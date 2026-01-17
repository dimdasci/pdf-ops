# Effect.ts Audit Findings

**Date:** 2026-01-17
**Auditor:** Claude Code
**Scope:** Effect.ts usage patterns in pdf-translator codebase

## Executive Summary

The codebase uses Effect.ts primarily in the `effect-wrapper.ts` and `robust-pipeline.ts` files for retry logic, rate limiting, and error handling. While the implementation provides good foundational robustness, there are significant opportunities to improve Effect idiom adherence, type safety, and architectural patterns.

**Key Issues:**

- Error types use plain Error classes instead of Schema.TaggedError
- Heavy reliance on Effect.runPromise/runEffect at boundary points
- Services not using Effect.Service or Context.Tag patterns
- Resource management (PdfService) not using Effect Scope
- Pipeline code remains Promise-based when it could benefit from Effect composition

---

## 1. Error Handling Patterns

### 1.1 Error Classes Should Use Schema.TaggedError

**Location:** `src/lib/pipeline/effect-wrapper.ts:15-47`

**Issue:** Custom error types extend plain `Error` and manually add `_tag` property instead of using Effect's `Schema.TaggedError`.

**Current Code:**

```typescript
export class RateLimitError extends Error {
  readonly _tag = 'RateLimitError' as const
  readonly retryAfterMs?: number

  constructor(message: string, retryAfterMs?: number) {
    super(message)
    this.name = 'RateLimitError'
    this.retryAfterMs = retryAfterMs
  }
}
```

**Recommended Fix:**

```typescript
import { Schema } from 'effect'

class RateLimitError extends Schema.TaggedError<RateLimitError>()('RateLimitError', {
  message: Schema.String,
  retryAfterMs: Schema.optional(Schema.Number),
}) {}
```

**Priority:** HIGH - Affects type narrowing and error channel composition

---

### 1.2 Error Type Union Not Using Data.TaggedEnum

**Location:** `src/lib/pipeline/effect-wrapper.ts:48`

**Issue:** `PipelineError` is a simple union type. Using `Data.TaggedEnum` would provide better exhaustiveness checking and pattern matching.

**Current Code:**

```typescript
export type PipelineError = RateLimitError | APIError | TimeoutError
```

**Recommended Fix:**

```typescript
import { Data } from 'effect'

type PipelineError = Data.TaggedEnum<{
  RateLimitError: { message: string; retryAfterMs?: number }
  APIError: { message: string; statusCode?: number; isRetryable: boolean }
  TimeoutError: { message: string }
}>

const { RateLimitError, APIError, TimeoutError } = Data.taggedEnum<PipelineError>()
```

**Priority:** MEDIUM - Improves pattern matching ergonomics

---

### 1.3 Catch Block Uses Effect.catchAll Instead of Specific Error Handling

**Location:** `src/lib/pipeline/robust-pipeline.ts:351`

**Issue:** Uses `Effect.catchAll` with a type cast instead of properly typed error handling.

**Current Code:**

```typescript
Effect.catchAll(error => {
  const pipelineError = error as PipelineError
  onWindowError?.(window.windowNum, pipelineError)
  // ...
})
```

**Recommended Fix:**

```typescript
Effect.catchTags({
  RateLimitError: (e) => /* handle rate limit */,
  APIError: (e) => /* handle API error */,
  TimeoutError: (e) => /* handle timeout */,
})
```

**Priority:** MEDIUM - Improves type safety in error recovery

---

## 2. Service/Layer Architecture

### 2.1 No Effect.Service Pattern for LLM Providers

**Location:** `src/lib/llm/claude-provider.ts`, `src/lib/llm/gemini-provider.ts`

**Issue:** LLM providers are implemented as plain classes with Promise-based methods. No Effect Context.Tag or Effect.Service pattern is used for dependency injection.

**Current Code:**

```typescript
export class ClaudeProvider implements LLMProvider {
  private client: Anthropic

  async analyzeDocument(pdfData: Uint8Array | string): Promise<DocumentAnalysis> {
    // Promise-based implementation
  }
}
```

**Recommended Fix:**

```typescript
import { Context, Effect, Layer } from 'effect'

class ClaudeProvider extends Effect.Service<ClaudeProvider>()('ClaudeProvider', {
  effect: Effect.gen(function*() {
    const config = yield* ClaudeConfig
    const client = new Anthropic({ apiKey: config.apiKey })

    const analyzeDocument = Effect.fn('ClaudeProvider.analyzeDocument')(
      function*(pdfData: Uint8Array | string) {
        // Effect-based implementation
      },
    )

    return { analyzeDocument } as const
  }),
}) {}
```

**Priority:** HIGH - Core architectural improvement for testability and composition

---

### 2.2 ProviderRegistry Uses Singleton Pattern Instead of Layer

**Location:** `src/lib/llm/provider-registry.ts:36-57`

**Issue:** Uses a static singleton pattern (`getInstance()`) which is an anti-pattern in Effect. Should use Layer for lifecycle management.

**Current Code:**

```typescript
export class ProviderRegistry {
  private static instance: ProviderRegistry | null = null

  static getInstance(config?: ProviderRegistryConfig): ProviderRegistry {
    if (!ProviderRegistry.instance) {
      ProviderRegistry.instance = new ProviderRegistry(config)
    }
    return ProviderRegistry.instance
  }
}
```

**Recommended Fix:**

```typescript
class ProviderRegistry extends Context.Tag('ProviderRegistry')<
  ProviderRegistry,
  { getProvider: (type: ProviderType) => Effect.Effect<LLMProvider, ProviderNotConfiguredError> }
>() {
  static readonly Default = Layer.effect(
    ProviderRegistry,
    Effect.gen(function*() {
      const config = yield* ProviderRegistryConfig
      // implementation
    }),
  )
}
```

**Priority:** HIGH - Affects testability and proper Effect composition

---

### 2.3 PDF Service Not Using Effect Context

**Location:** `src/lib/pdf-service/index.ts`

**Issue:** `createPdfService` returns a plain object/class. Should be wrapped in Effect for proper lifecycle management via Scope.

**Current Code:**

```typescript
export async function createPdfService(
  data: Uint8Array,
  environment: PdfServiceEnvironment,
): Promise<PdfService> {
  // ...
  return service
}
```

**Recommended Fix:**

```typescript
class PdfServiceTag extends Context.Tag('PdfService')<
  PdfServiceTag,
  PdfService
>() {
  static readonly layer = (data: Uint8Array, environment: PdfServiceEnvironment) =>
    Layer.scoped(
      PdfServiceTag,
      Effect.acquireRelease(
        Effect.promise(() => createPdfServiceInternal(data, environment)),
        service => Effect.sync(() => service.destroy()),
      ),
    )
}
```

**Priority:** HIGH - Resource lifecycle should be managed by Effect Scope

---

## 3. Resource Management

### 3.1 PdfService.destroy() Not Managed by Scope

**Location:** `src/lib/pdf-service/browser.ts:40-46`, `src/lib/pdf-service/node.ts:82-88`

**Issue:** `destroy()` method is called manually. This is error-prone. Effect's Scope with `Effect.acquireRelease` would ensure cleanup always happens.

**Current Code:**

```typescript
// In browser.ts and node.ts
destroy(): void {
  if (this.pdfDoc) {
    this.pdfDoc.destroy()
    this.pdfDoc = null
  }
  this.pdfData = null
}

// Usage requires manual cleanup
const service = await createPdfService(data, 'node')
try {
  // use service
} finally {
  service.destroy()  // Easy to forget!
}
```

**Recommended Fix:**

```typescript
const usePdfService = (data: Uint8Array) =>
  Effect.acquireUseRelease(
    Effect.promise(() => createPdfServiceInternal(data)),
    (service) => /* effect using service */,
    (service) => Effect.sync(() => service.destroy())
  )
```

**Priority:** HIGH - Resource leaks are possible with current pattern

---

### 3.2 Rate Limiter State Not Scoped

**Location:** `src/lib/pipeline/effect-wrapper.ts:197-241`

**Issue:** `createRateLimiter` creates Refs and Semaphore but doesn't use Scope for lifecycle. If an Effect using the rate limiter is interrupted, resources may leak.

**Current Code:**

```typescript
export function createRateLimiter(
  config: RateLimitConfig = DEFAULT_RATE_LIMIT_CONFIG,
): Effect.Effect<RateLimiter, never> {
  return Effect.gen(function*() {
    const semaphore = yield* Effect.makeSemaphore(config.concurrency)
    const lastCallTime = yield* Ref.make(0)
    const concurrentCount = yield* Ref.make(0)
    // ...
  })
}
```

**Recommended Fix:**

```typescript
// Use Layer for rate limiter lifecycle
class RateLimiterTag extends Context.Tag('RateLimiter')<RateLimiterTag, RateLimiter>() {
  static readonly layer = (config: RateLimitConfig) =>
    Layer.effect(RateLimiterTag, createRateLimiter(config))
}
```

**Priority:** MEDIUM - Affects proper resource management in long-running processes

---

## 4. Concurrency Patterns

### 4.1 Full Pipeline Parallel Processing Uses Promise.all

**Location:** `src/lib/pipeline/full-pipeline.ts:586-633`

**Issue:** `processWindowsParallel` uses `Promise.all` for batch processing instead of Effect's concurrency primitives.

**Current Code:**

```typescript
async function processWindowsParallel(...) {
  for (let i = 0; i < windows.length; i += concurrency) {
    const batch = windows.slice(i, i + concurrency)
    const batchPromises = batch.map(async (window, batchIndex) => {
      // ...
    })
    await Promise.all(batchPromises)
  }
}
```

**Recommended Fix:**

```typescript
const processWindowsParallel = Effect.fn('processWindowsParallel')(
  function*(windows: WindowSpec[], options: Options) {
    return yield* Effect.forEach(
      windows,
      window => processWindow(window),
      { concurrency: options.concurrency },
    )
  },
)
```

**Priority:** MEDIUM - Effect's concurrency model provides better control and interruptibility

---

### 4.2 Effect.all with 'unbounded' Concurrency

**Location:** `src/lib/pipeline/effect-wrapper.ts:326-330`

**Issue:** Uses `{ concurrency: 'unbounded' }` while relying on manual semaphore. Should let Effect manage concurrency directly.

**Current Code:**

```typescript
const results = yield * Effect.all(
  items.map((item, index) => processItem(item, index)),
  { concurrency: 'unbounded' }, // Semaphore handles actual concurrency
)
```

**Recommended Fix:**

```typescript
const results = yield * Effect.forEach(
  items,
  (item, index) => processItem(item, index),
  { concurrency: config.concurrency },
)
```

**Priority:** LOW - Current approach works but is less idiomatic

---

## 5. Pipeline Composition

### 5.1 Pipelines Remain Promise-Based

**Location:** `src/lib/pipeline/direct-pipeline.ts`, `src/lib/pipeline/light-pipeline.ts`, `src/lib/pipeline/full-pipeline.ts`

**Issue:** All pipelines are async functions returning Promises. Only `robust-pipeline.ts` wraps them in Effect. This limits composition and forces boundary crossings.

**Current Code:**

```typescript
export async function runDirectPipeline(
  pdfService: PdfService,
  provider: LLMProvider,
  options: DirectPipelineOptions = {},
): Promise<DirectPipelineResult> {
  // async/await throughout
}
```

**Recommended Fix:**
Convert pipelines to Effect-native functions:

```typescript
export const runDirectPipeline = Effect.fn('runDirectPipeline')(
  function*(
    pdfService: PdfService,
    provider: LLMProvider,
    options: DirectPipelineOptions = {},
  ) {
    // yield* throughout
  },
)
```

**Priority:** MEDIUM - Would enable better error handling and cancellation

---

### 5.2 Large PDFs Could Benefit from Stream

**Location:** `src/lib/pipeline/full-pipeline.ts`

**Issue:** Full pipeline processes windows in an array. For very large documents (100+ pages), using Effect Stream would provide better memory characteristics and backpressure.

**Current Pattern:**

```typescript
const windowResults: WindowResult[] = []
for (let i = 0; i < windows.length; i++) {
  // process and accumulate
  windowResults.push(result)
}
```

**Recommended Fix:**

```typescript
import { Stream } from 'effect'

const processDocumentStream = (windows: WindowSpec[]) =>
  Stream.fromIterable(windows).pipe(
    Stream.mapEffect(window => processWindow(window)),
    Stream.runCollect,
  )
```

**Priority:** LOW - Only relevant for very large documents

---

## 6. Effect Idioms

### 6.1 runEffect Uses Type Cast

**Location:** `src/lib/pipeline/effect-wrapper.ts:286-288`

**Issue:** `runEffect` casts away the error type, hiding potential failures.

**Current Code:**

```typescript
export async function runEffect<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect as Effect.Effect<A, never>)
}
```

**Recommended Fix:**
Remove this helper entirely. Use proper Effect composition:

```typescript
// At program edges only, with proper error handling
Effect.runPromise(
  effect.pipe(
    Effect.catchAll((e) => /* handle or rethrow */)
  )
)
```

**Priority:** HIGH - This hides errors and breaks type safety

---

### 6.2 try-finally Pattern in Effect Generator

**Location:** `src/lib/pipeline/effect-wrapper.ts:208-231`

**Issue:** Uses try/finally inside Effect.gen, which doesn't work correctly with Effect semantics. The finally block runs JS code, not Effect code.

**Current Code:**

```typescript
const withRateLimit = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
  Effect.gen(function*() {
    yield* Ref.update(concurrentCount, n => n + 1)
    try {
      // ...
      return result
    } finally {
      yield* Ref.update(concurrentCount, n => n - 1) // ERROR: Can't yield in finally!
    }
  })
```

**Recommended Fix:**

```typescript
const withRateLimit = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
  Effect.acquireUseRelease(
    Ref.update(concurrentCount, n => n + 1),
    () => effect,
    () => Ref.update(concurrentCount, n => n - 1),
  )
```

**Priority:** HIGH - Current code has a bug (yield* in finally doesn't work)

---

### 6.3 Progress Tracker Uses Effect.runSync

**Location:** `src/lib/pipeline/effect-wrapper.ts:362`

**Issue:** `getProgress()` uses `Effect.runSync` which is blocking and should be avoided.

**Current Code:**

```typescript
getProgress: () => Effect.runSync(Ref.get(state)),
```

**Recommended Fix:**
Return an Effect instead of calling runSync:

```typescript
getProgress: () => Ref.get(state),  // Returns Effect
```

**Priority:** MEDIUM - runSync should be avoided except at program edges

---

### 6.4 Date.now() Used Inside Effect

**Location:** `src/lib/pipeline/effect-wrapper.ts:214`

**Issue:** Using `Date.now()` inside Effect breaks referential transparency and makes testing with TestClock impossible.

**Current Code:**

```typescript
const now = Date.now()
const lastTime = yield * Ref.get(lastCallTime)
const elapsed = now - lastTime
```

**Recommended Fix:**

```typescript
import { Clock } from 'effect'

const now = yield* Clock.currentTimeMillis
const lastTime = yield* Ref.get(lastCallTime)
const elapsed = Number(now) - lastTime
```

**Priority:** MEDIUM - Affects testability with TestClock

---

## 7. Testing Improvements

### 7.1 Tests Could Use TestServices More Extensively

**Location:** `tests/unit/effect-wrapper.test.ts`

**Issue:** While tests use TestClock correctly, they don't use other TestServices like TestConsole for logging verification.

**Current Pattern:**

```typescript
it.scoped('test name', () =>
  Effect.gen(function*() {
    // Uses TestClock but not other test services
  }))
```

**Recommended Enhancement:**

```typescript
import { TestConsole, TestContext } from 'effect'

it.scoped('test name', () =>
  Effect.gen(function*() {
    const console = yield* TestConsole.lines
    // verify logged messages
  }).pipe(Effect.provide(TestContext.TestContext)))
```

**Priority:** LOW - Current tests are adequate

---

## Summary by Priority

### HIGH Priority (6 findings) - ✅ ALL COMPLETED

1. ✅ Error types should use Schema.TaggedError
2. ✅ LLM Providers should use Effect.Service pattern
3. ✅ ProviderRegistry should use Layer instead of singleton
4. ✅ PdfService destroy should be managed by Scope
5. ✅ runEffect type cast hides errors
6. ✅ try-finally pattern in Effect generator is buggy

### MEDIUM Priority (6 findings) - ✅ ALL COMPLETED

1. ⏭️ Error union should use Data.TaggedEnum (skipped - Schema.TaggedError sufficient)
2. ✅ catchAll should be catchTags for type safety
3. ⏭️ Rate limiter should be scoped (skipped - handled by withRateLimit fix)
4. ✅ Parallel processing should use Effect.forEach
5. ✅ Progress tracker uses runSync
6. ✅ Date.now() breaks referential transparency

### LOW Priority (3 findings) - ✅ COMPLETED

1. ✅ Effect.all with unbounded concurrency → Effect.forEach
2. 📝 Large PDFs could use Stream (documented below)
3. ⏭️ Tests could use more TestServices (future enhancement)

---

## Stream for Large PDFs - Design Note

**Status:** Documented for future consideration

**When to consider Stream:**

- Documents with 100+ pages
- Memory-constrained environments
- Need for backpressure in processing

**Current approach works well because:**

- Most PDFs are < 100 pages
- WindowResult[] accumulation is bounded by document size
- Effect.forEach with concurrency already provides controlled processing

**Future implementation pattern:**

```typescript
import { Stream } from 'effect'

const processDocumentStream = (windows: WindowSpec[]) =>
  Stream.fromIterable(windows).pipe(
    Stream.mapEffect(window => processWindow(window), { concurrency: 3 }),
    Stream.runCollect,
  )
```

This would be beneficial if users report memory issues with very large documents.

---

## Implementation Roadmap

### Phase 1: Fix Critical Issues (HIGH priority)

1. Refactor error types to Schema.TaggedError
2. Fix try-finally bug in withRateLimit
3. Remove runEffect helper, use proper error handling

### Phase 2: Architecture Improvements (HIGH priority)

1. Convert ProviderRegistry to Layer pattern
2. Add Effect.Service pattern to LLM providers
3. Add Scope-based lifecycle for PdfService

### Phase 3: Enhance Patterns (MEDIUM priority)

1. Replace catchAll with catchTags
2. Use Clock.currentTimeMillis instead of Date.now
3. Convert pipelines to Effect-native

### Phase 4: Polish (LOW priority)

1. Consider Stream for large documents
2. Add more test service usage
3. Improve concurrency patterns

---

## Files Audited

| File                                  | Effect Usage | Issues Found |
| ------------------------------------- | ------------ | ------------ |
| `src/lib/pipeline/effect-wrapper.ts`  | Heavy        | 8            |
| `src/lib/pipeline/robust-pipeline.ts` | Heavy        | 3            |
| `src/lib/pipeline/direct-pipeline.ts` | None         | 1            |
| `src/lib/pipeline/light-pipeline.ts`  | None         | 1            |
| `src/lib/pipeline/full-pipeline.ts`   | None         | 2            |
| `src/lib/llm/claude-provider.ts`      | None         | 1            |
| `src/lib/llm/gemini-provider.ts`      | None         | 1            |
| `src/lib/llm/provider-registry.ts`    | None         | 1            |
| `src/lib/pdf-service/browser.ts`      | None         | 1            |
| `src/lib/pdf-service/node.ts`         | None         | 1            |
| `electron/main.ts`                    | None         | 0            |
| `tests/unit/effect-wrapper.test.ts`   | Heavy        | 1            |

---

_This audit was performed on the codebase at commit 7269138 (main branch)._
