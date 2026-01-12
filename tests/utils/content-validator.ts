import type { ImageInfo, TableInfo, CodeBlockInfo } from './markdown-parser';

export interface ContentExpectation {
  images: {
    count: number;
    minDimensions?: { width: number; height: number };
  };
  tables: {
    count: number;
    details?: Array<{ rows: number; columns: number }>;
  };
  codeBlocks: {
    count: number;
    languages?: string[];
  };
}

export interface ImageValidationDetail {
  url: string;
  valid: boolean;
  reason?: string;
}

export interface TableValidationDetail {
  rows: number;
  columns: number;
  consistent: boolean;
}

export interface ContentValidationResult {
  images: {
    count: number;
    expected: number;
    valid: boolean;
    tolerance: number;
    details: ImageValidationDetail[];
  };
  tables: {
    count: number;
    expected: number;
    valid: boolean;
    tolerance: number;
    details: TableValidationDetail[];
  };
  codeBlocks: {
    count: number;
    expected: number;
    valid: boolean;
    tolerance: number;
    languages: string[];
  };
}

/**
 * Validate extracted content against expectations
 * @param images - Extracted images from markdown
 * @param tables - Extracted tables from markdown
 * @param codeBlocks - Extracted code blocks from markdown
 * @param expected - Expected content counts
 * @param tolerance - Allow +/- tolerance for counts (default 1)
 */
export function validateContent(
  images: ImageInfo[],
  tables: TableInfo[],
  codeBlocks: CodeBlockInfo[],
  expected: ContentExpectation,
  tolerance: number = 1
): ContentValidationResult {
  // Validate images
  const imageDetails: ImageValidationDetail[] = images.map((img) => {
    const valid = isValidImageUrl(img.url);
    return {
      url: img.url.substring(0, 50) + (img.url.length > 50 ? '...' : ''),
      valid,
      reason: valid ? undefined : 'Invalid or empty URL',
    };
  });

  const imageCountDiff = Math.abs(images.length - expected.images.count);
  const imagesValid = imageCountDiff <= tolerance;

  // Validate tables
  const tableDetails: TableValidationDetail[] = tables.map((table) => ({
    rows: table.rows,
    columns: table.columns,
    consistent: table.rows > 0 && table.columns > 0,
  }));

  const tableCountDiff = Math.abs(tables.length - expected.tables.count);
  const tablesValid = tableCountDiff <= tolerance;

  // Validate code blocks
  const languages = codeBlocks
    .map((block) => block.language)
    .filter((lang): lang is string => lang !== null);

  const codeCountDiff = Math.abs(codeBlocks.length - expected.codeBlocks.count);
  const codeBlocksValid = codeCountDiff <= tolerance;

  return {
    images: {
      count: images.length,
      expected: expected.images.count,
      valid: imagesValid,
      tolerance,
      details: imageDetails,
    },
    tables: {
      count: tables.length,
      expected: expected.tables.count,
      valid: tablesValid,
      tolerance,
      details: tableDetails,
    },
    codeBlocks: {
      count: codeBlocks.length,
      expected: expected.codeBlocks.count,
      valid: codeBlocksValid,
      tolerance,
      languages,
    },
  };
}

/**
 * Check if an image URL is valid
 */
function isValidImageUrl(url: string): boolean {
  if (!url || url.trim() === '') return false;

  // Check for data URLs (base64 embedded images)
  if (url.startsWith('data:image/')) {
    // Basic check that it has some content
    return url.length > 50;
  }

  // Check for regular URLs
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return true;
  }

  // Check for relative paths
  if (url.startsWith('./') || url.startsWith('/') || url.match(/^\w+\.(png|jpg|jpeg|gif|webp|svg)$/i)) {
    return true;
  }

  return false;
}
