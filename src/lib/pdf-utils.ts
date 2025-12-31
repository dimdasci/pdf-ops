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
  outline?: unknown[];
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
    
    // Access OPS safely
    const OPS = pdfjsLib.OPS;
    if (!OPS) {
        console.error('PDF.js OPS not found');
        return [];
    }
    
    for (let i = 0; i < operatorList.fnArray.length; i++) {
        const fn = operatorList.fnArray[i];
        
        if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
            const imageName = operatorList.argsArray[i][0] as string;
            try {
                // Determine where to get the image from (local objs or common objs)
                // Note: page.objs.get serves as a unified accessor in recent versions but explicit check helps
                const image = await page.objs.get(imageName);
                
                if (image && image.data) {
                    const { width, height, data, kind } = image;
                    
                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    
                    if (ctx) {
                        const imageData = ctx.createImageData(width, height);
                        
                        // Handle different image kinds
                        // kind: 1 = Grayscale, 2 = RGB, 3 = RGBA
                        // If kind is missing, infer from data length
                        
                        if (kind === 1 || (data.length === width * height)) {
                            // Grayscale
                            for (let j = 0, k = 0; j < data.length; j++, k += 4) {
                                const val = data[j];
                                imageData.data[k] = val;
                                imageData.data[k+1] = val;
                                imageData.data[k+2] = val;
                                imageData.data[k+3] = 255;
                            }
                        } else if (kind === 2 || (data.length === width * height * 3)) {
                            // RGB
                            for (let j = 0, k = 0; j < data.length; j += 3, k += 4) {
                                imageData.data[k] = data[j];
                                imageData.data[k+1] = data[j+1];
                                imageData.data[k+2] = data[j+2];
                                imageData.data[k+3] = 255;
                            }
                        } else if (kind === 3 || (data.length === width * height * 4)) {
                            // RGBA
                            imageData.data.set(data);
                        } else {
                            // Fallback or unknown format (e.g. CMYK), skip for now or try basic copy
                            console.warn(`Unknown image format for ${imageName}: length=${data.length}, w=${width}, h=${height}`);
                            continue;
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
