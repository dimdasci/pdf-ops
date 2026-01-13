/**
 * Provider Registry for managing available LLM providers.
 * Handles API key storage and provider instantiation.
 */

import type {
  LLMProvider,
  ProviderType,
  ProviderConfig,
  ClaudeProviderConfig,
  GeminiProviderConfig,
} from './types';
import { ClaudeProvider } from './claude-provider';
import { GeminiProvider } from './gemini-provider';

export interface ProviderRegistryConfig {
  /** Anthropic API key for Claude */
  anthropicApiKey?: string;
  /** Google API key for Gemini */
  geminiApiKey?: string;
}

export interface ProviderInfo {
  /** Provider type identifier */
  type: ProviderType;
  /** Display name for UI */
  displayName: string;
  /** Whether provider is configured (has API key) */
  isConfigured: boolean;
  /** Provider capabilities summary */
  capabilities: {
    supportsNativePdf: boolean;
    maxPdfPages: number;
    hasRecitationFilter: boolean;
  };
}

/**
 * Registry for managing LLM providers.
 * Singleton pattern - use getInstance() to get the registry.
 */
export class ProviderRegistry {
  private static instance: ProviderRegistry | null = null;

  private config: ProviderRegistryConfig;
  private providers: Map<ProviderType, LLMProvider> = new Map();
  private currentProviderType: ProviderType | null = null;

  private constructor(config: ProviderRegistryConfig = {}) {
    this.config = config;
  }

  /**
   * Get the singleton instance of the registry.
   */
  static getInstance(config?: ProviderRegistryConfig): ProviderRegistry {
    if (!ProviderRegistry.instance) {
      ProviderRegistry.instance = new ProviderRegistry(config);
    } else if (config) {
      ProviderRegistry.instance.updateConfig(config);
    }
    return ProviderRegistry.instance;
  }

  /**
   * Reset the singleton instance (for testing).
   */
  static resetInstance(): void {
    ProviderRegistry.instance = null;
  }

  /**
   * Update the configuration with new API keys.
   */
  updateConfig(config: Partial<ProviderRegistryConfig>): void {
    this.config = { ...this.config, ...config };
    // Clear cached providers when config changes
    this.providers.clear();
  }

  /**
   * Get list of all supported provider types.
   */
  getSupportedProviders(): ProviderType[] {
    return ['claude', 'gemini'];
  }

  /**
   * Get list of configured provider types (those with API keys).
   */
  getConfiguredProviders(): ProviderType[] {
    const configured: ProviderType[] = [];

    if (this.config.anthropicApiKey) {
      configured.push('claude');
    }
    if (this.config.geminiApiKey) {
      configured.push('gemini');
    }

    return configured;
  }

  /**
   * Get detailed information about all providers.
   */
  getProviderInfo(): ProviderInfo[] {
    return [
      {
        type: 'claude',
        displayName: 'Claude (Anthropic)',
        isConfigured: !!this.config.anthropicApiKey,
        capabilities: {
          supportsNativePdf: true,
          maxPdfPages: 100,
          hasRecitationFilter: false,
        },
      },
      {
        type: 'gemini',
        displayName: 'Gemini (Google)',
        isConfigured: !!this.config.geminiApiKey,
        capabilities: {
          supportsNativePdf: false,
          maxPdfPages: Infinity,
          hasRecitationFilter: true,
        },
      },
    ];
  }

  /**
   * Check if a specific provider is configured.
   */
  isProviderConfigured(type: ProviderType): boolean {
    switch (type) {
      case 'claude':
        return !!this.config.anthropicApiKey;
      case 'gemini':
        return !!this.config.geminiApiKey;
      default:
        return false;
    }
  }

  /**
   * Get or create a provider instance.
   */
  getProvider(type: ProviderType): LLMProvider {
    // Check if provider is configured
    if (!this.isProviderConfigured(type)) {
      throw new Error(`Provider "${type}" is not configured. Please add the API key in settings.`);
    }

    // Return cached provider if available
    if (this.providers.has(type)) {
      return this.providers.get(type)!;
    }

    // Create new provider
    const provider = this.createProvider(type);
    this.providers.set(type, provider);
    return provider;
  }

  /**
   * Get the currently selected provider.
   */
  getCurrentProvider(): LLMProvider | null {
    if (!this.currentProviderType) {
      // Auto-select first configured provider
      const configured = this.getConfiguredProviders();
      if (configured.length > 0) {
        this.currentProviderType = configured[0];
      }
    }

    if (this.currentProviderType) {
      return this.getProvider(this.currentProviderType);
    }

    return null;
  }

  /**
   * Get the current provider type.
   */
  getCurrentProviderType(): ProviderType | null {
    return this.currentProviderType;
  }

  /**
   * Set the current provider type.
   */
  setCurrentProvider(type: ProviderType): void {
    if (!this.isProviderConfigured(type)) {
      throw new Error(`Provider "${type}" is not configured. Please add the API key in settings.`);
    }
    this.currentProviderType = type;
  }

  /**
   * Validate a provider's API key by attempting a connection.
   */
  async validateProvider(type: ProviderType): Promise<boolean> {
    try {
      const provider = this.getProvider(type);
      return await provider.validateConnection();
    } catch {
      return false;
    }
  }

  /**
   * Get the best provider for a given document.
   * Considers document characteristics and provider capabilities.
   */
  getBestProviderFor(options: {
    pageCount: number;
    hasCopyrightedContent?: boolean;
    preferNativePdf?: boolean;
  }): ProviderType | null {
    const configured = this.getConfiguredProviders();
    if (configured.length === 0) {
      return null;
    }

    // If only one provider is configured, use it
    if (configured.length === 1) {
      return configured[0];
    }

    // Prefer Claude for:
    // - Documents with potential copyrighted content (Gemini has RECITATION)
    // - Documents where native PDF support is preferred
    // - Documents under 100 pages
    if (configured.includes('claude')) {
      if (options.hasCopyrightedContent) {
        return 'claude';
      }
      if (options.preferNativePdf && options.pageCount <= 100) {
        return 'claude';
      }
    }

    // Prefer Gemini for:
    // - Very large documents (>100 pages)
    // - Cost-sensitive batch processing
    if (configured.includes('gemini')) {
      if (options.pageCount > 100) {
        return 'gemini';
      }
    }

    // Default to Claude if available, otherwise Gemini
    return configured.includes('claude') ? 'claude' : 'gemini';
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private createProvider(type: ProviderType): LLMProvider {
    switch (type) {
      case 'claude':
        return new ClaudeProvider({
          apiKey: this.config.anthropicApiKey!,
        } as ClaudeProviderConfig);

      case 'gemini':
        return new GeminiProvider({
          apiKey: this.config.geminiApiKey!,
        } as GeminiProviderConfig);

      default:
        throw new Error(`Unknown provider type: ${type}`);
    }
  }
}

/**
 * Convenience function to get the registry instance.
 */
export function getProviderRegistry(config?: ProviderRegistryConfig): ProviderRegistry {
  return ProviderRegistry.getInstance(config);
}

/**
 * Convenience function to get a provider.
 */
export function getProvider(type: ProviderType): LLMProvider {
  return ProviderRegistry.getInstance().getProvider(type);
}

/**
 * Convenience function to get the current provider.
 */
export function getCurrentProvider(): LLMProvider | null {
  return ProviderRegistry.getInstance().getCurrentProvider();
}
