import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

export interface FormatValidationResult {
  parseable: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Validate that Markdown content is well-formed and parseable
 */
export function validateFormat(content: string): FormatValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Check for empty content
  if (!content || content.trim() === '') {
    return {
      parseable: false,
      errors: ['Content is empty'],
      warnings: [],
    }
  }

  // Try to parse the Markdown
  try {
    const processor = unified().use(remarkParse).use(remarkGfm)
    processor.parse(content)
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
    return {
      parseable: false,
      errors,
      warnings,
    }
  }

  // Check for common issues (warnings, not errors)

  // Check for broken image references
  const brokenImagePattern = /!\[[^\]]*\]\(\s*\)/g
  const brokenImages = content.match(brokenImagePattern)
  if (brokenImages) {
    warnings.push(`Found ${brokenImages.length} broken image reference(s) with empty URLs`)
  }

  // Check for unclosed brackets
  const openBrackets = (content.match(/\[/g) || []).length
  const closeBrackets = (content.match(/\]/g) || []).length
  if (openBrackets !== closeBrackets) {
    warnings.push(`Mismatched brackets: ${openBrackets} open, ${closeBrackets} close`)
  }

  // Check for unclosed parentheses in links
  const linkPattern = /\]\([^)]*$/gm
  if (linkPattern.test(content)) {
    warnings.push('Found unclosed link parentheses')
  }

  // Check for very long lines (might indicate missing line breaks)
  const lines = content.split('\n')
  const longLines = lines.filter(line => line.length > 500)
  if (longLines.length > 0) {
    warnings.push(`Found ${longLines.length} line(s) exceeding 500 characters`)
  }

  return {
    parseable: true,
    errors,
    warnings,
  }
}
