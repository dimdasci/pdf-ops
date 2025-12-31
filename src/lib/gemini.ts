import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai";

export class GeminiService {
  private genAI: GoogleGenerativeAI;
  private model: GenerativeModel;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  }

  async analyzeDocumentStructure(firstPagesText: string): Promise<{ language: string; hasTOC: boolean }> {
    const prompt = `
      Analyze the following text from the beginning of a document. 
      Identify the language and whether it contains a Table of Contents (TOC).
      Return ONLY a JSON object like: { "language": "English", "hasTOC": true }
      
      Text:
      ${firstPagesText.substring(0, 5000)}
    `;

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      // Basic cleanup to extract JSON
      const jsonMatch = text.match(/\{.*\}/s);
      if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
      }
      return { language: "Unknown", hasTOC: false };
    } catch (error) {
      console.error("Gemini analysis failed:", error);
      return { language: "Unknown", hasTOC: false };
    }
  }

  async convertPage(
    pageImageBase64: string, 
    context: { previousContent: string; pageNumber: number, totalPages: number }
  ): Promise<string> {
    const prompt = `
      You are an expert document converter. Your task is to convert the attached image of a document page (Page ${context.pageNumber} of ${context.totalPages}) into high-quality Markdown.
      
      STEP 1: REASONING
      Before generating the markdown, analyze the page and answer:
      - Are there any images or charts? (Describe their position and content)
      - Are there any tables? (Identify columns and rows)
      - are there any footnotes? (Look for small superscript numbers and corresponding text at the bottom)
      - What is the logical heading level for this page?
      
      STEP 2: CONVERSION
      Now, generate the Markdown content following these rules:
      1. Preserve the logical structure (headers, lists, paragraphs).
      2. Format tables as standard GitHub-Flavored Markdown tables.
      3. For images, use the following syntax: ![Description of image](image_placeholder_${context.pageNumber}_X) where X is the sequential number of the image on the page (1, 2, 3...).
      4. Place footnotes immediately after the paragraph where they are cited, using a blockquote or a clear "Footnote:" prefix.
      5. Ensure mathematical formulas are in LaTeX if applicable.
      6. Do NOT output standard markdown "frontmatter" or code block fences (\\\`\\\`\\\`). Just the content.
      7. Maintain continuity from the previous page: ...${context.previousContent.slice(-300)}

      
      Output format:
      [REASONING]
      (Your analysis here)
      
      [CONTENT]
      (Your markdown here)
    `;

    try {
      const result = await this.model.generateContent([
        prompt,
        {
            inlineData: {
                data: pageImageBase64,
                mimeType: "image/png"
            }
        }
      ]);
      const response = await result.response;
      const text = response.text();
      
      // Extract only the content part for the final document, 
      // but we could also log the reasoning.
      const contentMatch = text.match(/\[CONTENT\]([\s\S]*)/i);
      return contentMatch ? contentMatch[1].trim() : text;
    } catch (error) {
      console.error(`Page ${context.pageNumber} conversion failed:`, error);
      return `\n\n[Error converting page ${context.pageNumber}]\n\n`;
    }
  }
}
