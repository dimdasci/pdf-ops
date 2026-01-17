/**
 * Type definitions for the 4-pass pipeline architecture.
 *
 * Pass 1: Layout Analysis → LayoutProfile
 * Pass 2: Structure Extraction → StructureProfile
 * Pass 3: Content Extraction → RawContent
 * Pass 4: Assembly (uses all above to produce final markdown)
 */

// =============================================================================
// Common Types
// =============================================================================

/**
 * Represents a contiguous range of pages in the document.
 */
export interface PageRange {
  /** First page number (1-indexed) */
  start: number
  /** Last page number (1-indexed, inclusive) */
  end: number
}

// =============================================================================
// Pass 1: Layout Analysis
// =============================================================================

/**
 * Zone boundaries as percentages of page dimensions.
 * Used to identify header, footer, and margin regions.
 */
export interface ZoneBoundary {
  /** Top boundary as percentage (0-100) from page top */
  top: number
  /** Bottom boundary as percentage (0-100) from page top */
  bottom: number
}

/**
 * Margin zone boundaries as percentages of page width.
 */
export interface MarginZones {
  /** Left margin boundary as percentage (0-100) from page left */
  left: number
  /** Right margin boundary as percentage (0-100) from page left */
  right: number
}

/**
 * Defines the page zones for headers, footers, and margins.
 */
export interface PageZones {
  /** Header zone boundaries (percentage from top) */
  headerZone: ZoneBoundary
  /** Footer zone boundaries (percentage from top) */
  footerZone: ZoneBoundary
  /** Margin zone boundaries (percentage from left) */
  marginZones: MarginZones
}

/**
 * Patterns for repeated elements that should be filtered during conversion.
 */
export interface RepeatedElements {
  /** Fuzzy-matched header text patterns appearing on multiple pages */
  headers: string[]
  /** Fuzzy-matched footer text patterns appearing on multiple pages */
  footers: string[]
  /**
   * Regex pattern string for page numbers (e.g., "Page \\d+ of \\d+").
   * Stored as string since RegExp cannot be serialized.
   */
  pageNumbers: string
}

/**
 * Position of a decorative image in the document.
 */
export interface DecorativeImagePosition {
  /** Page number where the image appears (1-indexed) */
  page: number
  /** Zone where the image is located */
  zone: 'header' | 'footer' | 'margin'
}

/**
 * Information about decorative images that should be excluded from content.
 */
export interface DecorativeImages {
  /** Specific positions of decorative images */
  positions: DecorativeImagePosition[]
  /** Pattern descriptions like "logo top-right", "border bottom" */
  patterns: string[]
}

/**
 * Pass 1 Output: Layout profile describing the visual structure of the document.
 *
 * Identifies repeating elements (headers, footers, page numbers) and decorative
 * content that should be filtered during conversion. This information helps
 * avoid duplicating boilerplate content in the final markdown.
 */
export interface LayoutProfile {
  /** Page zone boundaries for header, footer, and margins */
  pageZones: PageZones
  /** Patterns for repeated elements to filter */
  repeatedElements: RepeatedElements
  /** Decorative images to exclude from content */
  decorativeImages: DecorativeImages
  /** Style of footnotes used in the document */
  footnoteStyle: 'numbered' | 'symbolic' | 'none'
  /** Column layout used in the document */
  columnLayout: 'single' | 'double' | 'mixed'
}

// =============================================================================
// Pass 2: Structure Extraction
// =============================================================================

/**
 * An entry in the table of contents.
 */
export interface TocEntry {
  /** Heading level (1 = top-level, 2 = subsection, etc.) */
  level: number
  /** Title text of the section */
  title: string
  /** Page number where this section starts (1-indexed) */
  page: number
  /** Nested child entries (subsections) */
  children?: TocEntry[]
}

/**
 * Style indicators for a heading level.
 */
export interface HeadingStyle {
  /** Heading level (1-6, corresponding to H1-H6) */
  level: number
  /**
   * Visual/formatting indicators for this heading level.
   * Examples: 'larger-font', 'bold', 'numbered', 'all-caps', 'underlined'
   */
  indicators: string[]
}

/**
 * Table of contents information extracted from the document.
 */
export interface TocInfo {
  /** Whether an explicit TOC was found in the document */
  explicit: boolean
  /** Extracted or inferred TOC entries */
  entries: TocEntry[]
}

/**
 * Document hierarchy information.
 */
export interface Hierarchy {
  /** Maximum heading depth used (e.g., 3 for H1-H2-H3) */
  maxDepth: number
  /** Style indicators for each heading level */
  headingStyles: HeadingStyle[]
}

/**
 * Document section breakdown.
 */
export interface DocumentSections {
  /** Front matter pages (preface, TOC, etc.), null if not present */
  frontMatter: PageRange | null
  /** Main body content pages */
  body: PageRange
  /** Back matter pages (appendix, index, etc.), null if not present */
  backMatter: PageRange | null
}

/**
 * Cross-reference handling information.
 */
export interface CrossReferences {
  /** Where footnotes are placed in the output */
  footnoteStyle: 'inline' | 'endnote' | 'chapter-end'
  /** Detected citation style (e.g., 'APA', 'MLA', 'Chicago'), null if none detected */
  citationStyle: string | null
}

/**
 * Known document type classifications.
 */
export type DocumentType =
  | 'academic'
  | 'book'
  | 'report'
  | 'marketing'
  | 'manual'
  | 'legal'
  | 'other'

/**
 * Pass 2 Output: Structure profile describing the logical organization.
 *
 * Maps out the document's table of contents, heading hierarchy, and section
 * boundaries. This information guides content extraction and ensures proper
 * heading levels and section ordering in the final markdown.
 */
export interface StructureProfile {
  /** Classified document type */
  documentType: DocumentType
  /** Table of contents information */
  toc: TocInfo
  /** Heading hierarchy information */
  hierarchy: Hierarchy
  /** Document section boundaries */
  sections: DocumentSections
  /** Cross-reference handling configuration */
  crossReferences: CrossReferences
}

// =============================================================================
// Pass 3: Content Extraction
// =============================================================================

/**
 * A footnote extracted from the document.
 */
export interface Footnote {
  /** Unique identifier for the footnote (e.g., '1', 'a', '*') */
  id: string
  /** Markdown content of the footnote */
  content: string
  /** Page number where the footnote appears (1-indexed) */
  page: number
}

/**
 * A meaningful image extracted from the document.
 */
export interface ImageRef {
  /** Unique identifier for the image */
  id: string
  /** Alt text description of the image content */
  description: string
  /** Base64-encoded data URL (e.g., 'data:image/png;base64,...') */
  dataUrl: string
  /** Page number where the image appears (1-indexed) */
  page: number
  /** Whether this image is decorative (should be excluded from output) */
  isDecorative: boolean
}

/**
 * A content section extracted from the document.
 */
export interface Section {
  /** Unique identifier for the section */
  id: string
  /** Heading level (1-6, or 0 for content without a heading) */
  level: number
  /** Section title (empty string for untitled sections) */
  title: string
  /** Markdown content of the section */
  content: string
  /** IDs of footnotes referenced in this section */
  footnoteRefs: string[]
  /** IDs of images referenced in this section */
  imageRefs: string[]
  /** ID of the previous section if this continues from a page break */
  continuesFrom?: string
}

/**
 * Pass 3 Output: Raw extracted content before assembly.
 *
 * Contains all meaningful content extracted from the document, organized
 * into sections with references to footnotes and images. The assembly pass
 * uses this along with the profiles to produce properly formatted markdown.
 */
export interface RawContent {
  /** Extracted content sections in document order */
  sections: Section[]
  /** Map of footnote ID to footnote content */
  footnotes: Map<string, Footnote>
  /** Map of image ID to image reference (meaningful images only) */
  images: Map<string, ImageRef>
  /** Section IDs whose content continues in a subsequent section */
  pendingContinuations: string[]
}

// =============================================================================
// Serializable Variants (for IPC/storage)
// =============================================================================

/**
 * Serializable version of RawContent using plain objects instead of Maps.
 * Use this for IPC communication or JSON storage.
 */
export interface SerializableRawContent {
  sections: Section[]
  footnotes: Record<string, Footnote>
  images: Record<string, ImageRef>
  pendingContinuations: string[]
}

// =============================================================================
// Combined Profile
// =============================================================================

/**
 * Combined document profiles from passes 1-2.
 * Used as input to the content extraction pass.
 */
export interface DocumentProfiles {
  layout: LayoutProfile
  structure: StructureProfile
}

/**
 * Complete extraction result from passes 1-3.
 * Used as input to the assembly pass.
 */
export interface ExtractionResult {
  profiles: DocumentProfiles
  content: RawContent
}

/**
 * Serializable version of ExtractionResult for IPC/storage.
 */
export interface SerializableExtractionResult {
  profiles: DocumentProfiles
  content: SerializableRawContent
}
