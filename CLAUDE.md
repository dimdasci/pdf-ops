# PDF to Markdown Translator

## Project Overview

Desktop application built with Electron and TypeScript to convert PDF documents into Markdown files using Gemini LLMs.

## Tech Stack

- **Framework**: Electron
- **Language**: TypeScript
- **AI**: Google Gemini LLMs
- **Build**: Electron Builder (recommended)

## Architecture

### Main Process
- File system operations
- Secure API key storage (electron-store with encryption or keytar)
- PDF processing coordination

### Renderer Process
- React or Vue for UI (TBD)
- PDF viewer component
- Markdown editor/preview
- Settings management

## Core Features

### 1. Settings
- Gemini API key input
- Secure storage of credentials

### 2. Document Loading
- Open file dialog
- Drag-and-drop support
- Display metadata: page count, creation date

### 3. PDF Viewer
- Page-by-page navigation
- Table of contents display (if embedded)

### 4. Conversion Pipeline (Multi-pass with Gemini)

**Pass 1 - Document Analysis:**
- Language detection
- TOC presence and page ranges
- Authors and dates
- Count of tables and images

**Pass 2 - Structure Extraction:**
- Extract or infer document outline/TOC
- Determine heading hierarchy

**Pass 3 - Page-by-page Conversion:**
- Provide document context and previous page content
- Use reasoning prompts (detect images, tables, footnotes first)
- Generate Markdown content

### 5. Content Preservation
- **Headers**: Correct hierarchy based on TOC
- **Images**: Extract and embed as inline Markdown images
- **Tables**: Preserve structure in Markdown format
- **Footnotes**: Place after the paragraph where referenced

### 6. Review Interface
- Side-by-side view: PDF page | Markdown output
- Edit capability for corrections

### 7. Export
- Save Markdown file to disk

## Footnote Best Practices

Recommended approach for footnotes in Markdown:
1. Use inline footnote syntax: `[^1]` with definition `[^1]: footnote text`
2. Place footnote definitions immediately after the paragraph containing the reference
3. For academic documents, consider grouping at section end
4. Maintain original numbering from PDF when possible

## Development Commands

```bash
# Install dependencies
npm install

# Run in development
npm run dev

# Build for production
npm run build

# Package application
npm run package
```

## Project Structure (Recommended)

```
src/
├── main/           # Electron main process
│   ├── index.ts
│   ├── ipc/        # IPC handlers
│   └── services/   # PDF processing, API calls
├── renderer/       # UI layer
│   ├── components/
│   ├── pages/
│   └── stores/
├── shared/         # Shared types and utilities
└── preload/        # Preload scripts
```

## Security Considerations

- Store API keys using OS keychain (keytar) or encrypted storage
- Validate all file inputs
- Sanitize Markdown output
- Use context isolation in Electron

## Testing

See [docs/requirements/testing.md](docs/requirements/testing.md) for E2E testing specification.
