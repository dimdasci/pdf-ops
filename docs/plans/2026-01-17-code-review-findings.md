# Code Review Findings: feature/bugfixes-pipeline-redesign

Date: 2026-01-17
Reviewers: effect-ts-architect, code-reviewer

## Status Summary

| Item                   | Status              |
| ---------------------- | ------------------- |
| Bug 1: PDF Preview     | ✅ COMPLETE         |
| Bug 3: Link Handling   | ✅ COMPLETE         |
| Bug 2: 4-Pass Pipeline | ⚠️ NEEDS REFACTORING |
| Model Selection        | ❌ NOT IMPLEMENTED  |
| Tests                  | ❌ NOT IMPLEMENTED  |

---

## Required Fixes

### FIX 1: Refactor Pipeline to Use Effect.ts (CRITICAL)

**Problem**: All new pipeline files use raw `async/await` with `Promise<T>` instead of Effect.ts patterns.

**Files to refactor**:

- `src/lib/pipeline/intelligent-pipeline.ts`
- `src/lib/pipeline/layout-analyzer.ts`
- `src/lib/pipeline/structure-analyzer.ts`
- `src/lib/pipeline/content-extractor.ts`
- `src/lib/pipeline/organizer.ts`

**What to do**:

1. Change return types from `Promise<T>` to `Effect.Effect<T, PipelineError>`:

```typescript
// BEFORE (current):
export async function runIntelligentPipeline(...): Promise<IntelligentPipelineResult>

// AFTER (required):
export function runIntelligentPipeline(...): Effect.Effect<IntelligentPipelineResult, PipelineError>
```

2. Use `Effect.gen` for async operations:

```typescript
export function runIntelligentPipeline(
  pdfService: PdfService,
  provider: LLMProvider,
  options: IntelligentPipelineOptions = {},
): Effect.Effect<IntelligentPipelineResult, PipelineError> {
  return Effect.gen(function*() {
    const layout = yield* analyzeLayoutEffect(pdfService, provider, options)
    const structure = yield* analyzeStructureEffect(pdfService, provider, layout)
    const content = yield* extractContentEffect(pdfService, provider, layout, structure)
    const result = yield* organizeContentEffect(content, structure)
    return result
  })
}
```

3. Keep async versions as wrappers for UI compatibility:

```typescript
// For React components that need Promise
export async function runIntelligentPipelineAsync(...): Promise<IntelligentPipelineResult> {
  return Effect.runPromise(runIntelligentPipeline(...))
}
```

---

### FIX 2: Add Typed Error Classes (CRITICAL)

**Problem**: Errors are caught with try/catch and logged with `console.warn`, losing type information.

**What to do**:

1. Add error types to `src/lib/pipeline/types/profiles.ts` or create `src/lib/pipeline/types/errors.ts`:

```typescript
import { Schema } from 'effect'

export class LayoutAnalysisError
  extends Schema.TaggedError<LayoutAnalysisError>()('LayoutAnalysisError', {
    message: Schema.String,
    pageNumber: Schema.optional(Schema.Number),
    cause: Schema.optional(Schema.Unknown),
  })
{}

export class StructureAnalysisError
  extends Schema.TaggedError<StructureAnalysisError>()('StructureAnalysisError', {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  })
{}

export class ContentExtractionError
  extends Schema.TaggedError<ContentExtractionError>()('ContentExtractionError', {
    message: Schema.String,
    pageNumber: Schema.optional(Schema.Number),
    cause: Schema.optional(Schema.Unknown),
  })
{}

export class OrganizationError
  extends Schema.TaggedError<OrganizationError>()('OrganizationError', {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  })
{}

export type IntelligentPipelineError =
  | LayoutAnalysisError
  | StructureAnalysisError
  | ContentExtractionError
  | OrganizationError
```

2. Replace try/catch with Effect error handling:

```typescript
// BEFORE:
try {
  const response = await provider.chat(prompt)
  return parseLayoutResponse(response, pageNumber)
} catch (error) {
  console.warn(`Layout analysis failed for page ${pageNumber}:`, error)
  return getDefaultPageAnalysis(pageNumber)
}

// AFTER:
return pipe(
  Effect.tryPromise({
    try: () => provider.chat(prompt),
    catch: error =>
      new LayoutAnalysisError({
        message: `Layout analysis failed for page ${pageNumber}`,
        pageNumber,
        cause: error,
      }),
  }),
  Effect.flatMap(response =>
    Effect.try({
      try: () => parseLayoutResponse(response, pageNumber),
      catch: error =>
        new LayoutAnalysisError({
          message: `Failed to parse layout response for page ${pageNumber}`,
          pageNumber,
          cause: error,
        }),
    })
  ),
  Effect.catchAll(() => Effect.succeed(getDefaultPageAnalysis(pageNumber))), // Fallback
)
```

---

### FIX 3: Add Retry Logic for LLM Calls (CRITICAL)

**Problem**: LLM calls (`provider.convertPage`, `provider.chat`) have no retry on failure.

**Files affected**:

- `layout-analyzer.ts` lines 262-306
- `structure-analyzer.ts` lines 75-94
- `content-extractor.ts` lines 116-123

**What to do**:

Use the existing `withRobustness` from `effect-wrapper.ts`:

```typescript
import { withRobustness } from './effect-wrapper'

// BEFORE:
const response = await provider.chat(prompt)

// AFTER:
const response = yield* withRobustness(
  () => provider.chat(prompt),
  {
    retryConfig: { maxAttempts: 3, baseDelayMs: 1000 },
    timeout: 120000  // 2 minutes
  }
)
```

---

### FIX 4: Add Rate Limiting (IMPORTANT)

**Problem**: `content-extractor.ts` processes pages without rate limiting.

**Location**: `content-extractor.ts` lines 100-161

**What to do**:

Use `Effect.forEach` with concurrency control:

```typescript
import { createRateLimiter } from './effect-wrapper'

// In extractContent function:
const rateLimiter = yield* createRateLimiter({
  concurrency: 2,  // Process 2 pages at a time
  requestsPerMinute: 30
})

const results = yield* Effect.forEach(
  pagesToProcess,
  (pageNum) => pipe(
    rateLimiter.acquire,
    Effect.flatMap(() => extractPageContentEffect(pageNum, ...)),
    Effect.tap(() => onProgress?.(pageNum, pageCount))
  ),
  { concurrency: 2 }
)
```

---

### FIX 5: Update Complexity Classifier (IMPORTANT)

**Problem**: The `intelligent` pipeline type was added but never auto-selected.

**File**: `src/lib/pipeline/complexity-classifier.ts`

**What to do**:

Add conditions in `determineComplexityLevel()` (around line 413) to recommend intelligent pipeline:

```typescript
// Add to determineComplexityLevel function:
if (
  analysis.hasComplexLayout // Multi-column, mixed layouts
  || analysis.hasFootnotes // Documents with footnotes benefit from 4-pass
  || pageCount > 20 // Longer documents benefit from structure analysis
  || analysis.documentType !== 'simple'
) {
  return 'intelligent'
}
```

---

### FIX 6: Add Unit Tests (IMPORTANT)

**Problem**: No tests added for new pipeline functionality.

**What to do**:

Create test files:

- `tests/unit/pipeline/layout-analyzer.test.ts`
- `tests/unit/pipeline/structure-analyzer.test.ts`
- `tests/unit/pipeline/organizer.test.ts`

Focus on testing pure utility functions:

- `parseLayoutResponse()` in layout-analyzer.ts
- `parseStructureResponse()` in structure-analyzer.ts
- `mergePartialParagraphs()` in organizer.ts
- `aggregateFootnotes()` in organizer.ts
- `validateHeadingHierarchy()` in organizer.ts

Example test:

```typescript
import { describe, expect, it } from 'vitest'
import { mergePartialParagraphs } from '../../../src/lib/pipeline/organizer'

describe('mergePartialParagraphs', () => {
  it('should merge sections with continuations', () => {
    const sections = [
      { id: '1', content: 'First part of paragraph', continuesTo: '2' },
      { id: '2', content: 'second part.', continuesFrom: '1' },
    ]
    const result = mergePartialParagraphs(sections)
    expect(result[0].content).toBe('First part of paragraph second part.')
  })
})
```

---

## Optional Improvements (Lower Priority)

### Model Selection Enhancement

Defer to follow-up PR. Create issue to track:

- Create `src/lib/llm/model-config.ts`
- Add Settings UI for model selection
- Allow per-pass model override

### Image DataURL Population

**File**: `content-extractor.ts` line 350

The `dataUrl` is set to empty string with comment "Will be filled by cropping later" but no cropping logic exists. Either:

- Implement image cropping using `pdfService.cropImage()`
- Or remove the field if not needed

---

## Verification Checklist

After fixes, verify:

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm run test:unit` passes (once tests added)
- [ ] PDF preview shows pages correctly
- [ ] External links open in system browser
- [ ] Internal markdown anchors scroll within preview
- [ ] Intelligent pipeline runs without errors
- [ ] LLM failures trigger retry logic
- [ ] Errors are properly typed and can be caught

---

## How to Apply These Fixes

1. Read this document fully
2. Start with FIX 1 (Effect.ts refactoring) as it's the foundation
3. Add error types (FIX 2) before refactoring functions
4. Add retry/rate limiting (FIX 3, 4) during Effect refactoring
5. Update classifier (FIX 5)
6. Add tests (FIX 6) to verify everything works
7. Run verification checklist
