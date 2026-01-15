/**
 * Node.js PDF Service Implementation
 *
 * Uses PDF.js with @napi-rs/canvas for rendering and pdf-lib for page manipulation.
 * This implementation is used for E2E tests and potential Node.js API backend.
 */

import { createCanvas, loadImage } from '@napi-rs/canvas'
import path from 'path'
import { PDFDocument } from 'pdf-lib'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { fileURLToPath } from 'url'
import type {
  CropOptions,
  EmbeddedImage,
  OutlineItem,
  PdfMetadata,
  PdfService,
  RenderOptions,
  VectorRegion,
} from './types'
import { detectVectorRegionsFromOpList } from './vector-detector'

// Configure PDF.js worker path for Node.js
const __dirname = path.dirname(fileURLToPath(import.meta.url))
GlobalWorkerOptions.workerSrc = path.join(
  __dirname,
  '../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
)

// Custom canvas factory for @napi-rs/canvas
class NodeCanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(width, height)
    const context = canvas.getContext('2d')
    return { canvas, context }
  }

  reset(
    canvasAndContext: { canvas: ReturnType<typeof createCanvas>; context: unknown },
    width: number,
    height: number,
  ) {
    canvasAndContext.canvas.width = width
    canvasAndContext.canvas.height = height
  }

  destroy(canvasAndContext: { canvas: ReturnType<typeof createCanvas> }) {
    canvasAndContext.canvas.width = 0
    canvasAndContext.canvas.height = 0
  }
}

/**
 * Node.js implementation of PdfService using PDF.js + @napi-rs/canvas
 */
export class NodePdfService implements PdfService {
  private pdfDoc: PDFDocumentProxy | null = null
  private pdfData: Uint8Array | null = null
  private canvasFactory = new NodeCanvasFactory()

  async load(data: Uint8Array): Promise<void> {
    this.pdfData = data

    const loadingTask = getDocument({
      data: data,
      useSystemFonts: true,
      standardFontDataUrl: path.join(
        __dirname,
        '../../../node_modules/pdfjs-dist/standard_fonts/',
      ),
      cMapUrl: path.join(__dirname, '../../../node_modules/pdfjs-dist/cmaps/'),
      cMapPacked: true,
      canvasFactory: this.canvasFactory,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    this.pdfDoc = await loadingTask.promise
  }

  destroy(): void {
    if (this.pdfDoc) {
      this.pdfDoc.destroy()
      this.pdfDoc = null
    }
    this.pdfData = null
  }

  private ensureLoaded(): PDFDocumentProxy {
    if (!this.pdfDoc) {
      throw new Error('PDF not loaded. Call load() first.')
    }
    return this.pdfDoc
  }

  getPageCount(): number {
    return this.ensureLoaded().numPages
  }

  async getMetadata(): Promise<PdfMetadata> {
    const pdf = this.ensureLoaded()
    const metadata = await pdf.getMetadata()
    const info = metadata.info as Record<string, unknown>

    return {
      pageCount: pdf.numPages,
      title: info?.Title as string | undefined,
      author: info?.Author as string | undefined,
      subject: info?.Subject as string | undefined,
      creator: info?.Creator as string | undefined,
      producer: info?.Producer as string | undefined,
      creationDate: info?.CreationDate ? new Date(info.CreationDate as string) : undefined,
      modificationDate: info?.ModDate ? new Date(info.ModDate as string) : undefined,
    }
  }

  async getOutline(): Promise<OutlineItem[] | null> {
    const pdf = this.ensureLoaded()
    const outline = await pdf.getOutline()

    if (!outline) return null

    const convertOutline = async (
      items: Awaited<ReturnType<typeof pdf.getOutline>>,
    ): Promise<OutlineItem[]> => {
      if (!items) return []

      return Promise.all(
        items.map(async item => {
          let pageNumber: number | undefined

          if (item.dest) {
            try {
              const dest = typeof item.dest === 'string'
                ? await pdf.getDestination(item.dest)
                : item.dest

              if (dest && dest[0]) {
                const pageIndex = await pdf.getPageIndex(dest[0])
                pageNumber = pageIndex + 1
              }
            } catch {
              // Ignore destination resolution errors
            }
          }

          return {
            title: item.title,
            pageNumber,
            children: item.items ? await convertOutline(item.items) : undefined,
          }
        }),
      )
    }

    return convertOutline(outline)
  }

  async renderPage(pageNum: number, options: RenderOptions = {}): Promise<string> {
    const pdf = this.ensureLoaded()
    const { dpi = 72 } = options

    // Convert DPI to scale (PDF.js default is 72 DPI)
    const scale = dpi / 72

    const page = await pdf.getPage(pageNum)
    const viewport = page.getViewport({ scale })

    const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height))
    const context = canvas.getContext('2d')

    await page.render({
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
      canvasFactory: this.canvasFactory,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).promise

    // Return base64 without data URL prefix (for Gemini API)
    const dataUrl = canvas.toDataURL('image/png')
    return dataUrl.split(',')[1]
  }

  async cropImage(base64Image: string, options: CropOptions): Promise<string> {
    const { bbox } = options
    const [ymin, xmin, ymax, xmax] = bbox

    // Load the image from base64
    const imageBuffer = Buffer.from(base64Image, 'base64')
    const img = await loadImage(imageBuffer)

    // Convert 0-1000 scale to pixels
    const x = (xmin / 1000) * img.width
    const y = (ymin / 1000) * img.height
    const width = ((xmax - xmin) / 1000) * img.width
    const height = ((ymax - ymin) / 1000) * img.height

    // Create canvas for cropped image
    const canvas = createCanvas(Math.floor(width), Math.floor(height))
    const ctx = canvas.getContext('2d')

    // Draw cropped area
    ctx.drawImage(img, x, y, width, height, 0, 0, width, height)

    // Return as data URL (for embedding in markdown)
    return canvas.toDataURL('image/png')
  }

  async getPageText(pageNum: number): Promise<string> {
    const pdf = this.ensureLoaded()
    const page = await pdf.getPage(pageNum)
    const textContent = await page.getTextContent()

    return textContent.items
      .map(item => ('str' in item ? item.str : ''))
      .join(' ')
  }

  async extractPageRange(startPage: number, endPage: number): Promise<Uint8Array> {
    if (!this.pdfData) {
      throw new Error('PDF data not available')
    }

    // Use pdf-lib for page extraction
    const sourcePdf = await PDFDocument.load(this.pdfData)
    const newPdf = await PDFDocument.create()

    // pdf-lib uses 0-indexed pages
    const pageIndices = Array.from(
      { length: endPage - startPage + 1 },
      (_, i) => startPage - 1 + i,
    )

    const pages = await newPdf.copyPages(sourcePdf, pageIndices)
    pages.forEach(page => newPdf.addPage(page))

    return newPdf.save()
  }

  async getPageImages(pageNum: number): Promise<EmbeddedImage[]> {
    const pdf = this.ensureLoaded()
    const page = await pdf.getPage(pageNum)

    // Get the operator list which contains rendering operations
    const operatorList = await page.getOperatorList()
    const images: EmbeddedImage[] = []

    // PDF.js operator types for images
    const OPS = {
      paintImageXObject: 85,
      paintInlineImageXObject: 86,
      paintInlineImageXObjectGroup: 87,
    }

    for (let i = 0; i < operatorList.fnArray.length; i++) {
      const op = operatorList.fnArray[i]

      if (
        op === OPS.paintImageXObject
        || op === OPS.paintInlineImageXObject
        || op === OPS.paintInlineImageXObjectGroup
      ) {
        try {
          const args = operatorList.argsArray[i]
          const imageName = args[0]

          // Get the image from page resources
          // Note: This is a simplified implementation - full image extraction
          // requires accessing the page's objs dictionary
          const objs = (page as unknown as { objs?: { get?: (name: string) => unknown } }).objs
          if (objs?.get) {
            const imageData = objs.get(imageName) as {
              data?: Uint8Array
              width?: number
              height?: number
            } | null

            if (imageData?.data && imageData.width && imageData.height) {
              images.push({
                data: imageData.data,
                width: imageData.width,
                height: imageData.height,
                format: 'raw', // Raw RGBA data
              })
            }
          }
        } catch {
          // Skip images that can't be extracted
        }
      }
    }

    return images
  }

  // Vector graphics detection

  async detectVectorRegions(pageNum: number): Promise<VectorRegion[]> {
    const pdf = this.ensureLoaded()
    const page = await pdf.getPage(pageNum)
    const viewport = page.getViewport({ scale: 1.0 })

    // Get the operator list
    const operatorList = await page.getOperatorList()

    // Detect vector regions
    return detectVectorRegionsFromOpList(
      operatorList.fnArray,
      operatorList.argsArray,
      {
        width: viewport.width,
        height: viewport.height,
        scale: 1.0,
        transform: viewport.transform,
      },
    )
  }

  async renderRegion(
    pageNum: number,
    region: VectorRegion,
    scale: number = 3,
  ): Promise<string> {
    const pdf = this.ensureLoaded()
    const page = await pdf.getPage(pageNum)
    const viewport = page.getViewport({ scale })

    // Render full page
    const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height))
    const context = canvas.getContext('2d')

    await page.render({
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
      canvasFactory: this.canvasFactory,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).promise

    // Crop to region
    const [x, y, width, height] = region.bbox
    const cropCanvas = createCanvas(
      Math.floor(width * scale),
      Math.floor(height * scale),
    )
    const cropContext = cropCanvas.getContext('2d')

    cropContext.drawImage(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      canvas as any,
      x * scale,
      y * scale,
      width * scale,
      height * scale,
      0,
      0,
      width * scale,
      height * scale,
    )

    // Return base64
    const dataUrl = cropCanvas.toDataURL('image/png')
    return dataUrl.split(',')[1]
  }
}
