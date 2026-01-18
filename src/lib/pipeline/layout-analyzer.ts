/**
 * Pass 1: Layout Analyzer
 *
 * Analyzes distributed sample pages to identify:
 * - Header/footer zones
 * - Repeated text elements (headers, footers, page numbers)
 * - Decorative images (logos, borders)
 * - Column layout
 * - Footnote style
 *
 * Uses cheap model (Haiku/Flash) for cost efficiency.
 */

import { Effect, pipe } from 'effect'
import type { LLMProvider } from '../llm/types'
import type { PdfService } from '../pdf-service/types'
import { DEFAULT_RETRY_CONFIG, withRetry } from './effect-wrapper'
import { LayoutAnalysisError } from './types/errors'
import type {
  DecorativeImagePosition,
  DecorativeImages,
  LayoutProfile,
  MarginZones,
  PageZones,
  RepeatedElements,
  ZoneBoundary,
} from './types/profiles'

// ============================================================================
// Types
// ============================================================================

export interface LayoutAnalyzerOptions {
  /** Progress callback */
  onProgress?: (status: string, current: number, total: number) => void
  /** Render DPI for sample pages */
  dpi?: number
  /** Sample positions as percentages (default: [10, 30, 50, 70, 90]) */
  samplePositions?: number[]
}

/**
 * Raw analysis result from LLM for a single page.
 */
interface PageLayoutAnalysis {
  pageNumber: number
  headerZone: ZoneBoundary
  footerZone: ZoneBoundary
  marginZones: MarginZones
  headerText: string | null
  footerText: string | null
  pageNumberPattern: string | null
  decorativeImages: Array<{
    zone: 'header' | 'footer' | 'margin'
    description: string
  }>
  footnoteStyle: 'numbered' | 'symbolic' | 'none'
  columnLayout: 'single' | 'double' | 'mixed'
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Analyze document layout by sampling distributed pages.
 *
 * @param pdfService - Initialized PDF service with loaded document
 * @param provider - LLM provider for analysis
 * @param options - Analysis options
 * @returns Effect producing LayoutProfile describing visual structure patterns
 */
export function analyzeLayout(
  pdfService: PdfService,
  provider: LLMProvider,
  options: LayoutAnalyzerOptions = {},
): Effect.Effect<LayoutProfile, LayoutAnalysisError> {
  const {
    onProgress,
    dpi = 150,
    samplePositions = [10, 30, 50, 70, 90],
  } = options

  return Effect.gen(function*() {
    const pageCount = pdfService.getPageCount()
    onProgress?.('Analyzing document layout...', 0, samplePositions.length)

    // Calculate which pages to sample
    const samplePages = calculateSamplePages(pageCount, samplePositions)

    // Analyze each sample page
    const pageAnalyses: PageLayoutAnalysis[] = []

    for (let i = 0; i < samplePages.length; i++) {
      const pageNum = samplePages[i]
      onProgress?.(
        `Analyzing layout of page ${pageNum}...`,
        i,
        samplePages.length,
      )

      const analysis = yield* analyzePageLayout(
        pdfService,
        provider,
        pageNum,
        pageCount,
        dpi,
      )
      pageAnalyses.push(analysis)
    }

    onProgress?.('Aggregating layout patterns...', samplePages.length, samplePages.length)

    // Cross-compare and aggregate results
    return aggregateLayoutAnalyses(pageAnalyses, samplePages)
  })
}

/**
 * Async wrapper for UI compatibility.
 * Runs the Effect and returns a Promise.
 */
export async function analyzeLayoutAsync(
  pdfService: PdfService,
  provider: LLMProvider,
  options: LayoutAnalyzerOptions = {},
): Promise<LayoutProfile> {
  return Effect.runPromise(analyzeLayout(pdfService, provider, options))
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate which page numbers to sample based on percentage positions.
 */
function calculateSamplePages(pageCount: number, positions: number[]): number[] {
  if (pageCount === 1) {
    return [1]
  }

  const pages = new Set<number>()

  for (const percent of positions) {
    // Map percentage to page number (1-indexed)
    const pageIndex = Math.floor((percent / 100) * (pageCount - 1))
    const pageNum = Math.max(1, Math.min(pageCount, pageIndex + 1))
    pages.add(pageNum)
  }

  // Return sorted unique pages
  return Array.from(pages).sort((a, b) => a - b)
}

/**
 * Build the prompt for layout analysis.
 */
function buildLayoutAnalysisPrompt(
  pageText: string,
  pageNumber: number,
  totalPages: number,
): string {
  return `Analyze the layout structure of this PDF page (page ${pageNumber} of ${totalPages}).

Page text content:
---
${pageText.substring(0, 3000)}
---

Based on the page image and text, identify the following layout elements:

1. **Header Zone**: What percentage of the page height (from top) contains the header?
   - Look for: document title, author info, chapter headers, running headers
   - Provide: top boundary (usually 0) and bottom boundary (e.g., 8 means 8% from top)

2. **Footer Zone**: What percentage of the page height contains the footer?
   - Look for: page numbers, copyright notices, date stamps
   - Provide: top boundary (e.g., 92 means starts at 92% from top) and bottom boundary (usually 100)

3. **Margin Zones**: What percentage from left/right edges contain marginal content?
   - Look for: side notes, line numbers, section markers
   - Provide: left boundary and right boundary percentages

4. **Header Text**: If there's a repeating header, what is the exact text? (null if none)

5. **Footer Text**: If there's a repeating footer, what is the exact text? (null if none)

6. **Page Number Pattern**: Describe the page number format if present
   - Examples: "Page N", "N of M", "- N -", just "N"
   - Return null if no page number visible

7. **Decorative Images**: List any decorative (non-content) images visible
   - Logos, borders, watermarks, ornamental graphics
   - For each: specify zone (header/footer/margin) and brief description

8. **Footnote Style**: What style of footnotes does the page use?
   - "numbered": 1, 2, 3...
   - "symbolic": *, dagger, double-dagger...
   - "none": no footnotes visible

9. **Column Layout**: How is the main text arranged?
   - "single": one column of text
   - "double": two columns
   - "mixed": varies on this page

Respond in JSON format only:
{
  "headerZone": { "top": 0, "bottom": <number 0-100> },
  "footerZone": { "top": <number 0-100>, "bottom": 100 },
  "marginZones": { "left": <number 0-100>, "right": <number 0-100> },
  "headerText": "<string or null>",
  "footerText": "<string or null>",
  "pageNumberPattern": "<string or null>",
  "decorativeImages": [
    { "zone": "<header|footer|margin>", "description": "<string>" }
  ],
  "footnoteStyle": "<numbered|symbolic|none>",
  "columnLayout": "<single|double|mixed>"
}`
}

/**
 * Parse LLM response into PageLayoutAnalysis.
 * Returns Effect to enable proper error handling.
 */
function parseLayoutResponse(
  response: string,
  pageNumber: number,
): Effect.Effect<PageLayoutAnalysis, LayoutAnalysisError> {
  return Effect.try({
    try: () => {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, response]
      const jsonStr = jsonMatch[1]?.trim() || response.trim()

      // Try to find JSON object in the response
      const objectMatch = jsonStr.match(/\{[\s\S]*\}/)
      const finalJson = objectMatch ? objectMatch[0] : jsonStr

      const parsed = JSON.parse(finalJson)

      return {
        pageNumber,
        headerZone: {
          top: clamp(parsed.headerZone?.top ?? 0, 0, 100),
          bottom: clamp(parsed.headerZone?.bottom ?? 10, 0, 100),
        },
        footerZone: {
          top: clamp(parsed.footerZone?.top ?? 90, 0, 100),
          bottom: clamp(parsed.footerZone?.bottom ?? 100, 0, 100),
        },
        marginZones: {
          left: clamp(parsed.marginZones?.left ?? 5, 0, 50),
          right: clamp(parsed.marginZones?.right ?? 95, 50, 100),
        },
        headerText: parsed.headerText ?? null,
        footerText: parsed.footerText ?? null,
        pageNumberPattern: parsed.pageNumberPattern ?? null,
        decorativeImages: Array.isArray(parsed.decorativeImages)
          ? parsed.decorativeImages.map((img: { zone?: string; description?: string }) => ({
            zone: validateZone(img.zone),
            description: String(img.description ?? ''),
          }))
          : [],
        footnoteStyle: validateFootnoteStyle(parsed.footnoteStyle),
        columnLayout: validateColumnLayout(parsed.columnLayout),
      }
    },
    catch: error =>
      new LayoutAnalysisError({
        message: `Failed to parse layout response for page ${pageNumber}`,
        pageNumber,
        cause: error,
      }),
  })
}

/**
 * Analyze a single page's layout using the LLM.
 *
 * Uses convertPage to send the image with context, then uses chat
 * for the detailed layout analysis prompt.
 */
function analyzePageLayout(
  pdfService: PdfService,
  provider: LLMProvider,
  pageNumber: number,
  totalPages: number,
  dpi: number,
): Effect.Effect<PageLayoutAnalysis, LayoutAnalysisError> {
  return Effect.gen(function*() {
    // Render page image
    const imageBase64 = yield* Effect.tryPromise({
      try: () => pdfService.renderPage(pageNumber, { dpi }),
      catch: error =>
        new LayoutAnalysisError({
          message: `Failed to render page ${pageNumber}`,
          pageNumber,
          cause: error,
        }),
    })

    // Get page text
    const pageText = yield* Effect.tryPromise({
      try: () => pdfService.getPageText(pageNumber),
      catch: error =>
        new LayoutAnalysisError({
          message: `Failed to get text for page ${pageNumber}`,
          pageNumber,
          cause: error,
        }),
    })

    const prompt = buildLayoutAnalysisPrompt(pageText, pageNumber, totalPages)

    // Try convertPage first with retry logic
    const convertPageResult = yield* pipe(
      withRetry(
        () =>
          provider.convertPage(imageBase64, {
            pageNumber,
            totalPages,
            previousContent: '',
            previousSummary: prompt,
            expectedHeadings: [],
            currentSection: 'LAYOUT_ANALYSIS',
            headerPattern: null,
            footerPattern: null,
            language: 'Unknown',
          }),
        { ...DEFAULT_RETRY_CONFIG, maxAttempts: 3 },
      ),
      Effect.mapError(error =>
        new LayoutAnalysisError({
          message: `Layout analysis failed for page ${pageNumber}`,
          pageNumber,
          cause: error,
        })
      ),
    )

    // Try to parse the response
    const analysis = yield* pipe(
      parseLayoutResponse(convertPageResult.content, pageNumber),
      Effect.catchAll(() => Effect.succeed(getDefaultPageAnalysis(pageNumber))),
    )

    // If we got default analysis from convertPage, try chat as fallback
    if (isDefaultAnalysis(analysis)) {
      return yield* pipe(
        withRetry(
          () => provider.chat(prompt),
          { ...DEFAULT_RETRY_CONFIG, maxAttempts: 3 },
        ),
        Effect.mapError(error =>
          new LayoutAnalysisError({
            message: `Chat fallback failed for page ${pageNumber}`,
            pageNumber,
            cause: error,
          })
        ),
        Effect.flatMap(chatResponse => parseLayoutResponse(chatResponse, pageNumber)),
        Effect.catchAll(() => Effect.succeed(getDefaultPageAnalysis(pageNumber))),
      )
    }

    return analysis
  }).pipe(
    // Final fallback: if everything fails, return default analysis
    Effect.catchAll(() => Effect.succeed(getDefaultPageAnalysis(pageNumber))),
  )
}

/**
 * Check if analysis result is just defaults (indicating parse failure).
 */
function isDefaultAnalysis(analysis: PageLayoutAnalysis): boolean {
  return (
    analysis.headerText === null
    && analysis.footerText === null
    && analysis.pageNumberPattern === null
    && analysis.decorativeImages.length === 0
    && analysis.headerZone.bottom === 10
    && analysis.footerZone.top === 90
  )
}

/**
 * Aggregate multiple page analyses into a single LayoutProfile.
 * Uses cross-page comparison with fuzzy matching to find consistent patterns.
 */
function aggregateLayoutAnalyses(
  analyses: PageLayoutAnalysis[],
  samplePages: number[],
): LayoutProfile {
  if (analyses.length === 0) {
    return getDefaultLayoutProfile()
  }

  // Aggregate zone boundaries (use median values)
  const pageZones = aggregatePageZones(analyses)

  // Find repeated text elements (fuzzy matching across pages)
  const repeatedElements = findRepeatedElements(analyses)

  // Aggregate decorative images
  const decorativeImages = aggregateDecorativeImages(analyses, samplePages)

  // Determine footnote style (most common)
  const footnoteStyle = getMostCommon(analyses.map(a => a.footnoteStyle))

  // Determine column layout (most common, or 'mixed' if varied)
  const columnLayout = aggregateColumnLayout(analyses)

  return {
    pageZones,
    repeatedElements,
    decorativeImages,
    footnoteStyle,
    columnLayout,
  }
}

/**
 * Aggregate page zone boundaries using median values.
 */
function aggregatePageZones(analyses: PageLayoutAnalysis[]): PageZones {
  return {
    headerZone: {
      top: median(analyses.map(a => a.headerZone.top)),
      bottom: median(analyses.map(a => a.headerZone.bottom)),
    },
    footerZone: {
      top: median(analyses.map(a => a.footerZone.top)),
      bottom: median(analyses.map(a => a.footerZone.bottom)),
    },
    marginZones: {
      left: median(analyses.map(a => a.marginZones.left)),
      right: median(analyses.map(a => a.marginZones.right)),
    },
  }
}

/**
 * Find repeated text elements using fuzzy matching.
 */
function findRepeatedElements(analyses: PageLayoutAnalysis[]): RepeatedElements {
  const headerTexts = analyses
    .map(a => a.headerText)
    .filter((t): t is string => t !== null)

  const footerTexts = analyses
    .map(a => a.footerText)
    .filter((t): t is string => t !== null)

  const pageNumberPatterns = analyses
    .map(a => a.pageNumberPattern)
    .filter((p): p is string => p !== null)

  // Group similar strings (fuzzy match)
  const headers = findSimilarPatterns(headerTexts)
  const footers = findSimilarPatterns(footerTexts)

  // Build page number regex from patterns
  const pageNumbers = buildPageNumberRegex(pageNumberPatterns)

  return {
    headers,
    footers,
    pageNumbers,
  }
}

/**
 * Find similar text patterns using normalized comparison.
 * Returns patterns that appear on at least 40% of analyzed pages.
 */
function findSimilarPatterns(texts: string[]): string[] {
  if (texts.length === 0) return []

  // Normalize and count occurrences
  const normalized = texts.map(t => normalizeText(t))
  const counts = new Map<string, { original: string; count: number }>()

  for (let i = 0; i < normalized.length; i++) {
    const norm = normalized[i]
    const existing = counts.get(norm)
    if (existing) {
      existing.count++
    } else {
      counts.set(norm, { original: texts[i], count: 1 })
    }
  }

  // Return patterns that appear multiple times (fuzzy threshold)
  const threshold = Math.max(1, Math.floor(texts.length * 0.4))
  const patterns: string[] = []

  for (const { original, count } of counts.values()) {
    if (count >= threshold) {
      patterns.push(original)
    }
  }

  return patterns
}

/**
 * Normalize text for fuzzy comparison.
 * Removes numbers, extra whitespace, and converts to lowercase.
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\d+/g, 'N') // Replace numbers with N
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim()
}

/**
 * Build a regex pattern string for page numbers from observed patterns.
 */
function buildPageNumberRegex(patterns: string[]): string {
  if (patterns.length === 0) {
    // Default pattern matches common page number formats
    return '^\\s*(?:Page\\s+)?\\d+(?:\\s+of\\s+\\d+)?\\s*$'
  }

  // Analyze patterns to build regex
  const hasPageWord = patterns.some(p => /page/i.test(p))
  const hasOfTotal = patterns.some(p => /of/i.test(p))
  const hasDashes = patterns.some(p => /-\s*\d+\s*-/.test(p))

  if (hasDashes) {
    return '^\\s*-\\s*\\d+\\s*-\\s*$'
  }

  if (hasPageWord && hasOfTotal) {
    return '^\\s*Page\\s+\\d+\\s+of\\s+\\d+\\s*$'
  }

  if (hasPageWord) {
    return '^\\s*Page\\s+\\d+\\s*$'
  }

  // Generic number pattern
  return '^\\s*\\d+\\s*$'
}

/**
 * Aggregate decorative images across all analyzed pages.
 */
function aggregateDecorativeImages(
  analyses: PageLayoutAnalysis[],
  samplePages: number[],
): DecorativeImages {
  const positions: DecorativeImagePosition[] = []
  const patternCounts = new Map<string, number>()

  for (let i = 0; i < analyses.length; i++) {
    const analysis = analyses[i]
    const pageNum = samplePages[i]

    for (const img of analysis.decorativeImages) {
      // Track position
      positions.push({
        page: pageNum,
        zone: img.zone,
      })

      // Count pattern occurrences
      const pattern = `${img.description} ${img.zone}`
      patternCounts.set(pattern, (patternCounts.get(pattern) ?? 0) + 1)
    }
  }

  // Extract patterns that appear multiple times
  const threshold = Math.max(1, Math.floor(analyses.length * 0.4))
  const patterns: string[] = []

  for (const [pattern, count] of patternCounts) {
    if (count >= threshold) {
      patterns.push(pattern)
    }
  }

  return { positions, patterns }
}

/**
 * Aggregate column layout preference.
 */
function aggregateColumnLayout(
  analyses: PageLayoutAnalysis[],
): 'single' | 'double' | 'mixed' {
  const layouts = analyses.map(a => a.columnLayout)
  const unique = new Set(layouts)

  // If all pages have same layout, use that
  if (unique.size === 1) {
    return layouts[0]
  }

  // If any page is mixed or we see multiple types, report mixed
  return 'mixed'
}

// ============================================================================
// Utility Functions
// ============================================================================

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
}

function getMostCommon<T>(values: T[]): T {
  const counts = new Map<T, number>()
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }

  let best: T = values[0]
  let bestCount = 0

  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value
      bestCount = count
    }
  }

  return best
}

function validateZone(zone: unknown): 'header' | 'footer' | 'margin' {
  if (zone === 'header' || zone === 'footer' || zone === 'margin') {
    return zone
  }
  return 'margin'
}

function validateFootnoteStyle(style: unknown): 'numbered' | 'symbolic' | 'none' {
  if (style === 'numbered' || style === 'symbolic' || style === 'none') {
    return style
  }
  return 'none'
}

function validateColumnLayout(layout: unknown): 'single' | 'double' | 'mixed' {
  if (layout === 'single' || layout === 'double' || layout === 'mixed') {
    return layout
  }
  return 'single'
}

function getDefaultPageAnalysis(pageNumber: number): PageLayoutAnalysis {
  return {
    pageNumber,
    headerZone: { top: 0, bottom: 10 },
    footerZone: { top: 90, bottom: 100 },
    marginZones: { left: 5, right: 95 },
    headerText: null,
    footerText: null,
    pageNumberPattern: null,
    decorativeImages: [],
    footnoteStyle: 'none',
    columnLayout: 'single',
  }
}

function getDefaultLayoutProfile(): LayoutProfile {
  return {
    pageZones: {
      headerZone: { top: 0, bottom: 10 },
      footerZone: { top: 90, bottom: 100 },
      marginZones: { left: 5, right: 95 },
    },
    repeatedElements: {
      headers: [],
      footers: [],
      pageNumbers: '^\\s*\\d+\\s*$',
    },
    decorativeImages: {
      positions: [],
      patterns: [],
    },
    footnoteStyle: 'none',
    columnLayout: 'single',
  }
}
