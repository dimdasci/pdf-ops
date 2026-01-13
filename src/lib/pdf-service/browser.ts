/**
 * Browser PDF Service Implementation
 *
 * Uses PDF.js with browser canvas for rendering and pdf-lib for page manipulation.
 * This implementation is used in Electron renderer process.
 */

import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument } from 'pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type {
  PdfService,
  PdfMetadata,
  OutlineItem,
  RenderOptions,
  CropOptions,
  EmbeddedImage,
  VectorRegion,
} from './types';
import { detectVectorRegionsFromOpList } from './vector-detector';

// Set worker source for browser (Vite URL import)
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Browser implementation of PdfService using PDF.js + browser canvas
 */
export class BrowserPdfService implements PdfService {
  private pdfDoc: PDFDocumentProxy | null = null;
  private pdfData: Uint8Array | null = null;

  async load(data: Uint8Array): Promise<void> {
    this.pdfData = data;

    const loadingTask = pdfjsLib.getDocument({ data });
    this.pdfDoc = await loadingTask.promise;
  }

  destroy(): void {
    if (this.pdfDoc) {
      this.pdfDoc.destroy();
      this.pdfDoc = null;
    }
    this.pdfData = null;
  }

  private ensureLoaded(): PDFDocumentProxy {
    if (!this.pdfDoc) {
      throw new Error('PDF not loaded. Call load() first.');
    }
    return this.pdfDoc;
  }

  getPageCount(): number {
    return this.ensureLoaded().numPages;
  }

  async getMetadata(): Promise<PdfMetadata> {
    const pdf = this.ensureLoaded();
    const metadata = await pdf.getMetadata();
    const info = metadata.info as Record<string, unknown>;

    return {
      pageCount: pdf.numPages,
      title: info?.Title as string | undefined,
      author: info?.Author as string | undefined,
      subject: info?.Subject as string | undefined,
      creator: info?.Creator as string | undefined,
      producer: info?.Producer as string | undefined,
      creationDate: info?.CreationDate ? new Date(info.CreationDate as string) : undefined,
      modificationDate: info?.ModDate ? new Date(info.ModDate as string) : undefined,
    };
  }

  async getOutline(): Promise<OutlineItem[] | null> {
    const pdf = this.ensureLoaded();
    const outline = await pdf.getOutline();

    if (!outline) return null;

    const convertOutline = async (
      items: Awaited<ReturnType<typeof pdf.getOutline>>
    ): Promise<OutlineItem[]> => {
      if (!items) return [];

      return Promise.all(
        items.map(async (item) => {
          let pageNumber: number | undefined;

          if (item.dest) {
            try {
              const dest = typeof item.dest === 'string'
                ? await pdf.getDestination(item.dest)
                : item.dest;

              if (dest && dest[0]) {
                const pageIndex = await pdf.getPageIndex(dest[0]);
                pageNumber = pageIndex + 1;
              }
            } catch {
              // Ignore destination resolution errors
            }
          }

          return {
            title: item.title,
            pageNumber,
            children: item.items ? await convertOutline(item.items) : undefined,
          };
        })
      );
    };

    return convertOutline(outline);
  }

  async renderPage(pageNum: number, options: RenderOptions = {}): Promise<string> {
    const pdf = this.ensureLoaded();
    const { dpi = 72 } = options;

    // Convert DPI to scale (PDF.js default is 72 DPI)
    const scale = dpi / 72;

    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not get canvas context');
    }

    await page.render({
      canvasContext: context,
      viewport,
      canvas,
    }).promise;

    // Return base64 without data URL prefix (for Gemini API)
    const dataUrl = canvas.toDataURL('image/png');
    return dataUrl.split(',')[1];
  }

  async cropImage(base64Image: string, options: CropOptions): Promise<string> {
    const { bbox } = options;
    const [ymin, xmin, ymax, xmax] = bbox;

    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        // Convert 0-1000 scale to pixels
        const x = (xmin / 1000) * img.width;
        const y = (ymin / 1000) * img.height;
        const width = ((xmax - xmin) / 1000) * img.width;
        const height = ((ymax - ymin) / 1000) * img.height;

        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(width);
        canvas.height = Math.floor(height);

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }

        // Draw cropped area
        ctx.drawImage(img, x, y, width, height, 0, 0, width, height);

        // Return as data URL (for embedding in markdown)
        resolve(canvas.toDataURL('image/png'));
      };

      img.onerror = (e) => reject(e);
      img.src = `data:image/png;base64,${base64Image}`;
    });
  }

  async getPageText(pageNum: number): Promise<string> {
    const pdf = this.ensureLoaded();
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    return textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ');
  }

  async extractPageRange(startPage: number, endPage: number): Promise<Uint8Array> {
    if (!this.pdfData) {
      throw new Error('PDF data not available');
    }

    // Use pdf-lib for page extraction
    const sourcePdf = await PDFDocument.load(this.pdfData);
    const newPdf = await PDFDocument.create();

    // pdf-lib uses 0-indexed pages
    const pageIndices = Array.from(
      { length: endPage - startPage + 1 },
      (_, i) => startPage - 1 + i
    );

    const pages = await newPdf.copyPages(sourcePdf, pageIndices);
    pages.forEach((page) => newPdf.addPage(page));

    return newPdf.save();
  }

  async getPageImages(pageNum: number): Promise<EmbeddedImage[]> {
    const pdf = this.ensureLoaded();
    const page = await pdf.getPage(pageNum);

    // Get the operator list which contains rendering operations
    const operatorList = await page.getOperatorList();
    const images: EmbeddedImage[] = [];

    // PDF.js operator types for images
    const OPS = {
      paintImageXObject: 85,
      paintInlineImageXObject: 86,
      paintInlineImageXObjectGroup: 87,
    };

    for (let i = 0; i < operatorList.fnArray.length; i++) {
      const op = operatorList.fnArray[i];

      if (
        op === OPS.paintImageXObject ||
        op === OPS.paintInlineImageXObject ||
        op === OPS.paintInlineImageXObjectGroup
      ) {
        try {
          const args = operatorList.argsArray[i];
          const imageName = args[0];

          // Get the image from page resources
          const objs = (page as unknown as { objs?: { get?: (name: string) => unknown } }).objs;
          if (objs?.get) {
            const imageData = objs.get(imageName) as {
              data?: Uint8Array;
              width?: number;
              height?: number;
            } | null;

            if (imageData?.data && imageData.width && imageData.height) {
              images.push({
                data: imageData.data,
                width: imageData.width,
                height: imageData.height,
                format: 'raw', // Raw RGBA data
              });
            }
          }
        } catch {
          // Skip images that can't be extracted
        }
      }
    }

    return images;
  }

  // Vector graphics detection

  async detectVectorRegions(pageNum: number): Promise<VectorRegion[]> {
    const pdf = this.ensureLoaded();
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.0 });

    // Get the operator list
    const operatorList = await page.getOperatorList();

    // Detect vector regions
    return detectVectorRegionsFromOpList(
      operatorList.fnArray,
      operatorList.argsArray,
      {
        width: viewport.width,
        height: viewport.height,
        scale: 1.0,
        transform: viewport.transform,
      }
    );
  }

  async renderAsSvg(pageNum: number, region?: VectorRegion): Promise<string> {
    const pdf = this.ensureLoaded();
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.0 });

    // Create SVG container
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');

    if (region) {
      const [x, y, width, height] = region.bbox;
      svg.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
      svg.setAttribute('width', String(width));
      svg.setAttribute('height', String(height));
    } else {
      svg.setAttribute('viewBox', `0 0 ${viewport.width} ${viewport.height}`);
      svg.setAttribute('width', String(viewport.width));
      svg.setAttribute('height', String(viewport.height));
    }

    // Render to canvas first, then convert to image in SVG
    // (Full SVGGraphics would require more complex implementation)
    const scale = 2; // Higher quality
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width * scale;
    canvas.height = viewport.height * scale;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not get canvas context');
    }

    await page.render({
      canvasContext: context,
      viewport: page.getViewport({ scale }),
      canvas,
    }).promise;

    // Convert to data URL
    const dataUrl = canvas.toDataURL('image/png');

    // Create image element in SVG
    const image = document.createElementNS(svgNs, 'image');
    image.setAttribute('href', dataUrl);
    image.setAttribute('width', String(viewport.width));
    image.setAttribute('height', String(viewport.height));
    svg.appendChild(image);

    // Serialize SVG
    const serializer = new XMLSerializer();
    return serializer.serializeToString(svg);
  }

  async renderRegion(
    pageNum: number,
    region: VectorRegion,
    scale: number = 3
  ): Promise<string> {
    const pdf = this.ensureLoaded();
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    // Render full page
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not get canvas context');
    }

    await page.render({
      canvasContext: context,
      viewport,
      canvas,
    }).promise;

    // Crop to region
    const [x, y, width, height] = region.bbox;
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = Math.floor(width * scale);
    cropCanvas.height = Math.floor(height * scale);

    const cropContext = cropCanvas.getContext('2d');
    if (!cropContext) {
      throw new Error('Could not get crop canvas context');
    }

    cropContext.drawImage(
      canvas,
      x * scale,
      y * scale,
      width * scale,
      height * scale,
      0,
      0,
      width * scale,
      height * scale
    );

    // Return base64
    const dataUrl = cropCanvas.toDataURL('image/png');
    return dataUrl.split(',')[1];
  }
}
