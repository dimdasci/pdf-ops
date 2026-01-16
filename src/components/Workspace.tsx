import { ArrowLeft, BookOpen, FileCode, Loader2, Play, Save } from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'
import React, { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { GeminiService } from '../lib/gemini'
import { BrowserPdfService } from '../lib/pdf-service/browser'
import type { OutlineItem, PdfMetadata } from '../lib/pdf-service/types'

// Extended metadata with outline for Workspace component
interface ExtendedMetadata extends PdfMetadata {
  outline?: OutlineItem[]
}

interface WorkspaceProps {
  filePath: string
  onClose: () => void
}

export const Workspace: React.FC<WorkspaceProps> = ({ filePath, onClose }) => {
  const [pdfService, setPdfService] = useState<BrowserPdfService | null>(null)
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [metadata, setMetadata] = useState<ExtendedMetadata | null>(null)
  const [markdown, setMarkdown] = useState<string>(
    '# Translated Document\n\nClick "Convert" to start...',
  )
  const [isLoading, setIsLoading] = useState(true)
  const [isConverting, setIsConverting] = useState(false)
  const [conversionStatus, setConversionStatus] = useState('')
  const [detectedLanguage, setDetectedLanguage] = useState<string>('')
  const [currentPage, setCurrentPage] = useState(1)
  const [activeTab, setActiveTab] = useState<'preview' | 'code'>('preview')
  const [showOutline, setShowOutline] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const init = async () => {
      try {
        setIsLoading(true)
        if (!window.electronAPI) {
          console.error('Electron API not available')
          return
        }
        // Read file using Electron IPC
        const buffer = await window.electronAPI.readFileBuffer(filePath)

        // Create PDF service
        const service = new BrowserPdfService()
        await service.load(buffer)

        const meta = await service.getMetadata()

        setPdfService(service)
        setMetadata(meta)

        // Also load raw pdfjs doc for canvas rendering
        const pdfjsLib = await import('pdfjs-dist')
        const loadingTask = pdfjsLib.getDocument({ data: buffer })
        const doc = await loadingTask.promise
        setPdfDoc(doc)
      } catch (error) {
        console.error('Failed to load PDF:', error)
      } finally {
        setIsLoading(false)
      }
    }
    init()

    // Cleanup on unmount
    return () => {
      pdfService?.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath])

  useEffect(() => {
    if (showOutline) return

    let renderTask: pdfjsLib.RenderTask | null = null

    const renderPage = async () => {
      if (!canvasRef.current || !pdfDoc) return

      try {
        const page = await pdfDoc.getPage(currentPage)
        const viewport = page.getViewport({ scale: 1.5 })
        const canvas = canvasRef.current

        canvas.height = viewport.height
        canvas.width = viewport.width

        const context = canvas.getContext('2d')
        if (context) {
          renderTask = page.render({
            canvasContext: context,
            viewport: viewport,
            canvas: canvas,
          })
          await renderTask.promise
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'RenderingCancelledException') {
          return
        }
        console.error('Page render error', err)
      }
    }
    renderPage()

    return () => {
      if (renderTask) {
        renderTask.cancel()
      }
    }
  }, [pdfDoc, currentPage, showOutline])

  const handleConvert = async () => {
    if (!pdfService || !metadata) return

    setIsConverting(true)
    try {
      const apiKey = await window.electronAPI.getApiKey()
      if (!apiKey) {
        alert('Please configure your Gemini API Key in settings first.')
        setIsConverting(false)
        return
      }

      const gemini = new GeminiService(apiKey)
      setMarkdown('') // Clear previous content
      setDetectedLanguage('')

      const numPages = metadata.pageCount

      // Pass 1: Analysis (First 3 pages)
      setConversionStatus('Analyzing document structure...')
      let firstPagesText = ''
      for (let i = 1; i <= Math.min(3, numPages); i++) {
        firstPagesText += await pdfService.getPageText(i) + '\n'
      }

      const analysis = await gemini.analyzeDocumentStructure(firstPagesText)
      setDetectedLanguage(analysis.language)

      // Pass 2: Page by Page
      let currentMarkdown = '' // Keep track locally to pass context

      for (let i = 1; i <= numPages; i++) {
        setConversionStatus(`Converting page ${i} of ${numPages}...`)
        setCurrentPage(i) // Sync view

        const imageBase64 = await pdfService.renderPage(i)
        const conversionResult = await gemini.convertPage(imageBase64, {
          previousContent: currentMarkdown,
          pageNumber: i,
          totalPages: numPages,
        })
        let pageContent = conversionResult.content
        const images = conversionResult.images

        console.log(`[Page ${i}] Generated Markdown (Pre-replace):`, pageContent)
        console.log(`[Page ${i}] Generated Images Map:`, images)

        // Visual Extraction: Replace placeholders with cropped images
        const placeholders = Object.keys(images)
        if (placeholders.length > 0) {
          for (const placeholder of placeholders) {
            try {
              const bbox = images[placeholder]
              if (!bbox || bbox.length !== 4) {
                console.warn(`[Page ${i}] Invalid bbox for ${placeholder}:`, bbox)
                continue
              }

              const croppedDataUrl = await pdfService.cropImage(imageBase64, { bbox })
              if (!croppedDataUrl) {
                console.warn(`[Page ${i}] Cropped image is empty for ${placeholder}`)
                continue
              }

              console.log(
                `[Page ${i}] Replaced ${placeholder} with data URL (length: ${croppedDataUrl.length})`,
              )
              // Replace all instances of the placeholder
              pageContent = pageContent.replaceAll(placeholder, croppedDataUrl)
            } catch (err) {
              console.error(`Failed to crop image for ${placeholder}`, err)
            }
          }
        } else {
          console.log(`No visual elements identified for page ${i}`)
        }

        // Fallback for unreplaced placeholders
        pageContent = pageContent.replace(
          /!\[(.*?)\]\((img_placeholder_[a-zA-Z0-9_]+)\)/g,
          '> *[Image extraction failed or coordinates missing for: $1]*',
        )

        // Sanitize: Replace empty image sources that cause browser errors
        pageContent = pageContent.replace(/!\[(.*?)\]\(\s*\)/g, '> *[Image missing: $1]*')

        // Log if any empty image sources remain
        if (pageContent.includes(']()')) {
          console.warn(
            `[Page ${i}] Markdown contains empty image sources:`,
            pageContent.match(/!\[.*?\]\(\)/g),
          )
        }

        currentMarkdown += pageContent + '\n\n'
        setMarkdown(prev => prev + pageContent + '\n\n')
      }

      setConversionStatus('Done!')
    } catch (error) {
      console.error('Conversion error:', error)
      setMarkdown(prev => prev + '\n\n**Error during conversion.** Check console for details.')
    } finally {
      setIsConverting(false)
    }
  }

  const handleSaveFile = async () => {
    try {
      await window.electronAPI.saveMarkdownFile(markdown)
    } catch (error) {
      console.error('Failed to save file:', error)
    }
  }

  // Helper to render outline recursively
  const renderOutline = (items: OutlineItem[]) => {
    return (
      <ul className="pl-4 space-y-2 text-sm text-zinc-300">
        {items.map((item, idx) => (
          <li key={idx}>
            <span className="hover:text-white cursor-pointer">{item.title}</span>
            {item.children && item.children.length > 0 && renderOutline(item.children)}
          </li>
        ))}
      </ul>
    )
  }

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
              {metadata ? `${metadata.pageCount} pages` : 'Loading...'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {detectedLanguage && (
            <span className="text-xs text-zinc-400 bg-zinc-800 px-2 py-1 rounded border border-zinc-700">
              {detectedLanguage}
            </span>
          )}
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
            {isConverting
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Play className="w-4 h-4 fill-current" />}
            {isConverting ? 'Stop' : 'Convert'}
          </button>
          <button
            onClick={handleSaveFile}
            aria-label="Save markdown"
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
                className={`${
                  !showOutline ? 'text-indigo-400' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                Page View
              </button>
              <button
                onClick={() => setShowOutline(true)}
                className={`${
                  showOutline ? 'text-indigo-400' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                Table of Contents
              </button>
            </div>
          )}

          <div className="flex-1 overflow-auto p-8 flex justify-center items-start">
            {isLoading
              ? <div className="flex items-center gap-2 text-zinc-500">Loading PDF...</div>
              : showOutline && metadata?.outline
              ? (
                <div className="w-full max-w-lg">
                  {renderOutline(metadata.outline as OutlineItem[])}
                </div>
              )
              : (
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
                Page {currentPage} / {metadata?.pageCount || '-'}
              </span>
              <button
                disabled={!metadata || currentPage >= metadata.pageCount}
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
              className={`flex-1 flex items-center justify-center gap-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'preview'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              Preview
            </button>
            <button
              onClick={() => setActiveTab('code')}
              className={`flex-1 flex items-center justify-center gap-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'code'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <FileCode className="w-4 h-4" />
              Raw Markdown
            </button>
          </div>

          <div className="flex-1 overflow-auto bg-zinc-900/30">
            {activeTab === 'preview'
              ? (
                <div className="p-12 max-w-4xl mx-auto text-zinc-300">
                  <div className="mb-4 text-xs text-zinc-500 font-mono border-b border-zinc-800 pb-2">
                    Debug: Content Length = {markdown.length} chars
                  </div>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    urlTransform={url => url}
                    components={{
                      table: props => (
                        <table
                          className="border-collapse border border-zinc-700 w-full my-4"
                          {...props}
                        />
                      ),
                      th: props => (
                        <th
                          className="border border-zinc-700 bg-zinc-800 p-2 text-left"
                          {...props}
                        />
                      ),
                      td: props => <td className="border border-zinc-700 p-2" {...props} />,
                      h1: props => (
                        <h1 className="text-3xl font-bold text-white mt-8 mb-4" {...props} />
                      ),
                      h2: props => (
                        <h2 className="text-2xl font-semibold text-white mt-6 mb-3" {...props} />
                      ),
                      h3: props => (
                        <h3 className="text-xl font-medium text-white mt-4 mb-2" {...props} />
                      ),
                      ul: props => (
                        <ul className="list-disc list-inside my-4 space-y-1" {...props} />
                      ),
                      ol: props => (
                        <ol className="list-decimal list-inside my-4 space-y-1" {...props} />
                      ),
                      blockquote: props => (
                        <blockquote
                          className="border-l-4 border-indigo-500 pl-4 italic my-4 text-zinc-400"
                          {...props}
                        />
                      ),
                      p: props => <p className="mb-4 leading-relaxed" {...props} />,
                      a: props => (
                        <a className="text-indigo-400 hover:text-indigo-300 underline" {...props} />
                      ),
                    }}
                  >
                    {markdown}
                  </ReactMarkdown>
                </div>
              )
              : (
                <textarea
                  value={markdown}
                  onChange={e => setMarkdown(e.target.value)}
                  className="w-full h-full bg-zinc-950 p-6 font-mono text-sm text-zinc-300 resize-none focus:outline-none"
                  spellCheck={false}
                />
              )}
          </div>
        </div>
      </div>
    </div>
  )
}
