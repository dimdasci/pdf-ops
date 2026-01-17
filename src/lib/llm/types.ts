/**
 * LLM Provider abstraction for PDF-to-Markdown conversion.
 * Supports multiple providers (Claude, Gemini) with a unified interface.
 */

import { Schema } from 'effect'

// ============================================================================
// Error Types (Effect-style tagged errors)
// ============================================================================

/**
 * Base error for LLM provider operations.
 */
export class LLMProviderError extends Schema.TaggedError<LLMProviderError>()('LLMProviderError', {
  message: Schema.String,
  provider: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Defect),
}) {}

/**
 * Error when provider is not configured (missing API key).
 */
export class ProviderNotConfiguredError extends Schema.TaggedError<ProviderNotConfiguredError>()(
  'ProviderNotConfiguredError',
  {
    message: Schema.String,
    providerType: Schema.String,
  },
) {}

/**
 * Error when API key validation fails.
 */
export class ApiKeyValidationError extends Schema.TaggedError<ApiKeyValidationError>()(
  'ApiKeyValidationError',
  {
    message: Schema.String,
    provider: Schema.String,
  },
) {}

/**
 * Error for document analysis failures.
 */
export class DocumentAnalysisError extends Schema.TaggedError<DocumentAnalysisError>()(
  'DocumentAnalysisError',
  {
    message: Schema.String,
    provider: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

/**
 * Error for page conversion failures.
 */
export class PageConversionError extends Schema.TaggedError<PageConversionError>()(
  'PageConversionError',
  {
    message: Schema.String,
    pageNumber: Schema.Number,
    provider: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

/**
 * Union of all LLM-related errors for exhaustive handling.
 */
export type LLMError =
  | LLMProviderError
  | ProviderNotConfiguredError
  | ApiKeyValidationError
  | DocumentAnalysisError
  | PageConversionError

// ============================================================================
// Document Analysis Types
// ============================================================================

export interface DocumentAnalysis {
  /** Detected document language */
  language: string
  /** Whether document has an embedded Table of Contents */
  hasTOC: boolean
  /** Total page count */
  pageCount: number
  /** Estimated number of images */
  estimatedImages: number
  /** Estimated number of tables */
  estimatedTables: number
  /** Estimated number of code blocks */
  estimatedCodeBlocks: number
  /** Header pattern detected (if any) */
  headerPattern: string | null
  /** Footer pattern detected (if any) */
  footerPattern: string | null
  /** Content type classification */
  contentType: 'invoice' | 'report' | 'manual' | 'academic' | 'form' | 'other'
  /** Text density assessment */
  textDensity: 'sparse' | 'normal' | 'dense'
}

// ============================================================================
// Document Structure Types
// ============================================================================

export interface HeadingInfo {
  /** Heading level (1-6) */
  level: number
  /** Heading text */
  text: string
  /** Page number where heading appears */
  page: number
}

export interface SectionInfo {
  /** Section title */
  title: string
  /** Heading level */
  level: number
  /** Start page */
  startPage: number
  /** End page (inclusive) */
  endPage: number
  /** Child sections */
  children: SectionInfo[]
}

export interface DocumentStructure {
  /** Complete heading hierarchy */
  headings: HeadingInfo[]
  /** Section tree structure */
  sections: SectionInfo[]
  /** Headings indexed by page number */
  headingsByPage: Map<number, HeadingInfo[]>
  /** Maximum heading depth */
  maxDepth: number
}

// ============================================================================
// Page Conversion Types
// ============================================================================

export interface ImageInfo {
  /** Unique identifier for this image */
  id: string
  /** Bounding box [ymin, xmin, ymax, xmax] on 0-1000 scale */
  bbox: [number, number, number, number]
  /** Description of the image content */
  description: string
  /** Image type classification */
  type: 'photo' | 'diagram' | 'chart' | 'logo' | 'icon' | 'screenshot' | 'other'
}

export interface PageConversionResult {
  /** Converted markdown content */
  content: string
  /** Detected images with bounding boxes */
  images: Record<string, ImageInfo>
  /** Summary of the page content (for context in next page) */
  summary: string
  /** Last paragraph text (for page-break handling) */
  lastParagraph: string
  /** Any errors or warnings */
  warnings: string[]
}

// ============================================================================
// Conversion Context Types
// ============================================================================

export interface PageContext {
  /** Current page number */
  pageNumber: number
  /** Total pages in document */
  totalPages: number
  /** Content from previous page (for context) */
  previousContent: string
  /** Summary of previous page */
  previousSummary: string
  /** Expected headings on this page (from structure) */
  expectedHeadings: HeadingInfo[]
  /** Current section being processed */
  currentSection: string | null
  /** Header pattern to exclude */
  headerPattern: string | null
  /** Footer pattern to exclude */
  footerPattern: string | null
  /** Document language */
  language: string
}

export interface WindowContext {
  /** Global document context */
  global: {
    totalPages: number
    language: string
    toc: HeadingInfo[]
    headerPattern: string | null
    footerPattern: string | null
  }
  /** Window position in document */
  position: {
    windowNumber: number
    totalWindows: number
    startPage: number
    endPage: number
    percentComplete: number
  }
  /** Structural context for this window */
  structure: {
    sectionsInWindow: SectionInfo[]
    expectedHeadings: HeadingInfo[]
    continuedSection: string | null
    sectionContinuesAfter: boolean
  }
  /** Content continuity from previous window */
  continuity: {
    previousWindowTail: string
    previousWindowSummary: string
    pendingReferences: Array<{ id: string; type: 'footnote' | 'figure' | 'table' }>
  }
  /** Content expectations for this window */
  expectations: {
    estimatedImages: number
    estimatedTables: number
    hasCodeBlocks: boolean
    hasMathFormulas: boolean
  }
}

// ============================================================================
// Window Processing Types
// ============================================================================

export interface WindowSpec {
  /** Start page (inclusive) */
  startPage: number
  /** End page (inclusive) */
  endPage: number
  /** Sections contained in this window */
  sectionsInWindow: SectionInfo[]
}

export interface WindowResult {
  /** Converted markdown for this window */
  markdown: string
  /** Last paragraph for continuity */
  lastParagraph: string
  /** Summary for context passing */
  summary: string
  /** Unresolved references */
  unresolvedReferences: Array<{ id: string; type: 'footnote' | 'figure' | 'table' }>
  /** Detected images */
  detectedImages: ImageInfo[]
}

// ============================================================================
// Provider Capabilities
// ============================================================================

export interface ProviderCapabilities {
  /** Whether provider supports native PDF input */
  supportsNativePdf: boolean
  /** Maximum pages for native PDF processing */
  maxPdfPages: number
  /** Maximum image size in bytes */
  maxImageSize: number
  /** Maximum context window in tokens */
  maxContextTokens: number
  /** Whether provider has RECITATION filtering */
  hasRecitationFilter: boolean
  /** Supported image formats */
  supportedImageFormats: string[]
}

// ============================================================================
// LLM Provider Interface
// ============================================================================

export interface LLMProvider {
  /** Provider name (e.g., 'claude', 'gemini') */
  readonly name: string

  /** Display name for UI */
  readonly displayName: string

  /** Provider capabilities */
  readonly capabilities: ProviderCapabilities

  // -------------------------------------------------------------------------
  // Document-Level Operations
  // -------------------------------------------------------------------------

  /**
   * Analyze document structure and characteristics.
   * @param pdfData - PDF data as Uint8Array or base64 string
   * @returns Document analysis results
   */
  analyzeDocument(pdfData: Uint8Array | string): Promise<DocumentAnalysis>

  /**
   * Extract document structure (headings, sections, TOC).
   * @param pdfData - PDF data
   * @param analysis - Previous analysis results
   * @returns Document structure
   */
  extractStructure(
    pdfData: Uint8Array | string,
    analysis: DocumentAnalysis,
  ): Promise<DocumentStructure>

  // -------------------------------------------------------------------------
  // Page-Level Operations
  // -------------------------------------------------------------------------

  /**
   * Convert a single page to markdown.
   * @param imageBase64 - Page image as base64
   * @param context - Conversion context
   * @returns Page conversion result
   */
  convertPage(
    imageBase64: string,
    context: PageContext,
  ): Promise<PageConversionResult>

  /**
   * Convert a window (multiple pages) to markdown.
   * @param pdfData - PDF data for the window
   * @param context - Window context
   * @returns Window conversion result
   */
  convertWindow(
    pdfData: Uint8Array | string,
    context: WindowContext,
  ): Promise<WindowResult>

  // -------------------------------------------------------------------------
  // Utility Operations
  // -------------------------------------------------------------------------

  /**
   * Classify an image region for extraction strategy.
   * @param imageBase64 - Region image as base64
   * @returns Classification result
   */
  classifyImage(imageBase64: string): Promise<{
    type: ImageInfo['type']
    description: string
    isPureVector: boolean
    complexity: number
  }>

  /**
   * Generate a summary of content for context passing.
   * @param content - Markdown content to summarize
   * @param maxLength - Maximum summary length
   * @returns Summary text
   */
  summarize(content: string, maxLength?: number): Promise<string>

  /**
   * Simple chat completion for utility tasks.
   * @param prompt - Prompt text
   * @returns Response text
   */
  chat(prompt: string): Promise<string>

  // -------------------------------------------------------------------------
  // Provider Management
  // -------------------------------------------------------------------------

  /**
   * Validate the API key and connection.
   * @returns Whether the provider is properly configured
   */
  validateConnection(): Promise<boolean>

  /**
   * Get the estimated cost for processing a document.
   * @param pageCount - Number of pages
   * @param complexity - Document complexity (0-1)
   * @returns Estimated cost in USD
   */
  estimateCost(pageCount: number, complexity: number): number
}

// ============================================================================
// Provider Configuration Types
// ============================================================================

export interface ProviderConfig {
  /** API key */
  apiKey: string
  /** Model name/version to use */
  model?: string
  /** Maximum retries for failed requests */
  maxRetries?: number
  /** Request timeout in milliseconds */
  timeout?: number
  /** Custom base URL (for proxies) */
  baseUrl?: string
}

export interface ClaudeProviderConfig extends ProviderConfig {
  /** Anthropic-specific: model version */
  model?: 'claude-sonnet-4-20250514' | 'claude-opus-4-20250514' | 'claude-3-5-sonnet-20241022'
}

export interface GeminiProviderConfig extends ProviderConfig {
  /** Gemini-specific: model version */
  model?: 'gemini-2.5-flash' | 'gemini-2.0-flash' | 'gemini-1.5-pro'
}

// ============================================================================
// Provider Factory Types
// ============================================================================

export type ProviderType = 'claude' | 'gemini'

export interface ProviderFactory {
  /**
   * Create a provider instance.
   * @param type - Provider type
   * @param config - Provider configuration
   * @returns Provider instance
   */
  create(type: ProviderType, config: ProviderConfig): LLMProvider

  /**
   * Get available provider types.
   * @returns Array of available provider types
   */
  getAvailableTypes(): ProviderType[]
}
