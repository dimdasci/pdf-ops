/**
 * Intelligent Pipeline - 4-Pass PDF to Markdown Conversion
 *
 * Orchestrates the complete conversion process through four specialized passes:
 *   Pass 1: Layout Analysis → Identifies headers, footers, repeated elements
 *   Pass 2: Structure Analysis → Extracts TOC, heading hierarchy, sections
 *   Pass 3: Content Extraction → Processes pages with profile-guided filtering
 *   Pass 4: Organization → Assembles final markdown with proper formatting
 *
 * This pipeline is designed for documents that benefit from deep structure
 * understanding, such as books, academic papers, and technical manuals.
 */

import type { LLMProvider } from '../llm/types'
import type { PdfService } from '../pdf-service/types'

import { extractContent } from './content-extractor'
import { analyzeLayout } from './layout-analyzer'
import { organizeContent } from './organizer'
import { analyzeStructure } from './structure-analyzer'
import type { LayoutProfile, StructureProfile } from './types/profiles'

// =============================================================================
// Types
// =============================================================================

/**
 * Options for the intelligent pipeline.
 */
export interface IntelligentPipelineOptions {
  /** Progress callback with phase information */
  onProgress?: (status: string, phase: number, totalPhases: number) => void
  /** Render DPI for page images (default: 150) */
  dpi?: number
  /** Include generated TOC in output (default: true) */
  includeToc?: boolean
}

/**
 * Result from the intelligent pipeline.
 */
export interface IntelligentPipelineResult {
  /** Final markdown content */
  markdown: string
  /** Conversion metadata */
  metadata: {
    pageCount: number
    language: string
    documentType: string
    processingTimeMs: number
    pipeline: 'intelligent'
  }
  /** Layout profile from Pass 1 */
  layout: LayoutProfile
  /** Structure profile from Pass 2 */
  structure: StructureProfile
}

/**
 * Internal phase tracking for progress reporting.
 */
interface PhaseInfo {
  phase: number
  name: string
  status: string
}

// =============================================================================
// Constants
// =============================================================================

const TOTAL_PHASES = 4

const PHASES: Record<number, PhaseInfo> = {
  1: { phase: 1, name: 'Layout Analysis', status: 'Analyzing document layout...' },
  2: { phase: 2, name: 'Structure Analysis', status: 'Extracting document structure...' },
  3: { phase: 3, name: 'Content Extraction', status: 'Extracting content...' },
  4: { phase: 4, name: 'Organization', status: 'Organizing final output...' },
}

// =============================================================================
// Main Pipeline Function
// =============================================================================

/**
 * Run the intelligent 4-pass pipeline for PDF to Markdown conversion.
 *
 * This pipeline provides the highest quality conversion by performing
 * deep analysis of document layout and structure before content extraction.
 * It is best suited for complex documents with consistent formatting.
 *
 * @param pdfService - Initialized PDF service with loaded document
 * @param provider - LLM provider for analysis and conversion
 * @param options - Pipeline options
 * @returns Complete conversion result with profiles and metadata
 *
 * @example
 * ```typescript
 * const result = await runIntelligentPipeline(pdfService, provider, {
 *   onProgress: (status, phase, total) => {
 *     console.log(`[${phase}/${total}] ${status}`)
 *   },
 *   dpi: 150,
 *   includeToc: true,
 * })
 * console.log(result.markdown)
 * ```
 */
export async function runIntelligentPipeline(
  pdfService: PdfService,
  provider: LLMProvider,
  options: IntelligentPipelineOptions = {},
): Promise<IntelligentPipelineResult> {
  const { onProgress, dpi = 150, includeToc = true } = options
  const startTime = performance.now()

  const pageCount = pdfService.getPageCount()

  // Helper to report progress with phase context
  const reportProgress = (phase: number, status: string) => {
    onProgress?.(status, phase, TOTAL_PHASES)
  }

  // -------------------------------------------------------------------------
  // Pass 1: Layout Analysis
  // -------------------------------------------------------------------------
  reportProgress(1, PHASES[1].status)

  const layout = await analyzeLayout(pdfService, provider, {
    onProgress: (status, current, total) => {
      const detailedStatus = `${PHASES[1].name}: ${status} (${current}/${total})`
      reportProgress(1, detailedStatus)
    },
    dpi,
  })

  reportProgress(1, `${PHASES[1].name} complete`)

  // -------------------------------------------------------------------------
  // Pass 2: Structure Analysis
  // -------------------------------------------------------------------------
  reportProgress(2, PHASES[2].status)

  const structure = await analyzeStructure(pdfService, provider, layout)

  reportProgress(2, `${PHASES[2].name} complete - detected: ${structure.documentType}`)

  // -------------------------------------------------------------------------
  // Pass 3: Content Extraction
  // -------------------------------------------------------------------------
  reportProgress(3, PHASES[3].status)

  const rawContent = await extractContent(pdfService, provider, layout, structure, {
    onProgress: (page, total) => {
      const detailedStatus = `${PHASES[3].name}: Processing page ${page}/${total}`
      reportProgress(3, detailedStatus)
    },
    dpi,
  })

  reportProgress(3, `${PHASES[3].name} complete - ${rawContent.sections.length} sections`)

  // -------------------------------------------------------------------------
  // Pass 4: Content Organization
  // -------------------------------------------------------------------------
  reportProgress(4, PHASES[4].status)

  const markdown = await organizeContent(rawContent, structure, provider, {
    includeToc,
    tocMaxLevel: 3,
    addSectionSpacing: true,
  })

  reportProgress(4, `${PHASES[4].name} complete`)

  // -------------------------------------------------------------------------
  // Build Result
  // -------------------------------------------------------------------------
  const processingTimeMs = Math.round(performance.now() - startTime)

  // Detect language from structure or default to 'en'
  const language = detectLanguage(structure, rawContent.sections)

  return {
    markdown,
    metadata: {
      pageCount,
      language,
      documentType: structure.documentType,
      processingTimeMs,
      pipeline: 'intelligent',
    },
    layout,
    structure,
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Attempt to detect the document language from structure and content.
 * Returns 'en' as default if detection fails.
 */
function detectLanguage(
  _structure: StructureProfile,
  sections: Array<{ content: string }>,
): string {
  // Simple heuristic: check for common words in different languages
  const sampleText = sections
    .slice(0, 5)
    .map(s => s.content)
    .join(' ')
    .toLowerCase()
    .slice(0, 2000)

  // Common word patterns for language detection
  const languagePatterns: Array<{ lang: string; patterns: RegExp[] }> = [
    {
      lang: 'en',
      patterns: [/\bthe\b/g, /\band\b/g, /\bof\b/g, /\bto\b/g, /\bin\b/g],
    },
    {
      lang: 'de',
      patterns: [/\bund\b/g, /\bder\b/g, /\bdie\b/g, /\bdas\b/g, /\bist\b/g],
    },
    {
      lang: 'fr',
      patterns: [/\ble\b/g, /\bla\b/g, /\bde\b/g, /\bet\b/g, /\bdes\b/g],
    },
    {
      lang: 'es',
      patterns: [/\bel\b/g, /\bla\b/g, /\bde\b/g, /\by\b/g, /\ben\b/g],
    },
    {
      lang: 'ru',
      patterns: [/\bи\b/g, /\bв\b/g, /\bна\b/g, /\bс\b/g, /\bот\b/g],
    },
  ]

  let bestLang = 'en'
  let bestScore = 0

  for (const { lang, patterns } of languagePatterns) {
    let score = 0
    for (const pattern of patterns) {
      const matches = sampleText.match(pattern)
      score += matches?.length ?? 0
    }

    if (score > bestScore) {
      bestScore = score
      bestLang = lang
    }
  }

  return bestLang
}

// =============================================================================
// Exports
// =============================================================================

export type { LayoutProfile, StructureProfile }
