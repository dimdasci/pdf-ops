# PDF to Markdown Translator

A desktop application powered by Electron, React, and Google Gemini to convert PDF documents into structured Markdown files.

## Features

- **Secure API Key Storage**: Safely stores your Google Gemini API key using `safeStorage`.
- **PDF Viewer**: Built-in PDF viewer with page navigation.
- **AI-Powered Conversion**: Uses Gemini 1.5 Flash for intelligent document analysis and conversion.
  - **Structure Preservation**: Maintains headers, lists, and tables.
  - **Image Handling**: Describes and references images.
  - **Context Aware**: Converts page-by-page while maintaining context.
- **Split-View Editor**: Preview the generated Markdown side-by-side with the PDF.
- **Export**: Save the converted Markdown file to your disk.

## Installation

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```

## Development

Run the application in development mode with hot-reloading:

```bash
npm start
```

## Build

Build the application for production:

```bash
npm run build
```

The output will be in the `dist-electron` and `dist` directories. You can package it using `electron-builder` (configuration not included in this prototype but dependencies are installed).

## Usage

1. Launch the application.
2. Click the Settings icon (gear) in the top right to enter your Google Gemini API Key.
3. Drag and drop a PDF file onto the window or click to browse.
4. Review the PDF in the left pane.
5. Click **Convert** to start the process.
6. Watch the Markdown generate in real-time on the right.
7. Click the **Save** icon to export the result.
