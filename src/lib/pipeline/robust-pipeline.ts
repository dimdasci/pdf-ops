/**
 * Robust Pipeline Module
 *
 * Wraps the conversion pipelines with Effect.ts for retry logic,
 * rate limiting, and error recovery.
 */

import type { LLMProvider } from '../llm/types'
import type { PdfService } from '../pdf-service/types'
import {
  APIError,
  createRateLimiter,
  DEFAULT_RATE_LIMIT_CONFIG,
  DEFAULT_RETRY_CONFIG,
  Duration,
  Effect,
  pipe,
  type PipelineError,
  processWithConcurrency,
  type RateLimitConfig,
  type RateLimiter,
  RateLimitError,
  type RetryConfig,
  runEffect,
  TimeoutError,
  withRetry,
  withRobustness,
} from './effect-wrapper'
import { type ConversionOptions, type ConversionResult, convertDocument } from './index'

// ============================================================================
// Types
// ============================================================================

export interface RobustConversionOptions extends ConversionOptions {
  /** Retry configuration for API calls */
  retryConfig?: RetryConfig
  /** Rate limit configuration */
  rateLimitConfig?: RateLimitConfig
  /** Timeout for the entire conversion */
  timeout?: Duration.DurationInput
  /** Whether to continue on partial failure */
  continueOnError?: boolean
  /** Error callback */
  onError?: (error: PipelineError, context: string) => void
}

export interface RobustConversionResult extends ConversionResult {
  /** Errors encountered during conversion */
  errors: Array<{
    context: string
    error: PipelineError
    recovered: boolean
  }>
  /** Whether conversion completed with full success */
  fullSuccess: boolean
}

// ============================================================================
// Robust Conversion Function
// ============================================================================

/**
 * Convert a PDF document with robust error handling.
 *
 * Uses Effect.ts for:
 * - Automatic retries with exponential backoff
 * - Rate limiting to prevent API throttling
 * - Timeout handling
 * - Partial failure recovery
 */
export async function convertDocumentRobust(
  pdfService: PdfService,
  provider: LLMProvider,
  options: RobustConversionOptions = {},
): Promise<RobustConversionResult> {
  const {
    retryConfig = DEFAULT_RETRY_CONFIG,
    rateLimitConfig = DEFAULT_RATE_LIMIT_CONFIG,
    timeout = '10 minutes',
    continueOnError = true,
    onError,
    ...conversionOptions
  } = options

  const errors: RobustConversionResult['errors'] = []

  // Create rate limiter
  const rateLimiter = await runEffect(createRateLimiter(rateLimitConfig))

  // Wrap the conversion with robustness
  const robustConversion = withRobustness(
    async () => {
      // Wrap provider methods with retry logic
      const robustProvider = createRobustProvider(
        provider,
        rateLimiter,
        retryConfig,
        (error, context) => {
          errors.push({ context, error, recovered: continueOnError })
          onError?.(error, context)
        },
      )

      return convertDocument(pdfService, robustProvider, conversionOptions)
    },
    {
      retryConfig,
      timeout,
    },
  )

  try {
    const result = await runEffect(robustConversion)
    return {
      ...result,
      errors,
      fullSuccess: errors.length === 0,
    }
  } catch (error) {
    // If the entire conversion fails, return partial result
    if (continueOnError) {
      const pipelineError = error instanceof Error
        ? new APIError(error.message)
        : new APIError(String(error))

      errors.push({
        context: 'conversion',
        error: pipelineError,
        recovered: false,
      })

      return {
        markdown: '',
        contents: [],
        metadata: {
          pageCount: pdfService.getPageCount(),
          language: 'Unknown',
          hasTOC: false,
          processingTimeMs: 0,
          pipeline: 'direct',
          complexity: 'simple',
        },
        complexity: {
          level: 'simple',
          score: 0,
          factors: {
            pageCount: pdfService.getPageCount(),
            hasEmbeddedTOC: false,
            estimatedImages: 0,
            estimatedTables: 0,
            hasVectorGraphics: false,
            textDensity: 'normal',
            structureDepth: 1,
            avgCharsPerPage: 0,
            hasCodeBlocks: false,
            hasMathFormulas: false,
          },
          recommendedPipeline: 'direct',
          estimatedTimeSeconds: 0,
          reasoning: ['Conversion failed'],
        },
        errors,
        fullSuccess: false,
      }
    }
    throw error
  }
}

// ============================================================================
// Robust Provider Wrapper
// ============================================================================

/**
 * Create a provider wrapper that adds retry logic to all API calls.
 */
function createRobustProvider(
  provider: LLMProvider,
  rateLimiter: RateLimiter,
  retryConfig: RetryConfig,
  onError: (error: PipelineError, context: string) => void,
): LLMProvider {
  const wrapMethod = <T extends unknown[], R>(
    method: (...args: T) => Promise<R>,
    context: string,
  ): (...args: T) => Promise<R> => {
    return async (...args: T): Promise<R> => {
      const effect = withRobustness(
        () => method.apply(provider, args),
        {
          retryConfig,
          rateLimiter,
          timeout: '2 minutes',
        },
      )

      try {
        return await runEffect(effect)
      } catch (error) {
        const pipelineError = error instanceof APIError
            || error instanceof RateLimitError
            || error instanceof TimeoutError
          ? error
          : new APIError(error instanceof Error ? error.message : String(error))

        onError(pipelineError, context)
        throw error
      }
    }
  }

  return {
    ...provider,
    analyzeDocument: wrapMethod(
      provider.analyzeDocument.bind(provider),
      'analyzeDocument',
    ),
    extractStructure: wrapMethod(
      provider.extractStructure.bind(provider),
      'extractStructure',
    ),
    convertPage: wrapMethod(
      provider.convertPage.bind(provider),
      'convertPage',
    ),
    convertWindow: wrapMethod(
      provider.convertWindow.bind(provider),
      'convertWindow',
    ),
    summarize: wrapMethod(
      provider.summarize.bind(provider),
      'summarize',
    ),
  }
}

// ============================================================================
// Batch Processing with Robustness
// ============================================================================

/**
 * Process multiple pages with controlled concurrency and error recovery.
 */
export async function processPagesBatch(
  _pdfService: PdfService,
  _provider: LLMProvider,
  pageNumbers: number[],
  processor: (pageNum: number) => Promise<string>,
  options: {
    concurrency?: number
    retryConfig?: RetryConfig
    onProgress?: (completed: number, total: number) => void
    onPageError?: (pageNum: number, error: PipelineError) => void
    continueOnError?: boolean
  } = {},
): Promise<Array<{ pageNum: number; content: string; error?: PipelineError }>> {
  const {
    concurrency = 3,
    retryConfig = DEFAULT_RETRY_CONFIG,
    onProgress,
    onPageError,
    continueOnError = true,
  } = options

  const effect = processWithConcurrency(
    pageNumbers,
    async (pageNum, _index) => {
      try {
        const content = await processor(pageNum)
        return { pageNum, content }
      } catch (error) {
        const pipelineError = error instanceof APIError
            || error instanceof RateLimitError
            || error instanceof TimeoutError
          ? error
          : new APIError(error instanceof Error ? error.message : String(error))

        onPageError?.(pageNum, pipelineError)

        if (continueOnError) {
          return { pageNum, content: '', error: pipelineError }
        }
        throw error
      }
    },
    {
      concurrency,
      retryConfig,
      onProgress,
    },
  )

  return runEffect(effect)
}

// ============================================================================
// Window Processing with Robustness
// ============================================================================

export interface WindowProcessingOptions {
  concurrency?: number
  retryConfig?: RetryConfig
  delayBetweenWindows?: number
  onProgress?: (windowNum: number, totalWindows: number) => void
  onWindowError?: (windowNum: number, error: PipelineError) => void
  continueOnError?: boolean
}

/**
 * Process document windows with controlled concurrency and error recovery.
 */
export async function processWindowsRobust<T>(
  windows: Array<{ windowNum: number; data: T }>,
  processor: (window: { windowNum: number; data: T }) => Promise<string>,
  options: WindowProcessingOptions = {},
): Promise<Array<{ windowNum: number; content: string; error?: PipelineError }>> {
  const {
    concurrency = 2,
    retryConfig = DEFAULT_RETRY_CONFIG,
    delayBetweenWindows = 500,
    onProgress,
    onWindowError,
    continueOnError = true,
  } = options

  const results: Array<{ windowNum: number; content: string; error?: PipelineError }> = []

  const effect = Effect.gen(function*() {
    const semaphore = yield* Effect.makeSemaphore(concurrency)

    for (let i = 0; i < windows.length; i++) {
      const window = windows[i]

      // Add delay between windows (except for first)
      if (i > 0 && delayBetweenWindows > 0) {
        yield* Effect.sleep(Duration.millis(delayBetweenWindows))
      }

      // Process with semaphore
      const result = yield* semaphore.withPermits(1)(
        pipe(
          withRetry(
            () => processor(window),
            retryConfig,
          ),
          Effect.map(content => ({
            windowNum: window.windowNum,
            content,
          })),
          Effect.catchAll(error => {
            const pipelineError = error as PipelineError
            onWindowError?.(window.windowNum, pipelineError)

            if (continueOnError) {
              return Effect.succeed({
                windowNum: window.windowNum,
                content: '',
                error: pipelineError,
              })
            }
            return Effect.fail(error)
          }),
        ),
      )

      results.push(result)
      onProgress?.(i + 1, windows.length)
    }

    return results
  })

  return runEffect(effect as Effect.Effect<typeof results, never>)
}

// ============================================================================
// Exports
// ============================================================================

export {
  // Re-export error types
  APIError,
  createRateLimiter,
  DEFAULT_RATE_LIMIT_CONFIG,
  // Re-export config defaults
  DEFAULT_RETRY_CONFIG,
  processWithConcurrency,
  RateLimitError,
  runEffect,
  TimeoutError,
  // Re-export Effect utilities
  withRetry,
  withRobustness,
}

export type { PipelineError, RateLimitConfig, RateLimiter, RetryConfig }
