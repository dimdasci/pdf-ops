import * as pdfjsLib from 'pdfjs-dist';

// Set worker source
// In a production Electron app, we might need to copy this file to the public folder
// or handle it via a specific Vite plugin. For now, we'll try importing the URL.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export interface PDFMetadata {
  numPages: number;
  fingerprint: string;
  info?: Record<string, unknown>;
  outline?: any[];
}

export const loadPDF = async (buffer: Uint8Array) => {
  const loadingTask = pdfjsLib.getDocument({ data: buffer });
  const pdf = await loadingTask.promise;
  return pdf;
};

export const getMetadata = async (pdf: pdfjsLib.PDFDocumentProxy): Promise<PDFMetadata> => {
    const metadata = await pdf.getMetadata();
    const outline = await pdf.getOutline();
    const fingerprintCandidate = (pdf as unknown as { fingerprint?: string }).fingerprint || (pdf.fingerprints ? pdf.fingerprints[0] : '');
    
    return {
        numPages: pdf.numPages,
        fingerprint: fingerprintCandidate || '',
        info: metadata.info as Record<string, unknown>,
        outline: outline || undefined
    };
}

export const renderPageToImage = async (pdf: pdfjsLib.PDFDocumentProxy, pageNum: number, scale: number = 1.5): Promise<string> => {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    
    const canvas = document.createElement('canvas');
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not get canvas context');
    
    await page.render({
        canvasContext: context,
        viewport: viewport,
        canvas: canvas, // Explicitly provide canvas element to satisfy type
    }).promise;
    
    // Return base64 string without the data URL prefix for Gemini
    const dataUrl = canvas.toDataURL('image/png');
    return dataUrl.split(',')[1];
};

export const getPageText = async (pdf: pdfjsLib.PDFDocumentProxy, pageNum: number): Promise<string> => {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    return textContent.items.map((item) => 'str' in item ? item.str : '').join(' ');
};

export const extractImagesFromPage = async (pdf: pdfjsLib.PDFDocumentProxy, pageNum: number): Promise<string[]> => {
    const page = await pdf.getPage(pageNum);
    const operatorList = await page.getOperatorList();
    const images: string[] = [];
    
    // operatorList.fnArray and operatorList.argsArray contain the operations
    for (let i = 0; i < operatorList.fnArray.length; i++) {
        // OPS.paintImageXObject or OPS.paintInlineImageXObject
        if (operatorList.fnArray[i] === (pdfjsLib as any).OPS.paintImageXObject || 
            operatorList.fnArray[i] === (pdfjsLib as any).OPS.paintInlineImageXObject) {
            
            const imageName = operatorList.argsArray[i][0];
            try {
                const image = await page.objs.get(imageName);
                if (image && image.data) {
                    // Convert image data to data URL
                    const canvas = document.createElement('canvas');
                    canvas.width = image.width;
                    canvas.height = image.height;
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        const imageData = ctx.createImageData(image.width, image.height);
                        // PDF.js image data format can vary, usually RGBA or RGB
                        // For simplicity in this prototype, we'll assume it's compatible or handle basic cases
                        if (image.data.length === image.width * image.height * 4) {
                            imageData.data.set(image.data);
                        } else {
                            // Basic RGB to RGBA conversion if needed
                            for (let j = 0, k = 0; j < image.data.length; j += 3, k += 4) {
                                imageData.data[k] = image.data[j];
                                imageData.data[k+1] = image.data[j+1];
                                imageData.data[k+2] = image.data[j+2];
                                imageData.data[k+3] = 255;
                            }
                        }
                        ctx.putImageData(imageData, 0, 0);
                        images.push(canvas.toDataURL('image/png'));
                    }
                }
            } catch (err) {
                console.warn("Could not extract image", imageName, err);
            }
        }
    }
    return images;
};
