# PDF to Markdown Converter - Implementation Plan

## 1. Project Scaffold
- [x] Initialize Electron app with Vite, React, and TypeScript.
- [x] Configure Tailwind CSS for styling (v4).
- [x] Set up Main and Renderer processes with IPC bridge.
- [x] Configure secure storage for API keys using `safeStorage`.

## 2. Core Features
- [x] **Secure Storage**: Implement UI to input and save Gemini API keys.
- [x] **PDF Viewer**:
    - [x] Use `pdfjs-dist` to render PDF pages.
    - [x] Implement navigation (Next/Prev).
    - [x] Extract and display metadata (Page count).
    - [x] Extract and display Table of Contents.
    - [x] Robust rendering with cancellation logic.
- [x] **Markdown Editor**:
    - [x] Split-pane view: PDF on left, Markdown on right.
    - [x] Real-time Markdown rendering using `react-markdown`.
    - [x] Editable text area for manual corrections.

## 3. Gemini Integration (Conversion Logic)
- [x] **API Client**: Setup Google Generative AI client (Gemini 2.5 Flash).
- [x] **Pass 1: Document Analysis**:
    - [x] Extract text from first few pages.
    - [x] Detect: Language and TOC existence.
- [x] **Pass 2: Page-by-Page Conversion**:
    - [x] Iterate through pages with visual context (images).
    - [x] Reasoning technique: Analyze for tables, images, and footnotes before generation.
    - [x] Extract images from PDF and embed as data URLs in Markdown.
- [ ] **Post-Processing**:
    - [x] Progressive assembly of pages into document.
    - [ ] Formatting cleanup and structural refinement.

## 4. UI/UX
- [x] **Dashboard**:
    - [x] Drag-and-drop zone for PDF files using `webUtils.getPathForFile`.
    - [x] Settings modal for API Key (Portal-based for visibility).
- [x] **Workspace**:
    - [x] Toolbar: Page navigation, Convert button, Save button.
    - [x] Status indicators: Analyzing, Converting Page X/Y.
    - [x] Error handling and safety checks.
- [ ] **Polishing**:
    - [ ] Visual aesthetic improvements.
    - [ ] Better TOC navigation (jump to page).

## 5. Saving
- [x] Save final Markdown to disk via native dialog.
- [ ] (Optional) Save extracted images to a folder alongside markdown.