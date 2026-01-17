# Build Cleanup & Package Scripts Design

## Goal

Fix build warnings, add package scripts, audit Effect.ts patterns.

## Problems

1. Vite mixed import warnings: `pdfjs-dist`, `@google/generative-ai`
2. Large chunk (1.2MB) exceeds 500KB limit
3. Missing `npm run package` scripts
4. Effect.ts patterns need audit

## Deliverables

- [ ] Clean build (zero warnings)
- [ ] `npm run package:dir` - unpacked app for dev
- [ ] `npm run package` - DMG (unsigned)
- [ ] Effect.ts refactorings implemented
- [ ] README: Gatekeeper bypass instructions

## Technical Approach

### Mixed Imports Fix

| Module | Current | Fix |
|--------|---------|-----|
| pdfjs-dist | static + dynamic in Workspace.tsx, browser.ts | standardize to static (eagerly needed) |
| @google/generative-ai | static + dynamic in SettingsModal.tsx, gemini.ts | standardize to static |

### Code Splitting

vite.config.ts → `build.rollupOptions.output.manualChunks`:
- `vendor-pdf`: pdfjs-dist
- `vendor-llm`: @google/generative-ai, @anthropic-ai/sdk
- `vendor-react`: react, react-dom
- `app`: application code

Target: no chunk > 500KB

### Package Scripts

electron-builder config:
- `package:dir` → `release/mac-arm64/` (unpacked)
- `package` → `release/*.dmg` (unsigned)

macOS unsigned builds require: `xattr -cr /path/to/app`

### Effect.ts Audit Areas

| Area | Files | Focus |
|------|-------|-------|
| Error handling | pipeline/, llm/ | typed errors, specific catch |
| Service/Layer | llm/, pdf-service/ | Context injection |
| Resources | pipeline/ | Scope, acquireRelease |
| Concurrency | pipeline/ | Effect.all options |
| Pipelines | pipeline/ | Stream for large PDFs |
| Idioms | all | Promise→Effect conversion |

## Implementation Plan

1. Create worktree `feature/build-cleanup`
2. Agent: Fix mixed imports
3. Agent: Configure code splitting
4. Agent: Add electron-builder + scripts
5. Agent: Effect.ts audit → recommendations
6. Agents: Implement Effect refactorings (per area)
7. Verify clean build + package works
8. Update README with Gatekeeper instructions

## Out of Scope

- Apple Developer certificate
- Core functionality changes
