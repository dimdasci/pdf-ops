/**
 * Direct Pipeline for Simple Documents
 *
 * Optimized for small documents (1-5 pages) with minimal structure.
 * Uses single-pass conversion without complex context building.
 */

import type { LLMProvider, PageConversionResult } from '../llm/types'
import type { PdfService } from '../pdf-service/types'

export interface DirectPipelineOptions {
  /** Progress callback */
  onProgress?: (status: string, page: number, total: number) => void
  /** Render DPI for page images */
  dpi?: number
}

export interface DirectPipelineResult {
  /** Combined markdown content */
  markdown: string
  /** Per-page content */
  pageContents: string[]
  /** Metadata */
  metadata: {
    pageCount: number
    language: string
    processingTimeMs: number
  }
}

/**
 * Direct pipeline for simple documents.
 * Best for: 1-5 page documents without complex structure.
 */
export async function runDirectPipeline(
  pdfService: PdfService,
  provider: LLMProvider,
  options: DirectPipelineOptions = {},
): Promise<DirectPipelineResult> {
  const startTime = Date.now()
  const { onProgress, dpi = 150 } = options
  const pageCount = pdfService.getPageCount()

  onProgress?.('Starting direct conversion...', 0, pageCount)

  const pageContents: string[] = []
  let previousContent = ''
  let detectedLanguage = 'Unknown'

  // Process each page sequentially with minimal context
  for (let i = 1; i <= pageCount; i++) {
    onProgress?.(`Converting page ${i} of ${pageCount}...`, i, pageCount)

    // Render page to image
    const imageBase64 = await pdfService.renderPage(i, { dpi })

    // Convert page with minimal context
    const result = await provider.convertPage(imageBase64, {
      pageNumber: i,
      totalPages: pageCount,
      previousContent: previousContent.slice(-500), // Limited context
      previousSummary: '',
      expectedHeadings: [], // No structure guidance
      currentSection: null,
      headerPattern: null,
      footerPattern: null,
      language: detectedLanguage,
    })

    // Process images if any
    const pageContent = await processPageImages(
      pdfService,
      imageBase64,
      result,
    )

    // Detect language from first page
    if (i === 1 && result.content) {
      detectedLanguage = detectLanguage(result.content)
    }

    pageContents.push(pageContent)
    previousContent = pageContent
  }

  // Combine pages
  const markdown = pageContents.join('\n\n')

  return {
    markdown,
    pageContents,
    metadata: {
      pageCount,
      language: detectedLanguage,
      processingTimeMs: Date.now() - startTime,
    },
  }
}

/**
 * Process page images by replacing placeholders with actual image data.
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

  // Clean up any remaining placeholders
  content = content.replace(
    /!\[(.*?)\]\((img_placeholder_[a-zA-Z0-9_]+)\)/g,
    '> *[Image: $1]*',
  )

  // Clean up empty image references
  content = content.replace(/!\[(.*?)\]\(\s*\)/g, '> *[Image: $1]*')

  return content
}

/**
 * Simple language detection from content.
 */
function detectLanguage(content: string): string {
  // Common words in different languages
  const patterns: Record<string, RegExp[]> = {
    English: [/\bthe\b/i, /\band\b/i, /\bof\b/i, /\bto\b/i, /\bin\b/i],
    German: [/\bund\b/i, /\bder\b/i, /\bdie\b/i, /\bdas\b/i, /\bist\b/i],
    French: [/\ble\b/i, /\bla\b/i, /\bde\b/i, /\bet\b/i, /\best\b/i],
    Spanish: [/\bel\b/i, /\bla\b/i, /\bde\b/i, /\by\b/i, /\ben\b/i],
    Russian: [/\bи\b/i, /\bв\b/i, /\bна\b/i, /\bне\b/i, /\bс\b/i],
  }

  const scores: Record<string, number> = {}

  for (const [language, regexes] of Object.entries(patterns)) {
    scores[language] = regexes.reduce(
      (score, regex) => score + (regex.test(content) ? 1 : 0),
      0,
    )
  }

  const best = Object.entries(scores).reduce((a, b) => b[1] > a[1] ? b : a)

  return best[1] >= 3 ? best[0] : 'Unknown'
}
