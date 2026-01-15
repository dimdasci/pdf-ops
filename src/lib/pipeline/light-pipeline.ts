/**
 * Light Pipeline for Moderate Documents
 *
 * Optimized for medium-sized documents (5-50 pages) with some structure.
 * Uses quick structure extraction followed by sequential page conversion.
 */

import type {
  DocumentStructure,
  HeadingInfo,
  LLMProvider,
  PageConversionResult,
} from '../llm/types'
import type { PdfService } from '../pdf-service/types'

export interface LightPipelineOptions {
  /** Progress callback */
  onProgress?: (status: string, page: number, total: number) => void
  /** Render DPI for page images */
  dpi?: number
  /** Whether to detect header/footer patterns */
  detectRepeatingElements?: boolean
}

export interface LightPipelineResult {
  /** Combined markdown content */
  markdown: string
  /** Per-page content */
  pageContents: string[]
  /** Metadata */
  metadata: {
    pageCount: number
    language: string
    hasTOC: boolean
    processingTimeMs: number
  }
  /** Extracted structure */
  structure: DocumentStructure
}

/**
 * Light pipeline for moderate complexity documents.
 * Best for: 5-50 page documents with some structure.
 */
export async function runLightPipeline(
  pdfService: PdfService,
  provider: LLMProvider,
  options: LightPipelineOptions = {},
): Promise<LightPipelineResult> {
  const startTime = Date.now()
  const { onProgress, dpi = 150, detectRepeatingElements = true } = options
  const pageCount = pdfService.getPageCount()

  // Phase 1: Quick document analysis
  onProgress?.('Analyzing document structure...', 0, pageCount)

  // Get text from first few pages for analysis
  const analysisPages = Math.min(5, pageCount)
  let analysisText = ''
  for (let i = 1; i <= analysisPages; i++) {
    analysisText += await pdfService.getPageText(i) + '\n\n'
  }

  // Analyze document
  const analysis = await provider.analyzeDocument(analysisText)

  // Phase 2: Extract structure
  onProgress?.('Extracting document structure...', 0, pageCount)
  const structure = await provider.extractStructure(analysisText, analysis)

  // Phase 3: Detect repeating elements (headers/footers)
  let headerPattern: string | null = null
  let footerPattern: string | null = null

  if (detectRepeatingElements && pageCount > 3) {
    onProgress?.('Detecting headers and footers...', 0, pageCount)
    const patterns = await detectRepeatingPatterns(pdfService, pageCount)
    headerPattern = patterns.header
    footerPattern = patterns.footer
  }

  // Phase 4: Convert pages with structure context
  const pageContents: string[] = []
  let previousContent = ''
  let previousSummary = ''

  for (let i = 1; i <= pageCount; i++) {
    onProgress?.(`Converting page ${i} of ${pageCount}...`, i, pageCount)

    // Render page to image
    const imageBase64 = await pdfService.renderPage(i, { dpi })

    // Get expected headings for this page
    const expectedHeadings = structure.headingsByPage.get(i) || []

    // Find current section
    const currentSection = findCurrentSection(structure.headings, i)

    // Convert page with structure context
    const result = await provider.convertPage(imageBase64, {
      pageNumber: i,
      totalPages: pageCount,
      previousContent: previousContent.slice(-800),
      previousSummary,
      expectedHeadings,
      currentSection,
      headerPattern,
      footerPattern,
      language: analysis.language,
    })

    // Process images
    const pageContent = await processPageImages(pdfService, imageBase64, result)

    // Store for context
    previousSummary = result.summary || ''
    previousContent = pageContent
    pageContents.push(pageContent)
  }

  // Phase 5: Post-processing
  onProgress?.('Finalizing document...', pageCount, pageCount)
  const markdown = postProcessPages(pageContents, headerPattern, footerPattern)

  return {
    markdown,
    pageContents,
    metadata: {
      pageCount,
      language: analysis.language,
      hasTOC: analysis.hasTOC,
      processingTimeMs: Date.now() - startTime,
    },
    structure,
  }
}

/**
 * Detect repeating patterns in headers/footers.
 */
async function detectRepeatingPatterns(
  pdfService: PdfService,
  pageCount: number,
): Promise<{ header: string | null; footer: string | null }> {
  // Sample pages for pattern detection
  const sampleSize = Math.min(5, pageCount)
  const samplePages: number[] = []

  // Get evenly distributed pages
  for (let i = 1; i <= sampleSize; i++) {
    samplePages.push(Math.ceil((i * pageCount) / (sampleSize + 1)))
  }

  // Extract first and last lines from each page
  const firstLines: string[] = []
  const lastLines: string[] = []

  for (const pageNum of samplePages) {
    const text = await pdfService.getPageText(pageNum)
    const lines = text
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)

    if (lines.length > 0) {
      firstLines.push(lines[0])
      if (lines.length > 1) {
        lastLines.push(lines[lines.length - 1])
      }
    }
  }

  // Find common patterns
  const headerPattern = findCommonPattern(firstLines)
  const footerPattern = findCommonPattern(lastLines)

  return { header: headerPattern, footer: footerPattern }
}

/**
 * Find common pattern among strings.
 */
function findCommonPattern(strings: string[]): string | null {
  if (strings.length < 3) return null

  // Check for exact matches
  const counts = new Map<string, number>()
  for (const s of strings) {
    counts.set(s, (counts.get(s) || 0) + 1)
  }

  // Find most common string that appears in >50% of samples
  for (const [str, count] of counts) {
    if (count >= strings.length * 0.5 && str.length > 2) {
      return str
    }
  }

  // Check for page number pattern (just numbers)
  const numberPattern = strings.every(s => /^\d+$/.test(s))
  if (numberPattern) {
    return '\\d+' // Return regex pattern
  }

  return null
}

/**
 * Find current section based on page number.
 */
function findCurrentSection(
  headings: HeadingInfo[],
  pageNum: number,
): string | null {
  // Find the most recent h1 or h2 heading before this page
  let currentSection: string | null = null

  for (const heading of headings) {
    if (heading.page > pageNum) break
    if (heading.level <= 2) {
      currentSection = heading.text
    }
  }

  return currentSection
}

/**
 * Process page images by replacing placeholders.
 */
async function processPageImages(
  pdfService: PdfService,
  pageImageBase64: string,
  result: PageConversionResult,
): Promise<string> {
  let content = result.content

  // Replace image placeholders with cropped images
  const placeholders = Object.keys(result.images)
  for (const placeholder of placeholders) {
    try {
      const imageInfo = result.images[placeholder]
      if (!imageInfo?.bbox || imageInfo.bbox.length !== 4) {
        continue
      }

      const croppedDataUrl = await pdfService.cropImage(pageImageBase64, {
        bbox: imageInfo.bbox,
      })

      if (croppedDataUrl) {
        content = content.replaceAll(placeholder, croppedDataUrl)
      }
    } catch (err) {
      console.warn(`Failed to crop image ${placeholder}:`, err)
    }
  }

  // Clean up remaining placeholders
  content = content.replace(
    /!\[(.*?)\]\((img_placeholder_[a-zA-Z0-9_]+)\)/g,
    '> *[Image: $1]*',
  )

  content = content.replace(/!\[(.*?)\]\(\s*\)/g, '> *[Image: $1]*')

  return content
}

/**
 * Post-process pages to clean up and merge content.
 */
function postProcessPages(
  pages: string[],
  headerPattern: string | null,
  footerPattern: string | null,
): string {
  const processedPages: string[] = []

  for (let i = 0; i < pages.length; i++) {
    let content = pages[i]

    // Remove header patterns
    if (headerPattern) {
      const headerRegex = new RegExp(`^${escapeRegex(headerPattern)}\\s*\n?`, 'gm')
      content = content.replace(headerRegex, '')
    }

    // Remove footer patterns
    if (footerPattern) {
      const footerRegex = new RegExp(`\n?${escapeRegex(footerPattern)}\\s*$`, 'gm')
      content = content.replace(footerRegex, '')
    }

    // Handle page breaks - merge incomplete sentences
    if (i < pages.length - 1) {
      const trimmedContent = content.trimEnd()
      const nextPage = pages[i + 1]?.trimStart() || ''

      // Check if current page ends mid-sentence
      const endsIncomplete = !trimmedContent.match(/[.!?:;'"]$/)
      const nextStartsLower = nextPage.match(/^[a-z]/)
      const nextNoHeading = !nextPage.startsWith('#')

      if (endsIncomplete && (nextStartsLower || nextNoHeading)) {
        content = trimmedContent + ' '
        processedPages.push(content)
        continue
      }
    }

    processedPages.push(content.trim())
  }

  return processedPages.join('\n\n')
}

/**
 * Escape special regex characters in string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
