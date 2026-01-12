import { GeminiService } from './gemini';
import type { PdfService, RenderOptions } from './pdf-service/types';

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
  /** Optional render options for page rendering (DPI, etc.) */
  renderOptions?: RenderOptions;
}

/**
 * Converts a PDF document to Markdown using Gemini LLM.
 *
 * This function works with any PdfService implementation, allowing it to run
 * in both browser (Electron) and Node.js (tests/API) environments.
 *
 * @param pdfService - Initialized PDF service instance
 * @param options - Conversion options including API key and callbacks
 * @returns Conversion result with markdown, metadata, and per-page content
 */
export async function convertPdfToMarkdown(
  pdfService: PdfService,
  options: ConversionOptions
): Promise<ConversionResult> {
  const { apiKey, onProgress, renderOptions } = options;

  const gemini = new GeminiService(apiKey);
  const pageContents: string[] = [];
  let fullMarkdown = '';
  const numPages = pdfService.getPageCount();

  // Pass 1: Analysis (First 3 pages)
  onProgress?.('Analyzing document structure...', 0, numPages);
  let firstPagesText = '';
  for (let i = 1; i <= Math.min(3, numPages); i++) {
    firstPagesText += await pdfService.getPageText(i) + '\n';
  }

  const analysis = await gemini.analyzeDocumentStructure(firstPagesText);

  // Pass 2: Page by Page Conversion
  let currentMarkdown = '';

  for (let i = 1; i <= numPages; i++) {
    onProgress?.(`Converting page ${i} of ${numPages}...`, i, numPages);

    const imageBase64 = await pdfService.renderPage(i, renderOptions);
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

          const croppedDataUrl = await pdfService.cropImage(imageBase64, { bbox });
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
