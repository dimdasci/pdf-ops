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
  ): Promise<{ content: string; images: Record<string, number[]> }> {
    const prompt = `
      You are an expert document converter. Your task is to convert the attached image of a document page (Page ${context.pageNumber} of ${context.totalPages}) into high-quality Markdown.
      
      STEP 1: REASONING
      - Identify all visual elements (photos, charts, diagrams, vector logos) that should be preserved.
      - For each element, estimate its Bounding Box [ymin, xmin, ymax, xmax] on a scale of 0-1000 (0,0 is top-left).
      
      STEP 2: CONVERSION
      Generate the Markdown content:
      1. Preserve structure (headers, lists).
      2. For EVERY visual element identified, insert a placeholder: \`![Description](img_placeholder_X)\` where X is a unique ID (e.g., "1", "logo", "chart").
      3. Do NOT use the previously mentioned "extracted images" logic. Rely purely on what you see.
      
      STEP 3: COORDINATES (Crucial)
      At the VERY END of your response, output a JSON block mapping the placeholder IDs to their coordinates.
      KEYS must be the exact string used inside the parenthesis in the markdown (e.g., "img_placeholder_1").
      Format:
      \`\`\`json
      {
        "img_placeholder_1": [ymin, xmin, ymax, xmax],
        "img_placeholder_logo": [0, 0, 150, 200]
      }
      \`\`\`
      
      Output format:
      [REASONING]
      ...
      [CONTENT]
      ... markdown ...
      [COORDINATES]
      \`\`\`json
      ...
      \`\`\`
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
      
      // Extract Content
      const contentMatch = text.match(/\[CONTENT\]([\s\S]*?)(\[COORDINATES\]|$)/i);
      const content = contentMatch ? contentMatch[1].trim() : text;

      // Extract Coordinates
      const coordMatch = text.match(/\[COORDINATES\]\s*`{3}json([\s\S]*?)`{3}/i);
      let images = {};
      if (coordMatch) {
          try {
              images = JSON.parse(coordMatch[1]);
          } catch (e) {
              console.error("Failed to parse coordinates JSON", e);
          }
      }

      return { content, images };
    } catch (error) {
      console.error(`Page ${context.pageNumber} conversion failed:`, error);
      return { content: `\n\n[Error converting page ${context.pageNumber}]\n\n`, images: {} };
    }
  }
}
