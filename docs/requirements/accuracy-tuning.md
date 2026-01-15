# Accuracy Tuning & Multi-LLM Support

## Overview

This document captures the current state of PDF-to-Markdown conversion accuracy and outlines the next steps for improving results. It also documents the plan to support multiple LLM providers.

## Current Test Results (2025-01-13)

### kindle-manual (55 pages, 74 images, 1 table)

**Test Duration**: 7.7 minutes (465 seconds)

| Metric             | Result        | Status               |
| ------------------ | ------------- | -------------------- |
| Markdown length    | 523,242 chars | Good                 |
| Headings found     | 111           | Close to expected    |
| Images extracted   | 89            | Above expected (74)  |
| Tables found       | 0             | Missing (expected 1) |
| Markdown parseable | Yes           | PASSED               |

#### Structure Validation (FAILED)

```
Expected headings: h1=10, h2=66, h3=42, h4=0
Actual headings:   h1=18, h2=31, h3=57, h4=5

Heading text matches: 48/117 (41%)
Required threshold: 80%
Hierarchy valid: false
```

**Observations:**

- Gemini assigns heading levels differently than the source document
- Some h2 headings interpreted as h1 or h3
- Heading hierarchy jumps (e.g., h1 → h3 without h2)

#### Content Validation (FAILED)

```
Images: 89 found / 74 expected (valid: false)
Tables: 0 found / 1 expected (valid: true due to tolerance)
```

**Observations:**

- More images detected than manually counted in expected.json
- Could be decorative elements being captured as images
- Table extraction not working reliably

#### RECITATION Errors

Pages blocked by Gemini's copyright filter:

- Pages 18, 19, 23, 54 (and others)
- These pages output `[Error converting page N]` placeholder

**Root cause**: Kindle manual is Amazon copyrighted content in Gemini's training data.

### arxiv-roadmap & arxiv-guidelines

Both fixtures completely blocked by RECITATION - academic papers are heavily protected.

## Issues to Address

### 1. Heading Level Accuracy

**Problem**: Gemini doesn't consistently match source document heading hierarchy.

**Potential solutions**:

- [ ] Include TOC/outline context in prompts
- [ ] Two-pass approach: first extract structure, then convert with structure hints
- [ ] Post-processing to normalize heading levels
- [ ] Adjust prompts to emphasize heading hierarchy preservation

### 2. Table Detection

**Problem**: Tables not being extracted reliably.

**Potential solutions**:

- [ ] Improve prompts with explicit table detection instructions
- [ ] Use higher DPI rendering for better table visibility
- [ ] Two-pass: detect tables first, then convert with table coordinates

### 3. Image Count Mismatch

**Problem**: More images extracted than expected.

**Analysis needed**:

- [ ] Review what extra images are being captured
- [ ] May need to filter decorative/small images
- [ ] Update expected.json if count was incorrect

### 4. RECITATION Blocking

**Problem**: Copyrighted content triggers Gemini's safety filter.

**Solutions**:

- [ ] Use non-copyrighted test fixtures
- [ ] Try different models (Claude, Mistral) without this limitation
- [ ] Increase temperature parameter
- [ ] Stream responses instead of batch
- [ ] Rephrase prompts to request "analysis" vs "transcription"

## Multi-LLM Support Plan

### Motivation

1. **Avoid vendor lock-in**: Different LLMs have different strengths
2. **RECITATION workaround**: Claude/Mistral may not have same restrictions
3. **Cost optimization**: Use cheaper models for simpler documents
4. **Quality comparison**: A/B test different providers

### Proposed Architecture

```typescript
interface LLMProvider {
  name: string;

  // Document analysis
  analyzeDocumentStructure(text: string): Promise<DocumentAnalysis>;

  // Page conversion
  convertPage(
    imageBase64: string,
    context: PageContext
  ): Promise<PageConversionResult>;

  // Configuration
  getMaxImageSize(): number;
  supportsImageInput(): boolean;
}

// Implementations
class GeminiProvider implements LLMProvider { ... }
class ClaudeProvider implements LLMProvider { ... }
class MistralProvider implements LLMProvider { ... }
```

### Provider Comparison

| Feature              | Gemini       | Claude       | Mistral       |
| -------------------- | ------------ | ------------ | ------------- |
| Vision support       | Yes (native) | Yes (native) | Yes (Pixtral) |
| Max image size       | 20MB         | 20MB         | 10MB          |
| RECITATION filter    | Yes (strict) | No           | No            |
| Cost (per 1M tokens) | $0.075       | $3.00        | $0.25         |
| Context window       | 1M           | 200K         | 128K          |

### Implementation Steps

1. **Create LLMProvider interface** (`src/lib/llm/types.ts`)
2. **Refactor GeminiService** to implement interface
3. **Add ClaudeProvider** using Anthropic SDK
4. **Add MistralProvider** using Mistral SDK
5. **Update converter** to accept provider parameter
6. **Add provider selection to UI**

### API Keys Required

```env
# .env
GEMINI_API_KEY=...
ANTHROPIC_API_KEY=...
MISTRAL_API_KEY=...
```

## Test Fixtures Needed

### Current Fixtures (Copyrighted - RECITATION issues)

- `arxiv-roadmap` - Academic paper (4 pages)
- `arxiv-guidelines` - Academic paper (10 pages)
- `kindle-manual` - Amazon product manual (55 pages)
- `competitive-handbook` - Programming book (300 pages)

### Recommended New Fixtures (Public Domain/CC)

- [ ] Government document (public domain)
- [ ] Creative Commons licensed content
- [ ] Self-generated test PDF
- [ ] Open source documentation

## Accuracy Metrics to Track

### Structure Accuracy

- Heading level match rate (target: >80%)
- Heading text match rate (target: >80%)
- Hierarchy validity (no illegal jumps)

### Content Accuracy

- Image extraction rate (within ±20% of expected)
- Table detection rate (target: 100%)
- Code block detection rate (target: 100%)

### Format Quality

- Markdown parseability (target: 100%)
- Line length compliance (<500 chars)
- No orphaned references

## Next Steps

### Phase 1: Accuracy Tuning (Current Focus)

1. Create public domain test fixtures
2. Tune prompts for heading accuracy
3. Improve table detection
4. Add post-processing for heading normalization

### Phase 2: Multi-LLM Support

1. Abstract LLM interface
2. Add Claude provider
3. Add Mistral provider
4. Compare accuracy across providers

### Phase 3: Advanced Features

1. Batch processing for large documents
2. Caching for repeated conversions
3. Quality scoring and confidence levels
4. User feedback integration

## References

- [Gemini RECITATION Issue](https://github.com/google/generative-ai-docs/issues/257)
- [Gemini Safety Settings](https://ai.google.dev/gemini-api/docs/safety-settings)
- [Claude Vision API](https://docs.anthropic.com/en/docs/build-with-claude/vision)
- [Mistral Pixtral](https://docs.mistral.ai/capabilities/vision/)
