/**
 * Provider Registry for managing available LLM providers.
 * Handles API key storage and provider instantiation.
 *
 * This module provides both:
 * 1. Legacy singleton pattern (ProviderRegistry.getInstance()) for non-Effect code
 * 2. Effect-based API (ProviderRegistryService) for Effect pipelines
 */

import { Context, Effect, Layer, Ref } from 'effect'

import { ClaudeProvider } from './claude-provider'
import { GeminiProvider } from './gemini-provider'
import type { ClaudeProviderConfig, GeminiProviderConfig, LLMProvider, ProviderType } from './types'
import { ProviderNotConfiguredError } from './types'

export interface ProviderRegistryConfig {
  /** Anthropic API key for Claude */
  anthropicApiKey?: string
  /** Google API key for Gemini */
  geminiApiKey?: string
}

export interface ProviderInfo {
  /** Provider type identifier */
  type: ProviderType
  /** Display name for UI */
  displayName: string
  /** Whether provider is configured (has API key) */
  isConfigured: boolean
  /** Provider capabilities summary */
  capabilities: {
    supportsNativePdf: boolean
    maxPdfPages: number
    hasRecitationFilter: boolean
  }
}

/**
 * Registry for managing LLM providers.
 * Singleton pattern - use getInstance() to get the registry.
 */
export class ProviderRegistry {
  private static instance: ProviderRegistry | null = null

  private config: ProviderRegistryConfig
  private providers: Map<ProviderType, LLMProvider> = new Map()
  private currentProviderType: ProviderType | null = null

  private constructor(config: ProviderRegistryConfig = {}) {
    this.config = config
  }

  /**
   * Get the singleton instance of the registry.
   */
  static getInstance(config?: ProviderRegistryConfig): ProviderRegistry {
    if (!ProviderRegistry.instance) {
      ProviderRegistry.instance = new ProviderRegistry(config)
    } else if (config) {
      ProviderRegistry.instance.updateConfig(config)
    }
    return ProviderRegistry.instance
  }

  /**
   * Reset the singleton instance (for testing).
   */
  static resetInstance(): void {
    ProviderRegistry.instance = null
  }

  /**
   * Update the configuration with new API keys.
   */
  updateConfig(config: Partial<ProviderRegistryConfig>): void {
    this.config = { ...this.config, ...config }
    // Clear cached providers when config changes
    this.providers.clear()
  }

  /**
   * Get list of all supported provider types.
   */
  getSupportedProviders(): ProviderType[] {
    return ['claude', 'gemini']
  }

  /**
   * Get list of configured provider types (those with API keys).
   */
  getConfiguredProviders(): ProviderType[] {
    const configured: ProviderType[] = []

    if (this.config.anthropicApiKey) {
      configured.push('claude')
    }
    if (this.config.geminiApiKey) {
      configured.push('gemini')
    }

    return configured
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
    ]
  }

  /**
   * Check if a specific provider is configured.
   */
  isProviderConfigured(type: ProviderType): boolean {
    switch (type) {
      case 'claude':
        return !!this.config.anthropicApiKey
      case 'gemini':
        return !!this.config.geminiApiKey
      default:
        return false
    }
  }

  /**
   * Get or create a provider instance.
   */
  getProvider(type: ProviderType): LLMProvider {
    // Check if provider is configured
    if (!this.isProviderConfigured(type)) {
      throw new Error(`Provider "${type}" is not configured. Please add the API key in settings.`)
    }

    // Return cached provider if available
    if (this.providers.has(type)) {
      return this.providers.get(type)!
    }

    // Create new provider
    const provider = this.createProvider(type)
    this.providers.set(type, provider)
    return provider
  }

  /**
   * Get the currently selected provider.
   */
  getCurrentProvider(): LLMProvider | null {
    if (!this.currentProviderType) {
      // Auto-select first configured provider
      const configured = this.getConfiguredProviders()
      if (configured.length > 0) {
        this.currentProviderType = configured[0]
      }
    }

    if (this.currentProviderType) {
      return this.getProvider(this.currentProviderType)
    }

    return null
  }

  /**
   * Get the current provider type.
   */
  getCurrentProviderType(): ProviderType | null {
    return this.currentProviderType
  }

  /**
   * Set the current provider type.
   */
  setCurrentProvider(type: ProviderType): void {
    if (!this.isProviderConfigured(type)) {
      throw new Error(`Provider "${type}" is not configured. Please add the API key in settings.`)
    }
    this.currentProviderType = type
  }

  /**
   * Validate a provider's API key by attempting a connection.
   */
  async validateProvider(type: ProviderType): Promise<boolean> {
    try {
      const provider = this.getProvider(type)
      return await provider.validateConnection()
    } catch {
      return false
    }
  }

  /**
   * Get the best provider for a given document.
   * Considers document characteristics and provider capabilities.
   */
  getBestProviderFor(options: {
    pageCount: number
    hasCopyrightedContent?: boolean
    preferNativePdf?: boolean
  }): ProviderType | null {
    const configured = this.getConfiguredProviders()
    if (configured.length === 0) {
      return null
    }

    // If only one provider is configured, use it
    if (configured.length === 1) {
      return configured[0]
    }

    // Prefer Claude for:
    // - Documents with potential copyrighted content (Gemini has RECITATION)
    // - Documents where native PDF support is preferred
    // - Documents under 100 pages
    if (configured.includes('claude')) {
      if (options.hasCopyrightedContent) {
        return 'claude'
      }
      if (options.preferNativePdf && options.pageCount <= 100) {
        return 'claude'
      }
    }

    // Prefer Gemini for:
    // - Very large documents (>100 pages)
    // - Cost-sensitive batch processing
    if (configured.includes('gemini')) {
      if (options.pageCount > 100) {
        return 'gemini'
      }
    }

    // Default to Claude if available, otherwise Gemini
    return configured.includes('claude') ? 'claude' : 'gemini'
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private createProvider(type: ProviderType): LLMProvider {
    switch (type) {
      case 'claude':
        return new ClaudeProvider({
          apiKey: this.config.anthropicApiKey!,
        } as ClaudeProviderConfig)

      case 'gemini':
        return new GeminiProvider({
          apiKey: this.config.geminiApiKey!,
        } as GeminiProviderConfig)

      default:
        throw new Error(`Unknown provider type: ${type}`)
    }
  }
}

/**
 * Convenience function to get the registry instance.
 */
export function getProviderRegistry(config?: ProviderRegistryConfig): ProviderRegistry {
  return ProviderRegistry.getInstance(config)
}

/**
 * Convenience function to get a provider.
 */
export function getProvider(type: ProviderType): LLMProvider {
  return ProviderRegistry.getInstance().getProvider(type)
}

/**
 * Convenience function to get the current provider.
 */
export function getCurrentProvider(): LLMProvider | null {
  return ProviderRegistry.getInstance().getCurrentProvider()
}

// =============================================================================
// Effect-Based Service API
// =============================================================================

/**
 * Service interface for ProviderRegistry in Effect context.
 * Provides type-safe dependency injection and proper error handling.
 */
export interface ProviderRegistryService {
  /** Get list of all supported provider types */
  readonly getSupportedProviders: () => ProviderType[]

  /** Get list of configured provider types (those with API keys) */
  readonly getConfiguredProviders: () => ProviderType[]

  /** Get detailed information about all providers */
  readonly getProviderInfo: () => ProviderInfo[]

  /** Check if a specific provider is configured */
  readonly isProviderConfigured: (type: ProviderType) => boolean

  /** Get or create a provider instance */
  readonly getProvider: (
    type: ProviderType,
  ) => Effect.Effect<LLMProvider, ProviderNotConfiguredError>

  /** Get the currently selected provider */
  readonly getCurrentProvider: () => Effect.Effect<LLMProvider, ProviderNotConfiguredError>

  /** Get the current provider type */
  readonly getCurrentProviderType: () => ProviderType | null

  /** Set the current provider type */
  readonly setCurrentProvider: (
    type: ProviderType,
  ) => Effect.Effect<void, ProviderNotConfiguredError>

  /** Validate a provider's API key by attempting a connection */
  readonly validateProvider: (type: ProviderType) => Effect.Effect<boolean>

  /** Get the best provider for a given document */
  readonly getBestProviderFor: (options: {
    pageCount: number
    hasCopyrightedContent?: boolean
    preferNativePdf?: boolean
  }) => ProviderType | null

  /** Update configuration with new API keys */
  readonly updateConfig: (config: Partial<ProviderRegistryConfig>) => Effect.Effect<void>
}

/**
 * Effect Context.Tag for ProviderRegistry service.
 * Use this to declare ProviderRegistry as a dependency in Effect programs.
 *
 * @example
 * ```typescript
 * const program = Effect.gen(function*() {
 *   const registry = yield* ProviderRegistryTag
 *   const provider = yield* registry.getProvider('claude')
 *   // ...
 * })
 *
 * // Provide the layer
 * program.pipe(Effect.provide(ProviderRegistryTag.Default))
 * ```
 */
export class ProviderRegistryTag extends Context.Tag('ProviderRegistry')<
  ProviderRegistryTag,
  ProviderRegistryService
>() {
  /**
   * Default layer using an in-memory configuration store.
   * Useful for testing or when config is managed externally.
   */
  static readonly Default = Layer.effect(
    ProviderRegistryTag,
    Effect.gen(function*() {
      const configRef = yield* Ref.make<ProviderRegistryConfig>({})
      const providersRef = yield* Ref.make<Map<ProviderType, LLMProvider>>(new Map())
      const currentProviderRef = yield* Ref.make<ProviderType | null>(null)

      const isProviderConfigured = (type: ProviderType): Effect.Effect<boolean> =>
        Effect.gen(function*() {
          const config = yield* Ref.get(configRef)
          switch (type) {
            case 'claude':
              return !!config.anthropicApiKey
            case 'gemini':
              return !!config.geminiApiKey
            default:
              return false
          }
        })

      const createProvider = (type: ProviderType): Effect.Effect<LLMProvider> =>
        Effect.gen(function*() {
          const config = yield* Ref.get(configRef)
          switch (type) {
            case 'claude':
              return new ClaudeProvider({
                apiKey: config.anthropicApiKey!,
              } as ClaudeProviderConfig)
            case 'gemini':
              return new GeminiProvider({
                apiKey: config.geminiApiKey!,
              } as GeminiProviderConfig)
            default:
              return yield* Effect.die(`Unknown provider type: ${type}`)
          }
        })

      const service: ProviderRegistryService = {
        getSupportedProviders: () => ['claude', 'gemini'],

        getConfiguredProviders: () => {
          // This is synchronous for backwards compatibility
          // Use Effect.runSync internally
          const config = Effect.runSync(Ref.get(configRef))
          const configured: ProviderType[] = []
          if (config.anthropicApiKey) configured.push('claude')
          if (config.geminiApiKey) configured.push('gemini')
          return configured
        },

        getProviderInfo: () => {
          const config = Effect.runSync(Ref.get(configRef))
          return [
            {
              type: 'claude' as ProviderType,
              displayName: 'Claude (Anthropic)',
              isConfigured: !!config.anthropicApiKey,
              capabilities: {
                supportsNativePdf: true,
                maxPdfPages: 100,
                hasRecitationFilter: false,
              },
            },
            {
              type: 'gemini' as ProviderType,
              displayName: 'Gemini (Google)',
              isConfigured: !!config.geminiApiKey,
              capabilities: {
                supportsNativePdf: false,
                maxPdfPages: Infinity,
                hasRecitationFilter: true,
              },
            },
          ]
        },

        isProviderConfigured: type => Effect.runSync(isProviderConfigured(type)),

        getProvider: type =>
          Effect.gen(function*() {
            const configured = yield* isProviderConfigured(type)
            if (!configured) {
              return yield* Effect.fail(
                new ProviderNotConfiguredError({
                  message:
                    `Provider "${type}" is not configured. Please add the API key in settings.`,
                  providerType: type,
                }),
              )
            }

            const providers = yield* Ref.get(providersRef)
            if (providers.has(type)) {
              return providers.get(type)!
            }

            const provider = yield* createProvider(type)
            yield* Ref.update(providersRef, m => new Map(m).set(type, provider))
            return provider
          }),

        getCurrentProvider: () =>
          Effect.gen(function*() {
            let currentType = yield* Ref.get(currentProviderRef)

            if (!currentType) {
              // Auto-select first configured provider
              const configured = service.getConfiguredProviders()
              if (configured.length > 0) {
                currentType = configured[0]
                yield* Ref.set(currentProviderRef, currentType)
              }
            }

            if (!currentType) {
              return yield* Effect.fail(
                new ProviderNotConfiguredError({
                  message: 'No provider is configured. Please add an API key in settings.',
                  providerType: 'none',
                }),
              )
            }

            return yield* service.getProvider(currentType)
          }),

        getCurrentProviderType: () => Effect.runSync(Ref.get(currentProviderRef)),

        setCurrentProvider: type =>
          Effect.gen(function*() {
            const configured = yield* isProviderConfigured(type)
            if (!configured) {
              return yield* Effect.fail(
                new ProviderNotConfiguredError({
                  message:
                    `Provider "${type}" is not configured. Please add the API key in settings.`,
                  providerType: type,
                }),
              )
            }
            yield* Ref.set(currentProviderRef, type)
          }),

        validateProvider: type =>
          Effect.gen(function*() {
            const providerResult = yield* Effect.either(service.getProvider(type))
            if (providerResult._tag === 'Left') {
              return false
            }
            return yield* Effect.tryPromise({
              try: () => providerResult.right.validateConnection(),
              catch: () => false,
            }).pipe(Effect.catchAll(() => Effect.succeed(false)))
          }),

        getBestProviderFor: options => {
          const configured = service.getConfiguredProviders()
          if (configured.length === 0) return null
          if (configured.length === 1) return configured[0]

          // Prefer Claude for copyrighted content and native PDF
          if (configured.includes('claude')) {
            if (options.hasCopyrightedContent) return 'claude'
            if (options.preferNativePdf && options.pageCount <= 100) return 'claude'
          }

          // Prefer Gemini for large documents
          if (configured.includes('gemini')) {
            if (options.pageCount > 100) return 'gemini'
          }

          return configured.includes('claude') ? 'claude' : 'gemini'
        },

        updateConfig: newConfig =>
          Effect.gen(function*() {
            yield* Ref.update(configRef, c => ({ ...c, ...newConfig }))
            // Clear cached providers when config changes
            yield* Ref.set(providersRef, new Map())
          }),
      }

      return service
    }),
  )

  /**
   * Create a layer with initial configuration.
   */
  static readonly make = (config: ProviderRegistryConfig) =>
    Layer.effect(
      ProviderRegistryTag,
      Effect.gen(function*() {
        const configRef = yield* Ref.make<ProviderRegistryConfig>(config)
        const providersRef = yield* Ref.make<Map<ProviderType, LLMProvider>>(new Map())
        const currentProviderRef = yield* Ref.make<ProviderType | null>(null)

        const isProviderConfigured = (type: ProviderType): Effect.Effect<boolean> =>
          Effect.gen(function*() {
            const cfg = yield* Ref.get(configRef)
            switch (type) {
              case 'claude':
                return !!cfg.anthropicApiKey
              case 'gemini':
                return !!cfg.geminiApiKey
              default:
                return false
            }
          })

        const createProvider = (type: ProviderType): Effect.Effect<LLMProvider> =>
          Effect.gen(function*() {
            const cfg = yield* Ref.get(configRef)
            switch (type) {
              case 'claude':
                return new ClaudeProvider({
                  apiKey: cfg.anthropicApiKey!,
                } as ClaudeProviderConfig)
              case 'gemini':
                return new GeminiProvider({
                  apiKey: cfg.geminiApiKey!,
                } as GeminiProviderConfig)
              default:
                return yield* Effect.die(`Unknown provider type: ${type}`)
            }
          })

        const service: ProviderRegistryService = {
          getSupportedProviders: () => ['claude', 'gemini'],

          getConfiguredProviders: () => {
            const cfg = Effect.runSync(Ref.get(configRef))
            const configured: ProviderType[] = []
            if (cfg.anthropicApiKey) configured.push('claude')
            if (cfg.geminiApiKey) configured.push('gemini')
            return configured
          },

          getProviderInfo: () => {
            const cfg = Effect.runSync(Ref.get(configRef))
            return [
              {
                type: 'claude' as ProviderType,
                displayName: 'Claude (Anthropic)',
                isConfigured: !!cfg.anthropicApiKey,
                capabilities: {
                  supportsNativePdf: true,
                  maxPdfPages: 100,
                  hasRecitationFilter: false,
                },
              },
              {
                type: 'gemini' as ProviderType,
                displayName: 'Gemini (Google)',
                isConfigured: !!cfg.geminiApiKey,
                capabilities: {
                  supportsNativePdf: false,
                  maxPdfPages: Infinity,
                  hasRecitationFilter: true,
                },
              },
            ]
          },

          isProviderConfigured: type => Effect.runSync(isProviderConfigured(type)),

          getProvider: type =>
            Effect.gen(function*() {
              const configured = yield* isProviderConfigured(type)
              if (!configured) {
                return yield* Effect.fail(
                  new ProviderNotConfiguredError({
                    message:
                      `Provider "${type}" is not configured. Please add the API key in settings.`,
                    providerType: type,
                  }),
                )
              }

              const providers = yield* Ref.get(providersRef)
              if (providers.has(type)) {
                return providers.get(type)!
              }

              const provider = yield* createProvider(type)
              yield* Ref.update(providersRef, m => new Map(m).set(type, provider))
              return provider
            }),

          getCurrentProvider: () =>
            Effect.gen(function*() {
              let currentType = yield* Ref.get(currentProviderRef)

              if (!currentType) {
                const configured = service.getConfiguredProviders()
                if (configured.length > 0) {
                  currentType = configured[0]
                  yield* Ref.set(currentProviderRef, currentType)
                }
              }

              if (!currentType) {
                return yield* Effect.fail(
                  new ProviderNotConfiguredError({
                    message: 'No provider is configured. Please add an API key in settings.',
                    providerType: 'none',
                  }),
                )
              }

              return yield* service.getProvider(currentType)
            }),

          getCurrentProviderType: () => Effect.runSync(Ref.get(currentProviderRef)),

          setCurrentProvider: type =>
            Effect.gen(function*() {
              const configured = yield* isProviderConfigured(type)
              if (!configured) {
                return yield* Effect.fail(
                  new ProviderNotConfiguredError({
                    message:
                      `Provider "${type}" is not configured. Please add the API key in settings.`,
                    providerType: type,
                  }),
                )
              }
              yield* Ref.set(currentProviderRef, type)
            }),

          validateProvider: type =>
            Effect.gen(function*() {
              const providerResult = yield* Effect.either(service.getProvider(type))
              if (providerResult._tag === 'Left') {
                return false
              }
              return yield* Effect.tryPromise({
                try: () => providerResult.right.validateConnection(),
                catch: () => false,
              }).pipe(Effect.catchAll(() => Effect.succeed(false)))
            }),

          getBestProviderFor: options => {
            const configured = service.getConfiguredProviders()
            if (configured.length === 0) return null
            if (configured.length === 1) return configured[0]

            if (configured.includes('claude')) {
              if (options.hasCopyrightedContent) return 'claude'
              if (options.preferNativePdf && options.pageCount <= 100) return 'claude'
            }

            if (configured.includes('gemini')) {
              if (options.pageCount > 100) return 'gemini'
            }

            return configured.includes('claude') ? 'claude' : 'gemini'
          },

          updateConfig: newConfig =>
            Effect.gen(function*() {
              yield* Ref.update(configRef, c => ({ ...c, ...newConfig }))
              yield* Ref.set(providersRef, new Map())
            }),
        }

        return service
      }),
    )

  /**
   * Create a layer from the existing legacy singleton.
   * Useful for gradual migration of existing code.
   */
  static readonly fromLegacy = (config?: ProviderRegistryConfig) =>
    Layer.sync(ProviderRegistryTag, () => {
      const registry = ProviderRegistry.getInstance(config)

      const service: ProviderRegistryService = {
        getSupportedProviders: () => registry.getSupportedProviders(),
        getConfiguredProviders: () => registry.getConfiguredProviders(),
        getProviderInfo: () => registry.getProviderInfo(),
        isProviderConfigured: type => registry.isProviderConfigured(type),

        getProvider: type =>
          Effect.try({
            try: () => registry.getProvider(type),
            catch: e =>
              new ProviderNotConfiguredError({
                message: (e as Error).message,
                providerType: type,
              }),
          }),

        getCurrentProvider: () =>
          Effect.gen(function*() {
            const provider = registry.getCurrentProvider()
            if (!provider) {
              return yield* Effect.fail(
                new ProviderNotConfiguredError({
                  message: 'No provider is configured. Please add an API key in settings.',
                  providerType: 'none',
                }),
              )
            }
            return provider
          }),

        getCurrentProviderType: () => registry.getCurrentProviderType(),

        setCurrentProvider: type =>
          Effect.try({
            try: () => registry.setCurrentProvider(type),
            catch: e =>
              new ProviderNotConfiguredError({
                message: (e as Error).message,
                providerType: type,
              }),
          }),

        validateProvider: type =>
          Effect.tryPromise({
            try: () => registry.validateProvider(type),
            catch: () => false,
          }).pipe(Effect.catchAll(() => Effect.succeed(false))),

        getBestProviderFor: options => registry.getBestProviderFor(options),

        updateConfig: newConfig => Effect.sync(() => registry.updateConfig(newConfig)),
      }

      return service
    })
}
