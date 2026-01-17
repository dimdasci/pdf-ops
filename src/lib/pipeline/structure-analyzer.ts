/**
 * Pass 2: Structure Analyzer
 *
 * Analyzes document structure to build a StructureProfile including:
 * - Document type classification
 * - Table of contents (explicit or inferred)
 * - Heading hierarchy and styles
 * - Section boundaries (front matter, body, back matter)
 * - Cross-reference handling configuration
 */

import type { LLMProvider } from '../llm/types'
import type { PdfService } from '../pdf-service/types'
import type {
  CrossReferences,
  DocumentSections,
  DocumentType,
  HeadingStyle,
  Hierarchy,
  LayoutProfile,
  PageRange,
  StructureProfile,
  TocEntry,
  TocInfo,
} from './types/profiles'

// =============================================================================
// Types for LLM Response Parsing
// =============================================================================

interface LLMStructureResponse {
  documentType: DocumentType
  toc: {
    explicit: boolean
    entries: Array<{
      level: number
      title: string
      page: number
      children?: LLMStructureResponse['toc']['entries']
    }>
  }
  hierarchy: {
    maxDepth: number
    headingStyles: Array<{
      level: number
      indicators: string[]
    }>
  }
  sections: {
    frontMatter: { start: number; end: number } | null
    body: { start: number; end: number }
    backMatter: { start: number; end: number } | null
  }
  crossReferences: {
    footnoteStyle: 'inline' | 'endnote' | 'chapter-end'
    citationStyle: string | null
  }
}

// =============================================================================
// Main Export
// =============================================================================

/**
 * Analyze document structure to produce a StructureProfile.
 *
 * This is Pass 2 of the 4-pass pipeline. It uses the LayoutProfile from Pass 1
 * to avoid header/footer zones when extracting text for structure analysis.
 *
 * @param pdfService - PDF service for text extraction
 * @param provider - LLM provider for structure analysis
 * @param layout - LayoutProfile from Pass 1
 * @returns StructureProfile describing document organization
 */
export async function analyzeStructure(
  pdfService: PdfService,
  provider: LLMProvider,
  layout: LayoutProfile,
): Promise<StructureProfile> {
  const pageCount = pdfService.getPageCount()

  // Extract text from strategic pages, avoiding header/footer zones
  const textSamples = await extractTextSamples(pdfService, layout, pageCount)

  // Build the analysis prompt
  const prompt = buildStructurePrompt(textSamples, layout, pageCount)

  // Send to LLM for analysis
  const response = await provider.chat(prompt)

  // Parse and validate the response
  const parsed = parseStructureResponse(response, pageCount)

  return parsed
}

// =============================================================================
// Text Extraction
// =============================================================================

/**
 * Extract text from distributed pages, filtering out header/footer zones.
 * Samples pages at 5%, 20%, 40%, 60%, 80%, 95% positions for coverage.
 */
async function extractTextSamples(
  pdfService: PdfService,
  layout: LayoutProfile,
  pageCount: number,
): Promise<Map<number, string>> {
  const samples = new Map<number, string>()

  // Sample positions as percentages
  const samplePositions = [0.05, 0.20, 0.40, 0.60, 0.80, 0.95]

  // Calculate actual page numbers
  const pageNumbers = samplePositions
    .map(pos => Math.max(1, Math.min(pageCount, Math.round(pos * pageCount))))
    .filter((page, index, arr) => arr.indexOf(page) === index) // Remove duplicates

  // For small documents, sample all pages
  const pagesToSample = pageCount <= 10
    ? Array.from({ length: pageCount }, (_, i) => i + 1)
    : pageNumbers

  // Extract text from each sampled page
  for (const pageNum of pagesToSample) {
    const rawText = await pdfService.getPageText(pageNum)
    const filteredText = filterHeaderFooter(rawText, layout)
    samples.set(pageNum, filteredText)
  }

  return samples
}

/**
 * Filter out header and footer content based on layout profile.
 * Uses fuzzy matching against known repeated elements.
 */
function filterHeaderFooter(text: string, layout: LayoutProfile): string {
  const lines = text.split('\n')
  const filtered: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      filtered.push(line)
      continue
    }

    // Skip if matches header patterns
    if (matchesAnyPattern(trimmed, layout.repeatedElements.headers)) {
      continue
    }

    // Skip if matches footer patterns
    if (matchesAnyPattern(trimmed, layout.repeatedElements.footers)) {
      continue
    }

    // Skip if matches page number pattern
    if (layout.repeatedElements.pageNumbers) {
      try {
        const pageNumRegex = new RegExp(layout.repeatedElements.pageNumbers, 'i')
        if (pageNumRegex.test(trimmed)) {
          continue
        }
      } catch {
        // Invalid regex, skip this check
      }
    }

    filtered.push(line)
  }

  return filtered.join('\n').trim()
}

/**
 * Check if text matches any of the given patterns using fuzzy matching.
 */
function matchesAnyPattern(text: string, patterns: string[]): boolean {
  const normalized = text.toLowerCase().trim()

  for (const pattern of patterns) {
    const normalizedPattern = pattern.toLowerCase().trim()

    // Exact match
    if (normalized === normalizedPattern) {
      return true
    }

    // Fuzzy match: check if one contains most of the other
    if (normalized.length > 5 && normalizedPattern.length > 5) {
      const similarity = calculateSimilarity(normalized, normalizedPattern)
      if (similarity > 0.8) {
        return true
      }
    }
  }

  return false
}

/**
 * Calculate simple similarity ratio between two strings.
 */
function calculateSimilarity(a: string, b: string): number {
  const longer = a.length > b.length ? a : b
  const shorter = a.length > b.length ? b : a

  if (longer.length === 0) {
    return 1.0
  }

  // Check if shorter is contained in longer
  if (longer.includes(shorter)) {
    return shorter.length / longer.length
  }

  // Simple character overlap
  const longerChars = new Set(longer)
  let matches = 0
  for (const char of shorter) {
    if (longerChars.has(char)) {
      matches++
    }
  }

  return matches / longer.length
}

// =============================================================================
// Prompt Building
// =============================================================================

/**
 * Build the structure analysis prompt for the LLM.
 */
function buildStructurePrompt(
  textSamples: Map<number, string>,
  layout: LayoutProfile,
  pageCount: number,
): string {
  // Format text samples for the prompt
  const samplesText = Array.from(textSamples.entries())
    .map(([page, text]) => `=== PAGE ${page} ===\n${text.slice(0, 2000)}`)
    .join('\n\n')

  return `Analyze this document's structure and organization.

DOCUMENT INFO:
- Total pages: ${pageCount}
- Footnote style detected: ${layout.footnoteStyle}
- Column layout: ${layout.columnLayout}

TEXT SAMPLES (from distributed pages, headers/footers already filtered):
${samplesText}

ANALYZE AND RESPOND WITH JSON:
{
  "documentType": "<academic|book|report|marketing|manual|legal|other>",
  "toc": {
    "explicit": <true if you found an actual Table of Contents page, false if inferred>,
    "entries": [
      {
        "level": <1 for top-level, 2 for subsection, etc.>,
        "title": "<section title>",
        "page": <page number where section starts>,
        "children": [<nested entries if any>]
      }
    ]
  },
  "hierarchy": {
    "maxDepth": <maximum heading depth used, e.g., 3 for H1-H2-H3>,
    "headingStyles": [
      {
        "level": <1-6>,
        "indicators": ["<style indicators like: larger-font, bold, numbered, all-caps, underlined, centered>"]
      }
    ]
  },
  "sections": {
    "frontMatter": <{"start": N, "end": M} or null if no front matter>,
    "body": {"start": <first body page>, "end": <last body page>},
    "backMatter": <{"start": N, "end": M} or null if no back matter>
  },
  "crossReferences": {
    "footnoteStyle": "<inline|endnote|chapter-end>",
    "citationStyle": "<APA|MLA|Chicago|IEEE|Harvard|null if not detected>"
  }
}

GUIDELINES:
1. Document Type:
   - "academic": Research papers, journal articles, theses with abstract, citations
   - "book": Chapters, possibly fiction/non-fiction narrative content
   - "report": Business/technical reports with executive summary, findings
   - "marketing": Brochures, presentations, promotional material
   - "manual": Technical documentation, user guides, how-to
   - "legal": Contracts, legal documents, numbered clauses
   - "other": Anything that doesn't fit above

2. TOC Detection:
   - Look for explicit "Table of Contents", "Contents", or similar
   - If no explicit TOC, infer structure from heading patterns
   - Use page numbers from text when available
   - Estimate page numbers based on document position if not explicit

3. Heading Hierarchy:
   - Identify consistent patterns: font size changes, numbering (1., 1.1, etc.)
   - Note formatting: bold, caps, centered, underlined
   - maxDepth should reflect actual usage (don't assume 6 if only 2 levels used)

4. Section Boundaries:
   - Front matter: title page, copyright, dedication, preface, TOC, abstract
   - Body: main content chapters/sections
   - Back matter: appendices, references, index, glossary

5. Cross-References:
   - "inline": footnotes appear at bottom of same page
   - "endnote": all notes collected at document end
   - "chapter-end": notes at end of each chapter/section
   - citationStyle: look for [1], (Author, Year), superscript numbers

RESPOND ONLY WITH VALID JSON, NO MARKDOWN FORMATTING.`
}

// =============================================================================
// Response Parsing
// =============================================================================

/**
 * Parse and validate the LLM response into a StructureProfile.
 */
function parseStructureResponse(response: string, pageCount: number): StructureProfile {
  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = response.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    console.warn('No JSON found in structure analysis response, using defaults')
    return createDefaultStructureProfile(pageCount)
  }

  let parsed: LLMStructureResponse
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch (error) {
    console.warn('Failed to parse structure analysis JSON, using defaults:', error)
    return createDefaultStructureProfile(pageCount)
  }

  // Validate and transform the response
  return {
    documentType: validateDocumentType(parsed.documentType),
    toc: validateToc(parsed.toc, pageCount),
    hierarchy: validateHierarchy(parsed.hierarchy),
    sections: validateSections(parsed.sections, pageCount),
    crossReferences: validateCrossReferences(parsed.crossReferences),
  }
}

/**
 * Create a default structure profile when parsing fails.
 */
function createDefaultStructureProfile(pageCount: number): StructureProfile {
  return {
    documentType: 'other',
    toc: {
      explicit: false,
      entries: [],
    },
    hierarchy: {
      maxDepth: 2,
      headingStyles: [
        { level: 1, indicators: ['larger-font', 'bold'] },
        { level: 2, indicators: ['bold'] },
      ],
    },
    sections: {
      frontMatter: null,
      body: { start: 1, end: pageCount },
      backMatter: null,
    },
    crossReferences: {
      footnoteStyle: 'inline',
      citationStyle: null,
    },
  }
}

// =============================================================================
// Validation Helpers
// =============================================================================

const VALID_DOCUMENT_TYPES: DocumentType[] = [
  'academic',
  'book',
  'report',
  'marketing',
  'manual',
  'legal',
  'other',
]

function validateDocumentType(type: unknown): DocumentType {
  if (typeof type === 'string' && VALID_DOCUMENT_TYPES.includes(type as DocumentType)) {
    return type as DocumentType
  }
  return 'other'
}

function validateToc(toc: unknown, pageCount: number): TocInfo {
  if (!toc || typeof toc !== 'object') {
    return { explicit: false, entries: [] }
  }

  const tocObj = toc as Partial<LLMStructureResponse['toc']>

  return {
    explicit: Boolean(tocObj.explicit),
    entries: validateTocEntries(tocObj.entries, pageCount),
  }
}

function validateTocEntries(
  entries: unknown,
  pageCount: number,
  maxLevel = 1,
): TocEntry[] {
  if (!Array.isArray(entries)) {
    return []
  }

  return entries
    .filter((entry): entry is Record<string, unknown> =>
      entry !== null && typeof entry === 'object'
    )
    .map(entry => {
      const level = typeof entry.level === 'number'
        ? Math.max(1, Math.min(6, entry.level))
        : maxLevel

      const page = typeof entry.page === 'number'
        ? Math.max(1, Math.min(pageCount, entry.page))
        : 1

      const result: TocEntry = {
        level,
        title: typeof entry.title === 'string' ? entry.title : 'Untitled',
        page,
      }

      // Recursively validate children
      if (Array.isArray(entry.children) && entry.children.length > 0) {
        result.children = validateTocEntries(entry.children, pageCount, level + 1)
      }

      return result
    })
}

function validateHierarchy(hierarchy: unknown): Hierarchy {
  if (!hierarchy || typeof hierarchy !== 'object') {
    return {
      maxDepth: 2,
      headingStyles: [
        { level: 1, indicators: ['larger-font', 'bold'] },
        { level: 2, indicators: ['bold'] },
      ],
    }
  }

  const hierarchyObj = hierarchy as Partial<LLMStructureResponse['hierarchy']>

  const maxDepth = typeof hierarchyObj.maxDepth === 'number'
    ? Math.max(1, Math.min(6, hierarchyObj.maxDepth))
    : 2

  const headingStyles = validateHeadingStyles(hierarchyObj.headingStyles, maxDepth)

  return { maxDepth, headingStyles }
}

function validateHeadingStyles(
  styles: unknown,
  maxDepth: number,
): HeadingStyle[] {
  if (!Array.isArray(styles) || styles.length === 0) {
    // Generate default styles based on maxDepth
    return Array.from({ length: maxDepth }, (_, i) => ({
      level: i + 1,
      indicators: i === 0 ? ['larger-font', 'bold'] : ['bold'],
    }))
  }

  return styles
    .filter((style): style is Record<string, unknown> =>
      style !== null && typeof style === 'object'
    )
    .map(style => ({
      level: typeof style.level === 'number'
        ? Math.max(1, Math.min(6, style.level))
        : 1,
      indicators: Array.isArray(style.indicators)
        ? style.indicators.filter((i): i is string => typeof i === 'string')
        : [],
    }))
    .sort((a, b) => a.level - b.level)
}

function validateSections(sections: unknown, pageCount: number): DocumentSections {
  if (!sections || typeof sections !== 'object') {
    return {
      frontMatter: null,
      body: { start: 1, end: pageCount },
      backMatter: null,
    }
  }

  const sectionsObj = sections as Partial<LLMStructureResponse['sections']>

  const frontMatter = validatePageRange(sectionsObj.frontMatter, pageCount)
  const backMatter = validatePageRange(sectionsObj.backMatter, pageCount)

  // Body must exist and cover remaining pages
  let body: PageRange
  if (sectionsObj.body && typeof sectionsObj.body === 'object') {
    body = {
      start: typeof sectionsObj.body.start === 'number'
        ? Math.max(1, sectionsObj.body.start)
        : (frontMatter ? frontMatter.end + 1 : 1),
      end: typeof sectionsObj.body.end === 'number'
        ? Math.min(pageCount, sectionsObj.body.end)
        : (backMatter ? backMatter.start - 1 : pageCount),
    }
  } else {
    body = {
      start: frontMatter ? frontMatter.end + 1 : 1,
      end: backMatter ? backMatter.start - 1 : pageCount,
    }
  }

  // Ensure body has at least one page
  if (body.end < body.start) {
    body = { start: 1, end: pageCount }
  }

  return { frontMatter, body, backMatter }
}

function validatePageRange(range: unknown, pageCount: number): PageRange | null {
  if (!range || typeof range !== 'object') {
    return null
  }

  const rangeObj = range as Record<string, unknown>

  if (typeof rangeObj.start !== 'number' || typeof rangeObj.end !== 'number') {
    return null
  }

  const start = Math.max(1, Math.min(pageCount, rangeObj.start))
  const end = Math.max(start, Math.min(pageCount, rangeObj.end))

  return { start, end }
}

const VALID_FOOTNOTE_STYLES: CrossReferences['footnoteStyle'][] = [
  'inline',
  'endnote',
  'chapter-end',
]

function validateCrossReferences(refs: unknown): CrossReferences {
  if (!refs || typeof refs !== 'object') {
    return { footnoteStyle: 'inline', citationStyle: null }
  }

  const refsObj = refs as Partial<LLMStructureResponse['crossReferences']>

  const footnoteStyle = VALID_FOOTNOTE_STYLES.includes(
      refsObj.footnoteStyle as CrossReferences['footnoteStyle'],
    )
    ? refsObj.footnoteStyle as CrossReferences['footnoteStyle']
    : 'inline'

  const citationStyle = typeof refsObj.citationStyle === 'string' && refsObj.citationStyle
    ? refsObj.citationStyle
    : null

  return { footnoteStyle, citationStyle }
}
