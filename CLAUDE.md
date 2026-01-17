# PDF Translator

Electron+React+TS app: PDF→Markdown via Gemini/Claude LLMs.

## Quick Reference

| Category | Details                                                         |
| -------- | --------------------------------------------------------------- |
| Stack    | Electron \| React 19 \| TypeScript strict \| Effect.ts \| Vite  |
| Style    | no-semi \| single-quote \| 2-space \| trailing-comma \| _unused |
| Quality  | dprint → eslint → typecheck (pre-commit auto)                   |

## Index

| Topic         | Location                                                                                             |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| Architecture  | [docs/architecture.md](docs/architecture.md)                                                         |
| Testing spec  | [docs/requirements/testing.md](docs/requirements/testing.md)                                         |
| Test strategy | [docs/plans/2026-01-15-testing-strategy-design.md](docs/plans/2026-01-15-testing-strategy-design.md) |
| E2E status    | [docs/requirements/e2e-testing-status.md](docs/requirements/e2e-testing-status.md)                   |

## Commands

```bash
npm start              # Dev mode
npm run build          # Production build
npm run package        # Create distributable
npm run test:e2e       # E2E tests (Gemini)
PROVIDER=claude npm run test:e2e  # E2E with Claude
npm run format         # dprint format
npm run lint:fix       # ESLint fix
npm run typecheck      # TS check
```

## Architecture

```
electron/          Main process, IPC handlers, preload
src/lib/pipeline/  Conversion pipelines (direct|light|full|robust)
src/lib/llm/       Provider abstraction (claude|gemini)
src/lib/pdf-service/  Cross-env PDF handling
src/components/    React UI components
```

## Pipelines

| Pipeline | Pages | Use Case                             |
| -------- | ----- | ------------------------------------ |
| direct   | 1-5   | Simple, no structure extraction      |
| light    | 5-50  | Quick scan + sequential              |
| full     | 50+   | Windowed processing                  |
| robust   | any   | Effect.ts wrapper (retry/rate-limit) |

## Providers

| Provider | PDF Support    | Context | Cost/page  | Notes               |
| -------- | -------------- | ------- | ---------- | ------------------- |
| Claude   | Native (100pg) | 200K    | $0.01-0.02 | Excellent structure |
| Gemini   | Image-based    | 2M      | $0.001     | RECITATION filter   |

## Plan Writing

**Required for multi-file changes.**

Location: `docs/plans/YYYY-MM-DD-<slug>.md`
Format: super-condensed, max info density, skip grammar
Structure: Goal \| Context \| Steps \| Files \| Verify

## Testing

```
Unit (Effect)     @effect/vitest, TestClock, pure logic
Component         Vitest + RTL, data-testid selectors
Integration       Playwright + Electron IPC
Workflow          Real LLM, pre-merge only
```

Fixtures: `tests/fixtures/{name}/source.pdf + expected.json`

## Security

- API keys: safeStorage encryption
- contextIsolation: true, nodeIntegration: false
- Validate file paths in main process
