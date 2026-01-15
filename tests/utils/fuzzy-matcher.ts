import stringSimilarity from 'string-similarity'

export interface FuzzyMatchResult {
  similarity: number
  passed: boolean
}

/**
 * Compare two strings using Dice coefficient similarity
 * @param actual - The actual string to compare
 * @param expected - The expected string
 * @param threshold - Minimum similarity threshold (0-1), default 0.9
 */
export function fuzzyMatch(
  actual: string,
  expected: string,
  threshold: number = 0.9,
): FuzzyMatchResult {
  // Normalize strings for comparison
  const normalizedActual = normalizeString(actual)
  const normalizedExpected = normalizeString(expected)

  const similarity = stringSimilarity.compareTwoStrings(
    normalizedActual,
    normalizedExpected,
  )

  return {
    similarity,
    passed: similarity >= threshold,
  }
}

/**
 * Normalize a string for comparison
 * - Lowercase
 * - Remove extra whitespace
 * - Remove special characters that may vary
 */
function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim()
}
