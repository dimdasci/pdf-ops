/**
 * E2E Tests for New Pipeline Architecture
 *
 * Tests the complexity classifier, adaptive pipeline selection,
 * and multi-provider support.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ClaudeProvider } from '../../src/lib/llm/claude-provider'
import { GeminiProvider } from '../../src/lib/llm/gemini-provider'
import type { LLMProvider } from '../../src/lib/llm/types'
import { createPdfService, type PdfService } from '../../src/lib/pdf-service'
import {
  classifyDocumentComplexity,
  type ConversionResult,
  convertDocument,
  convertDocumentRobust,
  type DocumentComplexity,
} from '../../src/lib/pipeline'
import { type Fixture, loadFixture } from '../utils/fixture-loader'
import { validateFormat } from '../utils/format-validator'

// ============================================================================
// Test Configuration
// ============================================================================

// Provider selection based on PROVIDER env var
const selectedProvider = process.env.PROVIDER?.toLowerCase() || 'gemini'
const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

// Check if we have the required API key for the selected provider
const hasRequiredKey = selectedProvider === 'claude'
  ? !!ANTHROPIC_API_KEY
  : !!GEMINI_API_KEY

// Skip tests if no API key for the selected provider
const describeWithKey = hasRequiredKey ? describe : describe.skip

// ============================================================================
// Complexity Classifier Tests
// ============================================================================

describe('Complexity Classifier', () => {
  describe('Simple document (4 pages)', () => {
    let pdfService: PdfService
    let complexity: DocumentComplexity

    beforeAll(async () => {
      const fixture = await loadFixture('arxiv-roadmap')
      pdfService = await createPdfService(fixture.pdfBuffer, 'node')
      complexity = await classifyDocumentComplexity(pdfService)
    })

    afterAll(() => {
      pdfService?.destroy()
    })

    it('classifies as simple or moderate complexity', () => {
      console.log('\n--- Complexity Analysis (arxiv-roadmap) ---')
      console.log('Level:', complexity.level)
      console.log('Score:', complexity.score)
      console.log('Recommended pipeline:', complexity.recommendedPipeline)
      console.log('Reasoning:', complexity.reasoning)

      // Small document should be classified as simple or moderate
      expect(['simple', 'moderate']).toContain(complexity.level)
    })

    it('recommends direct or light pipeline', () => {
      expect(['direct', 'light']).toContain(complexity.recommendedPipeline)
    })

    it('provides valid factors', () => {
      expect(complexity.factors.pageCount).toBe(4)
      expect(complexity.factors.textDensity).toBeDefined()
      expect(complexity.factors.structureDepth).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Medium document (10 pages)', () => {
    let pdfService: PdfService
    let complexity: DocumentComplexity

    beforeAll(async () => {
      const fixture = await loadFixture('arxiv-guidelines')
      pdfService = await createPdfService(fixture.pdfBuffer, 'node')
      complexity = await classifyDocumentComplexity(pdfService)
    })

    afterAll(() => {
      pdfService?.destroy()
    })

    it('classifies complexity appropriately', () => {
      console.log('\n--- Complexity Analysis (arxiv-guidelines) ---')
      console.log('Level:', complexity.level)
      console.log('Score:', complexity.score)
      console.log('Recommended pipeline:', complexity.recommendedPipeline)

      // Medium document typically moderate
      expect(complexity.factors.pageCount).toBe(10)
    })

    it('provides reasonable time estimate', () => {
      expect(complexity.estimatedTimeSeconds).toBeGreaterThan(0)
      expect(complexity.estimatedTimeSeconds).toBeLessThan(600) // Less than 10 minutes
    })
  })

  describe('Large document (55 pages)', () => {
    let pdfService: PdfService
    let complexity: DocumentComplexity

    beforeAll(async () => {
      const fixture = await loadFixture('kindle-manual')
      pdfService = await createPdfService(fixture.pdfBuffer, 'node')
      complexity = await classifyDocumentComplexity(pdfService)
    })

    afterAll(() => {
      pdfService?.destroy()
    })

    it('classifies as moderate or complex', () => {
      console.log('\n--- Complexity Analysis (kindle-manual) ---')
      console.log('Level:', complexity.level)
      console.log('Score:', complexity.score)
      console.log('Recommended pipeline:', complexity.recommendedPipeline)
      console.log('Factors:', complexity.factors)

      // Large document should be moderate or complex
      expect(['moderate', 'complex']).toContain(complexity.level)
    })

    it('detects embedded TOC if present', () => {
      // kindle-manual has an embedded TOC
      console.log('Has embedded TOC:', complexity.factors.hasEmbeddedTOC)
      // This is informational - we don't assert on TOC presence
    })
  })
})

// ============================================================================
// Pipeline Conversion Tests
// ============================================================================

describeWithKey('Pipeline Conversion', () => {
  let provider: LLMProvider

  beforeAll(() => {
    if (selectedProvider === 'claude') {
      provider = new ClaudeProvider({ apiKey: ANTHROPIC_API_KEY! })
      console.log('\n🤖 Using Claude provider for pipeline tests\n')
    } else {
      provider = new GeminiProvider(GEMINI_API_KEY!)
      console.log('\n🤖 Using Gemini provider for pipeline tests\n')
    }
  })

  describe('Direct Pipeline (simple document)', () => {
    let fixture: Fixture
    let pdfService: PdfService
    let result: ConversionResult

    beforeAll(async () => {
      fixture = await loadFixture('arxiv-roadmap')
      pdfService = await createPdfService(fixture.pdfBuffer, 'node')

      // Force direct pipeline for testing
      result = await convertDocument(pdfService, provider, {
        forcePipeline: 'direct',
        onProgress: (status, current, total) => {
          console.log(`[Direct] ${status} (${current}/${total})`)
        },
      })
    }, 180000) // 3 minute timeout

    afterAll(() => {
      pdfService?.destroy()
    })

    it('produces valid markdown', () => {
      expect(result.markdown).toBeTruthy()
      expect(result.markdown.length).toBeGreaterThan(100)

      const formatResult = validateFormat(result.markdown)
      expect(formatResult.parseable).toBe(true)
    })

    it('returns correct metadata', () => {
      expect(result.metadata.pageCount).toBe(4)
      expect(result.metadata.pipeline).toBe('direct')
    })

    it('returns page contents', () => {
      expect(result.contents).toHaveLength(4)
      expect(result.contents.every(c => typeof c === 'string')).toBe(true)
    })
  })

  describe('Light Pipeline (medium document)', () => {
    let fixture: Fixture
    let pdfService: PdfService
    let result: ConversionResult

    beforeAll(async () => {
      fixture = await loadFixture('arxiv-guidelines')
      pdfService = await createPdfService(fixture.pdfBuffer, 'node')

      // Force light pipeline for testing
      result = await convertDocument(pdfService, provider, {
        forcePipeline: 'light',
        onProgress: (status, current, total) => {
          console.log(`[Light] ${status} (${current}/${total})`)
        },
      })
    }, 300000) // 5 minute timeout

    afterAll(() => {
      pdfService?.destroy()
    })

    it('produces valid markdown', () => {
      expect(result.markdown).toBeTruthy()

      const formatResult = validateFormat(result.markdown)
      expect(formatResult.parseable).toBe(true)
    })

    it('returns correct metadata', () => {
      expect(result.metadata.pageCount).toBe(10)
      expect(result.metadata.pipeline).toBe('light')
    })

    it('extracts document structure', () => {
      // Light pipeline extracts structure
      if (result.structure) {
        console.log('Structure headings:', result.structure.headings.length)
        expect(result.structure.headings).toBeDefined()
      }
    })
  })

  describe('Adaptive Pipeline (automatic selection)', () => {
    let fixture: Fixture
    let pdfService: PdfService
    let result: ConversionResult

    beforeAll(async () => {
      fixture = await loadFixture('arxiv-roadmap')
      pdfService = await createPdfService(fixture.pdfBuffer, 'node')

      // Let the pipeline select automatically
      result = await convertDocument(pdfService, provider, {
        onProgress: (status, current, total) => {
          console.log(`[Adaptive] ${status} (${current}/${total})`)
        },
      })
    }, 180000) // 3 minute timeout

    afterAll(() => {
      pdfService?.destroy()
    })

    it('selects appropriate pipeline', () => {
      console.log('\n--- Adaptive Pipeline Result ---')
      console.log('Selected pipeline:', result.metadata.pipeline)
      console.log('Complexity level:', result.metadata.complexity)

      // Should select direct or light for small document
      expect(['direct', 'light']).toContain(result.metadata.pipeline)
    })

    it('includes complexity assessment', () => {
      expect(result.complexity).toBeDefined()
      expect(result.complexity.level).toBeDefined()
      expect(result.complexity.score).toBeDefined()
    })
  })
})

// ============================================================================
// Robust Pipeline Tests
// ============================================================================

describeWithKey('Robust Pipeline (Error Handling)', () => {
  let provider: LLMProvider

  beforeAll(() => {
    if (selectedProvider === 'claude') {
      provider = new ClaudeProvider({ apiKey: ANTHROPIC_API_KEY! })
    } else {
      provider = new GeminiProvider(GEMINI_API_KEY!)
    }
  })

  describe('with error recovery enabled', () => {
    let fixture: Fixture
    let pdfService: PdfService

    beforeAll(async () => {
      fixture = await loadFixture('arxiv-roadmap')
      pdfService = await createPdfService(fixture.pdfBuffer, 'node')
    })

    afterAll(() => {
      pdfService?.destroy()
    })

    it('completes conversion with retry support', async () => {
      const errors: Array<{ context: string; message: string }> = []

      const result = await convertDocumentRobust(pdfService, provider, {
        forcePipeline: 'direct',
        continueOnError: true,
        retryConfig: {
          baseDelay: '500 millis',
          maxDelay: '5 seconds',
          maxAttempts: 2,
        },
        onProgress: (status, current, total) => {
          console.log(`[Robust] ${status} (${current}/${total})`)
        },
        onError: (error, context) => {
          errors.push({ context, message: error.message })
          console.log(`[Robust] Error in ${context}: ${error.message}`)
        },
      })

      console.log('\n--- Robust Pipeline Result ---')
      console.log('Full success:', result.fullSuccess)
      console.log('Errors count:', result.errors.length)

      expect(result.markdown).toBeDefined()
      expect(result.errors).toBeDefined()
    }, 180000)
  })
})

// ============================================================================
// Vector Graphics Detection Tests
// ============================================================================

describe('Vector Graphics Detection', () => {
  let pdfService: PdfService

  beforeAll(async () => {
    const fixture = await loadFixture('arxiv-roadmap')
    pdfService = await createPdfService(fixture.pdfBuffer, 'node')
  })

  afterAll(() => {
    pdfService?.destroy()
  })

  it('detects vector regions on pages with graphics', async () => {
    // Check if method exists (optional on interface)
    if (!pdfService.detectVectorRegions) {
      console.log('Vector detection not implemented for this service')
      return
    }

    const regions = await pdfService.detectVectorRegions(1)

    console.log('\n--- Vector Regions (Page 1) ---')
    console.log('Total regions:', regions.length)
    for (const region of regions) {
      console.log(`  - Type: ${region.type}, Bbox: [${region.bbox.join(', ')}]`)
    }

    expect(regions).toBeInstanceOf(Array)
  })

  it('renders regions at high resolution', async () => {
    if (!pdfService.detectVectorRegions || !pdfService.renderRegion) {
      console.log('Vector rendering not implemented for this service')
      return
    }

    const regions = await pdfService.detectVectorRegions(1)

    if (regions.length > 0) {
      const rendered = await pdfService.renderRegion(1, regions[0], 2)
      expect(rendered).toBeTruthy()
      console.log('Rendered region size:', rendered.length, 'bytes (base64)')
    }
  })
})

// ============================================================================
// Provider Abstraction Tests
// ============================================================================

describe('LLM Provider Abstraction', () => {
  it('Selected provider has correct capabilities', () => {
    if (!hasRequiredKey) {
      console.log('Skipping - no API key for selected provider')
      return
    }

    let provider: LLMProvider
    if (selectedProvider === 'claude') {
      provider = new ClaudeProvider({ apiKey: ANTHROPIC_API_KEY! })
      expect(provider.name).toBe('claude')
      expect(provider.displayName).toBe('Claude (Anthropic)')
      expect(provider.capabilities.supportsNativePdf).toBe(true)
    } else {
      provider = new GeminiProvider(GEMINI_API_KEY!)
      expect(provider.name).toBe('gemini')
      expect(provider.displayName).toBe('Google Gemini')
      expect(provider.capabilities.supportsNativePdf).toBe(false)
    }
    expect(provider.capabilities.maxContextTokens).toBeGreaterThan(0)
  })

  it('Provider implements required methods', () => {
    if (!hasRequiredKey) {
      console.log('Skipping - no API key for selected provider')
      return
    }

    let provider: LLMProvider
    if (selectedProvider === 'claude') {
      provider = new ClaudeProvider({ apiKey: ANTHROPIC_API_KEY! })
    } else {
      provider = new GeminiProvider(GEMINI_API_KEY!)
    }

    expect(typeof provider.analyzeDocument).toBe('function')
    expect(typeof provider.extractStructure).toBe('function')
    expect(typeof provider.convertPage).toBe('function')
    expect(typeof provider.convertWindow).toBe('function')
    expect(typeof provider.summarize).toBe('function')
  })
})
