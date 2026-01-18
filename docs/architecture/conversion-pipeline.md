# LLM PDF Conversion Pipeline Architecture

## Overview

The PDF-to-Markdown conversion system uses an adaptive multi-pipeline architecture that selects the optimal processing strategy based on document complexity. The system supports four distinct pipeline types, each optimized for different document characteristics.

## Table of Contents

- [Pipeline Selection](#pipeline-selection)
- [Pipeline Strategies](#pipeline-strategies)
  - [Direct Pipeline](#direct-pipeline)
  - [Light Pipeline](#light-pipeline)
  - [Full Pipeline](#full-pipeline)
  - [Intelligent Pipeline (4-Pass)](#intelligent-pipeline-4-pass)
- [Intelligent Pipeline Deep Dive](#intelligent-pipeline-deep-dive)
  - [Pass 1: Layout Analysis](#pass-1-layout-analysis)
  - [Pass 2: Structure Analysis](#pass-2-structure-analysis)
  - [Pass 3: Content Extraction](#pass-3-content-extraction)
  - [Pass 4: Content Organization](#pass-4-content-organization)
- [Complexity Classifier](#complexity-classifier)
- [LLM Provider Abstraction](#llm-provider-abstraction)
- [Effect.ts Integration](#effectts-integration)
- [Data Flow Diagrams](#data-flow-diagrams)
- [Type Definitions](#type-definitions)

---

## Pipeline Selection

The system automatically selects the optimal pipeline based on document analysis:

| Pipeline      | Page Range | Use Case            | Key Features                          |
| ------------- | ---------- | ------------------- | ------------------------------------- |
| `direct`      | 1-5 pages  | Simple documents    | Single-pass, minimal context          |
| `light`       | 5-50 pages | Moderate complexity | Quick structure scan + sequential     |
| `full`        | 50+ pages  | Large documents     | Windowed processing, parallel capable |
| `intelligent` | Any        | Complex layouts     | 4-pass deep analysis                  |

### Selection Criteria

The complexity classifier triggers the `intelligent` pipeline when:

- Multi-column layout detected
- Footnotes present
- Document > 20 pages with embedded TOC and deep structure
- Many tables (> 5)
- Dense mixed content with images

---

## Pipeline Strategies

### Direct Pipeline

**Location:** `src/lib/pipeline/direct-pipeline.ts`

**Purpose:** Fast conversion for simple, short documents.

**Characteristics:**

- Sequential page-by-page processing
- Minimal context passing (last 500 chars)
- No structure extraction
- No header/footer detection

**Processing Flow:**

```
For each page:
  1. Render page to image (DPI configurable)
  2. Convert via LLM with minimal context
  3. Process image placeholders
  4. Detect language (first page only)
```

**Best For:** Invoices, single forms, short memos, simple PDFs.

---

### Light Pipeline

**Location:** `src/lib/pipeline/light-pipeline.ts`

**Purpose:** Balanced conversion for medium-sized documents with some structure.

**Characteristics:**

- Quick document analysis phase
- Structure extraction (headings, TOC)
- Header/footer pattern detection
- Context-aware page conversion
- Post-processing for page-break handling

**Processing Phases:**

1. **Analysis** - Extract text from first 5 pages, analyze document
2. **Structure** - Extract headings and section hierarchy
3. **Pattern Detection** - Sample pages for repeating headers/footers
4. **Conversion** - Convert pages with structure context
5. **Post-processing** - Clean up, merge split paragraphs

**Best For:** Reports, manuals, presentations (5-50 pages).

---

### Full Pipeline

**Location:** `src/lib/pipeline/full-pipeline.ts`

**Purpose:** Robust conversion for large documents using windowed processing.

**Characteristics:**

- Comprehensive document analysis
- Windowed processing (configurable window size)
- Parallel processing support
- Rich context passing between windows
- Cross-reference tracking

**Best For:** Books, large manuals, academic papers (50+ pages).

---

### Intelligent Pipeline (4-Pass)

**Location:** `src/lib/pipeline/intelligent-pipeline.ts`

**Purpose:** Highest quality conversion through deep structure understanding.

**Characteristics:**

- Four specialized analysis passes
- LLM-guided layout detection
- Robust footnote handling
- Cross-page paragraph continuity
- Decorative image filtering

**Best For:** Complex documents with multi-column layouts, footnotes, deep hierarchies.

---

## Intelligent Pipeline Deep Dive

The 4-pass intelligent pipeline orchestrates specialized analysis phases:

```
Pass 1: Layout Analysis    -> LayoutProfile
Pass 2: Structure Analysis -> StructureProfile
Pass 3: Content Extraction -> RawContent
Pass 4: Content Organization -> Final Markdown
```

### Pass 1: Layout Analysis

**Location:** `src/lib/pipeline/layout-analyzer.ts`

**Purpose:** Identify visual structure patterns across the document.

**Input:**

- `PdfService` - Initialized PDF service
- `LLMProvider` - LLM for analysis
- Options (DPI, sample positions)

**Processing:**

1. Select sample pages (default: 10%, 30%, 50%, 70%, 90% positions)
2. For each sample page:
   - Render page to image
   - Extract page text
   - Send to LLM with structured prompt
   - Parse JSON response
3. Aggregate results using:
   - Median values for zone boundaries
   - Fuzzy matching for repeated elements
   - Pattern frequency thresholds (40%+)

**LLM Prompt Extracts:**

- Header/footer zone boundaries (percentage-based)
- Repeated text patterns
- Page number format
- Decorative images (logos, borders)
- Footnote style (numbered/symbolic/none)
- Column layout (single/double/mixed)

**Output:** `LayoutProfile`

```typescript
interface LayoutProfile {
  pageZones: {
    headerZone: { top: number; bottom: number } // % from top
    footerZone: { top: number; bottom: number }
    marginZones: { left: number; right: number }
  }
  repeatedElements: {
    headers: string[] // Fuzzy-matched patterns
    footers: string[]
    pageNumbers: string // Regex pattern
  }
  decorativeImages: {
    positions: Array<{ page: number; zone: 'header' | 'footer' | 'margin' }>
    patterns: string[] // Descriptions like "logo top-right"
  }
  footnoteStyle: 'numbered' | 'symbolic' | 'none'
  columnLayout: 'single' | 'double' | 'mixed'
}
```

**Error Handling:**

- Falls back to default values on parse failure
- Uses `LayoutAnalysisError` with page number context
- Retry logic via `withRetry()` wrapper

---

### Pass 2: Structure Analysis

**Location:** `src/lib/pipeline/structure-analyzer.ts`

**Purpose:** Extract logical document organization.

**Input:**

- `PdfService` - For text extraction
- `LLMProvider` - For analysis
- `LayoutProfile` - From Pass 1 (used to filter headers/footers)

**Processing:**

1. Sample pages at strategic positions (5%, 20%, 40%, 60%, 80%, 95%)
2. Filter out header/footer content using LayoutProfile patterns
3. Build analysis prompt with filtered text samples
4. Send to LLM for structure extraction
5. Parse and validate JSON response

**LLM Extracts:**

- Document type classification
- Table of contents (explicit or inferred)
- Heading hierarchy with style indicators
- Section boundaries (front/body/back matter)
- Cross-reference style (footnote placement, citation style)

**Output:** `StructureProfile`

```typescript
interface StructureProfile {
  documentType: 'academic' | 'book' | 'report' | 'marketing' | 'manual' | 'legal' | 'other'
  toc: {
    explicit: boolean // Was TOC found in document?
    entries: TocEntry[] // Hierarchical TOC
  }
  hierarchy: {
    maxDepth: number // e.g., 3 for H1-H2-H3
    headingStyles: Array<{
      level: number
      indicators: string[] // 'larger-font', 'bold', 'numbered', etc.
    }>
  }
  sections: {
    frontMatter: PageRange | null // Title, TOC, preface
    body: PageRange // Main content
    backMatter: PageRange | null // Appendix, index
  }
  crossReferences: {
    footnoteStyle: 'inline' | 'endnote' | 'chapter-end'
    citationStyle: string | null // 'APA', 'MLA', etc.
  }
}
```

**Error Handling:**

- Returns default profile on parse failure
- Logs warnings for JSON parsing issues

---

### Pass 3: Content Extraction

**Location:** `src/lib/pipeline/content-extractor.ts`

**Purpose:** Extract content from each page using layout and structure profiles.

**Input:**

- `PdfService` - For page rendering
- `LLMProvider` - For conversion
- `LayoutProfile` - From Pass 1
- `StructureProfile` - From Pass 2
- Options (DPI, concurrency, progress callback)

**Processing:**
For each page (sequentially for context continuity):

1. Render page to image
2. Build `PageContext` with:
   - Expected headings from structure profile
   - Header/footer patterns to filter
   - Previous page summary and content (for continuity)
   - Current section from TOC
3. Convert via LLM with `convertPage()`
4. Parse result:
   - Remove repeated elements
   - Extract footnotes
   - Parse sections from headings
   - Classify images as decorative or meaningful
   - Track incomplete paragraphs

**Output:** `RawContent`

```typescript
interface RawContent {
  sections: Section[]
  footnotes: Map<string, Footnote>
  images: Map<string, ImageRef>
  pendingContinuations: string[] // Section IDs split across pages
}

interface Section {
  id: string
  level: number // 0 for non-heading content
  title: string
  content: string // Markdown content
  footnoteRefs: string[] // Referenced footnote IDs
  imageRefs: string[] // Referenced image IDs
  continuesFrom?: string // Previous section ID if split
}
```

**Rate Limiting:**

- Configurable concurrency (default: 2)
- Minimum delay between requests (default: 500ms)
- Semaphore-based permit system

**Error Handling:**

- `ContentExtractionError` with page context
- Retry logic on transient failures

---

### Pass 4: Content Organization

**Location:** `src/lib/pipeline/organizer.ts`

**Purpose:** Assemble extracted content into clean, properly formatted markdown.

**Input:**

- `RawContent` - From Pass 3
- `StructureProfile` - From Pass 2
- Options (include TOC, max TOC level, section spacing)

**Processing Steps:**

1. **Merge Continued Sections**
   - Track `continuesFrom` links
   - Combine content from split paragraphs
   - Deduplicate footnote and image references

2. **Validate Heading Hierarchy**
   - Prevent invalid jumps (e.g., H1 -> H3)
   - Correct levels progressively (max +1 per step)

3. **Determine Footnote Placement**
   - Based on document type:
     - `academic` -> document end
     - `book` -> chapter/section end
     - `report`, `manual` -> section end
     - Others -> inline

4. **Generate TOC** (optional)
   - From structure profile entries
   - Respects max depth setting
   - Creates anchor links

5. **Render Sections**
   - Apply corrected heading levels
   - Normalize footnote markers to `[^id]` format
   - Resolve image references
   - Place footnotes according to strategy

6. **Final Cleanup**
   - Remove excessive blank lines
   - Remove trailing whitespace
   - Fix broken list items
   - Remove empty headings
   - Normalize horizontal rules

**Output:** Final markdown string

**Error Handling:**

- `OrganizationError` for assembly failures
- Wrapped in Effect for typed error handling

---

## Complexity Classifier

**Location:** `src/lib/pipeline/complexity-classifier.ts`

**Purpose:** Analyze document characteristics and recommend optimal pipeline.

### Analysis Process

1. **Gather Metadata**
   - Page count
   - Embedded TOC/outline presence

2. **Sample Pages** (first, middle, last by default)
   - Extract text
   - Count images
   - Detect patterns

3. **Calculate Factors**

| Factor                 | Detection Method           |
| ---------------------- | -------------------------- |
| `hasEmbeddedTOC`       | PDF outline presence       |
| `estimatedImages`      | Sample extrapolation       |
| `estimatedTables`      | Pipe/tab patterns in text  |
| `textDensity`          | Chars per page thresholds  |
| `structureDepth`       | Numbered heading patterns  |
| `hasCodeBlocks`        | Function/class patterns    |
| `hasMathFormulas`      | LaTeX/Unicode math symbols |
| `hasFootnotes`         | Bracketed numbers, symbols |
| `hasMultiColumnLayout` | Whitespace gap analysis    |

### Complexity Score (0-100)

| Component          | Points |
| ------------------ | ------ |
| Page count (>100)  | 40     |
| Page count (>50)   | 30     |
| Page count (>20)   | 20     |
| Page count (>5)    | 10     |
| Has embedded TOC   | 10     |
| Structure depth >4 | 10     |
| Structure depth >2 | 5      |
| Images >50         | 12     |
| Images >20         | 8      |
| Tables >10         | 10     |
| Tables >3          | 6      |
| Code blocks        | 4      |
| Math formulas      | 4      |
| Dense text         | 10     |

### Pipeline Selection Rules

```
Score >= 60           -> 'complex' + 'full' pipeline
Score >= 20           -> 'moderate' + 'light' pipeline
Score < 20            -> 'simple' + 'direct' pipeline

OVERRIDE to 'intelligent':
  - hasMultiColumnLayout
  - hasFootnotes
  - pageCount > 20
  - hasEmbeddedTOC && structureDepth > 2
  - estimatedTables > 5
  - estimatedImages > 10 && textDensity === 'dense'
```

---

## LLM Provider Abstraction

**Location:** `src/lib/llm/`

### Provider Interface

```typescript
interface LLMProvider {
  name: string
  displayName: string
  capabilities: ProviderCapabilities

  // Document-level
  analyzeDocument(pdfData: Uint8Array | string): Promise<DocumentAnalysis>
  extractStructure(pdfData, analysis): Promise<DocumentStructure>

  // Page-level
  convertPage(imageBase64: string, context: PageContext): Promise<PageConversionResult>
  convertWindow(pdfData, context: WindowContext): Promise<WindowResult>

  // Utility
  classifyImage(imageBase64: string): Promise<ImageClassification>
  summarize(content: string, maxLength?: number): Promise<string>
  chat(prompt: string): Promise<string>

  // Management
  validateConnection(): Promise<boolean>
  estimateCost(pageCount: number, complexity: number): number
}
```

### Provider Capabilities

| Capability        | Claude                              | Gemini           |
| ----------------- | ----------------------------------- | ---------------- |
| Native PDF        | Yes (100 pages)                     | No (image-based) |
| Context Window    | 200K tokens                         | 2M tokens        |
| RECITATION Filter | No                                  | Yes              |
| Cost/page         | $0.01-0.02                          | $0.001           |
| Models            | claude-sonnet-4-5, claude-haiku-4-5 | gemini-2.5-flash |

### Claude Provider

**File:** `src/lib/llm/claude-provider.ts`

- Uses Anthropic SDK
- Native PDF support via base64 document blocks
- Two-model strategy:
  - Sonnet for complex tasks (analysis, structure)
  - Haiku for simple tasks (summaries, chat)
- Supports vision with bounding box extraction

### Gemini Provider

**File:** `src/lib/llm/gemini-provider.ts`

- Uses Google Generative AI SDK
- Image-based processing only
- Larger context window (2M tokens)
- RECITATION filter may block copyrighted content
- Lower cost per page

---

## Effect.ts Integration

**Location:** `src/lib/pipeline/effect-wrapper.ts`

### Error Types

```typescript
class RateLimitError extends Schema.TaggedError('RateLimitError') {
  message: string
  retryAfterMs?: number
}

class APIError extends Schema.TaggedError('APIError') {
  message: string
  statusCode?: number
  isRetryable: boolean
}

class TimeoutError extends Schema.TaggedError('TimeoutError') {
  message: string
}

type PipelineError = RateLimitError | APIError | TimeoutError
```

### Retry Logic

```typescript
const DEFAULT_RETRY_CONFIG = {
  baseDelay: '1 second',
  maxDelay: '30 seconds',
  maxAttempts: 5,
  factor: 2, // Exponential backoff
}

// Usage
const result = yield * withRetry(
  () => provider.convertPage(image, context),
  { ...DEFAULT_RETRY_CONFIG, maxAttempts: 3 },
)
```

**Retry Schedule:**

- Exponential backoff: 1s, 2s, 4s, 8s, ...
- Capped at maxDelay (30s)
- Limited attempts (default: 5)

**Retryable Conditions:**

- `RateLimitError` (always)
- `APIError` with `isRetryable: true`
- Messages containing: "rate limit", "429", "503", "timeout", "network"

### Rate Limiting

```typescript
const rateLimiter = yield * createRateLimiter({
  concurrency: 3, // Max concurrent requests
  minDelayMs: 200, // Minimum gap between requests
})

// Usage
const result = yield * rateLimiter.withRateLimit(effect)
```

**Implementation:**

- Semaphore for concurrency control
- Clock-based delay enforcement
- Ref-based state tracking

### Pipeline Error Types

Each pipeline pass has a dedicated error type:

```typescript
class LayoutAnalysisError extends Schema.TaggedError('LayoutAnalysisError') {
  message: string
  pageNumber?: number
  cause?: unknown
}

class StructureAnalysisError extends Schema.TaggedError('StructureAnalysisError') {
  message: string
  cause?: unknown
}

class ContentExtractionError extends Schema.TaggedError('ContentExtractionError') {
  message: string
  pageNumber?: number
  cause?: unknown
}

class OrganizationError extends Schema.TaggedError('OrganizationError') {
  message: string
  cause?: unknown
}

type IntelligentPipelineError =
  | LayoutAnalysisError
  | StructureAnalysisError
  | ContentExtractionError
  | OrganizationError
```

**Exhaustive Handling:**

```typescript
pipe(
  pipelineEffect,
  Effect.catchTags({
    LayoutAnalysisError: e => handleLayoutError(e),
    StructureAnalysisError: e => handleStructureError(e),
    ContentExtractionError: e => handleContentError(e),
    OrganizationError: e => handleOrgError(e),
  }),
)
```

---

## Data Flow Diagrams

### High-Level Pipeline Selection

```
PDF Input
    |
    v
+-------------------+
| classifyDocument  |
| Complexity()      |
+-------------------+
    |
    +---> score < 20  --------> Direct Pipeline
    |
    +---> score 20-60 --------> Light Pipeline
    |
    +---> score >= 60 --------> Full Pipeline
    |
    +---> multi-column OR ----> Intelligent Pipeline
          footnotes OR
          deep structure
```

### Intelligent Pipeline Data Flow

```
                          PDF Input
                              |
                              v
+---------------------------------------------------------------+
|                    PASS 1: Layout Analysis                     |
|    Sample Pages (10%, 30%, 50%, 70%, 90%)                     |
|    LLM: Identify zones, patterns, decorative elements          |
+---------------------------------------------------------------+
                              |
                              v
                        LayoutProfile
                              |
                              v
+---------------------------------------------------------------+
|                   PASS 2: Structure Analysis                   |
|    Filter text using LayoutProfile                             |
|    LLM: Extract TOC, headings, sections, references            |
+---------------------------------------------------------------+
                              |
                              v
                       StructureProfile
                              |
                              v
+---------------------------------------------------------------+
|                   PASS 3: Content Extraction                   |
|    For each page (with rate limiting):                         |
|      - Render image                                            |
|      - Build context from profiles                             |
|      - LLM: Convert with expected headings                     |
|      - Parse sections, footnotes, images                       |
|      - Track continuations                                     |
+---------------------------------------------------------------+
                              |
                              v
                          RawContent
                   (sections, footnotes, images)
                              |
                              v
+---------------------------------------------------------------+
|                   PASS 4: Content Organization                 |
|    - Merge continued sections                                  |
|    - Validate heading hierarchy                                |
|    - Place footnotes by document type                          |
|    - Generate TOC                                              |
|    - Resolve references                                        |
|    - Final cleanup                                             |
+---------------------------------------------------------------+
                              |
                              v
                       Final Markdown
```

### Rate-Limited Page Processing

```
Pages [1, 2, 3, 4, 5, ...]
           |
           v
    +-------------+
    | RateLimiter |
    | (semaphore) |
    +-------------+
           |
    +------+------+
    |             |
    v             v
 [Permit 1]   [Permit 2]    <- Max concurrency
    |             |
    v             v
  LLM API     LLM API
    |             |
    +------+------+
           |
           v
    +-------------+
    | minDelayMs  |  <- Enforced gap
    +-------------+
           |
           v
      Results[]
```

---

## Type Definitions

### Core Profile Types

**File:** `src/lib/pipeline/types/profiles.ts`

```typescript
// Page range (1-indexed, inclusive)
interface PageRange {
  start: number
  end: number
}

// Zone boundaries as percentages
interface ZoneBoundary {
  top: number // 0-100 from page top
  bottom: number
}

// TOC entry with nesting
interface TocEntry {
  level: number
  title: string
  page: number
  children?: TocEntry[]
}

// Extracted footnote
interface Footnote {
  id: string
  content: string
  page: number
}

// Image reference
interface ImageRef {
  id: string
  description: string
  dataUrl: string
  page: number
  isDecorative: boolean
}

// Content section
interface Section {
  id: string
  level: number
  title: string
  content: string
  footnoteRefs: string[]
  imageRefs: string[]
  continuesFrom?: string
}
```

### Combined Types

```typescript
// Profiles from passes 1-2
interface DocumentProfiles {
  layout: LayoutProfile
  structure: StructureProfile
}

// Complete extraction (passes 1-3)
interface ExtractionResult {
  profiles: DocumentProfiles
  content: RawContent
}
```

---

## File Reference

| File                                        | Purpose                                |
| ------------------------------------------- | -------------------------------------- |
| `src/lib/pipeline/index.ts`                 | Main exports, `convertDocument()`      |
| `src/lib/pipeline/complexity-classifier.ts` | Document analysis & pipeline selection |
| `src/lib/pipeline/direct-pipeline.ts`       | Simple document conversion             |
| `src/lib/pipeline/light-pipeline.ts`        | Medium complexity conversion           |
| `src/lib/pipeline/full-pipeline.ts`         | Large document windowed processing     |
| `src/lib/pipeline/intelligent-pipeline.ts`  | 4-pass orchestrator                    |
| `src/lib/pipeline/layout-analyzer.ts`       | Pass 1: Layout detection               |
| `src/lib/pipeline/structure-analyzer.ts`    | Pass 2: Structure extraction           |
| `src/lib/pipeline/content-extractor.ts`     | Pass 3: Content processing             |
| `src/lib/pipeline/organizer.ts`             | Pass 4: Final assembly                 |
| `src/lib/pipeline/effect-wrapper.ts`        | Effect.ts utilities                    |
| `src/lib/pipeline/robust-pipeline.ts`       | Effect-wrapped robust conversion       |
| `src/lib/pipeline/types/profiles.ts`        | Type definitions                       |
| `src/lib/pipeline/types/errors.ts`          | Error types                            |
| `src/lib/llm/types.ts`                      | Provider interface & types             |
| `src/lib/llm/claude-provider.ts`            | Anthropic Claude implementation        |
| `src/lib/llm/gemini-provider.ts`            | Google Gemini implementation           |
| `src/lib/llm/provider-registry.ts`          | Provider management                    |
