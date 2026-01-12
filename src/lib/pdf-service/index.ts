/**
 * PDF Service Factory
 *
 * Provides a unified way to create PDF services for different environments.
 */

import type { PdfService } from './types';

export type PdfServiceEnvironment = 'browser' | 'node';

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
  environment: PdfServiceEnvironment
): Promise<PdfService> {
  if (environment === 'node') {
    const { NodePdfService } = await import('./node');
    const service = new NodePdfService();
    await service.load(data);
    return service;
  } else {
    const { BrowserPdfService } = await import('./browser');
    const service = new BrowserPdfService();
    await service.load(data);
    return service;
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
    typeof process !== 'undefined' &&
    process.versions != null &&
    process.versions.node != null
  ) {
    return 'node';
  }
  return 'browser';
}

/**
 * Create a PDF service for the current environment (auto-detected).
 *
 * @param data - PDF file data as Uint8Array
 * @returns Initialized PdfService instance
 */
export async function createPdfServiceAuto(data: Uint8Array): Promise<PdfService> {
  return createPdfService(data, detectEnvironment());
}

// Re-export types
export * from './types';
