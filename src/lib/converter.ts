import * as pdfjsLib from 'pdfjs-dist';
import { GeminiService } from './gemini';
import { getPageText } from './pdf-utils';

export interface ConversionResult {
  markdown: string;
  metadata: {
    pageCount: number;
    language: string;
    hasTOC: boolean;
  };
  pageContents: string[];
}

export interface ConversionOptions {
  apiKey: string;
  onProgress?: (status: string, page: number, total: number) => void;
  renderPageToImage: (pdf: pdfjsLib.PDFDocumentProxy, pageNum: number, scale?: number) => Promise<string>;
  cropImage: (base64Image: string, bbox: number[]) => Promise<string>;
}

/**
 * Converts a PDF document to Markdown using Gemini LLM.
 * This function is used by both the application (with browser canvas) and tests (with node-canvas).
 */
export async function convertPdfToMarkdown(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  numPages: number,
  options: ConversionOptions
): Promise<ConversionResult> {
  const { apiKey, onProgress, renderPageToImage, cropImage } = options;

  const gemini = new GeminiService(apiKey);
  const pageContents: string[] = [];
  let fullMarkdown = '';

  // Pass 1: Analysis (First 3 pages)
  onProgress?.('Analyzing document structure...', 0, numPages);
  let firstPagesText = '';
  for (let i = 1; i <= Math.min(3, numPages); i++) {
    firstPagesText += await getPageText(pdfDoc, i) + '\n';
  }

  const analysis = await gemini.analyzeDocumentStructure(firstPagesText);

  // Pass 2: Page by Page Conversion
  let currentMarkdown = '';

  for (let i = 1; i <= numPages; i++) {
    onProgress?.(`Converting page ${i} of ${numPages}...`, i, numPages);

    const imageBase64 = await renderPageToImage(pdfDoc, i);
    const conversionResult = await gemini.convertPage(imageBase64, {
      previousContent: currentMarkdown,
      pageNumber: i,
      totalPages: numPages
    });

    let pageContent = conversionResult.content;
    const images = conversionResult.images;

    // Visual Extraction: Replace placeholders with cropped images
    const placeholders = Object.keys(images);
    if (placeholders.length > 0) {
      for (const placeholder of placeholders) {
        try {
          const bbox = images[placeholder];
          if (!bbox || bbox.length !== 4) {
            console.warn(`[Page ${i}] Invalid bbox for ${placeholder}:`, bbox);
            continue;
          }

          const croppedDataUrl = await cropImage(imageBase64, bbox);
          if (!croppedDataUrl) {
            console.warn(`[Page ${i}] Cropped image is empty for ${placeholder}`);
            continue;
          }

          pageContent = pageContent.replaceAll(placeholder, croppedDataUrl);
        } catch (err) {
          console.error(`Failed to crop image for ${placeholder}`, err);
        }
      }
    }

    // Fallback for unreplaced placeholders
    pageContent = pageContent.replace(
      /!\[(.*?)\]\((img_placeholder_[a-zA-Z0-9_]+)\)/g,
      '> *[Image extraction failed or coordinates missing for: $1]*'
    );

    // Sanitize: Replace empty image sources
    pageContent = pageContent.replace(/!\[(.*?)\]\(\s*\)/g, '> *[Image missing: $1]*');

    pageContents.push(pageContent);
    currentMarkdown += pageContent + '\n\n';
    fullMarkdown += pageContent + '\n\n';
  }

  return {
    markdown: fullMarkdown,
    metadata: {
      pageCount: numPages,
      language: analysis.language,
      hasTOC: analysis.hasTOC
    },
    pageContents
  };
}
