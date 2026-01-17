/**
 * Pipeline Module - PDF to Markdown Conversion
 *
 * Provides adaptive conversion pipelines based on document complexity.
 */

import type { DocumentAnalysis, DocumentStructure, LLMProvider } from '../llm/types'
import type { PdfService } from '../pdf-service/types'

import {
  classifyDocumentComplexity,
  type ComplexityLevel,
  type DocumentComplexity,
  type PipelineType,
} from './complexity-classifier'
import { type DirectPipelineResult, runDirectPipeline } from './direct-pipeline'
import { type FullPipelineResult, runFullPipeline } from './full-pipeline'
import { type IntelligentPipelineResult, runIntelligentPipelineAsync } from './intelligent-pipeline'
import { type LightPipelineResult, runLightPipeline } from './light-pipeline'

// ============================================================================
// Types
// ============================================================================

export interface ConversionOptions {
  /** Progress callback */
  onProgress?: (status: string, current: number, total: number) => void
  /** Render DPI for page images */
  dpi?: number
  /** Force a specific pipeline type */
  forcePipeline?: PipelineType
  /** Enable parallel processing for full pipeline */
  parallel?: boolean
  /** Concurrency for parallel processing */
  concurrency?: number
}

export interface ConversionResult {
  /** Combined markdown content */
  markdown: string
  /** Per-page/window content */
  contents: string[]
  /** Conversion metadata */
  metadata: {
    pageCount: number
    language: string
    hasTOC: boolean
    processingTimeMs: number
    pipeline: PipelineType
    complexity: ComplexityLevel
  }
  /** Document structure (if extracted) */
  structure?: DocumentStructure
  /** Document analysis (if performed) */
  analysis?: DocumentAnalysis
  /** Complexity assessment */
  complexity: DocumentComplexity
}

// ============================================================================
// Main Conversion Function
// ============================================================================

/**
 * Convert a PDF document to markdown using the optimal pipeline.
 *
 * @param pdfService - Initialized PDF service
 * @param provider - LLM provider for conversion
 * @param options - Conversion options
 * @returns Conversion result with markdown and metadata
 */
export async function convertDocument(
  pdfService: PdfService,
  provider: LLMProvider,
  options: ConversionOptions = {},
): Promise<ConversionResult> {
  const { onProgress, dpi = 150, forcePipeline, parallel, concurrency } = options

  // Step 1: Classify document complexity
  onProgress?.('Analyzing document complexity...', 0, 100)
  const complexity = await classifyDocumentComplexity(pdfService)

  // Determine pipeline to use
  const pipelineType = forcePipeline || complexity.recommendedPipeline

  onProgress?.(
    `Using ${pipelineType} pipeline (complexity: ${complexity.level}, score: ${complexity.score})`,
    5,
    100,
  )

  // Step 2: Run appropriate pipeline
  let result: ConversionResult

  switch (pipelineType) {
    case 'direct': {
      const directResult = await runDirectPipeline(pdfService, provider, {
        onProgress: (status, page, total) => {
          const percent = 5 + Math.floor((page / total) * 90)
          onProgress?.(status, percent, 100)
        },
        dpi,
      })
      result = mapDirectResult(directResult, complexity)
      break
    }

    case 'light': {
      const lightResult = await runLightPipeline(pdfService, provider, {
        onProgress: (status, page, total) => {
          const percent = 5 + Math.floor((page / total) * 90)
          onProgress?.(status, percent, 100)
        },
        dpi,
      })
      result = mapLightResult(lightResult, complexity)
      break
    }

    case 'full': {
      const fullResult = await runFullPipeline(pdfService, provider, {
        onProgress: (status, current, total) => {
          onProgress?.(status, current, total)
        },
        dpi,
        parallel,
        concurrency,
      })
      result = mapFullResult(fullResult, complexity)
      break
    }

    case 'intelligent': {
      const intelligentResult = await runIntelligentPipelineAsync(pdfService, provider, {
        onProgress: (status, phase, totalPhases) => {
          const percent = 5 + Math.floor((phase / totalPhases) * 90)
          onProgress?.(status, percent, 100)
        },
        dpi,
      })
      result = mapIntelligentResult(intelligentResult, complexity)
      break
    }

    default:
      throw new Error(`Unknown pipeline type: ${pipelineType}`)
  }

  onProgress?.('Conversion complete!', 100, 100)
  return result
}

// ============================================================================
// Result Mappers
// ============================================================================

function mapDirectResult(
  result: DirectPipelineResult,
  complexity: DocumentComplexity,
): ConversionResult {
  return {
    markdown: result.markdown,
    contents: result.pageContents,
    metadata: {
      pageCount: result.metadata.pageCount,
      language: result.metadata.language,
      hasTOC: false,
      processingTimeMs: result.metadata.processingTimeMs,
      pipeline: 'direct',
      complexity: complexity.level,
    },
    complexity,
  }
}

function mapLightResult(
  result: LightPipelineResult,
  complexity: DocumentComplexity,
): ConversionResult {
  return {
    markdown: result.markdown,
    contents: result.pageContents,
    metadata: {
      pageCount: result.metadata.pageCount,
      language: result.metadata.language,
      hasTOC: result.metadata.hasTOC,
      processingTimeMs: result.metadata.processingTimeMs,
      pipeline: 'light',
      complexity: complexity.level,
    },
    structure: result.structure,
    complexity,
  }
}

function mapFullResult(
  result: FullPipelineResult,
  complexity: DocumentComplexity,
): ConversionResult {
  return {
    markdown: result.markdown,
    contents: result.windowResults.map(w => w.markdown),
    metadata: {
      pageCount: result.metadata.pageCount,
      language: result.metadata.language,
      hasTOC: result.metadata.hasTOC,
      processingTimeMs: result.metadata.processingTimeMs,
      pipeline: 'full',
      complexity: complexity.level,
    },
    structure: result.structure,
    analysis: result.analysis,
    complexity,
  }
}

function mapIntelligentResult(
  result: IntelligentPipelineResult,
  complexity: DocumentComplexity,
): ConversionResult {
  // Convert TOC entries to headings format
  const headings = flattenTocToHeadings(result.structure.toc.entries)

  return {
    markdown: result.markdown,
    contents: [result.markdown], // Intelligent pipeline returns unified content
    metadata: {
      pageCount: result.metadata.pageCount,
      language: result.metadata.language,
      hasTOC: result.structure.toc.explicit,
      processingTimeMs: result.metadata.processingTimeMs,
      pipeline: 'intelligent',
      complexity: complexity.level,
    },
    structure: {
      headings,
      sections: [],
      headingsByPage: new Map(),
      maxDepth: result.structure.hierarchy.maxDepth,
    },
    complexity,
  }
}

/**
 * Flatten TOC entries into a flat list of heading info.
 */
function flattenTocToHeadings(
  entries: Array<{ level: number; title: string; page: number; children?: unknown[] }>,
): Array<{ level: number; text: string; page: number }> {
  const result: Array<{ level: number; text: string; page: number }> = []

  for (const entry of entries) {
    result.push({
      level: entry.level,
      text: entry.title,
      page: entry.page,
    })
    if (entry.children && Array.isArray(entry.children)) {
      result.push(
        ...flattenTocToHeadings(
          entry.children as Array<
            { level: number; title: string; page: number; children?: unknown[] }
          >,
        ),
      )
    }
  }

  return result
}

// ============================================================================
// Exports
// ============================================================================

export { classifyDocumentComplexity, runDirectPipeline, runFullPipeline, runLightPipeline }

export type {
  ComplexityLevel,
  DirectPipelineResult,
  DocumentComplexity,
  FullPipelineResult,
  LightPipelineResult,
  PipelineType,
}

// Robust pipeline with Effect.ts
export {
  APIError,
  convertDocumentRobust,
  createRateLimiter,
  DEFAULT_RATE_LIMIT_CONFIG,
  DEFAULT_RETRY_CONFIG,
  processPagesBatch,
  processWindowsRobust,
  RateLimitError,
  TimeoutError,
  withRetry,
  withRobustness,
} from './robust-pipeline'

export type {
  PipelineError,
  RateLimitConfig,
  RateLimiter,
  RetryConfig,
  RobustConversionOptions,
  RobustConversionResult,
  WindowProcessingOptions,
} from './robust-pipeline'

// Intelligent 4-pass pipeline
export { runIntelligentPipeline, runIntelligentPipelineAsync } from './intelligent-pipeline'

export type { IntelligentPipelineOptions, IntelligentPipelineResult } from './intelligent-pipeline'
