/**
 * Claude LLM Provider implementation using Anthropic SDK.
 * Supports native PDF processing and vision capabilities.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  LLMProvider,
  ProviderCapabilities,
  ClaudeProviderConfig,
  DocumentAnalysis,
  DocumentStructure,
  PageContext,
  PageConversionResult,
  WindowContext,
  WindowResult,
  HeadingInfo,
  SectionInfo,
  ImageInfo,
} from './types';

// Model configuration
const MODEL_SONNET = 'claude-sonnet-4-5-20250929'; // For complex tasks
const MODEL_HAIKU = 'claude-haiku-4-5-20251001';   // For simple tasks
const DEFAULT_MODEL = MODEL_SONNET;
const MAX_RETRIES = 3;
const DEFAULT_TIMEOUT = 120000; // 2 minutes

export class ClaudeProvider implements LLMProvider {
  readonly name = 'claude';
  readonly displayName = 'Claude (Anthropic)';
  readonly capabilities: ProviderCapabilities = {
    supportsNativePdf: true,
    maxPdfPages: 100,
    maxImageSize: 20 * 1024 * 1024, // 20MB
    maxContextTokens: 200000,
    hasRecitationFilter: false,
    supportedImageFormats: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  };

  private client: Anthropic;
  private model: string;        // Sonnet for complex tasks
  private modelLight: string;   // Haiku for simple tasks
  private maxRetries: number;

  constructor(config: ClaudeProviderConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      timeout: config.timeout || DEFAULT_TIMEOUT,
      maxRetries: config.maxRetries || MAX_RETRIES,
    });
    this.model = config.model || MODEL_SONNET;
    this.modelLight = MODEL_HAIKU;
    this.maxRetries = config.maxRetries || MAX_RETRIES;
  }

  // ===========================================================================
  // Document-Level Operations
  // ===========================================================================

  async analyzeDocument(pdfData: Uint8Array | string): Promise<DocumentAnalysis> {
    const prompt = `Analyze this document and extract the following information. Return ONLY a JSON object with no additional text.

Required fields:
- language: The primary language of the document (e.g., "English", "Spanish", "German")
- hasTOC: Boolean indicating if the document has a Table of Contents
- pageCount: Number of pages (estimate if not easily determinable)
- estimatedImages: Approximate number of images/figures
- estimatedTables: Approximate number of tables
- estimatedCodeBlocks: Approximate number of code blocks
- headerPattern: Common header text that appears on most pages (null if none)
- footerPattern: Common footer text that appears on most pages (null if none)
- contentType: One of "invoice", "report", "manual", "academic", "form", "other"
- textDensity: One of "sparse", "normal", "dense"

Example output:
{
  "language": "English",
  "hasTOC": true,
  "pageCount": 55,
  "estimatedImages": 30,
  "estimatedTables": 5,
  "estimatedCodeBlocks": 0,
  "headerPattern": "Kindle Paperwhite User Guide",
  "footerPattern": null,
  "contentType": "manual",
  "textDensity": "normal"
}`;

    try {
      // Detect if input is plain text or PDF binary
      const isPlainText = typeof pdfData === 'string' && this.isPlainText(pdfData);

      let response;
      if (isPlainText) {
        // Text-based analysis (from light pipeline)
        response = await this.client.messages.create({
          model: this.model,
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: `${prompt}\n\nDocument text:\n${pdfData}`,
            },
          ],
        });
      } else {
        // Native PDF analysis
        const base64Data = typeof pdfData === 'string'
          ? pdfData
          : this.uint8ArrayToBase64(pdfData);

        response = await this.client.messages.create({
          model: this.model,
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'document',
                  source: {
                    type: 'base64',
                    media_type: 'application/pdf',
                    data: base64Data,
                  },
                },
                {
                  type: 'text',
                  text: prompt,
                },
              ],
            },
          ],
        });
      }

      const text = this.extractTextFromResponse(response);
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      return JSON.parse(jsonMatch[0]) as DocumentAnalysis;
    } catch (error) {
      console.error('Document analysis failed:', error);
      // Return defaults on failure
      return {
        language: 'Unknown',
        hasTOC: false,
        pageCount: 0,
        estimatedImages: 0,
        estimatedTables: 0,
        estimatedCodeBlocks: 0,
        headerPattern: null,
        footerPattern: null,
        contentType: 'other',
        textDensity: 'normal',
      };
    }
  }

  /**
   * Detect if a string is plain text (vs base64 encoded binary)
   */
  private isPlainText(str: string): boolean {
    // Plain text typically contains spaces, newlines, and common punctuation
    // Base64 only contains A-Z, a-z, 0-9, +, /, =
    const plainTextIndicators = /[\s\n\r.,!?;:'"()\[\]{}]/;
    return plainTextIndicators.test(str);
  }

  async extractStructure(
    pdfData: Uint8Array | string,
    analysis: DocumentAnalysis
  ): Promise<DocumentStructure> {
    const prompt = `Extract the document structure. I need a complete heading hierarchy.

Document context:
- Language: ${analysis.language}
- Has TOC: ${analysis.hasTOC}
- Content type: ${analysis.contentType}

Return ONLY a JSON object with this structure:
{
  "headings": [
    { "level": 1, "text": "Chapter 1: Introduction", "page": 1 },
    { "level": 2, "text": "Getting Started", "page": 2 },
    ...
  ],
  "maxDepth": 3
}

Rules:
1. Include ALL headings from level 1 to 6
2. Preserve exact heading text
3. Include accurate page numbers
4. Order headings by their appearance in the document
5. If the document has a TOC, use it as the primary source
6. If no TOC, infer headings from visual formatting (larger/bold text, numbering patterns)`;

    try {
      // Detect if input is plain text or PDF binary
      const isPlainText = typeof pdfData === 'string' && this.isPlainText(pdfData);

      let response;
      if (isPlainText) {
        // Text-based structure extraction (from light pipeline)
        response = await this.client.messages.create({
          model: this.model,
          max_tokens: 8192,
          messages: [
            {
              role: 'user',
              content: `${prompt}\n\nDocument text:\n${pdfData}`,
            },
          ],
        });
      } else {
        // Native PDF structure extraction
        const base64Data = typeof pdfData === 'string'
          ? pdfData
          : this.uint8ArrayToBase64(pdfData);

        response = await this.client.messages.create({
          model: this.model,
          max_tokens: 8192,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'document',
                  source: {
                    type: 'base64',
                    media_type: 'application/pdf',
                    data: base64Data,
                  },
                },
                {
                  type: 'text',
                  text: prompt,
                },
              ],
            },
          ],
        });
      }

      const text = this.extractTextFromResponse(response);
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const headings: HeadingInfo[] = parsed.headings || [];

      // Build sections tree from flat headings
      const sections = this.buildSectionTree(headings, analysis.pageCount);

      // Build headings by page map
      const headingsByPage = new Map<number, HeadingInfo[]>();
      for (const heading of headings) {
        const pageHeadings = headingsByPage.get(heading.page) || [];
        pageHeadings.push(heading);
        headingsByPage.set(heading.page, pageHeadings);
      }

      return {
        headings,
        sections,
        headingsByPage,
        maxDepth: parsed.maxDepth || Math.max(...headings.map(h => h.level), 1),
      };
    } catch (error) {
      console.error('Structure extraction failed:', error);
      return {
        headings: [],
        sections: [],
        headingsByPage: new Map(),
        maxDepth: 0,
      };
    }
  }

  // ===========================================================================
  // Page-Level Operations
  // ===========================================================================

  async convertPage(
    imageBase64: string,
    context: PageContext
  ): Promise<PageConversionResult> {
    const prompt = this.buildPageConversionPrompt(context);

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: imageBase64,
                },
              },
              {
                type: 'text',
                text: prompt,
              },
            ],
          },
        ],
      });

      const text = this.extractTextFromResponse(response);
      return this.parsePageConversionResponse(text, context.pageNumber);
    } catch (error) {
      console.error(`Page ${context.pageNumber} conversion failed:`, error);
      return {
        content: `\n\n[Error converting page ${context.pageNumber}]\n\n`,
        images: {},
        summary: '',
        lastParagraph: '',
        warnings: [(error as Error).message],
      };
    }
  }

  async convertWindow(
    pdfData: Uint8Array | string,
    context: WindowContext
  ): Promise<WindowResult> {
    const base64Data = typeof pdfData === 'string'
      ? pdfData
      : this.uint8ArrayToBase64(pdfData);

    const prompt = this.buildWindowConversionPrompt(context);

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 16384,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: base64Data,
                },
              },
              {
                type: 'text',
                text: prompt,
              },
            ],
          },
        ],
      });

      const text = this.extractTextFromResponse(response);
      return this.parseWindowConversionResponse(text);
    } catch (error) {
      console.error(`Window ${context.position.windowNumber} conversion failed:`, error);
      return {
        markdown: `\n\n[Error converting window ${context.position.windowNumber}]\n\n`,
        lastParagraph: '',
        summary: '',
        unresolvedReferences: [],
        detectedImages: [],
      };
    }
  }

  // ===========================================================================
  // Utility Operations
  // ===========================================================================

  async classifyImage(imageBase64: string): Promise<{
    type: ImageInfo['type'];
    description: string;
    isPureVector: boolean;
    complexity: number;
  }> {
    const prompt = `Analyze this image and classify it. Return ONLY a JSON object:
{
  "type": "photo" | "diagram" | "chart" | "logo" | "icon" | "screenshot" | "other",
  "description": "Brief description of the image content",
  "isPureVector": true/false (whether this appears to be a vector graphic),
  "complexity": 0.0-1.0 (visual complexity, 0=simple, 1=very complex)
}`;

    try {
      // Use lighter model for simple classification
      const response = await this.client.messages.create({
        model: this.modelLight,
        max_tokens: 256,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: imageBase64,
                },
              },
              {
                type: 'text',
                text: prompt,
              },
            ],
          },
        ],
      });

      const text = this.extractTextFromResponse(response);
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      return JSON.parse(jsonMatch[0]);
    } catch (error) {
      console.error('Image classification failed:', error);
      return {
        type: 'other',
        description: 'Unknown image',
        isPureVector: false,
        complexity: 0.5,
      };
    }
  }

  async summarize(content: string, maxLength = 500): Promise<string> {
    const prompt = `Summarize the following content in ${maxLength} characters or less. Focus on key points and main ideas. Return ONLY the summary text, no additional formatting.

Content:
${content}`;

    try {
      // Use lighter model for summarization
      const response = await this.client.messages.create({
        model: this.modelLight,
        max_tokens: Math.ceil(maxLength / 2), // Approximate tokens
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      return this.extractTextFromResponse(response).slice(0, maxLength);
    } catch (error) {
      console.error('Summarization failed:', error);
      return content.slice(0, maxLength);
    }
  }

  async chat(prompt: string): Promise<string> {
    // Use lighter model for general chat
    const response = await this.client.messages.create({
      model: this.modelLight,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    return this.extractTextFromResponse(response);
  }

  // ===========================================================================
  // Provider Management
  // ===========================================================================

  async validateConnection(): Promise<boolean> {
    try {
      // Use lighter model for connection validation
      await this.client.messages.create({
        model: this.modelLight,
        max_tokens: 10,
        messages: [
          {
            role: 'user',
            content: 'Say "OK" to confirm connection.',
          },
        ],
      });
      return true;
    } catch {
      return false;
    }
  }

  estimateCost(pageCount: number, complexity: number): number {
    // Claude Sonnet pricing (approximate)
    // Input: $3/million tokens, Output: $15/million tokens
    // Estimate ~2000 input tokens per page, ~1000 output tokens
    const inputTokensPerPage = 2000 + (complexity * 1000);
    const outputTokensPerPage = 1000 + (complexity * 500);

    const totalInputTokens = pageCount * inputTokensPerPage;
    const totalOutputTokens = pageCount * outputTokensPerPage;

    const inputCost = (totalInputTokens / 1_000_000) * 3;
    const outputCost = (totalOutputTokens / 1_000_000) * 15;

    return inputCost + outputCost;
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private uint8ArrayToBase64(data: Uint8Array): string {
    // Use Buffer for proper binary-to-base64 conversion in Node.js
    // Falls back to browser-compatible method if Buffer is not available
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(data).toString('base64');
    }

    // Browser fallback using btoa with proper binary handling
    let binary = '';
    const len = data.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(data[i]);
    }
    return btoa(binary);
  }

  private extractTextFromResponse(response: Anthropic.Message): string {
    const textBlock = response.content.find(block => block.type === 'text');
    return textBlock && textBlock.type === 'text' ? textBlock.text : '';
  }

  private buildPageConversionPrompt(context: PageContext): string {
    const expectedHeadingsStr = context.expectedHeadings.length > 0
      ? context.expectedHeadings.map(h => `- H${h.level}: "${h.text}"`).join('\n')
      : 'None specified';

    return `Convert this document page (Page ${context.pageNumber} of ${context.totalPages}) to high-quality Markdown.

STRUCTURE CONTEXT:
Expected headings on this page:
${expectedHeadingsStr}

Current section: ${context.currentSection || 'Unknown'}
Document language: ${context.language}

${context.previousContent ? `Previous content ended with:
"""
${context.previousContent.slice(-300)}
"""` : ''}

ELEMENTS TO EXCLUDE (repeating headers/footers):
- Header pattern: ${context.headerPattern || 'None'}
- Footer pattern: ${context.footerPattern || 'None'}

CONVERSION RULES:
1. ${context.expectedHeadings.length > 0 ? 'Use EXACTLY the heading levels specified above' : 'Infer heading levels from visual formatting'}
2. SKIP any text matching the header/footer patterns
3. Tables: Convert to GitHub-flavored markdown tables
4. Images: Insert placeholder ![Description](img_placeholder_N) and note bounding box
5. Code: Use fenced code blocks with language identifier if detectable
6. Footnotes: Use [^N] inline, place definition after the paragraph
7. If content continues from previous page, do NOT start with a new heading

OUTPUT FORMAT:
[CONTENT]
... markdown content ...
[IMAGES]
\`\`\`json
{
  "img_placeholder_1": { "bbox": [ymin, xmin, ymax, xmax], "description": "..." },
  ...
}
\`\`\`
[SUMMARY]
One-sentence summary of this page content.
[LAST_PARAGRAPH]
Last paragraph text for continuity.`;
  }

  private buildWindowConversionPrompt(context: WindowContext): string {
    const tocStr = context.global.toc.length > 0
      ? context.global.toc.map(h => {
          const marker = h.page >= context.position.startPage && h.page <= context.position.endPage
            ? ' <-- IN THIS WINDOW'
            : '';
          return `${'  '.repeat(h.level - 1)}H${h.level}: "${h.text}" (p.${h.page})${marker}`;
        }).join('\n')
      : 'No TOC available';

    const sectionsStr = context.structure.sectionsInWindow.map(s =>
      `- "${s.title}" (pages ${s.startPage}-${s.endPage})`
    ).join('\n') || 'No sections identified';

    const headingsStr = context.structure.expectedHeadings.map(h =>
      `- Page ${h.page}: H${h.level} "${h.text}"`
    ).join('\n') || 'None specified';

    return `Convert pages ${context.position.startPage}-${context.position.endPage} of a ${context.global.totalPages}-page document to Markdown.

DOCUMENT OVERVIEW:
- Language: ${context.global.language}
- Window: ${context.position.windowNumber} of ${context.position.totalWindows}
- Progress: ${context.position.percentComplete}% through document

DOCUMENT STRUCTURE (Table of Contents):
${tocStr}

SECTIONS IN THIS WINDOW:
${sectionsStr}
${context.structure.continuedSection ? `\nNOTE: This window continues "${context.structure.continuedSection}" from previous window.` : ''}

EXPECTED HEADINGS IN THIS WINDOW:
${headingsStr}

${context.continuity.previousWindowTail ? `CONTENT CONTINUITY:
Previous window ended with:
"""
${context.continuity.previousWindowTail}
"""
If the first page continues this content, do NOT add a heading - continue the paragraph.` : 'This is the start of the document.'}

ELEMENTS TO EXCLUDE (repeating on every page):
- Header: ${context.global.headerPattern || 'None detected'}
- Footer: ${context.global.footerPattern || 'None detected'}

CONVERSION RULES:
1. Use EXACTLY the heading levels from "Expected Headings" - do not infer different levels
2. Exclude text matching header/footer patterns
3. Tables → GitHub-flavored markdown tables
4. Images → ![description](img_placeholder_N) with bounding box in JSON
5. Code → fenced blocks with language
6. Footnotes → [^N] inline, definition after paragraph
7. Merge content across page boundaries naturally

${context.structure.sectionContinuesAfter ? 'NOTE: Section continues in next window - do not add artificial endings.' : ''}

OUTPUT FORMAT:
[CONTENT]
... markdown content for all pages in this window ...
[IMAGES]
\`\`\`json
{ "img_placeholder_1": { "bbox": [y1, x1, y2, x2], "description": "...", "page": N }, ... }
\`\`\`
[SUMMARY]
Brief summary of this window's content.
[LAST_PARAGRAPH]
Last paragraph text for continuity to next window.`;
  }

  private parsePageConversionResponse(text: string, pageNumber: number): PageConversionResult {
    // Extract content section
    const contentMatch = text.match(/\[CONTENT\]([\s\S]*?)(\[IMAGES\]|\[SUMMARY\]|$)/i);
    const content = contentMatch ? contentMatch[1].trim() : text;

    // Extract images
    const imagesMatch = text.match(/\[IMAGES\]\s*```json([\s\S]*?)```/i);
    let images: Record<string, ImageInfo> = {};
    if (imagesMatch) {
      try {
        const parsed = JSON.parse(imagesMatch[1]);
        images = Object.fromEntries(
          Object.entries(parsed).map(([key, value]: [string, unknown]) => {
            const v = value as { bbox?: number[]; description?: string };
            return [key, {
              id: key,
              bbox: v.bbox as [number, number, number, number] || [0, 0, 1000, 1000],
              description: v.description || 'Image',
              type: 'other' as const,
            }];
          })
        );
      } catch (e) {
        console.error(`Failed to parse images JSON on page ${pageNumber}:`, e);
      }
    }

    // Extract summary
    const summaryMatch = text.match(/\[SUMMARY\]([\s\S]*?)(\[LAST_PARAGRAPH\]|$)/i);
    const summary = summaryMatch ? summaryMatch[1].trim() : '';

    // Extract last paragraph
    const lastParagraphMatch = text.match(/\[LAST_PARAGRAPH\]([\s\S]*?)$/i);
    const lastParagraph = lastParagraphMatch ? lastParagraphMatch[1].trim() : '';

    return {
      content,
      images,
      summary,
      lastParagraph,
      warnings: [],
    };
  }

  private parseWindowConversionResponse(text: string): WindowResult {
    // Extract content section
    const contentMatch = text.match(/\[CONTENT\]([\s\S]*?)(\[IMAGES\]|\[SUMMARY\]|$)/i);
    const markdown = contentMatch ? contentMatch[1].trim() : text;

    // Extract images
    const imagesMatch = text.match(/\[IMAGES\]\s*```json([\s\S]*?)```/i);
    const detectedImages: ImageInfo[] = [];
    if (imagesMatch) {
      try {
        const parsed = JSON.parse(imagesMatch[1]);
        for (const [key, value] of Object.entries(parsed)) {
          const v = value as { bbox?: number[]; description?: string; page?: number };
          detectedImages.push({
            id: key,
            bbox: v.bbox as [number, number, number, number] || [0, 0, 1000, 1000],
            description: v.description || 'Image',
            type: 'other',
          });
        }
      } catch (e) {
        console.error('Failed to parse images JSON:', e);
      }
    }

    // Extract summary
    const summaryMatch = text.match(/\[SUMMARY\]([\s\S]*?)(\[LAST_PARAGRAPH\]|$)/i);
    const summary = summaryMatch ? summaryMatch[1].trim() : '';

    // Extract last paragraph
    const lastParagraphMatch = text.match(/\[LAST_PARAGRAPH\]([\s\S]*?)$/i);
    const lastParagraph = lastParagraphMatch ? lastParagraphMatch[1].trim() : '';

    return {
      markdown,
      lastParagraph,
      summary,
      unresolvedReferences: [],
      detectedImages,
    };
  }

  private buildSectionTree(headings: HeadingInfo[], totalPages: number): SectionInfo[] {
    if (headings.length === 0) return [];

    const sections: SectionInfo[] = [];
    const stack: { section: SectionInfo; level: number }[] = [];

    for (let i = 0; i < headings.length; i++) {
      const heading = headings[i];
      const nextHeading = headings[i + 1];
      const endPage = nextHeading ? nextHeading.page - 1 : totalPages;

      const section: SectionInfo = {
        title: heading.text,
        level: heading.level,
        startPage: heading.page,
        endPage,
        children: [],
      };

      // Pop stack until we find a parent level
      while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
        stack.pop();
      }

      if (stack.length === 0) {
        sections.push(section);
      } else {
        stack[stack.length - 1].section.children.push(section);
      }

      stack.push({ section, level: heading.level });
    }

    return sections;
  }
}
