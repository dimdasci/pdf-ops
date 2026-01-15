/**
 * PDF Service Types
 *
 * This module defines the interface for PDF operations that work in both
 * Node.js (for tests/API) and browser (for Electron) environments.
 */

export interface PdfMetadata {
  pageCount: number
  title?: string
  author?: string
  subject?: string
  creator?: string
  producer?: string
  creationDate?: Date
  modificationDate?: Date
}

export interface OutlineItem {
  title: string
  pageNumber?: number
  children?: OutlineItem[]
}

export interface RenderOptions {
  /** DPI for rendering. Default is 72. Use 600 for high quality. */
  dpi?: number
  /** Output format. Currently only PNG is supported. */
  format?: 'png'
  /** Whether to render annotations. Default is true. */
  withAnnotations?: boolean
}

export interface EmbeddedImage {
  /** Raw image data */
  data: Uint8Array
  /** Image width in pixels */
  width: number
  /** Image height in pixels */
  height: number
  /** Image format (e.g., 'png', 'jpeg') */
  format: string
}

export interface CropOptions {
  /** Bounding box in 0-1000 scale: [ymin, xmin, ymax, xmax] */
  bbox: number[]
}

/**
 * Vector graphic region detected in a PDF page.
 */
export interface VectorRegion {
  /** Bounding box in page coordinates: [x, y, width, height] */
  bbox: [number, number, number, number]
  /** Number of path operations in this region */
  pathCount: number
  /** Whether the region contains stroked paths */
  hasStroke: boolean
  /** Whether the region contains filled paths */
  hasFill: boolean
  /** Estimated complexity score (0-1) */
  complexity: number
  /** Region type hint */
  type: 'diagram' | 'chart' | 'logo' | 'decoration' | 'unknown'
}

/**
 * Classification of a vector graphic.
 */
export interface GraphicClassification {
  /** Whether this is primarily vector content */
  isPureVector: boolean
  /** Complexity estimate (0-1) */
  complexity: number
  /** Whether this should be extracted */
  shouldExtract: boolean
  /** Description for alt text */
  description?: string
}

/**
 * Unified PDF Service Interface
 *
 * Provides a consistent API for PDF operations across different environments.
 * Implementations exist for both browser (using browser canvas) and Node.js
 * (using @napi-rs/canvas).
 */
export interface PdfService {
  // Lifecycle

  /** Load a PDF document from binary data */
  load(data: Uint8Array): Promise<void>

  /** Release resources. Always call when done with the PDF. */
  destroy(): void

  // Metadata

  /** Get the number of pages in the document */
  getPageCount(): number

  /** Get document metadata (title, author, etc.) */
  getMetadata(): Promise<PdfMetadata>

  /** Get document outline/table of contents if available */
  getOutline(): Promise<OutlineItem[] | null>

  // Rendering

  /**
   * Render a page to a base64-encoded PNG image.
   * @param pageNum - 1-indexed page number
   * @param options - Rendering options (DPI, etc.)
   * @returns Base64-encoded PNG (without data URL prefix)
   */
  renderPage(pageNum: number, options?: RenderOptions): Promise<string>

  /**
   * Crop an image based on bounding box coordinates.
   * @param base64Image - Base64-encoded source image
   * @param options - Crop options with bounding box
   * @returns Base64-encoded cropped image as data URL
   */
  cropImage(base64Image: string, options: CropOptions): Promise<string>

  // Text extraction

  /**
   * Extract text content from a page.
   * @param pageNum - 1-indexed page number
   * @returns Plain text content
   */
  getPageText(pageNum: number): Promise<string>

  // Page manipulation

  /**
   * Extract a range of pages into a new PDF.
   * @param startPage - 1-indexed start page (inclusive)
   * @param endPage - 1-indexed end page (inclusive)
   * @returns Binary data of new PDF containing only the specified pages
   */
  extractPageRange(startPage: number, endPage: number): Promise<Uint8Array>

  // Image extraction

  /**
   * Extract embedded images from a page.
   * @param pageNum - 1-indexed page number
   * @returns Array of embedded images with their data and dimensions
   */
  getPageImages(pageNum: number): Promise<EmbeddedImage[]>

  // Vector graphics detection (optional)

  /**
   * Detect vector graphic regions on a page.
   * @param pageNum - 1-indexed page number
   * @returns Array of detected vector regions
   */
  detectVectorRegions?(pageNum: number): Promise<VectorRegion[]>

  /**
   * Render a page or region as SVG.
   * @param pageNum - 1-indexed page number
   * @param region - Optional region to extract (full page if not specified)
   * @returns SVG string
   */
  renderAsSvg?(pageNum: number, region?: VectorRegion): Promise<string>

  /**
   * Render a specific region at high resolution for classification.
   * @param pageNum - 1-indexed page number
   * @param region - Region to render
   * @param scale - Scale factor (default: 3)
   * @returns Base64-encoded PNG
   */
  renderRegion?(pageNum: number, region: VectorRegion, scale?: number): Promise<string>
}
