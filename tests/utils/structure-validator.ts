import type { HeadingInfo } from './markdown-parser';
import { fuzzyMatch } from './fuzzy-matcher';

export interface HeadingExpectation {
  level: number;
  text: string;
}

export interface HeadingsByLevel {
  h1: number;
  h2: number;
  h3: number;
  h4: number;
  h5: number;
  h6: number;
}

export interface StructureExpectation {
  headings: {
    byLevel: HeadingsByLevel;
    items: HeadingExpectation[];
  };
  hierarchyValid: boolean;
}

export interface HeadingMatchResult {
  expected: string;
  actual: string | null;
  similarity: number;
  passed: boolean;
}

export interface StructureValidationResult {
  headingCounts: HeadingsByLevel;
  hierarchyValid: boolean;
  hierarchyErrors: string[];
  headingMatches: HeadingMatchResult[];
}

/**
 * Validate document structure against expectations
 */
export function validateStructure(
  headings: HeadingInfo[],
  expected: StructureExpectation
): StructureValidationResult {
  // Count headings by level
  const headingCounts: HeadingsByLevel = {
    h1: 0,
    h2: 0,
    h3: 0,
    h4: 0,
    h5: 0,
    h6: 0,
  };

  for (const heading of headings) {
    const key = `h${heading.level}` as keyof HeadingsByLevel;
    if (key in headingCounts) {
      headingCounts[key]++;
    }
  }

  // Validate hierarchy (no skipped levels)
  const hierarchyErrors: string[] = [];
  let prevLevel = 0;

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    if (prevLevel > 0 && heading.level > prevLevel + 1) {
      hierarchyErrors.push(
        `Skipped heading level at position ${i}: H${prevLevel} -> H${heading.level} ("${heading.text.substring(0, 30)}...")`
      );
    }
    prevLevel = heading.level;
  }

  // Match heading text with fuzzy matching
  const headingMatches: HeadingMatchResult[] = [];

  for (const expectedHeading of expected.headings.items) {
    // Find a heading with the same level
    const candidates = headings.filter((h) => h.level === expectedHeading.level);

    let bestMatch: HeadingMatchResult = {
      expected: expectedHeading.text,
      actual: null,
      similarity: 0,
      passed: false,
    };

    for (const candidate of candidates) {
      const match = fuzzyMatch(candidate.text, expectedHeading.text);
      if (match.similarity > bestMatch.similarity) {
        bestMatch = {
          expected: expectedHeading.text,
          actual: candidate.text,
          similarity: match.similarity,
          passed: match.passed,
        };
      }
    }

    headingMatches.push(bestMatch);
  }

  return {
    headingCounts,
    hierarchyValid: hierarchyErrors.length === 0,
    hierarchyErrors,
    headingMatches,
  };
}
