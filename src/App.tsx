import { FileText, Settings } from 'lucide-react'
import { useEffect, useState } from 'react'
import { DropZone } from './components/DropZone'
import { SettingsModal } from './components/SettingsModal'
import { Workspace } from './components/Workspace'

function App() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  const [currentFile, setCurrentFile] = useState<string | null>(null)

  const handleFileSelect = (filePath: string) => {
    console.log('App: handleFileSelect called with:', filePath)

    setCurrentFile(filePath)
  }

  // Test helper: allow integration tests to load PDFs programmatically
  // Active in development mode and test/CI environments
  useEffect(() => {
    const handleTestLoadPdf = (event: CustomEvent<{ filePath: string }>) => {
      // Allow in dev mode (Vite) or test mode (Electron with NODE_ENV=test)
      if (import.meta.env.DEV || window.electronAPI?.isTestMode) {
        handleFileSelect(event.detail.filePath)
      }
    }

    window.addEventListener('test:load-pdf', handleTestLoadPdf as EventListener)
    return () => {
      window.removeEventListener('test:load-pdf', handleTestLoadPdf as EventListener)
    }
  }, [])

  console.log('App render. currentFile:', currentFile)

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100 font-sans selection:bg-indigo-500/30">
      {/* Header only shown when no file is selected (Workspace has its own header) */}

      {!currentFile && (
        <header className="h-14 border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-md flex items-center justify-between px-6 sticky top-0 z-10">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-500/10 rounded-lg flex items-center justify-center border border-indigo-500/20">
              <FileText className="w-5 h-5 text-indigo-400" />
            </div>

            <h1 className="font-bold text-lg tracking-tight">PDF Translator</h1>
          </div>

          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
            title="Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
        </header>
      )}

      {/* Main Content */}
      <main className="flex-1 overflow-hidden relative">
        {currentFile
          ? (
            <Workspace
              filePath={currentFile}
              onClose={() => setCurrentFile(null)}
            />
          )
          : (
            <div className="h-[calc(100vh-3.5rem)] flex flex-col items-center justify-center p-8 text-center text-zinc-500">
              <DropZone onFileSelect={handleFileSelect} />
            </div>
          )}
      </main>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  )
}

export default App
