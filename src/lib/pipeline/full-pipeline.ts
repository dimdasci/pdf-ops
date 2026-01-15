/**
 * Full Pipeline for Complex Documents
 *
 * Optimized for large documents (50+ pages) with rich structure.
 * Uses intelligent windowed processing with context passing.
 */

import type {
  DocumentAnalysis,
  DocumentStructure,
  HeadingInfo,
  LLMProvider,
  SectionInfo,
  WindowContext,
  WindowResult,
} from '../llm/types'
import type { PdfService } from '../pdf-service/types'

export interface FullPipelineOptions {
  /** Progress callback */
  onProgress?: (status: string, current: number, total: number) => void
  /** Render DPI for page images */
  dpi?: number
  /** Maximum pages per processing window */
  maxPagesPerWindow?: number
  /** Whether to use parallel window processing */
  parallel?: boolean
  /** Concurrency for parallel processing */
  concurrency?: number
}

export interface FullPipelineResult {
  /** Combined markdown content */
  markdown: string
  /** Per-window results */
  windowResults: WindowResult[]
  /** Metadata */
  metadata: {
    pageCount: number
    language: string
    hasTOC: boolean
    windowCount: number
    processingTimeMs: number
  }
  /** Extracted structure */
  structure: DocumentStructure
  /** Document analysis */
  analysis: DocumentAnalysis
}

interface WindowSpec {
  windowNumber: number
  startPage: number
  endPage: number
  sectionsInWindow: SectionInfo[]
  expectedHeadings: HeadingInfo[]
}

/**
 * Full pipeline for complex documents.
 * Best for: 50+ page documents with rich structure.
 */
export async function runFullPipeline(
  pdfService: PdfService,
  provider: LLMProvider,
  options: FullPipelineOptions = {},
): Promise<FullPipelineResult> {
  const startTime = Date.now()
  const {
    onProgress,
    dpi = 150,
    maxPagesPerWindow = 50,
    parallel = false,
    concurrency = 3,
  } = options

  const pageCount = pdfService.getPageCount()
  const supportsNativePdf = provider.capabilities.supportsNativePdf

  // Phase 1: Global Document Analysis
  onProgress?.('Analyzing document...', 0, 100)

  let analysis: DocumentAnalysis
  let structure: DocumentStructure

  if (supportsNativePdf && pageCount <= provider.capabilities.maxPdfPages) {
    // Use native PDF for analysis
    const pdfData = await getPdfData(pdfService, pageCount)
    analysis = await provider.analyzeDocument(pdfData)
    structure = await provider.extractStructure(pdfData, analysis)
  } else {
    // Use text-based analysis
    const analysisText = await getAnalysisText(pdfService, pageCount)
    analysis = await provider.analyzeDocument(analysisText)
    structure = await provider.extractStructure(analysisText, analysis)
  }

  onProgress?.('Document analysis complete', 10, 100)

  // Phase 2: Detect Repeating Elements
  onProgress?.('Detecting headers and footers...', 15, 100)
  const patterns = await detectRepeatingPatterns(pdfService, pageCount)

  // Phase 3: Compute Processing Windows
  onProgress?.('Planning processing windows...', 20, 100)
  const windows = computeWindows(
    pageCount,
    structure,
    maxPagesPerWindow,
  )

  const totalWindows = windows.length
  onProgress?.(`Processing ${totalWindows} windows...`, 25, 100)

  // Phase 4: Process Windows
  const windowResults: WindowResult[] = []

  if (parallel && totalWindows > 1) {
    // Process windows in parallel batches
    windowResults.push(
      ...(await processWindowsParallel(
        pdfService,
        provider,
        windows,
        {
          dpi,
          analysis,
          structure,
          patterns,
          onProgress,
          concurrency,
        },
      )),
    )
  } else {
    // Process windows sequentially
    let previousWindowTail = ''
    let previousWindowSummary = ''

    for (let i = 0; i < windows.length; i++) {
      const window = windows[i]
      const progressPercent = 25 + Math.floor((i / totalWindows) * 65)
      onProgress?.(
        `Processing window ${
          i + 1
        } of ${totalWindows} (pages ${window.startPage}-${window.endPage})...`,
        progressPercent,
        100,
      )

      const context = buildWindowContext(
        window,
        totalWindows,
        analysis,
        structure,
        patterns,
        previousWindowTail,
        previousWindowSummary,
      )

      const result = await processWindow(
        pdfService,
        provider,
        window,
        context,
        dpi,
      )

      windowResults.push(result)
      previousWindowTail = result.lastParagraph
      previousWindowSummary = result.summary
    }
  }

  // Phase 5: Merge Window Results
  onProgress?.('Merging results...', 92, 100)
  const markdown = mergeWindowResults(windowResults, patterns)

  onProgress?.('Complete!', 100, 100)

  return {
    markdown,
    windowResults,
    metadata: {
      pageCount,
      language: analysis.language,
      hasTOC: analysis.hasTOC,
      windowCount: totalWindows,
      processingTimeMs: Date.now() - startTime,
    },
    structure,
    analysis,
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get PDF data as base64 string.
 */
async function getPdfData(pdfService: PdfService, pageCount: number): Promise<string> {
  // Extract all pages as a single PDF
  const pdfBytes = await pdfService.extractPageRange(1, pageCount)
  return btoa(String.fromCharCode(...pdfBytes))
}

/**
 * Get text from document for analysis.
 */
async function getAnalysisText(pdfService: PdfService, pageCount: number): Promise<string> {
  const sampleSize = Math.min(10, pageCount)
  let text = ''

  // Get first pages
  const firstPages = Math.min(5, sampleSize)
  for (let i = 1; i <= firstPages; i++) {
    text += await pdfService.getPageText(i) + '\n\n'
  }

  // Get middle and last pages if document is large
  if (pageCount > 10) {
    const middlePage = Math.floor(pageCount / 2)
    text += await pdfService.getPageText(middlePage) + '\n\n'
    text += await pdfService.getPageText(pageCount) + '\n\n'
  }

  return text
}

/**
 * Detect repeating header/footer patterns.
 */
async function detectRepeatingPatterns(
  pdfService: PdfService,
  pageCount: number,
): Promise<{ header: string | null; footer: string | null }> {
  if (pageCount < 5) {
    return { header: null, footer: null }
  }

  const sampleSize = Math.min(7, pageCount)
  const firstLines: string[] = []
  const lastLines: string[] = []

  for (let i = 1; i <= sampleSize; i++) {
    const pageNum = Math.ceil((i * pageCount) / (sampleSize + 1))
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

  return {
    header: findCommonPattern(firstLines),
    footer: findCommonPattern(lastLines),
  }
}

function findCommonPattern(strings: string[]): string | null {
  if (strings.length < 3) return null

  const counts = new Map<string, number>()
  for (const s of strings) {
    counts.set(s, (counts.get(s) || 0) + 1)
  }

  for (const [str, count] of counts) {
    if (count >= strings.length * 0.5 && str.length > 2) {
      return str
    }
  }

  if (strings.every(s => /^\d+$/.test(s))) {
    return '\\d+'
  }

  return null
}

/**
 * Compute processing windows based on document structure.
 */
function computeWindows(
  pageCount: number,
  structure: DocumentStructure,
  maxPagesPerWindow: number,
): WindowSpec[] {
  const windows: WindowSpec[] = []
  let currentStart = 1
  let windowNumber = 1

  while (currentStart <= pageCount) {
    let idealEnd = Math.min(currentStart + maxPagesPerWindow - 1, pageCount)

    // Look for section boundary within last 10 pages of window
    const sectionBreak = findNearestSectionBreak(
      structure.sections,
      idealEnd - 10,
      idealEnd,
    )

    if (sectionBreak && sectionBreak > currentStart) {
      idealEnd = sectionBreak
    }

    // Get sections and headings for this window
    const sectionsInWindow = getSectionsInRange(structure.sections, currentStart, idealEnd)
    const expectedHeadings = getHeadingsInRange(structure.headings, currentStart, idealEnd)

    windows.push({
      windowNumber,
      startPage: currentStart,
      endPage: idealEnd,
      sectionsInWindow,
      expectedHeadings,
    })

    currentStart = idealEnd + 1
    windowNumber++
  }

  return windows
}

function findNearestSectionBreak(
  sections: SectionInfo[],
  minPage: number,
  maxPage: number,
): number | null {
  let bestBreak: number | null = null

  function searchSection(section: SectionInfo): void {
    if (section.startPage >= minPage && section.startPage <= maxPage) {
      if (!bestBreak || section.startPage > bestBreak) {
        bestBreak = section.startPage - 1 // End just before section starts
      }
    }
    for (const child of section.children) {
      searchSection(child)
    }
  }

  for (const section of sections) {
    searchSection(section)
  }

  return bestBreak
}

function getSectionsInRange(
  sections: SectionInfo[],
  startPage: number,
  endPage: number,
): SectionInfo[] {
  const result: SectionInfo[] = []

  function collectSections(section: SectionInfo): void {
    if (section.startPage <= endPage && section.endPage >= startPage) {
      result.push(section)
    }
    for (const child of section.children) {
      collectSections(child)
    }
  }

  for (const section of sections) {
    collectSections(section)
  }

  return result
}

function getHeadingsInRange(
  headings: HeadingInfo[],
  startPage: number,
  endPage: number,
): HeadingInfo[] {
  return headings.filter(h => h.page >= startPage && h.page <= endPage)
}

/**
 * Build context for a processing window.
 */
function buildWindowContext(
  window: WindowSpec,
  totalWindows: number,
  analysis: DocumentAnalysis,
  structure: DocumentStructure,
  patterns: { header: string | null; footer: string | null },
  previousWindowTail: string,
  previousWindowSummary: string,
): WindowContext {
  const percentComplete = Math.round((window.windowNumber / totalWindows) * 100)

  // Find continued section
  let continuedSection: string | null = null
  if (window.startPage > 1) {
    for (const heading of structure.headings) {
      if (heading.page >= window.startPage) break
      if (heading.level <= 2) {
        continuedSection = heading.text
      }
    }
  }

  // Check if section continues after
  const sectionContinuesAfter = window.sectionsInWindow.some(
    s => s.endPage > window.endPage,
  )

  return {
    global: {
      totalPages: analysis.pageCount || structure.headings.length || 0,
      language: analysis.language,
      toc: structure.headings,
      headerPattern: patterns.header,
      footerPattern: patterns.footer,
    },
    position: {
      windowNumber: window.windowNumber,
      totalWindows,
      startPage: window.startPage,
      endPage: window.endPage,
      percentComplete,
    },
    structure: {
      sectionsInWindow: window.sectionsInWindow,
      expectedHeadings: window.expectedHeadings,
      continuedSection,
      sectionContinuesAfter,
    },
    continuity: {
      previousWindowTail,
      previousWindowSummary,
      pendingReferences: [],
    },
    expectations: {
      estimatedImages: Math.ceil(
        (analysis.estimatedImages / (analysis.pageCount || 1))
          * (window.endPage - window.startPage + 1),
      ),
      estimatedTables: Math.ceil(
        (analysis.estimatedTables / (analysis.pageCount || 1))
          * (window.endPage - window.startPage + 1),
      ),
      hasCodeBlocks: analysis.estimatedCodeBlocks > 0,
      hasMathFormulas: false,
    },
  }
}

/**
 * Process a single window.
 */
async function processWindow(
  pdfService: PdfService,
  provider: LLMProvider,
  window: WindowSpec,
  context: WindowContext,
  dpi: number,
): Promise<WindowResult> {
  if (provider.capabilities.supportsNativePdf) {
    // Use native PDF processing
    const pdfData = await pdfService.extractPageRange(window.startPage, window.endPage)
    const base64Data = btoa(String.fromCharCode(...pdfData))
    return await provider.convertWindow(base64Data, context)
  } else {
    // Use page-by-page processing
    return await processWindowPageByPage(pdfService, provider, window, context, dpi)
  }
}

/**
 * Process window page by page (for providers without native PDF support).
 */
async function processWindowPageByPage(
  pdfService: PdfService,
  provider: LLMProvider,
  window: WindowSpec,
  context: WindowContext,
  dpi: number,
): Promise<WindowResult> {
  const pageContents: string[] = []
  let previousContent = context.continuity.previousWindowTail
  let summary = ''

  for (let pageNum = window.startPage; pageNum <= window.endPage; pageNum++) {
    const imageBase64 = await pdfService.renderPage(pageNum, { dpi })

    const expectedHeadings = window.expectedHeadings.filter(h => h.page === pageNum)
    const currentSection = findCurrentSection(context.global.toc, pageNum)

    const result = await provider.convertPage(imageBase64, {
      pageNumber: pageNum,
      totalPages: context.global.totalPages,
      previousContent: previousContent.slice(-500),
      previousSummary: summary,
      expectedHeadings,
      currentSection,
      headerPattern: context.global.headerPattern,
      footerPattern: context.global.footerPattern,
      language: context.global.language,
    })

    // Process images
    const content = await processPageImages(pdfService, imageBase64, result)
    pageContents.push(content)
    previousContent = content
    summary = result.summary || ''
  }

  const markdown = pageContents.join('\n\n')
  const lastParagraph = extractLastParagraph(markdown)

  return {
    markdown,
    lastParagraph,
    summary: await provider.summarize(markdown, 300),
    unresolvedReferences: [],
    detectedImages: [],
  }
}

function findCurrentSection(headings: HeadingInfo[], pageNum: number): string | null {
  let current: string | null = null
  for (const heading of headings) {
    if (heading.page > pageNum) break
    if (heading.level <= 2) {
      current = heading.text
    }
  }
  return current
}

async function processPageImages(
  pdfService: PdfService,
  pageImageBase64: string,
  result: { content: string; images: Record<string, { bbox?: number[] }> },
): Promise<string> {
  let content = result.content

  for (const [placeholder, imageInfo] of Object.entries(result.images)) {
    if (!imageInfo?.bbox || imageInfo.bbox.length !== 4) continue

    try {
      const croppedDataUrl = await pdfService.cropImage(pageImageBase64, {
        bbox: imageInfo.bbox as [number, number, number, number],
      })
      if (croppedDataUrl) {
        content = content.replaceAll(placeholder, croppedDataUrl)
      }
    } catch (err) {
      console.warn(`Failed to crop image ${placeholder}:`, err)
    }
  }

  content = content.replace(
    /!\[(.*?)\]\((img_placeholder_[a-zA-Z0-9_]+)\)/g,
    '> *[Image: $1]*',
  )

  return content
}

function extractLastParagraph(markdown: string): string {
  const paragraphs = markdown
    .split(/\n\n+/)
    .filter(p => p.trim().length > 0 && !p.trim().startsWith('#'))

  return paragraphs[paragraphs.length - 1]?.slice(-500) || ''
}

/**
 * Process windows in parallel.
 */
async function processWindowsParallel(
  pdfService: PdfService,
  provider: LLMProvider,
  windows: WindowSpec[],
  options: {
    dpi: number
    analysis: DocumentAnalysis
    structure: DocumentStructure
    patterns: { header: string | null; footer: string | null }
    onProgress?: (status: string, current: number, total: number) => void
    concurrency: number
  },
): Promise<WindowResult[]> {
  const results: WindowResult[] = new Array(windows.length)
  const { dpi, analysis, structure, patterns, onProgress, concurrency } = options

  // Process in batches
  for (let i = 0; i < windows.length; i += concurrency) {
    const batch = windows.slice(i, i + concurrency)
    const batchPromises = batch.map(async (window, batchIndex) => {
      const windowIndex = i + batchIndex

      // Build context (note: for parallel, we don't have previous window context)
      const context = buildWindowContext(
        window,
        windows.length,
        analysis,
        structure,
        patterns,
        '', // No previous tail in parallel
        '', // No previous summary in parallel
      )

      const result = await processWindow(pdfService, provider, window, context, dpi)
      results[windowIndex] = result

      onProgress?.(
        `Processed window ${windowIndex + 1} of ${windows.length}`,
        25 + Math.floor(((windowIndex + 1) / windows.length) * 65),
        100,
      )
    })

    await Promise.all(batchPromises)
  }

  return results
}

/**
 * Merge window results into final markdown.
 */
function mergeWindowResults(
  results: WindowResult[],
  patterns: { header: string | null; footer: string | null },
): string {
  const processedResults: string[] = []

  for (let i = 0; i < results.length; i++) {
    let content = results[i].markdown

    // Remove header patterns
    if (patterns.header) {
      const headerRegex = new RegExp(`^${escapeRegex(patterns.header)}\\s*\n?`, 'gm')
      content = content.replace(headerRegex, '')
    }

    // Remove footer patterns
    if (patterns.footer) {
      const footerRegex = new RegExp(`\n?${escapeRegex(patterns.footer)}\\s*$`, 'gm')
      content = content.replace(footerRegex, '')
    }

    // Handle cross-window continuity
    if (i < results.length - 1) {
      const currentTail = results[i].lastParagraph
      const nextStart = results[i + 1].markdown.trimStart()

      const needsMerging = currentTail
        && !currentTail.match(/[.!?:;'"]$/)
        && (nextStart.match(/^[a-z]/) || !nextStart.startsWith('#'))

      if (needsMerging) {
        content = content.trimEnd() + ' '
        processedResults.push(content)
        continue
      }
    }

    processedResults.push(content.trim())
  }

  return processedResults.join('\n\n')
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
