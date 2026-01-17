/**
 * Pass 3: Content Extractor
 *
 * Extracts content from PDF pages using layout and structure profiles.
 * Filters repeated elements, separates footnotes, tracks cross-page
 * paragraph continuity, and filters decorative images.
 */

import type { LLMProvider, PageContext } from '../llm/types'
import type { PdfService } from '../pdf-service/types'
import type {
  Footnote,
  ImageRef,
  LayoutProfile,
  RawContent,
  Section,
  StructureProfile,
  TocEntry,
} from './types/profiles'

// =============================================================================
// Types
// =============================================================================

export interface ContentExtractorOptions {
  /** Progress callback for page processing */
  onProgress?: (page: number, total: number) => void
  /** DPI for page rendering (default: 150) */
  dpi?: number
  /** Batch size for parallel processing (default: 1 for sequential) */
  batchSize?: number
}

interface PageExtractionResult {
  /** Extracted sections from this page */
  sections: Section[]
  /** Footnotes found on this page */
  footnotes: Footnote[]
  /** Images found on this page */
  images: ImageRef[]
  /** Summary of page content for context passing */
  summary: string
  /** Last paragraph text (may continue on next page) */
  lastParagraph: string
  /** Whether the last paragraph appears incomplete */
  endsIncomplete: boolean
}

interface ExtractionContext {
  pageNumber: number
  totalPages: number
  previousSummary: string
  previousContent: string
  pendingSectionId: string | null
  currentTocEntry: TocEntry | null
}

// =============================================================================
// Main Export
// =============================================================================

/**
 * Extract content from a PDF document using layout and structure profiles.
 *
 * This is Pass 3 of the 4-pass pipeline. It processes each page sequentially,
 * filtering out repeated elements identified in the layout profile and
 * maintaining the heading structure from the structure profile.
 *
 * @param pdfService - PDF service for rendering pages
 * @param provider - LLM provider for content extraction
 * @param layout - Layout profile from Pass 1
 * @param structure - Structure profile from Pass 2
 * @param options - Optional configuration
 * @returns Raw content with sections, footnotes, and images
 */
export async function extractContent(
  pdfService: PdfService,
  provider: LLMProvider,
  layout: LayoutProfile,
  structure: StructureProfile,
  options: ContentExtractorOptions = {},
): Promise<RawContent> {
  const { onProgress, dpi = 150, batchSize = 1 } = options
  const pageCount = pdfService.getPageCount()

  const sections: Section[] = []
  const footnotes = new Map<string, Footnote>()
  const images = new Map<string, ImageRef>()
  const pendingContinuations: string[] = []

  const context: ExtractionContext = {
    pageNumber: 0,
    totalPages: pageCount,
    previousSummary: '',
    previousContent: '',
    pendingSectionId: null,
    currentTocEntry: findTocEntryForPage(structure.toc.entries, 1),
  }

  // Process pages in batches (sequential by default for better context)
  for (let startPage = 1; startPage <= pageCount; startPage += batchSize) {
    const endPage = Math.min(startPage + batchSize - 1, pageCount)
    const pagesToProcess = []

    for (let page = startPage; page <= endPage; page++) {
      pagesToProcess.push(page)
    }

    // Process batch (sequentially within batch for context continuity)
    for (const pageNum of pagesToProcess) {
      onProgress?.(pageNum, pageCount)

      context.pageNumber = pageNum
      context.currentTocEntry = findTocEntryForPage(structure.toc.entries, pageNum)

      const result = await extractPageContent(
        pdfService,
        provider,
        layout,
        structure,
        context,
        dpi,
      )

      // Collect sections
      for (const section of result.sections) {
        // Link continuation from previous page
        if (context.pendingSectionId && section.continuesFrom === undefined) {
          // Check if this section continues the previous one
          if (shouldContinueSection(context.previousContent, section.content)) {
            section.continuesFrom = context.pendingSectionId
          }
        }
        sections.push(section)
      }

      // Collect footnotes
      for (const footnote of result.footnotes) {
        footnotes.set(footnote.id, footnote)
      }

      // Collect meaningful images
      for (const image of result.images) {
        if (!image.isDecorative) {
          images.set(image.id, image)
        }
      }

      // Track incomplete paragraphs for continuation
      if (result.endsIncomplete && result.sections.length > 0) {
        const lastSection = result.sections[result.sections.length - 1]
        context.pendingSectionId = lastSection.id
        pendingContinuations.push(lastSection.id)
      } else {
        context.pendingSectionId = null
      }

      // Update context for next page
      context.previousSummary = result.summary
      context.previousContent = result.lastParagraph
    }
  }

  return {
    sections,
    footnotes,
    images,
    pendingContinuations,
  }
}

// =============================================================================
// Page Extraction
// =============================================================================

/**
 * Extract content from a single page.
 */
async function extractPageContent(
  pdfService: PdfService,
  provider: LLMProvider,
  layout: LayoutProfile,
  structure: StructureProfile,
  context: ExtractionContext,
  dpi: number,
): Promise<PageExtractionResult> {
  // Render page to image
  const imageBase64 = await pdfService.renderPage(context.pageNumber, { dpi })

  // Build page context for LLM
  const pageContext = buildPageContext(layout, structure, context)

  // Convert page using LLM
  const result = await provider.convertPage(imageBase64, pageContext)

  // Parse the LLM response into structured content
  return parsePageResult(
    result.content,
    result.images,
    context,
    layout,
    structure,
    result.summary,
    result.lastParagraph,
  )
}

/**
 * Build PageContext for the LLM provider.
 */
function buildPageContext(
  layout: LayoutProfile,
  structure: StructureProfile,
  context: ExtractionContext,
): PageContext {
  // Find expected headings for this page from structure
  const expectedHeadings = findExpectedHeadings(structure, context.pageNumber)

  // Build header/footer patterns from layout profile
  const headerPattern = buildFilterPattern(layout.repeatedElements.headers)
  const footerPattern = buildFilterPattern(layout.repeatedElements.footers)

  return {
    pageNumber: context.pageNumber,
    totalPages: context.totalPages,
    previousContent: context.previousContent.slice(-800),
    previousSummary: context.previousSummary,
    expectedHeadings,
    currentSection: context.currentTocEntry?.title ?? null,
    headerPattern,
    footerPattern,
    language: 'auto', // Could be extracted from structure if available
  }
}

/**
 * Build a filter pattern string from repeated element patterns.
 */
function buildFilterPattern(patterns: string[]): string | null {
  if (patterns.length === 0) return null
  // Join patterns with OR for matching any
  return patterns.map(escapeRegex).join('|')
}

/**
 * Find expected headings for a page from the structure profile.
 */
function findExpectedHeadings(
  structure: StructureProfile,
  pageNum: number,
): Array<{ level: number; text: string; page: number }> {
  const headings: Array<{ level: number; text: string; page: number }> = []

  function collectFromEntries(entries: TocEntry[]) {
    for (const entry of entries) {
      if (entry.page === pageNum) {
        headings.push({
          level: entry.level,
          text: entry.title,
          page: entry.page,
        })
      }
      if (entry.children) {
        collectFromEntries(entry.children)
      }
    }
  }

  collectFromEntries(structure.toc.entries)
  return headings
}

/**
 * Find the TOC entry that applies to a given page.
 */
function findTocEntryForPage(entries: TocEntry[], pageNum: number): TocEntry | null {
  let currentEntry: TocEntry | null = null

  function searchEntries(items: TocEntry[]) {
    for (const entry of items) {
      if (entry.page <= pageNum) {
        currentEntry = entry
      }
      if (entry.children) {
        searchEntries(entry.children)
      }
    }
  }

  searchEntries(entries)
  return currentEntry
}

// =============================================================================
// Result Parsing
// =============================================================================

/**
 * Parse LLM conversion result into structured content.
 */
function parsePageResult(
  content: string,
  detectedImages: Record<
    string,
    { id: string; bbox: [number, number, number, number]; description: string; type: string }
  >,
  context: ExtractionContext,
  layout: LayoutProfile,
  structure: StructureProfile,
  summary: string,
  lastParagraph: string,
): PageExtractionResult {
  const sections: Section[] = []
  const footnotes: Footnote[] = []
  const images: ImageRef[] = []

  // Clean content by removing repeated elements
  let cleanedContent = removeRepeatedElements(content, layout)

  // Extract footnotes from content
  const { text: contentWithoutFootnotes, extractedFootnotes } = extractFootnotes(
    cleanedContent,
    context.pageNumber,
    layout.footnoteStyle,
  )
  footnotes.push(...extractedFootnotes)
  cleanedContent = contentWithoutFootnotes

  // Parse sections from content
  const parsedSections = parseSections(
    cleanedContent,
    context.pageNumber,
    structure.hierarchy.maxDepth,
  )
  sections.push(...parsedSections)

  // Collect footnote refs for each section
  for (const section of sections) {
    section.footnoteRefs = findFootnoteRefs(section.content, extractedFootnotes)
  }

  // Process images
  for (const [id, imageInfo] of Object.entries(detectedImages)) {
    const isDecorative = isImageDecorative(imageInfo, layout, context.pageNumber)
    images.push({
      id,
      description: imageInfo.description,
      dataUrl: '', // Will be filled by cropping later
      page: context.pageNumber,
      isDecorative,
    })

    // Add image ref to relevant section
    if (!isDecorative && sections.length > 0) {
      const lastSection = sections[sections.length - 1]
      lastSection.imageRefs.push(id)
    }
  }

  // Determine if content ends incomplete
  const trimmedContent = cleanedContent.trimEnd()
  const endsIncomplete = !trimmedContent.match(/[.!?:;'"]$/)
    && trimmedContent.length > 0

  return {
    sections,
    footnotes,
    images,
    summary,
    lastParagraph,
    endsIncomplete,
  }
}

/**
 * Remove repeated elements (headers, footers, page numbers) from content.
 */
function removeRepeatedElements(content: string, layout: LayoutProfile): string {
  let result = content

  // Remove header patterns
  for (const header of layout.repeatedElements.headers) {
    const pattern = new RegExp(`^\\s*${escapeRegex(header)}\\s*$`, 'gm')
    result = result.replace(pattern, '')
  }

  // Remove footer patterns
  for (const footer of layout.repeatedElements.footers) {
    const pattern = new RegExp(`^\\s*${escapeRegex(footer)}\\s*$`, 'gm')
    result = result.replace(pattern, '')
  }

  // Remove page number patterns
  if (layout.repeatedElements.pageNumbers) {
    try {
      const pageNumPattern = new RegExp(layout.repeatedElements.pageNumbers, 'gm')
      result = result.replace(pageNumPattern, '')
    } catch {
      // Invalid regex pattern, skip
    }
  }

  // Clean up excessive blank lines
  result = result.replace(/\n{3,}/g, '\n\n')

  return result.trim()
}

/**
 * Extract footnotes from content, leaving only inline markers.
 */
function extractFootnotes(
  content: string,
  pageNum: number,
  style: 'numbered' | 'symbolic' | 'none',
): { text: string; extractedFootnotes: Footnote[] } {
  const extractedFootnotes: Footnote[] = []

  if (style === 'none') {
    return { text: content, extractedFootnotes }
  }

  // Pattern for footnote definitions at bottom of text
  // Matches lines like "1. Footnote text" or "* Footnote text"
  const footnoteDefPattern = style === 'numbered'
    ? /^(\d+)\.\s+(.+)$/gm
    : /^([*\u2020\u2021\u00a7])\s+(.+)$/gm

  let text = content
  let match

  // Extract footnote definitions
  const seenIds = new Set<string>()
  while ((match = footnoteDefPattern.exec(content)) !== null) {
    const id = match[1]
    const footnoteContent = match[2].trim()

    // Avoid duplicates
    if (!seenIds.has(id)) {
      seenIds.add(id)
      extractedFootnotes.push({
        id,
        content: footnoteContent,
        page: pageNum,
      })
    }
  }

  // Remove footnote definitions from text, keeping only markers
  text = text.replace(footnoteDefPattern, '')

  // Clean up any resulting empty lines
  text = text.replace(/\n{3,}/g, '\n\n').trim()

  return { text, extractedFootnotes }
}

/**
 * Parse content into sections based on heading markers.
 */
function parseSections(
  content: string,
  pageNum: number,
  maxDepth: number,
): Section[] {
  const sections: Section[] = []
  const lines = content.split('\n')

  let currentSection: Section | null = null
  let sectionCounter = 0

  for (const line of lines) {
    // Check for heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)

    if (headingMatch) {
      // Save previous section
      if (currentSection) {
        currentSection.content = currentSection.content.trim()
        sections.push(currentSection)
      }

      const level = Math.min(headingMatch[1].length, maxDepth)
      const title = headingMatch[2].trim()
      sectionCounter++

      currentSection = {
        id: `section-${pageNum}-${sectionCounter}`,
        level,
        title,
        content: '',
        footnoteRefs: [],
        imageRefs: [],
      }
    } else {
      // Add to current section or create untitled section
      if (!currentSection) {
        sectionCounter++
        currentSection = {
          id: `section-${pageNum}-${sectionCounter}`,
          level: 0,
          title: '',
          content: '',
          footnoteRefs: [],
          imageRefs: [],
        }
      }
      currentSection.content += line + '\n'
    }
  }

  // Don't forget the last section
  if (currentSection) {
    currentSection.content = currentSection.content.trim()
    if (currentSection.content.length > 0 || currentSection.title.length > 0) {
      sections.push(currentSection)
    }
  }

  return sections
}

/**
 * Find footnote references in section content.
 */
function findFootnoteRefs(content: string, footnotes: Footnote[]): string[] {
  const refs: string[] = []

  for (const footnote of footnotes) {
    // Check for inline reference markers like [1] or [*]
    const markerPattern = new RegExp(`\\[${escapeRegex(footnote.id)}\\]`)
    if (markerPattern.test(content)) {
      refs.push(footnote.id)
    }
  }

  return refs
}

/**
 * Determine if an image is decorative based on layout profile.
 */
function isImageDecorative(
  imageInfo: {
    id: string
    bbox: [number, number, number, number]
    description: string
    type: string
  },
  layout: LayoutProfile,
  pageNum: number,
): boolean {
  // Check if image matches decorative patterns
  const descLower = imageInfo.description.toLowerCase()
  for (const pattern of layout.decorativeImages.patterns) {
    if (descLower.includes(pattern.toLowerCase())) {
      return true
    }
  }

  // Check if image is in a decorative position
  const [ymin, xmin, _ymax, _xmax] = imageInfo.bbox

  for (const pos of layout.decorativeImages.positions) {
    if (pos.page !== pageNum) continue

    // Check zone based on position
    const yPercent = ymin / 10 // bbox is 0-1000, convert to 0-100
    const xPercent = xmin / 10

    if (pos.zone === 'header' && yPercent < layout.pageZones.headerZone.bottom) {
      return true
    }
    if (pos.zone === 'footer' && yPercent > layout.pageZones.footerZone.top) {
      return true
    }
    if (pos.zone === 'margin') {
      if (
        xPercent < layout.pageZones.marginZones.left
        || xPercent > layout.pageZones.marginZones.right
      ) {
        return true
      }
    }
  }

  // Check image type - logos and icons are often decorative
  if (imageInfo.type === 'logo' || imageInfo.type === 'icon') {
    return true
  }

  return false
}

/**
 * Determine if a section should continue from the previous one.
 */
function shouldContinueSection(previousContent: string, currentContent: string): boolean {
  if (!previousContent || !currentContent) return false

  const trimmedPrev = previousContent.trim()
  const trimmedCurr = currentContent.trim()

  // Previous ends mid-sentence
  const prevEndsIncomplete = !trimmedPrev.match(/[.!?:;'"]$/)

  // Current starts with lowercase (continuation indicator)
  const currStartsLower = /^[a-z]/.test(trimmedCurr)

  // Current doesn't start with heading
  const currNoHeading = !trimmedCurr.startsWith('#')

  return prevEndsIncomplete && (currStartsLower || currNoHeading)
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
