/**
 * Gemini LLM Provider implementation using Google Generative AI SDK.
 * Uses image-based processing (no native PDF support).
 *
 * This module provides both:
 * 1. Legacy class-based provider (GeminiProvider) for non-Effect code
 * 2. Effect-based service (GeminiProviderTag) for Effect pipelines
 */

import { GenerativeModel, GoogleGenerativeAI } from '@google/generative-ai'
import { Context, Effect, Layer } from 'effect'

import type {
  DocumentAnalysis,
  DocumentStructure,
  GeminiProviderConfig,
  HeadingInfo,
  ImageInfo,
  LLMProvider,
  PageContext,
  PageConversionResult,
  ProviderCapabilities,
  SectionInfo,
  WindowContext,
  WindowResult,
} from './types'
import { DocumentAnalysisError, LLMProviderError, PageConversionError } from './types'

// Default model configuration
const DEFAULT_MODEL = 'gemini-2.5-flash'

export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini'
  readonly displayName = 'Gemini (Google)'
  readonly capabilities: ProviderCapabilities = {
    supportsNativePdf: false, // Gemini requires image rendering
    maxPdfPages: Infinity, // Limited by context window, not page count
    maxImageSize: 20 * 1024 * 1024, // 20MB
    maxContextTokens: 2_000_000, // 2M token context
    hasRecitationFilter: true, // Gemini blocks copyrighted content
    supportedImageFormats: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  }

  private genAI: GoogleGenerativeAI
  private model: GenerativeModel
  private modelName: string

  constructor(config: GeminiProviderConfig) {
    this.genAI = new GoogleGenerativeAI(config.apiKey)
    this.modelName = config.model || DEFAULT_MODEL
    this.model = this.genAI.getGenerativeModel({ model: this.modelName })
  }

  // ===========================================================================
  // Document-Level Operations
  // ===========================================================================

  async analyzeDocument(pdfData: Uint8Array | string): Promise<DocumentAnalysis> {
    // Gemini doesn't support native PDF - this method expects text
    // For Gemini, we analyze extracted text from first few pages
    const textContent = typeof pdfData === 'string' ? pdfData : ''

    const prompt =
      `Analyze the following text from a document and extract information. Return ONLY a JSON object.

Text:
${textContent.substring(0, 8000)}

Required fields:
{
  "language": "The primary language",
  "hasTOC": true/false,
  "pageCount": number (estimate),
  "estimatedImages": number,
  "estimatedTables": number,
  "estimatedCodeBlocks": number,
  "headerPattern": "common header text" or null,
  "footerPattern": "common footer text" or null,
  "contentType": "invoice" | "report" | "manual" | "academic" | "form" | "other",
  "textDensity": "sparse" | "normal" | "dense"
}`

    try {
      const result = await this.model.generateContent(prompt)
      const response = await result.response
      const text = response.text()

      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('No JSON found in response')
      }

      return JSON.parse(jsonMatch[0]) as DocumentAnalysis
    } catch (error) {
      console.error('Gemini document analysis failed:', error)
      return {
        language: 'Unknown',
        hasTOC: false,
        pageCount: 0,
        estimatedImages: 0,
        estimatedTables: 0,
        estimatedCodeBlocks: 0,
        headerPattern: null,
        footerPattern: null,
        contentType: 'other',
        textDensity: 'normal',
      }
    }
  }

  async extractStructure(
    pdfData: Uint8Array | string,
    analysis: DocumentAnalysis,
  ): Promise<DocumentStructure> {
    // For Gemini, structure extraction works on text content
    const textContent = typeof pdfData === 'string' ? pdfData : ''

    const prompt = `Extract the document structure from this text. I need a heading hierarchy.

Document context:
- Language: ${analysis.language}
- Has TOC: ${analysis.hasTOC}
- Content type: ${analysis.contentType}

Text content:
${textContent.substring(0, 15000)}

Return ONLY a JSON object:
{
  "headings": [
    { "level": 1, "text": "Heading text", "page": 1 },
    ...
  ],
  "maxDepth": 3
}

Infer page numbers from position in text if not explicit.`

    try {
      const result = await this.model.generateContent(prompt)
      const response = await result.response
      const text = response.text()

      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('No JSON found in response')
      }

      const parsed = JSON.parse(jsonMatch[0])
      const headings: HeadingInfo[] = parsed.headings || []

      const sections = this.buildSectionTree(headings, analysis.pageCount)
      const headingsByPage = new Map<number, HeadingInfo[]>()
      for (const heading of headings) {
        const pageHeadings = headingsByPage.get(heading.page) || []
        pageHeadings.push(heading)
        headingsByPage.set(heading.page, pageHeadings)
      }

      return {
        headings,
        sections,
        headingsByPage,
        maxDepth: parsed.maxDepth || Math.max(...headings.map(h => h.level), 1),
      }
    } catch (error) {
      console.error('Gemini structure extraction failed:', error)
      return {
        headings: [],
        sections: [],
        headingsByPage: new Map(),
        maxDepth: 0,
      }
    }
  }

  // ===========================================================================
  // Page-Level Operations
  // ===========================================================================

  async convertPage(
    imageBase64: string,
    context: PageContext,
  ): Promise<PageConversionResult> {
    const prompt = this.buildPageConversionPrompt(context)

    try {
      const result = await this.model.generateContent([
        prompt,
        {
          inlineData: {
            data: imageBase64,
            mimeType: 'image/png',
          },
        },
      ])

      const response = await result.response
      const text = response.text()

      return this.parsePageConversionResponse(text, context.pageNumber)
    } catch (error) {
      console.error(`Gemini page ${context.pageNumber} conversion failed:`, error)
      return {
        content: `\n\n[Error converting page ${context.pageNumber}]\n\n`,
        images: {},
        summary: '',
        lastParagraph: '',
        warnings: [(error as Error).message],
      }
    }
  }

  async convertWindow(
    _pdfData: Uint8Array | string,
    context: WindowContext,
  ): Promise<WindowResult> {
    // Gemini doesn't support native PDF window processing
    // This would need to be called with page images instead
    console.warn('Gemini does not support native PDF window processing')
    return {
      markdown:
        `[Window ${context.position.windowNumber} conversion not supported for Gemini - use page-by-page processing]`,
      lastParagraph: '',
      summary: '',
      unresolvedReferences: [],
      detectedImages: [],
    }
  }

  // ===========================================================================
  // Utility Operations
  // ===========================================================================

  async classifyImage(imageBase64: string): Promise<{
    type: ImageInfo['type']
    description: string
    isPureVector: boolean
    complexity: number
  }> {
    const prompt = `Analyze this image and classify it. Return ONLY a JSON object:
{
  "type": "photo" | "diagram" | "chart" | "logo" | "icon" | "screenshot" | "other",
  "description": "Brief description",
  "isPureVector": true/false,
  "complexity": 0.0-1.0
}`

    try {
      const result = await this.model.generateContent([
        prompt,
        {
          inlineData: {
            data: imageBase64,
            mimeType: 'image/png',
          },
        },
      ])

      const response = await result.response
      const text = response.text()

      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('No JSON found in response')
      }

      return JSON.parse(jsonMatch[0])
    } catch (error) {
      console.error('Gemini image classification failed:', error)
      return {
        type: 'other',
        description: 'Unknown image',
        isPureVector: false,
        complexity: 0.5,
      }
    }
  }

  async summarize(content: string, maxLength = 500): Promise<string> {
    const prompt = `Summarize in ${maxLength} characters or less. Return ONLY the summary:

${content}`

    try {
      const result = await this.model.generateContent(prompt)
      const response = await result.response
      return response.text().slice(0, maxLength)
    } catch (error) {
      console.error('Gemini summarization failed:', error)
      return content.slice(0, maxLength)
    }
  }

  async chat(prompt: string): Promise<string> {
    const result = await this.model.generateContent(prompt)
    const response = await result.response
    return response.text()
  }

  // ===========================================================================
  // Provider Management
  // ===========================================================================

  async validateConnection(): Promise<boolean> {
    try {
      const result = await this.model.generateContent('Say "OK" to confirm connection.')
      await result.response
      return true
    } catch {
      return false
    }
  }

  estimateCost(pageCount: number, complexity: number): number {
    // Gemini Flash pricing (much cheaper than Claude)
    // Input: $0.075/million tokens, Output: $0.30/million tokens
    const inputTokensPerPage = 1500 + (complexity * 500)
    const outputTokensPerPage = 500 + (complexity * 300)

    const totalInputTokens = pageCount * inputTokensPerPage
    const totalOutputTokens = pageCount * outputTokensPerPage

    const inputCost = (totalInputTokens / 1_000_000) * 0.075
    const outputCost = (totalOutputTokens / 1_000_000) * 0.30

    return inputCost + outputCost
  }

  // ===========================================================================
  // Legacy Compatibility Methods (from original GeminiService)
  // ===========================================================================

  /**
   * Legacy method for backward compatibility with existing converter.
   * @deprecated Use analyzeDocument instead
   */
  async analyzeDocumentStructure(
    firstPagesText: string,
  ): Promise<{ language: string; hasTOC: boolean }> {
    const analysis = await this.analyzeDocument(firstPagesText)
    return {
      language: analysis.language,
      hasTOC: analysis.hasTOC,
    }
  }

  /**
   * Legacy method for backward compatibility with existing converter.
   * @deprecated Use convertPage instead
   */
  async legacyConvertPage(
    pageImageBase64: string,
    context: { previousContent: string; pageNumber: number; totalPages: number },
  ): Promise<{ content: string; images: Record<string, number[]> }> {
    const prompt = `
      You are an expert document converter. Your task is to convert the attached image of a document page (Page ${context.pageNumber} of ${context.totalPages}) into high-quality Markdown.

      STEP 1: REASONING
      - Identify all visual elements (photos, charts, diagrams, vector logos) that should be preserved.
      - For each element, estimate its Bounding Box [ymin, xmin, ymax, xmax] on a scale of 0-1000 (0,0 is top-left).

      STEP 2: CONVERSION
      Generate the Markdown content:
      1. Preserve structure (headers, lists).
      2. For EVERY visual element identified, insert a placeholder: \`![Description](img_placeholder_X)\` where X is a unique ID (e.g., "1", "logo", "chart").
      3. Do NOT use the previously mentioned "extracted images" logic. Rely purely on what you see.

      STEP 3: COORDINATES (Crucial)
      At the VERY END of your response, output a JSON block mapping the placeholder IDs to their coordinates.
      KEYS must be the exact string used inside the parenthesis in the markdown (e.g., "img_placeholder_1").
      Format:
      \`\`\`json
      {
        "img_placeholder_1": [ymin, xmin, ymax, xmax],
        "img_placeholder_logo": [0, 0, 150, 200]
      }
      \`\`\`

      Output format:
      [REASONING]
      ...
      [CONTENT]
      ... markdown ...
      [COORDINATES]
      \`\`\`json
      ...
      \`\`\`
    `

    try {
      const result = await this.model.generateContent([
        prompt,
        {
          inlineData: {
            data: pageImageBase64,
            mimeType: 'image/png',
          },
        },
      ])

      const response = await result.response
      const text = response.text()

      // Extract Content
      const contentMatch = text.match(/\[CONTENT\]([\s\S]*?)(\[COORDINATES\]|$)/i)
      const content = contentMatch ? contentMatch[1].trim() : text

      // Extract Coordinates
      const coordMatch = text.match(/\[COORDINATES\]\s*`{3}json([\s\S]*?)`{3}/i)
      let images: Record<string, number[]> = {}
      if (coordMatch) {
        try {
          images = JSON.parse(coordMatch[1])
        } catch (e) {
          console.error('Failed to parse coordinates JSON', e)
        }
      }

      return { content, images }
    } catch (error) {
      console.error(`Page ${context.pageNumber} conversion failed:`, error)
      return { content: `\n\n[Error converting page ${context.pageNumber}]\n\n`, images: {} }
    }
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private buildPageConversionPrompt(context: PageContext): string {
    const expectedHeadingsStr = context.expectedHeadings.length > 0
      ? context.expectedHeadings.map(h => `- H${h.level}: "${h.text}"`).join('\n')
      : 'None specified - infer from visual formatting'

    return `Convert this document page (Page ${context.pageNumber} of ${context.totalPages}) to Markdown.

STRUCTURE CONTEXT:
Expected headings:
${expectedHeadingsStr}

Current section: ${context.currentSection || 'Unknown'}
Language: ${context.language}

${
      context.previousContent
        ? `Previous content:
"""
${context.previousContent.slice(-300)}
"""`
        : ''
    }

EXCLUDE (headers/footers):
- Header: ${context.headerPattern || 'None'}
- Footer: ${context.footerPattern || 'None'}

RULES:
1. ${
      context.expectedHeadings.length > 0
        ? 'Use EXACTLY the heading levels specified'
        : 'Infer heading levels from formatting'
    }
2. Skip header/footer patterns
3. Tables → markdown tables
4. Images → ![Description](img_placeholder_N) with bounding box
5. Code → fenced code blocks
6. Footnotes → [^N] inline, definition after paragraph

OUTPUT:
[CONTENT]
... markdown ...
[IMAGES]
\`\`\`json
{ "img_placeholder_1": { "bbox": [ymin, xmin, ymax, xmax], "description": "..." } }
\`\`\`
[SUMMARY]
One-sentence summary.
[LAST_PARAGRAPH]
Last paragraph for continuity.`
  }

  private parsePageConversionResponse(text: string, pageNumber: number): PageConversionResult {
    // Extract content
    const contentMatch = text.match(/\[CONTENT\]([\s\S]*?)(\[IMAGES\]|\[SUMMARY\]|$)/i)
    const content = contentMatch ? contentMatch[1].trim() : text

    // Extract images
    const imagesMatch = text.match(/\[IMAGES\]\s*```json([\s\S]*?)```/i)
    let images: Record<string, ImageInfo> = {}
    if (imagesMatch) {
      try {
        const parsed = JSON.parse(imagesMatch[1])
        images = Object.fromEntries(
          Object.entries(parsed).map(([key, value]: [string, unknown]) => {
            const v = value as { bbox?: number[]; description?: string }
            return [key, {
              id: key,
              bbox: v.bbox as [number, number, number, number] || [0, 0, 1000, 1000],
              description: v.description || 'Image',
              type: 'other' as const,
            }]
          }),
        )
      } catch (e) {
        console.error(`Failed to parse images on page ${pageNumber}:`, e)
      }
    }

    // Extract summary
    const summaryMatch = text.match(/\[SUMMARY\]([\s\S]*?)(\[LAST_PARAGRAPH\]|$)/i)
    const summary = summaryMatch ? summaryMatch[1].trim() : ''

    // Extract last paragraph
    const lastParagraphMatch = text.match(/\[LAST_PARAGRAPH\]([\s\S]*?)$/i)
    const lastParagraph = lastParagraphMatch ? lastParagraphMatch[1].trim() : ''

    return {
      content,
      images,
      summary,
      lastParagraph,
      warnings: [],
    }
  }

  private buildSectionTree(headings: HeadingInfo[], totalPages: number): SectionInfo[] {
    if (headings.length === 0) return []

    const sections: SectionInfo[] = []
    const stack: { section: SectionInfo; level: number }[] = []

    for (let i = 0; i < headings.length; i++) {
      const heading = headings[i]
      const nextHeading = headings[i + 1]
      const endPage = nextHeading ? nextHeading.page - 1 : totalPages

      const section: SectionInfo = {
        title: heading.text,
        level: heading.level,
        startPage: heading.page,
        endPage,
        children: [],
      }

      while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
        stack.pop()
      }

      if (stack.length === 0) {
        sections.push(section)
      } else {
        stack[stack.length - 1].section.children.push(section)
      }

      stack.push({ section, level: heading.level })
    }

    return sections
  }
}

// =============================================================================
// Effect-Based Service API
// =============================================================================

/**
 * Service interface for Gemini provider in Effect context.
 * All methods return Effects with properly typed errors.
 */
export interface GeminiProviderService {
  /** Provider name */
  readonly name: 'gemini'

  /** Display name for UI */
  readonly displayName: string

  /** Provider capabilities */
  readonly capabilities: ProviderCapabilities

  /** Analyze document structure and characteristics */
  readonly analyzeDocument: (
    pdfData: Uint8Array | string,
  ) => Effect.Effect<DocumentAnalysis, DocumentAnalysisError>

  /** Extract document structure (headings, sections, TOC) */
  readonly extractStructure: (
    pdfData: Uint8Array | string,
    analysis: DocumentAnalysis,
  ) => Effect.Effect<DocumentStructure, DocumentAnalysisError>

  /** Convert a single page to markdown */
  readonly convertPage: (
    imageBase64: string,
    context: PageContext,
  ) => Effect.Effect<PageConversionResult, PageConversionError>

  /** Convert a window (multiple pages) to markdown */
  readonly convertWindow: (
    pdfData: Uint8Array | string,
    context: WindowContext,
  ) => Effect.Effect<WindowResult, PageConversionError>

  /** Classify an image region */
  readonly classifyImage: (
    imageBase64: string,
  ) => Effect.Effect<{
    type: ImageInfo['type']
    description: string
    isPureVector: boolean
    complexity: number
  }, LLMProviderError>

  /** Generate a summary of content */
  readonly summarize: (
    content: string,
    maxLength?: number,
  ) => Effect.Effect<string, LLMProviderError>

  /** Simple chat completion */
  readonly chat: (prompt: string) => Effect.Effect<string, LLMProviderError>

  /** Validate the API key and connection */
  readonly validateConnection: () => Effect.Effect<boolean>

  /** Get the estimated cost for processing a document */
  readonly estimateCost: (pageCount: number, complexity: number) => number

  /** Get the underlying provider instance (for legacy interop) */
  readonly provider: LLMProvider
}

/**
 * Effect Context.Tag for Gemini provider service.
 * Use this to declare Gemini as a dependency in Effect programs.
 *
 * @example
 * ```typescript
 * const program = Effect.gen(function*() {
 *   const gemini = yield* GeminiProviderTag
 *   const analysis = yield* gemini.analyzeDocument(textContent)
 *   // ...
 * })
 *
 * // Provide the layer
 * program.pipe(Effect.provide(GeminiProviderTag.make({ apiKey: 'AIza...' })))
 * ```
 */
export class GeminiProviderTag extends Context.Tag('GeminiProvider')<
  GeminiProviderTag,
  GeminiProviderService
>() {
  /**
   * Create a layer with the given configuration.
   */
  static readonly make = (config: GeminiProviderConfig) =>
    Layer.succeed(GeminiProviderTag, createGeminiService(config))

  /**
   * Create a scoped layer that manages the provider lifecycle.
   */
  static readonly scoped = (config: GeminiProviderConfig) =>
    Layer.scoped(
      GeminiProviderTag,
      Effect.gen(function*() {
        const service = createGeminiService(config)
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            // Cleanup if needed (Gemini SDK doesn't require explicit cleanup)
          })
        )
        return service
      }),
    )
}

/**
 * Helper function to create a Gemini service from config.
 */
function createGeminiService(config: GeminiProviderConfig): GeminiProviderService {
  const provider = new GeminiProvider(config)

  return {
    name: 'gemini',
    displayName: provider.displayName,
    capabilities: provider.capabilities,
    provider,

    analyzeDocument: pdfData =>
      Effect.tryPromise({
        try: () => provider.analyzeDocument(pdfData),
        catch: error =>
          new DocumentAnalysisError({
            message: `Failed to analyze document: ${(error as Error).message}`,
            provider: 'gemini',
            cause: error,
          }),
      }),

    extractStructure: (pdfData, analysis) =>
      Effect.tryPromise({
        try: () => provider.extractStructure(pdfData, analysis),
        catch: error =>
          new DocumentAnalysisError({
            message: `Failed to extract structure: ${(error as Error).message}`,
            provider: 'gemini',
            cause: error,
          }),
      }),

    convertPage: (imageBase64, context) =>
      Effect.tryPromise({
        try: () => provider.convertPage(imageBase64, context),
        catch: error =>
          new PageConversionError({
            message: `Failed to convert page: ${(error as Error).message}`,
            pageNumber: context.pageNumber,
            provider: 'gemini',
            cause: error,
          }),
      }),

    convertWindow: (pdfData, context) =>
      Effect.tryPromise({
        try: () => provider.convertWindow(pdfData, context),
        catch: error =>
          new PageConversionError({
            message: `Failed to convert window: ${(error as Error).message}`,
            pageNumber: context.position.startPage,
            provider: 'gemini',
            cause: error,
          }),
      }),

    classifyImage: imageBase64 =>
      Effect.tryPromise({
        try: () => provider.classifyImage(imageBase64),
        catch: error =>
          new LLMProviderError({
            message: `Failed to classify image: ${(error as Error).message}`,
            provider: 'gemini',
            cause: error,
          }),
      }),

    summarize: (content, maxLength) =>
      Effect.tryPromise({
        try: () => provider.summarize(content, maxLength),
        catch: error =>
          new LLMProviderError({
            message: `Failed to summarize: ${(error as Error).message}`,
            provider: 'gemini',
            cause: error,
          }),
      }),

    chat: prompt =>
      Effect.tryPromise({
        try: () => provider.chat(prompt),
        catch: error =>
          new LLMProviderError({
            message: `Chat failed: ${(error as Error).message}`,
            provider: 'gemini',
            cause: error,
          }),
      }),

    validateConnection: () =>
      Effect.tryPromise({
        try: () => provider.validateConnection(),
        catch: () => false,
      }).pipe(Effect.catchAll(() => Effect.succeed(false))),

    estimateCost: (pageCount, complexity) => provider.estimateCost(pageCount, complexity),
  }
}
