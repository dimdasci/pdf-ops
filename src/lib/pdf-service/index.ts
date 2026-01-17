/**
 * PDF Service Factory
 *
 * Provides a unified way to create PDF services for different environments.
 * Supports both manual lifecycle management and Effect-based scoped resources.
 */

import { Context, Data, Effect, type Scope } from 'effect'
import type { PdfService } from './types'

export type PdfServiceEnvironment = 'browser' | 'node'

// -----------------------------------------------------------------------------
// Effect Service Tag
// -----------------------------------------------------------------------------

/**
 * Context Tag for PdfService dependency injection.
 *
 * @example
 * ```typescript
 * const program = Effect.gen(function*() {
 *   const pdf = yield* PdfServiceTag
 *   const pageCount = pdf.getPageCount()
 *   return pageCount
 * })
 * ```
 */
export class PdfServiceTag extends Context.Tag('PdfService')<PdfServiceTag, PdfService>() {}

/**
 * Create a PDF service instance for the specified environment.
 *
 * @param data - PDF file data as Uint8Array
 * @param environment - Target environment ('browser' or 'node')
 * @returns Initialized PdfService instance
 *
 * @example
 * ```typescript
 * // In browser/Electron
 * const service = await createPdfService(pdfBuffer, 'browser');
 *
 * // In Node.js tests
 * const service = await createPdfService(pdfBuffer, 'node');
 *
 * try {
 *   const pageCount = service.getPageCount();
 *   const image = await service.renderPage(1, { dpi: 300 });
 * } finally {
 *   service.destroy();
 * }
 * ```
 */
export async function createPdfService(
  data: Uint8Array,
  environment: PdfServiceEnvironment,
): Promise<PdfService> {
  if (environment === 'node') {
    const { NodePdfService } = await import('./node')
    const service = new NodePdfService()
    await service.load(data)
    return service
  } else {
    const { BrowserPdfService } = await import('./browser')
    const service = new BrowserPdfService()
    await service.load(data)
    return service
  }
}

/**
 * Detect the current runtime environment.
 *
 * @returns 'node' if running in Node.js, 'browser' otherwise
 */
export function detectEnvironment(): PdfServiceEnvironment {
  // Check for Node.js-specific globals
  if (
    typeof process !== 'undefined'
    && process.versions != null
    && process.versions.node != null
  ) {
    return 'node'
  }
  return 'browser'
}

/**
 * Create a PDF service for the current environment (auto-detected).
 *
 * @param data - PDF file data as Uint8Array
 * @returns Initialized PdfService instance
 */
export async function createPdfServiceAuto(data: Uint8Array): Promise<PdfService> {
  return createPdfService(data, detectEnvironment())
}

// -----------------------------------------------------------------------------
// Effect-based Scoped Lifecycle Management
// -----------------------------------------------------------------------------

/**
 * Error type for PdfService initialization failures.
 */
export class PdfServiceError extends Data.TaggedError('PdfServiceError')<{
  readonly message: string
  readonly cause?: unknown
}> {}

/**
 * Create a scoped PdfService that automatically handles cleanup.
 *
 * Uses Effect's acquireRelease pattern to ensure destroy() is always called,
 * even when errors occur or the scope is closed.
 *
 * @param data - PDF file data as Uint8Array
 * @param environment - Target environment ('browser' or 'node')
 * @returns Effect that yields a PdfService and releases it when scope closes
 *
 * @example
 * ```typescript
 * import { Effect } from 'effect'
 * import { makePdfServiceScoped } from './pdf-service'
 *
 * const program = Effect.scoped(
 *   Effect.gen(function*() {
 *     const pdfService = yield* makePdfServiceScoped(pdfData, 'node')
 *     const pageCount = pdfService.getPageCount()
 *     const metadata = yield* Effect.promise(() => pdfService.getMetadata())
 *     return { pageCount, metadata }
 *   })
 * )
 * // pdfService.destroy() is called automatically when scope closes
 * ```
 */
export const makePdfServiceScoped = (
  data: Uint8Array,
  environment: PdfServiceEnvironment,
): Effect.Effect<PdfService, PdfServiceError, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: () => createPdfService(data, environment),
      catch: error =>
        new PdfServiceError({
          message: `Failed to create PdfService for ${environment}`,
          cause: error,
        }),
    }),
    service => Effect.sync(() => service.destroy()),
  )

/**
 * Create a scoped PdfService with auto-detected environment.
 *
 * @param data - PDF file data as Uint8Array
 * @returns Effect that yields a PdfService and releases it when scope closes
 *
 * @example
 * ```typescript
 * import { Effect } from 'effect'
 * import { makePdfServiceScopedAuto } from './pdf-service'
 *
 * const program = Effect.scoped(
 *   Effect.gen(function*() {
 *     const pdfService = yield* makePdfServiceScopedAuto(pdfData)
 *     return pdfService.getPageCount()
 *   })
 * )
 * ```
 */
export const makePdfServiceScopedAuto = (
  data: Uint8Array,
): Effect.Effect<PdfService, PdfServiceError, Scope.Scope> =>
  makePdfServiceScoped(data, detectEnvironment())

/**
 * Convenience function to use a PdfService within a scoped context.
 *
 * This is equivalent to makePdfServiceScoped but with a more descriptive name
 * for use in Effect pipelines.
 *
 * @param data - PDF file data as Uint8Array
 * @param environment - Target environment ('browser' or 'node')
 * @returns Scoped Effect yielding PdfService
 *
 * @example
 * ```typescript
 * import { Effect } from 'effect'
 * import { usePdfService } from './pdf-service'
 *
 * const program = Effect.scoped(
 *   Effect.gen(function*() {
 *     const pdf = yield* usePdfService(data, 'node')
 *     // pdf.destroy() is called automatically
 *     return pdf.getPageCount()
 *   })
 * )
 * ```
 */
export const usePdfService = makePdfServiceScoped

// Re-export types
export * from './types'
