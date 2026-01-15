/**
 * LLM Provider module exports.
 * Provides unified access to multiple LLM providers (Claude, Gemini).
 */

// Types
export type {
  ClaudeProviderConfig,
  DocumentAnalysis,
  DocumentStructure,
  GeminiProviderConfig,
  HeadingInfo,
  ImageInfo,
  LLMProvider,
  PageContext,
  PageConversionResult,
  ProviderCapabilities,
  ProviderConfig,
  ProviderFactory,
  ProviderType,
  SectionInfo,
  WindowContext,
  WindowResult,
  WindowSpec,
} from './types'

// Providers
export { ClaudeProvider } from './claude-provider'
export { GeminiProvider } from './gemini-provider'

// Registry
export {
  getCurrentProvider,
  getProvider,
  getProviderRegistry,
  type ProviderInfo,
  ProviderRegistry,
  type ProviderRegistryConfig,
} from './provider-registry'

// Factory function for creating providers
import { ClaudeProvider } from './claude-provider'
import { GeminiProvider } from './gemini-provider'
import type {
  ClaudeProviderConfig,
  GeminiProviderConfig,
  LLMProvider,
  ProviderConfig,
  ProviderType,
} from './types'

/**
 * Create an LLM provider instance.
 * @param type - Provider type ('claude' or 'gemini')
 * @param config - Provider configuration with API key
 * @returns Provider instance
 */
export function createProvider(type: ProviderType, config: ProviderConfig): LLMProvider {
  switch (type) {
    case 'claude':
      return new ClaudeProvider(config as ClaudeProviderConfig)
    case 'gemini':
      return new GeminiProvider(config as GeminiProviderConfig)
    default:
      throw new Error(`Unknown provider type: ${type}`)
  }
}

/**
 * Get all supported provider types.
 */
export function getSupportedProviderTypes(): ProviderType[] {
  return ['claude', 'gemini']
}
