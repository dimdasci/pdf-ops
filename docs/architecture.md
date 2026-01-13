# Technical Architecture

## Overview

PDF-to-Markdown is an Electron desktop application that converts PDF documents into well-structured Markdown files using LLM-based analysis. The architecture supports multiple LLM providers and uses adaptive pipelines based on document complexity.

## Key Design Principles

1. **Multi-provider support**: Abstract LLM operations behind a unified interface
2. **Adaptive processing**: Choose optimal pipeline based on document complexity
3. **Cross-environment PDF handling**: Unified PDF service for both Node.js and browser
4. **Robust error handling**: Effect.ts integration for retries and rate limiting
5. **Structure-guided conversion**: Extract document structure before page conversion

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Electron App                                   │
├─────────────────────────────────────────────────────────────────────────┤
│  UI Layer (React)                                                        │
│  ├── Workspace.tsx       - Main conversion interface                     │
│  ├── SettingsModal.tsx   - API key configuration                         │
│  └── PDF Viewer          - Document preview                              │
├─────────────────────────────────────────────────────────────────────────┤
│  Pipeline Layer                                                          │
│  ├── complexity-classifier.ts  - Analyze doc, choose pipeline            │
│  ├── direct-pipeline.ts        - Simple docs (1-5 pages)                 │
│  ├── light-pipeline.ts         - Moderate docs (5-50 pages)              │
│  ├── full-pipeline.ts          - Complex docs (50+ pages)                │
│  └── robust-pipeline.ts        - Effect.ts wrapper for reliability       │
├─────────────────────────────────────────────────────────────────────────┤
│  LLM Provider Layer                                                      │
│  ├── types.ts            - LLMProvider interface                         │
│  ├── claude-provider.ts  - Anthropic Claude (native PDF)                 │
│  ├── gemini-provider.ts  - Google Gemini (image-based)                   │
│  └── provider-registry.ts - Manage available providers                   │
├─────────────────────────────────────────────────────────────────────────┤
│  PDF Service Layer                                                       │
│  ├── types.ts            - PdfService interface                          │
│  ├── browser.ts          - Browser implementation (canvas)               │
│  ├── node.ts             - Node.js implementation (@napi-rs/canvas)      │
│  └── vector-detector.ts  - PDF operator analysis for graphics            │
└─────────────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
src/
├── lib/
│   ├── llm/                    # LLM Provider Abstraction
│   │   ├── types.ts            # Interfaces: LLMProvider, DocumentAnalysis, etc.
│   │   ├── claude-provider.ts  # Claude implementation (native PDF support)
│   │   ├── gemini-provider.ts  # Gemini implementation (image-based)
│   │   ├── provider-registry.ts # Provider management
│   │   └── index.ts            # Factory exports
│   │
│   ├── pipeline/               # Conversion Pipelines
│   │   ├── complexity-classifier.ts  # Document analysis & pipeline selection
│   │   ├── direct-pipeline.ts        # Fast single-pass conversion
│   │   ├── light-pipeline.ts         # Structure-guided conversion
│   │   ├── full-pipeline.ts          # Multi-pass with windowing
│   │   ├── robust-pipeline.ts        # Effect.ts error handling
│   │   ├── effect-wrapper.ts         # Effect.ts utilities
│   │   └── index.ts                  # Main convertDocument() function
│   │
│   ├── pdf-service/            # Cross-Environment PDF Handling
│   │   ├── types.ts            # PdfService interface
│   │   ├── browser.ts          # Browser implementation
│   │   ├── node.ts             # Node.js implementation
│   │   ├── vector-detector.ts  # Vector graphics detection
│   │   └── index.ts            # Factory: createPdfService()
│   │
│   ├── converter.ts            # Legacy converter (deprecated)
│   ├── gemini.ts               # Legacy Gemini service (deprecated)
│   └── image-utils.ts          # Image processing utilities
│
├── components/                 # React UI Components
├── main/                       # Electron main process
└── preload/                    # Electron preload scripts

tests/
├── e2e/
│   ├── conversion.test.ts      # Ground truth validation tests
│   └── pipeline.test.ts        # Pipeline smoke tests
├── fixtures/                   # Test PDFs with expected.json
└── utils/                      # Test utilities (validators, loaders)
```

## LLM Provider Architecture

### Interface

```typescript
interface LLMProvider {
  readonly name: string;           // 'claude' | 'gemini'
  readonly displayName: string;    // UI display name
  readonly capabilities: ProviderCapabilities;

  // Document-level operations
  analyzeDocument(pdfData: Uint8Array | string): Promise<DocumentAnalysis>;
  extractStructure(pdfData: Uint8Array | string, analysis: DocumentAnalysis): Promise<DocumentStructure>;

  // Page-level operations
  convertPage(imageBase64: string, context: PageContext): Promise<PageConversionResult>;
  convertWindow(pdfData: Uint8Array | string, context: WindowContext): Promise<WindowResult>;

  // Utilities
  classifyImage(imageBase64: string): Promise<ImageClassification>;
  summarize(content: string, maxLength?: number): Promise<string>;
  chat(prompt: string): Promise<string>;
  validateConnection(): Promise<boolean>;
  estimateCost(pageCount: number, complexity: number): number;
}
```

### Provider Comparison

| Feature | Claude | Gemini |
|---------|--------|--------|
| Native PDF support | Yes (up to 100 pages) | No (requires image rendering) |
| Models | claude-sonnet-4-5-20250929 (complex), claude-haiku-4-5-20251001 (simple) | gemini-2.5-flash |
| RECITATION filter | No | Yes (blocks copyrighted content) |
| Context window | 200K tokens | 2M tokens |
| Cost per page | ~$0.01-0.02 | ~$0.001 |
| Structure extraction | Excellent (semantic) | Good (visual inference) |

### Provider Selection

```typescript
// Provider is selected based on available API keys
const registry = new ProviderRegistry({
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  geminiApiKey: process.env.GEMINI_API_KEY,
});

const availableProviders = registry.getAvailable(); // ['claude', 'gemini']
const provider = registry.get('claude');
```

## Pipeline Architecture

### Complexity Classifier

Before processing, documents are analyzed to determine optimal pipeline:

```typescript
interface DocumentComplexity {
  level: 'simple' | 'moderate' | 'complex';
  score: number; // 0-100
  factors: {
    pageCount: number;
    hasEmbeddedTOC: boolean;
    estimatedImages: number;
    estimatedTables: number;
    hasVectorGraphics: boolean;
    textDensity: 'sparse' | 'normal' | 'dense';
    structureDepth: number;
  };
  recommendedPipeline: 'direct' | 'light' | 'full';
  estimatedTimeSeconds: number;
}
```

### Pipeline Selection

| Pipeline | Complexity | Pages | Description |
|----------|------------|-------|-------------|
| **Direct** | Simple (0-20) | 1-5 | Single-pass, page-by-page conversion. No structure extraction. |
| **Light** | Moderate (20-60) | 5-50 | Quick structure scan, then sequential conversion with context. |
| **Full** | Complex (60-100) | 50+ | Multi-pass: global scan, structure extraction, windowed conversion. |

### Pipeline Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                        convertDocument()                              │
├──────────────────────────────────────────────────────────────────────┤
│  1. classifyDocumentComplexity(pdfService)                           │
│     └── Returns: { level, score, recommendedPipeline }               │
│                                                                       │
│  2. Select pipeline based on complexity or forcePipeline option       │
│                                                                       │
│  3. Run selected pipeline:                                            │
│     ├── direct:  runDirectPipeline()   → Fast, no structure          │
│     ├── light:   runLightPipeline()    → Structure-guided            │
│     └── full:    runFullPipeline()     → Windowed processing         │
│                                                                       │
│  4. Return ConversionResult with markdown and metadata                │
└──────────────────────────────────────────────────────────────────────┘
```

### Direct Pipeline (Simple Documents)

```typescript
// 1-5 pages, no TOC, minimal structure
async function runDirectPipeline(pdfService, provider, options) {
  const pageCount = pdfService.getPageCount();
  const results = [];

  for (let page = 1; page <= pageCount; page++) {
    const image = await pdfService.renderPage(page, { dpi: options.dpi });
    const result = await provider.convertPage(image, {
      pageNumber: page,
      totalPages: pageCount,
      previousContent: results[page - 2]?.content || '',
    });
    results.push(result);
  }

  return mergeResults(results);
}
```

### Light Pipeline (Moderate Documents)

```typescript
// 5-50 pages, some structure
async function runLightPipeline(pdfService, provider, options) {
  // Pass 1: Quick document analysis (text-only)
  const text = await getAllPageText(pdfService);
  const analysis = await provider.analyzeDocument(text);

  // Pass 2: Extract structure (headings, sections)
  const structure = await provider.extractStructure(text, analysis);

  // Pass 3: Sequential conversion with structure hints
  const results = [];
  for (let page = 1; page <= pageCount; page++) {
    const image = await pdfService.renderPage(page);
    const result = await provider.convertPage(image, {
      pageNumber: page,
      expectedHeadings: structure.headingsByPage.get(page) || [],
      headerPattern: analysis.headerPattern,
      footerPattern: analysis.footerPattern,
      // ... more context
    });
    results.push(result);
  }

  return mergeResults(results, structure);
}
```

### Full Pipeline (Complex Documents)

```typescript
// 50+ pages, rich structure
async function runFullPipeline(pdfService, provider, options) {
  // Pass 0: Global structure scan (full document)
  const pdfData = await pdfService.extractPageRange(1, pageCount);
  const analysis = await provider.analyzeDocument(pdfData);

  // Pass 1: Structure extraction
  const structure = await provider.extractStructure(pdfData, analysis);

  // Pass 2: Compute windows (aligned to section boundaries)
  const windows = computeWindows(structure, { maxPagesPerWindow: 50 });

  // Pass 3: Convert windows (can be parallel)
  const windowResults = await processWindows(windows, provider, {
    global: { toc: structure.headings, ... },
    parallel: options.parallel,
  });

  // Pass 4: Merge windows with continuity handling
  return mergeWindowResults(windowResults);
}
```

## PDF Service Architecture

### Interface

```typescript
interface PdfService {
  // Lifecycle
  load(data: Uint8Array): Promise<void>;
  destroy(): void;

  // Metadata
  getPageCount(): number;
  getMetadata(): Promise<PdfMetadata>;
  getOutline(): Promise<OutlineItem[] | null>;

  // Rendering
  renderPage(pageNum: number, options?: RenderOptions): Promise<string>;
  cropImage(base64Image: string, options: CropOptions): Promise<string>;

  // Text extraction
  getPageText(pageNum: number): Promise<string>;

  // Page manipulation
  extractPageRange(startPage: number, endPage: number): Promise<Uint8Array>;

  // Image extraction
  getPageImages(pageNum: number): Promise<EmbeddedImage[]>;

  // Vector graphics (optional)
  detectVectorRegions?(pageNum: number): Promise<VectorRegion[]>;
  renderAsSvg?(pageNum: number, region?: VectorRegion): Promise<string>;
  renderRegion?(pageNum: number, region: VectorRegion, scale?: number): Promise<string>;
}
```

### Environment-Specific Implementations

| Method | Browser (BrowserPdfService) | Node.js (NodePdfService) |
|--------|----------------------------|--------------------------|
| PDF parsing | pdf.js | pdf.js |
| Canvas rendering | HTMLCanvasElement | @napi-rs/canvas |
| Image cropping | browser canvas | @napi-rs/canvas |
| Page extraction | pdf-lib | pdf-lib |

### Factory Pattern

```typescript
// Create appropriate service based on environment
const pdfService = await createPdfService(pdfBuffer, 'node'); // or 'browser'
```

## Robust Pipeline (Effect.ts)

For production reliability, the robust pipeline adds:

- **Retry with exponential backoff**: Automatic retry on transient failures
- **Rate limiting**: Prevent API throttling
- **Error recovery**: Continue processing even if some pages fail
- **Progress tracking**: Detailed status updates

```typescript
const result = await convertDocumentRobust(pdfService, provider, {
  retryConfig: {
    maxAttempts: 3,
    baseDelay: '1 second',
    maxDelay: '30 seconds',
  },
  continueOnError: true,
  onProgress: (status, current, total) => console.log(status),
  onError: (error, context) => console.error(context, error),
});
```

## Vector Graphics Detection

PDFs contain two types of graphics:
1. **Raster images**: Embedded JPEG/PNG (easy to extract)
2. **Vector graphics**: Drawn with PDF operators (paths, fills, strokes)

### Detection Process

```typescript
// Analyze PDF operator list
const regions = await pdfService.detectVectorRegions(pageNum);

// Each region contains:
{
  bbox: [x, y, width, height],  // Page coordinates
  pathCount: 15,                // Number of path operations
  hasStroke: true,              // Contains stroked paths
  hasFill: true,                // Contains filled regions
  complexity: 0.7,              // 0-1 complexity score
  type: 'diagram'               // Inferred type
}
```

### Extraction Strategy

1. **Detect** vector regions via operator list analysis
2. **Classify** using LLM vision (is this a diagram/chart/logo?)
3. **Extract** as SVG (via PDF.js SVGGraphics) or high-res PNG fallback
4. **Embed** in markdown with semantic description

## Configuration

### Environment Variables

```bash
# LLM Provider API Keys
ANTHROPIC_API_KEY=sk-ant-...    # For Claude provider
GEMINI_API_KEY=AIza...          # For Gemini provider

# Test Configuration
PROVIDER=claude                  # Select provider for tests (claude|gemini)
```

### Electron Storage

API keys are stored securely using `electron-store` with encryption:

```typescript
interface Settings {
  geminiApiKey?: string;
  anthropicApiKey?: string;
  selectedProvider?: 'claude' | 'gemini';
}
```

## Testing

### E2E Test Structure

```
tests/
├── fixtures/
│   ├── arxiv-roadmap/
│   │   ├── source.pdf           # Test PDF
│   │   └── expected.json        # Ground truth
│   └── arxiv-guidelines/
│       ├── source.pdf
│       └── expected.json
├── e2e/
│   ├── conversion.test.ts       # Ground truth validation
│   └── pipeline.test.ts         # Pipeline smoke tests
└── utils/
    ├── fixture-loader.ts        # Load test fixtures
    ├── structure-validator.ts   # Validate heading hierarchy
    ├── format-validator.ts      # Validate markdown format
    └── markdown-parser.ts       # Parse markdown for analysis
```

### Ground Truth Format (expected.json)

```json
{
  "headings": [
    { "text": "Introduction", "level": 1, "page": 1 },
    { "text": "Background", "level": 2, "page": 1 }
  ],
  "images": 5,
  "tables": 1,
  "codeBlocks": 0
}
```

### Running Tests

```bash
# Run with Gemini provider (default)
npm run test:e2e

# Run with Claude provider
PROVIDER=claude npm run test:e2e

# Run specific test file
npm run test:e2e -- --run tests/e2e/pipeline.test.ts
```

## Current Accuracy (Claude Provider)

| Metric | Result |
|--------|--------|
| Heading text match | 89% (8/9 on arxiv-roadmap) |
| Content extraction | 100% valid |
| Markdown format | Parseable |
| H1/H2 detection | Matches expected |

## Dependencies

### Core
- `electron`: Desktop application framework
- `react`: UI framework
- `pdf.js`: PDF parsing and rendering
- `pdf-lib`: PDF manipulation (page extraction)

### LLM Providers
- `@anthropic-ai/sdk`: Claude API client
- `@google/generative-ai`: Gemini API client

### Reliability
- `effect`: Functional error handling and retry logic

### Node.js PDF Rendering
- `@napi-rs/canvas`: Native canvas for Node.js (replaces node-canvas)
