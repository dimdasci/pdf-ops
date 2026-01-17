/**
 * Document Complexity Classifier
 *
 * Analyzes PDF documents to determine their complexity level
 * and recommend the optimal processing pipeline.
 */

import type { EmbeddedImage, PdfService } from '../pdf-service/types'

// ============================================================================
// Types
// ============================================================================

export type ComplexityLevel = 'simple' | 'moderate' | 'complex'
export type PipelineType = 'direct' | 'light' | 'full' | 'intelligent'
export type TextDensity = 'sparse' | 'normal' | 'dense'

export interface ComplexityFactors {
  /** Total page count */
  pageCount: number
  /** Whether document has an embedded TOC/outline */
  hasEmbeddedTOC: boolean
  /** Estimated number of images */
  estimatedImages: number
  /** Estimated number of tables */
  estimatedTables: number
  /** Whether document contains vector graphics */
  hasVectorGraphics: boolean
  /** Text density assessment */
  textDensity: TextDensity
  /** Maximum heading depth detected */
  structureDepth: number
  /** Average characters per page */
  avgCharsPerPage: number
  /** Presence of special content */
  hasCodeBlocks: boolean
  hasMathFormulas: boolean
}

export interface DocumentComplexity {
  /** Overall complexity level */
  level: ComplexityLevel
  /** Numeric complexity score (0-100) */
  score: number
  /** Individual factors contributing to complexity */
  factors: ComplexityFactors
  /** Recommended processing pipeline */
  recommendedPipeline: PipelineType
  /** Estimated processing time in seconds */
  estimatedTimeSeconds: number
  /** Reasoning for the recommendation */
  reasoning: string[]
}

export interface ClassifierOptions {
  /** Number of pages to sample for analysis (default: 3) */
  sampleSize?: number
  /** Whether to detect vector graphics (slower but more accurate) */
  detectVectors?: boolean
  /** Minimum complexity score for 'moderate' classification */
  moderateThreshold?: number
  /** Minimum complexity score for 'complex' classification */
  complexThreshold?: number
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_OPTIONS: Required<ClassifierOptions> = {
  sampleSize: 3,
  detectVectors: false, // Disabled by default for speed
  moderateThreshold: 20,
  complexThreshold: 60,
}

// ============================================================================
// Complexity Classifier Implementation
// ============================================================================

/**
 * Analyze a PDF document and classify its complexity.
 */
export async function classifyDocumentComplexity(
  pdfService: PdfService,
  options: ClassifierOptions = {},
): Promise<DocumentComplexity> {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const pageCount = pdfService.getPageCount()

  // Get metadata and outline
  const [metadata, outline] = await Promise.all([
    pdfService.getMetadata(),
    pdfService.getOutline(),
  ])

  // Determine sample pages (first, middle, last)
  const samplePageNumbers = getSamplePageNumbers(pageCount, opts.sampleSize)

  // Analyze sample pages
  const samples = await Promise.all(
    samplePageNumbers.map(async pageNum => {
      const [text, images] = await Promise.all([
        pdfService.getPageText(pageNum),
        safeGetPageImages(pdfService, pageNum),
      ])

      return {
        pageNum,
        text,
        images,
        charCount: text.length,
      }
    }),
  )

  // Calculate factors
  const factors = calculateFactors(pageCount, outline, samples, metadata)

  // Calculate complexity score
  const score = calculateComplexityScore(factors)

  // Determine level and pipeline
  const { level, pipeline, reasoning } = determineComplexityLevel(
    score,
    factors,
    opts.moderateThreshold,
    opts.complexThreshold,
  )

  // Estimate processing time
  const estimatedTimeSeconds = estimateProcessingTime(factors, pipeline)

  return {
    level,
    score,
    factors,
    recommendedPipeline: pipeline,
    estimatedTimeSeconds,
    reasoning,
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get evenly distributed sample page numbers.
 */
function getSamplePageNumbers(totalPages: number, sampleSize: number): number[] {
  if (totalPages <= sampleSize) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }

  const pages: number[] = [1] // Always include first page

  if (sampleSize >= 2 && totalPages > 1) {
    pages.push(totalPages) // Always include last page
  }

  if (sampleSize >= 3 && totalPages > 2) {
    pages.splice(1, 0, Math.floor(totalPages / 2)) // Add middle page
  }

  // Add more evenly distributed pages if needed
  if (sampleSize > 3) {
    const step = Math.floor(totalPages / (sampleSize - 1))
    for (let i = step; i < totalPages; i += step) {
      if (!pages.includes(i) && pages.length < sampleSize) {
        pages.push(i)
      }
    }
    pages.sort((a, b) => a - b)
  }

  return pages.slice(0, sampleSize)
}

/**
 * Safely get page images, returning empty array on error.
 */
async function safeGetPageImages(
  pdfService: PdfService,
  pageNum: number,
): Promise<EmbeddedImage[]> {
  try {
    return await pdfService.getPageImages(pageNum)
  } catch {
    return []
  }
}

interface PageSample {
  pageNum: number
  text: string
  images: EmbeddedImage[]
  charCount: number
}

/**
 * Calculate complexity factors from samples.
 */
function calculateFactors(
  pageCount: number,
  outline: Awaited<ReturnType<PdfService['getOutline']>>,
  samples: PageSample[],
  _metadata: Awaited<ReturnType<PdfService['getMetadata']>>,
): ComplexityFactors {
  // Calculate averages from samples
  const avgCharsPerPage = samples.reduce((sum, s) => sum + s.charCount, 0) / samples.length
  const totalSampleImages = samples.reduce((sum, s) => sum + s.images.length, 0)

  // Estimate total images based on sample
  const estimatedImages = Math.round(
    (totalSampleImages / samples.length) * pageCount,
  )

  // Estimate tables by looking for table-like patterns in text
  const estimatedTables = estimateTableCount(samples)

  // Determine text density
  const textDensity = classifyTextDensity(avgCharsPerPage)

  // Analyze structure depth from outline or infer from text
  const structureDepth = outline
    ? getOutlineMaxDepth(outline)
    : estimateStructureDepth(samples)

  // Check for special content
  const hasCodeBlocks = samples.some(s => detectCodePatterns(s.text))
  const hasMathFormulas = samples.some(s => detectMathPatterns(s.text))

  return {
    pageCount,
    hasEmbeddedTOC: outline !== null && outline.length > 0,
    estimatedImages,
    estimatedTables,
    hasVectorGraphics: false, // Would require operator list analysis
    textDensity,
    structureDepth,
    avgCharsPerPage,
    hasCodeBlocks,
    hasMathFormulas,
  }
}

/**
 * Estimate table count from text patterns.
 */
function estimateTableCount(samples: PageSample[]): number {
  let tablePatternCount = 0

  for (const sample of samples) {
    // Look for table-like patterns: multiple columns separated by tabs or |
    const lines = sample.text.split('\n')
    let consecutiveTableLines = 0

    for (const line of lines) {
      // Check for pipe-separated columns or tab-separated data
      const hasPipes = (line.match(/\|/g) || []).length >= 2
      const hasTabs = (line.match(/\t/g) || []).length >= 2
      const hasMultipleNumbers = (line.match(/\d+/g) || []).length >= 3

      if (hasPipes || (hasTabs && hasMultipleNumbers)) {
        consecutiveTableLines++
      } else {
        if (consecutiveTableLines >= 3) {
          tablePatternCount++
        }
        consecutiveTableLines = 0
      }
    }

    if (consecutiveTableLines >= 3) {
      tablePatternCount++
    }
  }

  // Extrapolate to full document
  return Math.round((tablePatternCount / samples.length) * (samples[0]?.pageNum || 1))
}

/**
 * Classify text density based on characters per page.
 */
function classifyTextDensity(avgCharsPerPage: number): TextDensity {
  if (avgCharsPerPage < 500) return 'sparse'
  if (avgCharsPerPage > 2500) return 'dense'
  return 'normal'
}

/**
 * Get maximum depth of outline structure.
 */
function getOutlineMaxDepth(
  outline: NonNullable<Awaited<ReturnType<PdfService['getOutline']>>>,
  currentDepth: number = 1,
): number {
  let maxDepth = currentDepth

  for (const item of outline) {
    if (item.children && item.children.length > 0) {
      const childDepth = getOutlineMaxDepth(item.children, currentDepth + 1)
      maxDepth = Math.max(maxDepth, childDepth)
    }
  }

  return maxDepth
}

/**
 * Estimate structure depth from text patterns.
 */
function estimateStructureDepth(samples: PageSample[]): number {
  let maxDepth = 1

  for (const sample of samples) {
    const lines = sample.text.split('\n')

    for (const line of lines) {
      // Look for numbered headings (1., 1.1., 1.1.1., etc.)
      const numberedMatch = line.match(/^(\d+\.)+/)
      if (numberedMatch) {
        const depth = (numberedMatch[0].match(/\d+/g) || []).length
        maxDepth = Math.max(maxDepth, depth)
      }

      // Look for markdown-style headings
      const hashMatch = line.match(/^#+\s/)
      if (hashMatch) {
        const depth = (hashMatch[0].match(/#/g) || []).length
        maxDepth = Math.max(maxDepth, depth)
      }
    }
  }

  return Math.min(maxDepth, 6) // Cap at 6 levels
}

/**
 * Detect code block patterns in text.
 */
function detectCodePatterns(text: string): boolean {
  const patterns = [
    /```[\s\S]*?```/, // Fenced code blocks
    /function\s+\w+\s*\(/, // JavaScript functions
    /def\s+\w+\s*\(/, // Python functions
    /class\s+\w+\s*[:{]/, // Class definitions
    /import\s+.*from/, // ES6 imports
    /<\/?[a-z][a-z0-9]*[^>]*>/i, // HTML tags
  ]

  return patterns.some(pattern => pattern.test(text))
}

/**
 * Detect mathematical formula patterns in text.
 */
function detectMathPatterns(text: string): boolean {
  const patterns = [
    /\$.*\$/, // LaTeX inline math
    /\\\[.*\\\]/, // LaTeX display math
    /\\frac\{/, // LaTeX fractions
    /\\sum|\\int|\\prod/, // LaTeX operators
    /[∑∫∏∂∇]/, // Unicode math symbols
    /[α-ωΑ-Ω]/, // Greek letters
  ]

  return patterns.some(pattern => pattern.test(text))
}

/**
 * Calculate overall complexity score (0-100).
 */
function calculateComplexityScore(factors: ComplexityFactors): number {
  let score = 0

  // Page count contribution (0-40 points)
  if (factors.pageCount > 100) score += 40
  else if (factors.pageCount > 50) score += 30
  else if (factors.pageCount > 20) score += 20
  else if (factors.pageCount > 5) score += 10
  else score += 5

  // Structure contribution (0-20 points)
  if (factors.hasEmbeddedTOC) score += 10
  if (factors.structureDepth > 4) score += 10
  else if (factors.structureDepth > 2) score += 5

  // Content contribution (0-30 points)
  if (factors.estimatedImages > 50) score += 12
  else if (factors.estimatedImages > 20) score += 8
  else if (factors.estimatedImages > 5) score += 4

  if (factors.estimatedTables > 10) score += 10
  else if (factors.estimatedTables > 3) score += 6
  else if (factors.estimatedTables > 0) score += 3

  if (factors.hasCodeBlocks) score += 4
  if (factors.hasMathFormulas) score += 4

  // Text density contribution (0-10 points)
  if (factors.textDensity === 'dense') score += 10
  else if (factors.textDensity === 'normal') score += 5

  return Math.min(100, score)
}

/**
 * Determine complexity level and recommended pipeline.
 */
function determineComplexityLevel(
  score: number,
  factors: ComplexityFactors,
  moderateThreshold: number,
  complexThreshold: number,
): {
  level: ComplexityLevel
  pipeline: PipelineType
  reasoning: string[]
} {
  const reasoning: string[] = []

  // Special case: very small documents
  if (factors.pageCount <= 3 && factors.estimatedImages <= 5 && !factors.hasEmbeddedTOC) {
    reasoning.push(`Small document (${factors.pageCount} pages)`)
    reasoning.push('No complex structure detected')
    return {
      level: 'simple',
      pipeline: 'direct',
      reasoning,
    }
  }

  // Special case: documents with TOC should use at least light pipeline
  if (factors.hasEmbeddedTOC && score < moderateThreshold) {
    reasoning.push('Document has embedded TOC - using light pipeline for better structure')
    return {
      level: 'moderate',
      pipeline: 'light',
      reasoning,
    }
  }

  // Score-based classification
  if (score >= complexThreshold) {
    reasoning.push(`High complexity score (${score}/100)`)

    if (factors.pageCount > 50) {
      reasoning.push(`Large document (${factors.pageCount} pages) requires windowed processing`)
    }
    if (factors.estimatedImages > 20) {
      reasoning.push(`Many images (${factors.estimatedImages}) require careful extraction`)
    }
    if (factors.structureDepth > 3) {
      reasoning.push(`Deep heading hierarchy (${factors.structureDepth} levels)`)
    }

    return {
      level: 'complex',
      pipeline: 'full',
      reasoning,
    }
  }

  if (score >= moderateThreshold) {
    reasoning.push(`Moderate complexity score (${score}/100)`)

    if (factors.pageCount > 10) {
      reasoning.push(`Medium-sized document (${factors.pageCount} pages)`)
    }
    if (factors.estimatedImages > 5) {
      reasoning.push(`Contains images (${factors.estimatedImages})`)
    }

    return {
      level: 'moderate',
      pipeline: 'light',
      reasoning,
    }
  }

  reasoning.push(`Low complexity score (${score}/100)`)
  reasoning.push('Simple direct conversion recommended')

  return {
    level: 'simple',
    pipeline: 'direct',
    reasoning,
  }
}

/**
 * Estimate processing time based on factors and pipeline.
 */
function estimateProcessingTime(
  factors: ComplexityFactors,
  pipeline: PipelineType,
): number {
  // Base time per page (seconds)
  const baseTimePerPage: Record<PipelineType, number> = {
    direct: 3,
    light: 5,
    full: 8,
    intelligent: 10,
  }

  let time = factors.pageCount * baseTimePerPage[pipeline]

  // Add time for images
  time += factors.estimatedImages * 0.5

  // Add time for tables
  time += factors.estimatedTables * 2

  // Add overhead for structure extraction
  if (pipeline !== 'direct') {
    time += 10 // Initial structure scan
  }

  // Add overhead for full pipeline
  if (pipeline === 'full') {
    time += Math.ceil(factors.pageCount / 50) * 5 // Window processing overhead
  }

  return Math.round(time)
}

// ============================================================================
// Export Types
// ============================================================================

export type { PageSample }
