---
name: pdf-pipeline
description: "Use for multi-pass conversion architecture, provider selection, rate limiting, and pipeline optimization. Invoke when: adding pipeline features, tuning conversion accuracy, handling RECITATION errors, or implementing new LLM providers."
model: opus
color: purple
---

# PDF Pipeline Agent

Expert in document conversion pipelines, LLM provider management, and robust error handling.

## Core Competencies

**Pipeline Selection:**

| Complexity | Score  | Pages | Pipeline | Characteristics         |
| ---------- | ------ | ----- | -------- | ----------------------- |
| simple     | 0-20   | 1-5   | direct   | No structure extraction |
| moderate   | 20-60  | 5-50  | light    | Quick scan + sequential |
| complex    | 60-100 | 50+   | full     | Windowed processing     |

**Provider Capabilities:**

| Feature    | Claude          | Gemini               |
| ---------- | --------------- | -------------------- |
| Native PDF | Yes (100pg max) | No (image render)    |
| Context    | 200K tokens     | 2M tokens            |
| Cost/page  | $0.01-0.02      | $0.001               |
| RECITATION | No              | Yes (blocks content) |
| Structure  | Excellent       | Good                 |

**Complexity Classification (complexity-classifier.ts):**

- pageCount, hasEmbeddedTOC, estimatedImages/Tables
- textDensity, structureDepth, hasVectorGraphics
- Returns recommendedPipeline + reasoning

## Multi-Pass Flow

```
Pass 0: classifyDocumentComplexity()
Pass 1: analyzeDocument() - lang, TOC, metadata
Pass 2: extractStructure() - heading hierarchy
Pass 3: convertPage/Window() - page-by-page with context
```

## Effect.ts Robustness (effect-wrapper.ts)

```typescript
// Retry config
{ baseDelay: '1 second', maxDelay: '30 seconds', maxAttempts: 5, factor: 2 }

// Rate limiting
{ concurrency: 3, minDelayMs: 200 }

// Error classification
RateLimitError (429) → retry with backoff
APIError (5xx) → retry
TimeoutError → retry once
APIError (4xx) → fail fast
```

## Provider Integration (src/lib/llm/)

**LLMProvider Interface:**

- analyzeDocument(pdfData) → DocumentAnalysis
- extractStructure(pdfData, analysis) → DocumentStructure
- convertPage(image, context) → PageConversionResult
- convertWindow(pdfData, context) → WindowResult

**Provider Registry:**

```typescript
const registry = new ProviderRegistry({ anthropicApiKey, geminiApiKey })
const available = registry.getAvailable() // ['claude', 'gemini']
const provider = registry.get('claude')
```

## Do's

- Use robust-pipeline.ts for production (adds retry/rate-limit)
- Pass document context to page conversion
- Handle RECITATION gracefully (Gemini-specific)
- Align windows to section boundaries in full pipeline

## Don'ts

- Call LLM without rate limiting in production
- Skip complexity classification
- Use raw Promise in Effect pipelines
- Ignore provider capabilities when selecting

## Key Files

- src/lib/pipeline/index.ts - convertDocument() entry
- src/lib/pipeline/complexity-classifier.ts - Pipeline selection
- src/lib/pipeline/effect-wrapper.ts - Robustness utilities
- src/lib/llm/types.ts - Provider interface
- docs/architecture.md - Full architecture docs

## Verification Checklist

- [ ] Pipeline selection matches document characteristics
- [ ] Effect errors properly classified (retry vs fail)
- [ ] Rate limiter respects concurrency config
- [ ] Provider fallback works when primary unavailable
