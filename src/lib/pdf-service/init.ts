/**
 * PDF.js Worker Initialization
 *
 * IMPORTANT: This module must be imported BEFORE any other imports of pdfjs-dist
 * to ensure the worker source is configured before any PDF operations.
 *
 * Import this at the top of your application entry point (main.tsx).
 */

import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// Configure worker source globally
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

// Re-export for convenience
export { pdfjsLib }
