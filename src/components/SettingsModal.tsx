import { AlertCircle, CheckCircle, Key, Loader2, Save, X } from 'lucide-react'
import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  onKeysChanged?: (keys: ApiKeys) => void
}

interface ProviderStatus {
  isValid: boolean | null
  isChecking: boolean
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, onKeysChanged }) => {
  const [geminiKey, setGeminiKey] = useState('')
  const [anthropicKey, setAnthropicKey] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaved, setIsSaved] = useState(false)
  const [geminiStatus, setGeminiStatus] = useState<ProviderStatus>({
    isValid: null,
    isChecking: false,
  })
  const [anthropicStatus, setAnthropicStatus] = useState<ProviderStatus>({
    isValid: null,
    isChecking: false,
  })

  useEffect(() => {
    if (isOpen) {
      loadApiKeys()
    }
  }, [isOpen])

  const loadApiKeys = async () => {
    if (window.electronAPI) {
      try {
        const keys = await window.electronAPI.getApiKeys()
        if (keys.gemini) setGeminiKey(keys.gemini)
        if (keys.anthropic) setAnthropicKey(keys.anthropic)
      } catch (e) {
        console.error('Failed to load API keys:', e)
      }
    }
  }

  const handleSave = async () => {
    if (!window.electronAPI) {
      console.error('Electron API not available')
      return
    }

    setIsLoading(true)
    try {
      const keys: ApiKeys = {}
      if (geminiKey) keys.gemini = geminiKey
      if (anthropicKey) keys.anthropic = anthropicKey

      await window.electronAPI.saveApiKeys(keys)
      setIsSaved(true)
      setTimeout(() => setIsSaved(false), 2000)

      // Notify parent of changes
      onKeysChanged?.(keys)
    } catch (error) {
      console.error('Failed to save keys:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const validateGeminiKey = async () => {
    if (!geminiKey) return
    setGeminiStatus({ isValid: null, isChecking: true })

    try {
      // Simple validation by attempting a minimal API call
      const { GoogleGenerativeAI } = await import('@google/generative-ai')
      const genAI = new GoogleGenerativeAI(geminiKey)
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
      await model.generateContent('test')
      setGeminiStatus({ isValid: true, isChecking: false })
    } catch {
      setGeminiStatus({ isValid: false, isChecking: false })
    }
  }

  const validateAnthropicKey = async () => {
    if (!anthropicKey) return
    setAnthropicStatus({ isValid: null, isChecking: true })

    try {
      // Import Anthropic SDK dynamically
      const Anthropic = (await import('@anthropic-ai/sdk')).default
      const client = new Anthropic({ apiKey: anthropicKey, dangerouslyAllowBrowser: true })
      await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'test' }],
      })
      setAnthropicStatus({ isValid: true, isChecking: false })
    } catch {
      setAnthropicStatus({ isValid: false, isChecking: false })
    }
  }

  const renderStatusIcon = (status: ProviderStatus, testId: string) => {
    if (status.isChecking) {
      return <Loader2 data-testid={testId} className="w-4 h-4 animate-spin text-zinc-400" />
    }
    if (status.isValid === true) {
      return <CheckCircle data-testid={testId} className="w-4 h-4 text-green-400" />
    }
    if (status.isValid === false) {
      return <AlertCircle data-testid={testId} className="w-4 h-4 text-red-400" />
    }
    return null
  }

  if (!isOpen) return null

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        data-testid="settings-modal"
        className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl p-6"
      >
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <Key className="w-5 h-5 text-indigo-400" />
            API Configuration
          </h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-6">
          {/* Gemini API Key */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-zinc-400">
                Gemini API Key (Google)
              </label>
              <div className="flex items-center gap-2">
                {renderStatusIcon(geminiStatus, 'gemini-status')}
                <button
                  onClick={validateGeminiKey}
                  disabled={!geminiKey || geminiStatus.isChecking}
                  className="text-xs text-indigo-400 hover:text-indigo-300 disabled:text-zinc-600 disabled:cursor-not-allowed"
                >
                  Validate
                </button>
              </div>
            </div>
            <input
              data-testid="gemini-key-input"
              type="password"
              value={geminiKey}
              onChange={e => {
                setGeminiKey(e.target.value)
                setGeminiStatus({ isValid: null, isChecking: false })
              }}
              placeholder="Enter your Gemini API key..."
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
            />
            <p className="mt-1 text-xs text-zinc-500">
              Large context window (2M tokens), cost-effective. May block copyrighted content.
            </p>
          </div>

          {/* Anthropic API Key */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-zinc-400">
                Anthropic API Key (Claude)
              </label>
              <div className="flex items-center gap-2">
                {renderStatusIcon(anthropicStatus, 'anthropic-status')}
                <button
                  onClick={validateAnthropicKey}
                  disabled={!anthropicKey || anthropicStatus.isChecking}
                  className="text-xs text-indigo-400 hover:text-indigo-300 disabled:text-zinc-600 disabled:cursor-not-allowed"
                >
                  Validate
                </button>
              </div>
            </div>
            <input
              data-testid="anthropic-key-input"
              type="password"
              value={anthropicKey}
              onChange={e => {
                setAnthropicKey(e.target.value)
                setAnthropicStatus({ isValid: null, isChecking: false })
              }}
              placeholder="Enter your Anthropic API key..."
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
            />
            <p className="mt-1 text-xs text-zinc-500">
              Native PDF support, better structure extraction. No content blocking.
            </p>
          </div>

          <div className="border-t border-zinc-800 pt-4">
            <p className="text-xs text-zinc-500 mb-4">
              Your keys are stored securely on your local device using encrypted storage. At least
              one API key is required for document conversion.
            </p>

            <div className="flex justify-end gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-zinc-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                data-testid="save-settings"
                onClick={handleSave}
                disabled={isLoading || (!geminiKey && !anthropicKey)}
                className={`
                  flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all
                  ${
                  isSaved
                    ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                    : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                }
                  disabled:opacity-50 disabled:cursor-not-allowed
                `}
              >
                {isLoading
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : isSaved
                  ? <>Saved!</>
                  : (
                    <>
                      <Save className="w-4 h-4" />
                      Save Keys
                    </>
                  )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
