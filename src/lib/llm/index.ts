/**
 * LLM Provider module exports.
 * Provides unified access to multiple LLM providers (Claude, Gemini).
 */

// Types
export type {
  LLMProvider,
  ProviderCapabilities,
  ProviderConfig,
  ClaudeProviderConfig,
  GeminiProviderConfig,
  ProviderType,
  ProviderFactory,
  DocumentAnalysis,
  DocumentStructure,
  HeadingInfo,
  SectionInfo,
  PageContext,
  PageConversionResult,
  WindowContext,
  WindowResult,
  WindowSpec,
  ImageInfo,
} from './types';

// Providers
export { ClaudeProvider } from './claude-provider';
export { GeminiProvider } from './gemini-provider';

// Registry
export {
  ProviderRegistry,
  getProviderRegistry,
  getProvider,
  getCurrentProvider,
  type ProviderRegistryConfig,
  type ProviderInfo,
} from './provider-registry';

// Factory function for creating providers
import type { LLMProvider, ProviderType, ProviderConfig } from './types';
import { ClaudeProvider } from './claude-provider';
import { GeminiProvider } from './gemini-provider';

/**
 * Create an LLM provider instance.
 * @param type - Provider type ('claude' or 'gemini')
 * @param config - Provider configuration with API key
 * @returns Provider instance
 */
export function createProvider(type: ProviderType, config: ProviderConfig): LLMProvider {
  switch (type) {
    case 'claude':
      return new ClaudeProvider(config);
    case 'gemini':
      return new GeminiProvider(config);
    default:
      throw new Error(`Unknown provider type: ${type}`);
  }
}

/**
 * Get all supported provider types.
 */
export function getSupportedProviderTypes(): ProviderType[] {
  return ['claude', 'gemini'];
}
