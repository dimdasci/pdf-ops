# PDF to Markdown Converter - Implementation Plan

## 1. Project Scaffold
- [x] Initialize Electron app with Vite, React, and TypeScript.
- [x] Configure Tailwind CSS for styling.
- [x] Set up Main and Renderer processes with IPC bridge.
- [x] Configure secure storage for API keys.

## 2. Core Features
- [ ] **Secure Storage**: Implement UI to input and save Gemini API keys using `safeStorage`.
- [ ] **PDF Viewer**:
    - Use `pdfjs-dist` to render PDF pages.
    - Implement navigation (Next/Prev, Jump to page).
    - Extract and display metadata (Page count, Creation date).
    - Extract and display Table of Contents (if available).
- [ ] **Markdown Editor**:
    - Split-pane view: PDF on left, Markdown on right.
    - Real-time Markdown rendering using `react-markdown`.
    - Editable text area for manual corrections.

## 3. Gemini Integration (Conversion Logic)
- [ ] **API Client**: Setup Google Generative AI client.
- [ ] **Pass 1: Document Analysis**:
    - Extract text from first few pages or TOC pages.
    - Detect: Language, TOC existence, Authors, Date, Image/Table count estimates.
- [ ] **Pass 2: Page-by-Page Conversion**:
    - Iterate through pages.
    - Extract text and images (as base64 or blob).
    - Prompt Gemini:
        - Context: Previous page summary, document metadata.
        - Request: Markdown content, preserving structure, tables, and handling footnotes.
        - Images: Ask Gemini to place placeholders or describe them (or handle extraction separately and insert references). *Refinement: We will extract images using pdf.js and insert them into the markdown.*
- [ ] **Post-Processing**:
    - Assemble pages into a single Markdown document.
    - formatting cleanup.

## 4. UI/UX
- [ ] **Dashboard**:
    - Drag-and-drop zone for PDF files.
    - Settings modal for API Key.
- [ ] **Workspace**:
    - Toolbar: Page navigation, Convert button, Save button.
    - Status indicators: Analyzing, Converting Page X/Y.
    - Error handling display.

## 5. Saving
- [ ] Save final Markdown to disk.
- [ ] (Optional) Save extracted images to a folder alongside markdown.
