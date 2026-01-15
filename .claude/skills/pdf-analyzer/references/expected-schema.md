# ExpectedSchema Reference

TypeScript interface for test fixture expectations. Located at `tests/utils/fixture-loader.ts`.

## Full Interface

```typescript
interface ExpectedSchema {
  metadata: {
    name: string // Fixture directory name (e.g., "kindle-manual")
    pageCount: number // Total PDF pages
    language: string // ISO 639-1 code (e.g., "en", "de", "fr")
  }

  structure: {
    headings: {
      byLevel: {
        h1: number // Count of H1 headings
        h2: number // Count of H2 headings
        h3: number // Count of H3 headings
        h4: number // Count of H4 headings
        h5: number // Count of H5 headings
        h6: number // Count of H6 headings
      }
      items: Array<{
        level: number // 1-6
        text: string // Exact heading text as it appears
      }>
    }
    hierarchyValid: boolean // true if no skipped levels (e.g., H1->H3 is invalid)
  }

  content: {
    images: {
      count: number // Total content images (excluding decorative)
      minDimensions?: { // Optional minimum size filter
        width: number
        height: number
      }
    }
    tables: {
      count: number // Total data tables
      details?: Array<{ // Optional per-table dimensions
        rows: number // Including header row
        columns: number
      }>
    }
    codeBlocks: {
      count: number // Total code blocks
      languages: string[] // Detected languages (e.g., ["python", "bash"])
    }
  }

  format: {
    shouldParse: boolean // Expect output to be valid parseable Markdown
    allowedWarnings?: string[] // Warnings that are acceptable
  }
}
```

## Field Guidelines

### metadata.name

Use the fixture directory name, not the PDF filename.

- Correct: `"kindle-manual"`
- Incorrect: `"Kindle User Guide.pdf"`

### metadata.language

Use ISO 639-1 two-letter codes:

- English: `"en"`
- German: `"de"`
- French: `"fr"`
- Spanish: `"es"`

### structure.headings.items

List headings in document order. Include exact text as it appears (preserve case, punctuation).

### structure.hierarchyValid

Set to `false` if document has skipped heading levels:

- Valid: H1 -> H2 -> H3 -> H2 -> H3
- Invalid: H1 -> H3 (skipped H2)

### content.images.count

Count meaningful content images:

- Include: Figures, diagrams, charts, screenshots, photos
- Exclude: Logos, icons, decorative borders, background images

### content.tables.details

Optional but recommended for precise validation. Count header row in `rows`.

### content.codeBlocks.languages

Empty array `[]` if no code blocks or languages not identifiable.

### format.shouldParse

Almost always `true`. Set `false` only for intentionally malformed test cases.

## Example

```json
{
  "metadata": {
    "name": "kindle-manual",
    "pageCount": 42,
    "language": "en"
  },
  "structure": {
    "headings": {
      "byLevel": {
        "h1": 1,
        "h2": 8,
        "h3": 15,
        "h4": 3,
        "h5": 0,
        "h6": 0
      },
      "items": [
        { "level": 1, "text": "Kindle User's Guide" },
        { "level": 2, "text": "Chapter 1: Getting Started" },
        { "level": 3, "text": "Registering Your Kindle" },
        { "level": 3, "text": "Charging Your Kindle" }
      ]
    },
    "hierarchyValid": true
  },
  "content": {
    "images": {
      "count": 12
    },
    "tables": {
      "count": 2,
      "details": [
        { "rows": 5, "columns": 2 },
        { "rows": 8, "columns": 3 }
      ]
    },
    "codeBlocks": {
      "count": 0,
      "languages": []
    }
  },
  "format": {
    "shouldParse": true
  }
}
```
