import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas, loadImage, Canvas } from 'canvas';
import type { PDFDocumentProxy } from 'pdfjs-dist';

// Configure PDF.js for Node.js
// Disable worker in Node.js environment
pdfjsLib.GlobalWorkerOptions.workerSrc = '';

/**
 * Load a PDF document from a buffer in Node.js
 */
export async function loadPdfNode(buffer: Uint8Array): Promise<PDFDocumentProxy> {
  const loadingTask = pdfjsLib.getDocument({
    data: buffer,
    useSystemFonts: true,
    isEvalSupported: false,
    useWorkerFetch: false,
    disableFontFace: true,
  });
  return loadingTask.promise;
}

/**
 * Render a PDF page to a base64 PNG image in Node.js
 */
export async function renderPageToImageNode(
  pdf: PDFDocumentProxy,
  pageNum: number,
  scale: number = 2.0
): Promise<string> {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  // Create a canvas using node-canvas
  const canvas = createCanvas(viewport.width, viewport.height) as unknown as Canvas;
  const context = canvas.getContext('2d');

  // Render the page
  await page.render({
    canvasContext: context as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise;

  // Convert to base64 (without data URL prefix for Gemini)
  const dataUrl = canvas.toDataURL('image/png');
  return dataUrl.split(',')[1];
}

/**
 * Crop an image based on bounding box coordinates [ymin, xmin, ymax, xmax] (0-1000 scale)
 * Node.js version using node-canvas
 */
export async function cropImageNode(
  base64Image: string,
  bbox: number[]
): Promise<string> {
  const [ymin, xmin, ymax, xmax] = bbox;

  // Load the image
  const imageBuffer = Buffer.from(base64Image, 'base64');
  const img = await loadImage(imageBuffer);

  // Convert 0-1000 scale to pixels
  const x = (xmin / 1000) * img.width;
  const y = (ymin / 1000) * img.height;
  const width = ((xmax - xmin) / 1000) * img.width;
  const height = ((ymax - ymin) / 1000) * img.height;

  // Create canvas for cropped image
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Draw cropped area
  ctx.drawImage(img, x, y, width, height, 0, 0, width, height);

  // Return as data URL
  return canvas.toDataURL('image/png');
}

/**
 * Get text content from a PDF page
 */
export async function getPageTextNode(
  pdf: PDFDocumentProxy,
  pageNum: number
): Promise<string> {
  const page = await pdf.getPage(pageNum);
  const textContent = await page.getTextContent();
  return textContent.items
    .map((item) => ('str' in item ? item.str : ''))
    .join(' ');
}
