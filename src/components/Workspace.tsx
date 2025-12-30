import React, { useEffect, useState, useRef } from 'react';
import { ArrowLeft, BookOpen, FileCode, Play, Save, Loader2 } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import { loadPDF, getMetadata, renderPageToImage, getPageText, extractImagesFromPage } from '../lib/pdf-utils';
import type { PDFMetadata } from '../lib/pdf-utils';
import { GeminiService } from '../lib/gemini';
import ReactMarkdown from 'react-markdown';

interface WorkspaceProps {
  filePath: string;
  onClose: () => void;
}

export const Workspace: React.FC<WorkspaceProps> = ({ filePath, onClose }) => {
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [metadata, setMetadata] = useState<PDFMetadata | null>(null);
  const [markdown, setMarkdown] = useState<string>('# Translated Document\n\nClick "Convert" to start...');
  const [isLoading, setIsLoading] = useState(true);
  const [isConverting, setIsConverting] = useState(false);
  const [conversionStatus, setConversionStatus] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [activeTab, setActiveTab] = useState<'preview' | 'code'>('preview');
  const [showOutline, setShowOutline] = useState(false);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const init = async () => {
      try {
        setIsLoading(true);
        if (!window.electronAPI) {
            console.error('Electron API not available');
            return;
        }
        // Read file using Electron IPC
        const buffer = await window.electronAPI.readFileBuffer(filePath);
        const doc = await loadPDF(buffer);
        const meta = await getMetadata(doc);
        
        setPdfDoc(doc);
        setMetadata(meta);
      } catch (error) {
        console.error('Failed to load PDF:', error);
      } finally {
        setIsLoading(false);
      }
    };
    init();
  }, [filePath]);

  useEffect(() => {
    if (showOutline) return;

    let renderTask: any = null;

    const renderPage = async () => {
        if (!canvasRef.current || !pdfDoc) return;
        
        try {
            const page = await pdfDoc.getPage(currentPage);
            const viewport = page.getViewport({ scale: 1.5 });
            const canvas = canvasRef.current;
            
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            
            const context = canvas.getContext('2d');
            if (context) {
                renderTask = page.render({
                    canvasContext: context,
                    viewport: viewport,
                    canvas: canvas
                });
                await renderTask.promise;
            }
        } catch(err: any) {
            if (err.name !== 'RenderingCancelledException') {
                console.error("Page render error", err);
            }
        }
    }
    renderPage();

    return () => {
        if (renderTask) {
            renderTask.cancel();
        }
    };
  }, [pdfDoc, currentPage, showOutline]);

  const handleConvert = async () => {
    if (!pdfDoc || !metadata) return;
    
    setIsConverting(true);
    try {
        const apiKey = await window.electronAPI.getApiKey();
        if (!apiKey) {
            alert('Please configure your Gemini API Key in settings first.');
            setIsConverting(false);
            return;
        }

        const gemini = new GeminiService(apiKey);
        setMarkdown('# Converting...\n');

        // Pass 1: Analysis (First 3 pages)
        setConversionStatus('Analyzing document structure...');
        let firstPagesText = '';
        for (let i = 1; i <= Math.min(3, metadata.numPages); i++) {
            firstPagesText += await getPageText(pdfDoc, i) + '\n';
        }
        
        const analysis = await gemini.analyzeDocumentStructure(firstPagesText);
        setMarkdown(() => `# Converted Document\n\n**Language:** ${analysis.language} | **TOC:** ${analysis.hasTOC ? 'Yes' : 'No'}\n\n---\n\n`);

        // Pass 2: Page by Page
        let currentMarkdown = ''; // Keep track locally to pass context
        
        for (let i = 1; i <= metadata.numPages; i++) {
            setConversionStatus(`Converting page ${i} of ${metadata.numPages}...`);
            setCurrentPage(i); // Sync view
            
            // Extract images from this page
            const extractedImages = await extractImagesFromPage(pdfDoc, i);
            
            const imageBase64 = await renderPageToImage(pdfDoc, i);
            let pageContent = await gemini.convertPage(imageBase64, {
                previousContent: currentMarkdown,
                pageNumber: i,
                totalPages: metadata.numPages
            });
            
            // Replace image placeholders with actual data URLs
            // Placeholder format: ![Description of image](image_placeholder_{pageNum}_X)
            extractedImages.forEach((imgDataUrl, idx) => {
                const placeholder = `image_placeholder_${i}_${idx + 1}`;
                pageContent = pageContent.replace(placeholder, imgDataUrl);
            });
            
            currentMarkdown += pageContent + '\n\n';
            setMarkdown((prev) => prev + pageContent + '\n\n');
        }

        setConversionStatus('Done!');

    } catch (error) {
        console.error("Conversion error:", error);
        setMarkdown(prev => prev + '\n\n**Error during conversion.** Check console for details.');
    } finally {
        setIsConverting(false);
    }
  };

  const handleSaveFile = async () => {
    try {
        await window.electronAPI.saveMarkdownFile(markdown);
    } catch (error) {
        console.error('Failed to save file:', error);
    }
  };

  // Helper to render outline recursively
  const renderOutline = (items: any[]) => {
      return (
          <ul className="pl-4 space-y-2 text-sm text-zinc-300">
              {items.map((item, idx) => (
                  <li key={idx}>
                      <span className="hover:text-white cursor-pointer">{item.title}</span>
                      {item.items && item.items.length > 0 && renderOutline(item.items)}
                  </li>
              ))}
          </ul>
      );
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-white">
      {/* Toolbar */}
      <div className="h-14 border-b border-zinc-800 bg-zinc-900 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-4">
          <button 
            onClick={onClose}
            className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex flex-col">
            <span className="font-medium text-sm truncate max-w-[200px]" title={filePath}>
              {filePath.split('/').pop()}
            </span>
            <span className="text-xs text-zinc-500">
                {metadata ? `${metadata.numPages} pages` : 'Loading...'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
            {isConverting && (
                <span className="text-xs text-indigo-400 animate-pulse">
                    {conversionStatus}
                </span>
            )}
            
            <button 
                onClick={handleConvert}
                disabled={isConverting || isLoading}
                className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-indigo-500/20"
            >
                {isConverting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
                {isConverting ? 'Stop' : 'Convert'}
            </button>
            <button 
                onClick={handleSaveFile}
                className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-colors"
            >
                <Save className="w-5 h-5" />
            </button>
        </div>
      </div>

      {/* Main Content Split View */}
      <div className="flex-1 flex overflow-hidden">
        {/* PDF Viewer (Left) */}
        <div className="w-1/2 border-r border-zinc-800 bg-zinc-900/50 flex flex-col">
            {/* View Toggle (Only if outline exists) */}
            {metadata?.outline && metadata.outline.length > 0 && (
                <div className="px-4 py-2 flex gap-4 text-xs font-medium border-b border-zinc-800/50">
                    <button 
                        onClick={() => setShowOutline(false)}
                        className={`${!showOutline ? 'text-indigo-400' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                        Page View
                    </button>
                    <button 
                        onClick={() => setShowOutline(true)}
                        className={`${showOutline ? 'text-indigo-400' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                        Table of Contents
                    </button>
                </div>
            )}

            <div className="flex-1 overflow-auto p-8 flex justify-center items-start">
                 {isLoading ? (
                     <div className="flex items-center gap-2 text-zinc-500">Loading PDF...</div>
                 ) : showOutline && metadata?.outline ? (
                     <div className="w-full max-w-lg">
                        {renderOutline(metadata.outline)}
                     </div>
                 ) : (
                     <canvas 
                        ref={canvasRef} 
                        className="shadow-2xl border border-zinc-800/50 max-w-full h-auto"
                     />
                 )}
            </div>
            {/* PDF Navigation */}
            {!showOutline && (
                <div className="h-12 border-t border-zinc-800 bg-zinc-900 flex items-center justify-center gap-4">
                    <button 
                        disabled={currentPage <= 1}
                        onClick={() => setCurrentPage(p => p - 1)}
                        className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 rounded text-sm"
                    >
                        Previous
                    </button>
                    <span className="text-sm font-medium w-20 text-center">
                        Page {currentPage} / {metadata?.numPages || '-'}
                    </span>
                    <button 
                        disabled={!metadata || currentPage >= metadata.numPages}
                        onClick={() => setCurrentPage(p => p + 1)}
                        className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 rounded text-sm"
                    >
                        Next
                    </button>
                </div>
            )}
        </div>

        {/* Markdown Editor (Right) */}
        <div className="w-1/2 flex flex-col bg-zinc-950">
            <div className="h-10 border-b border-zinc-800 flex">
                <button 
                    onClick={() => setActiveTab('preview')}
                    className={`flex-1 flex items-center justify-center gap-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'preview' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
                >
                    <BookOpen className="w-4 h-4" />
                    Preview
                </button>
                <button 
                    onClick={() => setActiveTab('code')}
                    className={`flex-1 flex items-center justify-center gap-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'code' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
                >
                    <FileCode className="w-4 h-4" />
                    Raw Markdown
                </button>
            </div>
            
            <div className="flex-1 overflow-auto">
                {activeTab === 'preview' ? (
                    <div className="p-8 prose prose-invert prose-zinc max-w-none">
                        <ReactMarkdown>{markdown}</ReactMarkdown>
                    </div>
                ) : (
                    <textarea 
                        value={markdown}
                        onChange={(e) => setMarkdown(e.target.value)}
                        className="w-full h-full bg-zinc-950 p-6 font-mono text-sm text-zinc-300 resize-none focus:outline-none"
                        spellCheck={false}
                    />
                )}
            </div>
        </div>
      </div>
    </div>
  );
};
