import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { loadFixture, type Fixture } from '../utils/fixture-loader';
import { createPdfService, type PdfService } from '../../src/lib/pdf-service';
import { convertPdfToMarkdown, type ConversionResult } from '../../src/lib/converter';
import { parseMarkdown, type ParsedMarkdown } from '../utils/markdown-parser';
import { validateStructure } from '../utils/structure-validator';
import { validateContent } from '../utils/content-validator';
import { validateFormat } from '../utils/format-validator';

describe('PDF to Markdown Conversion', () => {
  describe('arxiv-roadmap (4 pages)', () => {
    let fixture: Fixture;
    let pdfService: PdfService;
    let result: ConversionResult;
    let parsed: ParsedMarkdown;

    beforeAll(async () => {
      // 1. Load fixture (PDF + expected.json)
      fixture = await loadFixture('arxiv-roadmap');

      // 2. Create PDF service for Node.js environment
      pdfService = await createPdfService(fixture.pdfBuffer, 'node');

      // 3. Run full conversion pipeline
      result = await convertPdfToMarkdown(pdfService, {
        apiKey: process.env.GEMINI_API_KEY!,
      });

      // 4. Parse resulting markdown
      parsed = parseMarkdown(result.markdown);

      // Debug output
      console.log('\n--- Conversion Result ---');
      console.log('Markdown length:', result.markdown.length);
      console.log('Headings found:', parsed.headings.length);
      console.log('Images found:', parsed.images.length);
      console.log('Tables found:', parsed.tables.length);
      console.log('Code blocks found:', parsed.codeBlocks.length);
      console.log('\n--- Markdown Preview (first 2000 chars) ---');
      console.log(result.markdown.substring(0, 2000));
    });

    afterAll(() => {
      pdfService?.destroy();
    });

    it('validates document structure', () => {
      const structureResult = validateStructure(parsed.headings, fixture.expected.structure);

      // Log structure validation details
      console.log('\n--- Structure Validation ---');
      console.log('Heading counts:', structureResult.headingCounts);
      console.log('Expected counts:', fixture.expected.structure.headings.byLevel);
      console.log('Hierarchy valid:', structureResult.hierarchyValid);
      if (structureResult.hierarchyErrors.length > 0) {
        console.log('Hierarchy errors:', structureResult.hierarchyErrors);
      }

      // Check heading matches
      const passedMatches = structureResult.headingMatches.filter((m) => m.passed).length;
      const totalExpected = fixture.expected.structure.headings.items.length;
      console.log(`Heading text matches: ${passedMatches}/${totalExpected}`);

      // Assertions
      expect(structureResult.hierarchyValid).toBe(true);
      expect(passedMatches).toBeGreaterThan(totalExpected * 0.8); // 80% match threshold
    });

    it('validates content extraction', () => {
      const contentResult = validateContent(
        parsed.images,
        parsed.tables,
        parsed.codeBlocks,
        fixture.expected.content
      );

      // Log content validation details
      console.log('\n--- Content Validation ---');
      console.log(
        `Images: ${contentResult.images.count}/${contentResult.images.expected} (valid: ${contentResult.images.valid})`
      );
      console.log(
        `Tables: ${contentResult.tables.count}/${contentResult.tables.expected} (valid: ${contentResult.tables.valid})`
      );
      console.log(
        `Code blocks: ${contentResult.codeBlocks.count}/${contentResult.codeBlocks.expected} (valid: ${contentResult.codeBlocks.valid})`
      );

      // Assertions (with tolerance)
      expect(contentResult.images.valid).toBe(true);
      expect(contentResult.tables.valid).toBe(true);
      expect(contentResult.codeBlocks.valid).toBe(true);
    });

    it('validates markdown format', () => {
      const formatResult = validateFormat(result.markdown);

      // Log format validation details
      console.log('\n--- Format Validation ---');
      console.log('Parseable:', formatResult.parseable);
      if (formatResult.errors.length > 0) {
        console.log('Errors:', formatResult.errors);
      }
      if (formatResult.warnings.length > 0) {
        console.log('Warnings:', formatResult.warnings);
      }

      // Assertions
      expect(formatResult.parseable).toBe(true);
      expect(formatResult.errors).toHaveLength(0);
    });
  });

  describe('arxiv-guidelines (10 pages)', () => {
    let fixture: Fixture;
    let pdfService: PdfService;
    let result: ConversionResult;
    let parsed: ParsedMarkdown;

    beforeAll(async () => {
      // 1. Load fixture
      fixture = await loadFixture('arxiv-guidelines');

      // 2. Create PDF service for Node.js environment
      pdfService = await createPdfService(fixture.pdfBuffer, 'node');

      // 3. Run full conversion pipeline
      result = await convertPdfToMarkdown(pdfService, {
        apiKey: process.env.GEMINI_API_KEY!,
      });

      // 4. Parse resulting markdown
      parsed = parseMarkdown(result.markdown);

      // Debug output
      console.log('\n--- Conversion Result (arxiv-guidelines) ---');
      console.log('Markdown length:', result.markdown.length);
      console.log('Headings found:', parsed.headings.length);
      console.log('Images found:', parsed.images.length);
      console.log('Tables found:', parsed.tables.length);
      console.log('Code blocks found:', parsed.codeBlocks.length);
    });

    afterAll(() => {
      pdfService?.destroy();
    });

    it('validates document structure', () => {
      const structureResult = validateStructure(parsed.headings, fixture.expected.structure);

      console.log('\n--- Structure Validation (arxiv-guidelines) ---');
      console.log('Heading counts:', structureResult.headingCounts);
      console.log('Expected counts:', fixture.expected.structure.headings.byLevel);
      console.log('Hierarchy valid:', structureResult.hierarchyValid);

      const passedMatches = structureResult.headingMatches.filter((m) => m.passed).length;
      const totalExpected = fixture.expected.structure.headings.items.length;
      console.log(`Heading text matches: ${passedMatches}/${totalExpected}`);

      expect(structureResult.hierarchyValid).toBe(true);
      expect(passedMatches).toBeGreaterThan(totalExpected * 0.8);
    });

    it('validates content extraction', () => {
      const contentResult = validateContent(
        parsed.images,
        parsed.tables,
        parsed.codeBlocks,
        fixture.expected.content
      );

      console.log('\n--- Content Validation (arxiv-guidelines) ---');
      console.log(
        `Images: ${contentResult.images.count}/${contentResult.images.expected} (valid: ${contentResult.images.valid})`
      );
      console.log(
        `Tables: ${contentResult.tables.count}/${contentResult.tables.expected} (valid: ${contentResult.tables.valid})`
      );
      console.log(
        `Code blocks: ${contentResult.codeBlocks.count}/${contentResult.codeBlocks.expected} (valid: ${contentResult.codeBlocks.valid})`
      );

      expect(contentResult.images.valid).toBe(true);
      expect(contentResult.tables.valid).toBe(true);
      expect(contentResult.codeBlocks.valid).toBe(true);
    });

    it('validates markdown format', () => {
      const formatResult = validateFormat(result.markdown);

      console.log('\n--- Format Validation (arxiv-guidelines) ---');
      console.log('Parseable:', formatResult.parseable);
      if (formatResult.warnings.length > 0) {
        console.log('Warnings:', formatResult.warnings);
      }

      expect(formatResult.parseable).toBe(true);
      expect(formatResult.errors).toHaveLength(0);
    });
  });

  describe('kindle-manual (55 pages)', () => {
    let fixture: Fixture;
    let pdfService: PdfService;
    let result: ConversionResult;
    let parsed: ParsedMarkdown;

    beforeAll(async () => {
      // 1. Load fixture
      fixture = await loadFixture('kindle-manual');

      // 2. Create PDF service for Node.js environment
      pdfService = await createPdfService(fixture.pdfBuffer, 'node');

      // 3. Run full conversion pipeline
      result = await convertPdfToMarkdown(pdfService, {
        apiKey: process.env.GEMINI_API_KEY!,
      });

      // 4. Parse resulting markdown
      parsed = parseMarkdown(result.markdown);

      // Debug output
      console.log('\n--- Conversion Result (kindle-manual) ---');
      console.log('Markdown length:', result.markdown.length);
      console.log('Headings found:', parsed.headings.length);
      console.log('Images found:', parsed.images.length);
      console.log('Tables found:', parsed.tables.length);
      console.log('Code blocks found:', parsed.codeBlocks.length);
    }, 600000); // 10 minute timeout for 55 pages

    afterAll(() => {
      pdfService?.destroy();
    });

    it('validates document structure', () => {
      const structureResult = validateStructure(parsed.headings, fixture.expected.structure);

      console.log('\n--- Structure Validation (kindle-manual) ---');
      console.log('Heading counts:', structureResult.headingCounts);
      console.log('Expected counts:', fixture.expected.structure.headings.byLevel);
      console.log('Hierarchy valid:', structureResult.hierarchyValid);

      const passedMatches = structureResult.headingMatches.filter((m) => m.passed).length;
      const totalExpected = fixture.expected.structure.headings.items.length;
      console.log(`Heading text matches: ${passedMatches}/${totalExpected}`);

      expect(structureResult.hierarchyValid).toBe(true);
      expect(passedMatches).toBeGreaterThan(totalExpected * 0.8);
    });

    it('validates content extraction', () => {
      const contentResult = validateContent(
        parsed.images,
        parsed.tables,
        parsed.codeBlocks,
        fixture.expected.content
      );

      console.log('\n--- Content Validation (kindle-manual) ---');
      console.log(
        `Images: ${contentResult.images.count}/${contentResult.images.expected} (valid: ${contentResult.images.valid})`
      );
      console.log(
        `Tables: ${contentResult.tables.count}/${contentResult.tables.expected} (valid: ${contentResult.tables.valid})`
      );
      console.log(
        `Code blocks: ${contentResult.codeBlocks.count}/${contentResult.codeBlocks.expected} (valid: ${contentResult.codeBlocks.valid})`
      );

      expect(contentResult.images.valid).toBe(true);
      expect(contentResult.tables.valid).toBe(true);
      expect(contentResult.codeBlocks.valid).toBe(true);
    });

    it('validates markdown format', () => {
      const formatResult = validateFormat(result.markdown);

      console.log('\n--- Format Validation (kindle-manual) ---');
      console.log('Parseable:', formatResult.parseable);
      if (formatResult.warnings.length > 0) {
        console.log('Warnings:', formatResult.warnings);
      }

      expect(formatResult.parseable).toBe(true);
      expect(formatResult.errors).toHaveLength(0);
    });
  });
});
