/**
 * Pass 4: Content Organization and Final Markdown Assembly
 *
 * Takes raw extracted content and structure profile to produce
 * clean, well-organized final markdown output.
 *
 * Responsibilities:
 * - Merge split paragraphs (continuesFrom handling)
 * - Place footnotes according to document type
 * - Validate and fix heading hierarchy
 * - Resolve all footnote/image references
 * - Generate optional TOC navigation
 * - Final cleanup pass
 */

import { Effect } from 'effect'
import type { LLMProvider } from '../llm/types'
import { OrganizationError } from './types/errors'
import type {
  DocumentType,
  Footnote,
  ImageRef,
  RawContent,
  Section,
  StructureProfile,
  TocEntry,
} from './types/profiles'

// =============================================================================
// Types
// =============================================================================

/**
 * Options for organizing content.
 */
export interface OrganizeOptions {
  /** Include TOC at document start if structure has one */
  includeToc?: boolean
  /** Maximum heading level to include in generated TOC (default: 3) */
  tocMaxLevel?: number
  /** Add blank lines between sections for readability */
  addSectionSpacing?: boolean
}

/**
 * Result of heading hierarchy validation.
 */
interface HeadingValidation {
  /** Original level */
  original: number
  /** Corrected level (may be same as original) */
  corrected: number
  /** Whether correction was applied */
  wasFixed: boolean
}

// =============================================================================
// Footnote Placement Logic
// =============================================================================

/**
 * Determines where footnotes should be placed based on document type.
 */
function getFootnotePlacement(
  documentType: DocumentType,
): 'inline' | 'section-end' | 'document-end' {
  switch (documentType) {
    case 'academic':
      return 'document-end'
    case 'book':
      return 'section-end' // chapter-end, but we treat top-level sections as chapters
    case 'report':
    case 'manual':
      return 'section-end'
    case 'marketing':
    case 'legal':
    case 'other':
    default:
      return 'inline'
  }
}

/**
 * Formats a single footnote for markdown output.
 */
function formatFootnote(id: string, footnote: Footnote): string {
  return `[^${id}]: ${footnote.content}`
}

/**
 * Formats multiple footnotes as a block.
 */
function formatFootnoteBlock(footnotes: Array<{ id: string; footnote: Footnote }>): string {
  if (footnotes.length === 0) return ''

  const formatted = footnotes
    .map(({ id, footnote }) => formatFootnote(id, footnote))
    .join('\n')

  return `\n\n---\n\n${formatted}`
}

// =============================================================================
// Paragraph Continuation Handling
// =============================================================================

/**
 * Merges sections that were split across page boundaries.
 * Returns a new array of merged sections.
 */
function mergeContinuedSections(sections: Section[]): Section[] {
  const merged: Section[] = []
  const sectionMap = new Map<string, Section>()

  // Build a map for quick lookup
  for (const section of sections) {
    sectionMap.set(section.id, section)
  }

  // Track which sections have been merged into others
  const mergedInto = new Set<string>()

  for (const section of sections) {
    // Skip if this section was already merged into a previous one
    if (mergedInto.has(section.id)) {
      continue
    }

    // Find the root section if this continues from another
    let rootSection = section
    while (rootSection.continuesFrom) {
      const parent = sectionMap.get(rootSection.continuesFrom)
      if (parent) {
        rootSection = parent
      } else {
        break
      }
    }

    // If this is already the root, collect all continuations
    if (rootSection.id === section.id) {
      const continuations = collectContinuations(section.id, sections, sectionMap)

      if (continuations.length > 0) {
        // Merge all continuations into this section
        const mergedContent = [section.content]
        const mergedFootnoteRefs = [...section.footnoteRefs]
        const mergedImageRefs = [...section.imageRefs]

        for (const continuation of continuations) {
          mergedContent.push(continuation.content)
          mergedFootnoteRefs.push(...continuation.footnoteRefs)
          mergedImageRefs.push(...continuation.imageRefs)
          mergedInto.add(continuation.id)
        }

        merged.push({
          ...section,
          content: mergedContent.join('\n\n'),
          footnoteRefs: [...new Set(mergedFootnoteRefs)],
          imageRefs: [...new Set(mergedImageRefs)],
        })
      } else {
        merged.push(section)
      }
    }
  }

  return merged
}

/**
 * Collects all sections that continue from a given section ID.
 */
function collectContinuations(
  sectionId: string,
  sections: Section[],
  sectionMap: Map<string, Section>,
): Section[] {
  const continuations: Section[] = []

  for (const section of sections) {
    if (section.continuesFrom === sectionId) {
      continuations.push(section)
      // Recursively collect further continuations
      continuations.push(...collectContinuations(section.id, sections, sectionMap))
    }
  }

  return continuations
}

// =============================================================================
// Heading Hierarchy Validation
// =============================================================================

/**
 * Validates and fixes heading hierarchy to prevent jumps (e.g., H1 -> H3).
 * Returns corrected heading levels.
 */
function validateHeadingHierarchy(sections: Section[]): Map<string, HeadingValidation> {
  const validations = new Map<string, HeadingValidation>()
  let lastLevel = 0

  for (const section of sections) {
    if (section.level === 0) {
      // Non-heading content, skip
      validations.set(section.id, {
        original: 0,
        corrected: 0,
        wasFixed: false,
      })
      continue
    }

    let correctedLevel = section.level

    // Check for invalid jumps
    if (lastLevel === 0) {
      // First heading should be level 1 or 2
      if (section.level > 2) {
        correctedLevel = 1
      }
    } else if (section.level > lastLevel + 1) {
      // Jump too big, reduce to max allowed
      correctedLevel = lastLevel + 1
    }

    validations.set(section.id, {
      original: section.level,
      corrected: correctedLevel,
      wasFixed: correctedLevel !== section.level,
    })

    lastLevel = correctedLevel
  }

  return validations
}

/**
 * Generates markdown heading prefix for a given level.
 */
function headingPrefix(level: number): string {
  if (level <= 0 || level > 6) return ''
  return '#'.repeat(level) + ' '
}

// =============================================================================
// Image Reference Resolution
// =============================================================================

/**
 * Formats an image reference for markdown output.
 */
function formatImageRef(id: string, image: ImageRef): string {
  if (image.isDecorative) return ''

  const alt = image.description || `Image ${id}`
  return `![${alt}](${image.dataUrl})`
}

/**
 * Resolves image placeholders in content.
 */
function resolveImageReferences(content: string, images: Map<string, ImageRef>): string {
  let resolved = content

  // Replace image reference placeholders like {{image:id}} or [image:id]
  const imageRefPattern = /\{\{image:([^}]+)\}\}|\[image:([^\]]+)\]/g

  resolved = resolved.replace(imageRefPattern, (_match, id1, id2) => {
    const id = id1 || id2
    const image = images.get(id)
    if (image && !image.isDecorative) {
      return formatImageRef(id, image)
    }
    return '' // Remove unresolved or decorative references
  })

  return resolved
}

// =============================================================================
// Footnote Reference Resolution
// =============================================================================

/**
 * Ensures footnote markers in content use standard markdown format.
 */
function normalizeFootnoteMarkers(content: string): string {
  // Convert various footnote marker formats to standard [^id]
  // Handles: [1], (1), ^1, [^1], etc.
  return content
    .replace(/\[(\d+)\](?!\()/g, '[^$1]') // [1] -> [^1] (but not [1](url))
    .replace(/\((\d+)\)(?!\[)/g, '[^$1]') // (1) -> [^1] (but not (1)[text])
    .replace(/\^(\d+)(?!\])/g, '[^$1]') // ^1 -> [^1]
}

// =============================================================================
// TOC Generation
// =============================================================================

/**
 * Generates markdown TOC from structure profile entries.
 */
function generateToc(entries: TocEntry[], maxLevel: number = 3): string {
  const lines: string[] = ['## Table of Contents', '']

  function renderEntry(entry: TocEntry, depth: number = 0): void {
    if (entry.level > maxLevel) return

    const indent = '  '.repeat(depth)
    const anchor = entry.title.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')

    lines.push(`${indent}- [${entry.title}](#${anchor})`)

    if (entry.children) {
      for (const child of entry.children) {
        renderEntry(child, depth + 1)
      }
    }
  }

  for (const entry of entries) {
    renderEntry(entry)
  }

  lines.push('')
  return lines.join('\n')
}

// =============================================================================
// Section Rendering
// =============================================================================

/**
 * Renders a single section to markdown.
 */
function renderSection(
  section: Section,
  headingLevel: number,
  images: Map<string, ImageRef>,
): string {
  const parts: string[] = []

  // Add heading if present
  if (section.title && headingLevel > 0) {
    parts.push(`${headingPrefix(headingLevel)}${section.title}`)
    parts.push('')
  }

  // Add content with resolved references
  let content = section.content
  content = normalizeFootnoteMarkers(content)
  content = resolveImageReferences(content, images)

  if (content.trim()) {
    parts.push(content)
  }

  return parts.join('\n')
}

// =============================================================================
// Main Organizer Function
// =============================================================================

/**
 * Organizes raw extracted content into final markdown.
 *
 * @param rawContent - Extracted content from Pass 3
 * @param structure - Structure profile from Pass 2
 * @param _provider - Optional LLM provider for cleanup pass (reserved for future use)
 * @param options - Organization options
 * @returns Effect that produces final markdown string or OrganizationError
 */
export function organizeContent(
  rawContent: RawContent,
  structure: StructureProfile,
  _provider?: LLMProvider,
  options: OrganizeOptions = {},
): Effect.Effect<string, OrganizationError> {
  return Effect.gen(function*() {
    const {
      includeToc = true,
      tocMaxLevel = 3,
      addSectionSpacing = true,
    } = options

    const output: string[] = []

    // Step 1: Merge continued sections
    const mergedSections = yield* Effect.try({
      try: () => mergeContinuedSections(rawContent.sections),
      catch: error =>
        new OrganizationError({
          message: 'Failed to merge continued sections',
          cause: error,
        }),
    })

    // Step 2: Validate heading hierarchy
    const headingValidations = yield* Effect.try({
      try: () => validateHeadingHierarchy(mergedSections),
      catch: error =>
        new OrganizationError({
          message: 'Failed to validate heading hierarchy',
          cause: error,
        }),
    })

    // Step 3: Determine footnote placement strategy
    const footnotePlacement = getFootnotePlacement(structure.documentType)

    // Step 4: Generate TOC if requested and available
    if (includeToc && structure.toc.entries.length > 0) {
      const toc = yield* Effect.try({
        try: () => generateToc(structure.toc.entries, tocMaxLevel),
        catch: error =>
          new OrganizationError({
            message: 'Failed to generate table of contents',
            cause: error,
          }),
      })
      output.push(toc)
    }

    // Step 5: Render sections with footnotes based on placement strategy
    const usedFootnotes = new Set<string>()
    const sectionFootnotes: Map<string, Array<{ id: string; footnote: Footnote }>> = new Map()
    const documentFootnotes: Array<{ id: string; footnote: Footnote }> = []

    // Track which level 1 sections own which footnotes (for chapter-end placement)
    let currentChapterId: string | null = null

    for (const section of mergedSections) {
      const validation = headingValidations.get(section.id)
      const headingLevel = validation?.corrected ?? section.level

      // Track chapter for chapter-end footnotes
      if (headingLevel === 1) {
        currentChapterId = section.id
      }

      // Render section content
      const sectionMarkdown = yield* Effect.try({
        try: () => renderSection(section, headingLevel, rawContent.images),
        catch: error =>
          new OrganizationError({
            message: `Failed to render section: ${section.id}`,
            cause: error,
          }),
      })

      if (sectionMarkdown.trim()) {
        output.push(sectionMarkdown)

        if (addSectionSpacing) {
          output.push('')
        }
      }

      // Collect footnotes for this section
      for (const refId of section.footnoteRefs) {
        if (usedFootnotes.has(refId)) continue

        const footnote = rawContent.footnotes.get(refId)
        if (!footnote) continue

        usedFootnotes.add(refId)

        if (footnotePlacement === 'inline') {
          // Add footnote immediately after section
          output.push(formatFootnote(refId, footnote))
          output.push('')
        } else if (footnotePlacement === 'section-end' && currentChapterId) {
          // Collect for chapter/section end
          if (!sectionFootnotes.has(currentChapterId)) {
            sectionFootnotes.set(currentChapterId, [])
          }
          sectionFootnotes.get(currentChapterId)!.push({ id: refId, footnote })
        } else {
          // Document end
          documentFootnotes.push({ id: refId, footnote })
        }
      }

      // For section-end placement, add footnotes when starting a new chapter
      if (footnotePlacement === 'section-end' && headingLevel === 1 && currentChapterId) {
        const prevChapterId = findPreviousChapter(mergedSections, section.id)
        if (prevChapterId && sectionFootnotes.has(prevChapterId)) {
          const footnotes = sectionFootnotes.get(prevChapterId)!
          if (footnotes.length > 0) {
            output.push(formatFootnoteBlock(footnotes))
          }
          sectionFootnotes.delete(prevChapterId)
        }
      }
    }

    // Step 6: Add remaining section-end footnotes
    if (footnotePlacement === 'section-end') {
      for (const [_chapterId, footnotes] of sectionFootnotes) {
        if (footnotes.length > 0) {
          output.push(formatFootnoteBlock(footnotes))
        }
      }
    }

    // Step 7: Add document-end footnotes
    if (footnotePlacement === 'document-end' && documentFootnotes.length > 0) {
      output.push('')
      output.push('---')
      output.push('')
      output.push('## Notes')
      output.push('')
      for (const { id, footnote } of documentFootnotes) {
        output.push(formatFootnote(id, footnote))
      }
    }

    // Step 8: Final cleanup
    const markdown = yield* Effect.try({
      try: () => {
        let md = output.join('\n')
        md = cleanupMarkdown(md)
        return md
      },
      catch: error =>
        new OrganizationError({
          message: 'Failed to cleanup markdown output',
          cause: error,
        }),
    })

    return markdown
  })
}

/**
 * Async wrapper for organizeContent for UI compatibility.
 * Use this when you need to call organizeContent from Promise-based code.
 *
 * @param rawContent - Extracted content from Pass 3
 * @param structure - Structure profile from Pass 2
 * @param provider - Optional LLM provider for cleanup pass (reserved for future use)
 * @param options - Organization options
 * @returns Promise that resolves to final markdown string
 */
export async function organizeContentAsync(
  rawContent: RawContent,
  structure: StructureProfile,
  provider?: LLMProvider,
  options: OrganizeOptions = {},
): Promise<string> {
  return Effect.runPromise(organizeContent(rawContent, structure, provider, options))
}

/**
 * Finds the previous chapter (level 1 section) before the given section.
 */
function findPreviousChapter(sections: Section[], currentSectionId: string): string | null {
  let lastChapterId: string | null = null

  for (const section of sections) {
    if (section.id === currentSectionId) {
      return lastChapterId
    }
    if (section.level === 1) {
      lastChapterId = section.id
    }
  }

  return lastChapterId
}

// =============================================================================
// Final Cleanup
// =============================================================================

/**
 * Performs final cleanup on the markdown output.
 */
function cleanupMarkdown(markdown: string): string {
  let cleaned = markdown

  // Remove excessive blank lines (more than 2 consecutive)
  cleaned = cleaned.replace(/\n{4,}/g, '\n\n\n')

  // Remove trailing whitespace on lines
  cleaned = cleaned.replace(/[ \t]+$/gm, '')

  // Ensure single trailing newline
  cleaned = cleaned.trim() + '\n'

  // Fix broken list items (list marker at end of line)
  cleaned = cleaned.replace(/^([-*+])\s*$/gm, '')

  // Remove empty heading lines
  cleaned = cleaned.replace(/^#{1,6}\s*$/gm, '')

  // Fix double heading markers
  cleaned = cleaned.replace(/^(#{1,6})\s+\1\s+/gm, '$1 ')

  // Normalize horizontal rules
  cleaned = cleaned.replace(/^[-*_]{3,}$/gm, '---')

  return cleaned
}

// =============================================================================
// Utility Exports
// =============================================================================

export {
  cleanupMarkdown,
  generateToc,
  getFootnotePlacement,
  mergeContinuedSections,
  normalizeFootnoteMarkers,
  resolveImageReferences,
  validateHeadingHierarchy,
}
