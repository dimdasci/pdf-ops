# PDF to Markdown Translator

Electron desktop app converting PDFs to structured Markdown using LLM vision (Claude/Gemini).

## Prerequisites

- **Node.js** 18+ (recommended: 20+)
- **npm** 8+
- **API Key** from [Anthropic](https://console.anthropic.com/) or [Google AI Studio](https://aistudio.google.com/)

## Getting Started

```bash
# 1. Clone the repository
git clone https://github.com/dimdasci/pdf-translator.git
cd pdf-translator

# 2. Install dependencies
npm install

# 3. Start the application (development mode)
npm start
```

On first launch, open Settings (gear icon) and enter your API key for Claude or Gemini.

## Architecture

```
┌─────────────────┐     IPC      ┌─────────────────┐
│  Main Process   │◄────────────►│ Renderer Process│
│ (electron/)     │   (preload)  │  (src/ React)   │
├─────────────────┤              ├─────────────────┤
│ Node.js, fs     │              │ React 19, DOM   │
│ safeStorage     │              │ pdf.js viewer   │
│ IPC handlers    │              │ Conversion UI   │
└─────────────────┘              └─────────────────┘
```

**Pipeline Flow:**

```
PDF → classifyComplexity() → select pipeline → multi-pass convert → merge
```

**Providers:** Claude (native PDF, 200K ctx) | Gemini (image-based, 2M ctx)

See [docs/architecture.md](docs/architecture.md) for details.

## Development

```bash
npm install            # Install dependencies
npm start              # Dev mode with HMR
npm run build          # Production build
npm run package        # Create distributable (electron-builder)
```

## Testing

```bash
npm run test:e2e                   # Conversion accuracy (Gemini)
PROVIDER=claude npm run test:e2e   # With Claude provider
npm run test:components            # React component tests
npm run test:integration           # Electron IPC tests
npm run test:unit                  # Effect unit tests
```

**Fixtures:** `tests/fixtures/{name}/source.pdf + expected.json`

See [docs/requirements/testing.md](docs/requirements/testing.md) for test strategy.

## Code Quality

```bash
npm run format         # dprint formatter
npm run lint:fix       # ESLint with auto-fix
npm run typecheck      # TypeScript strict check
```

Pre-commit hooks run: typecheck → format → lint (via Husky).

**Style:** no-semicolons, single-quotes, 2-space indent, trailing-commas.

## Deployment

**Build outputs:**

- `dist/` - Renderer (Vite build)
- `dist-electron/` - Main process

**Packaging:** electron-builder config in `package.json`

**API Keys:** Encrypted via `safeStorage` at `app.getPath('userData')/config.enc`

## Key Files

| Path                                 | Purpose                      |
| ------------------------------------ | ---------------------------- |
| `electron/main.ts`                   | Main process, IPC handlers   |
| `electron/preload.ts`                | Context bridge (electronAPI) |
| `src/lib/pipeline/index.ts`          | `convertDocument()` entry    |
| `src/lib/llm/types.ts`               | LLMProvider interface        |
| `src/lib/pipeline/effect-wrapper.ts` | Retry/rate-limit utilities   |

## Tech Stack

Electron | React 19 | TypeScript (strict) | Effect.ts | Vite | dprint | ESLint
