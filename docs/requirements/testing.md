# E2E Testing Specification

## Test Philosophy

Tests validate conversion quality without requiring exact text matching. Focus on structural correctness and content type extraction validity.

## Priority 1: Document Structure

Validates heading hierarchy is preserved correctly.

**Checks:**

- Heading count per level matches expected
- Hierarchy validity (no skipped levels, e.g., H1 → H3)
- Heading text matches with fuzzy tolerance (~90% similarity)
- Sequence order preserved

**Expected format:**

```json
{
  "headings": [
    { "level": 1, "text": "Introduction", "position": 0 },
    { "level": 2, "text": "Background", "position": 1 }
  ]
}
```

## Priority 2: Content Type Extraction

### Images

- **Quantity:** extracted count matches expected
- **Validity:** file exists, readable, non-zero size, decodable, reasonable dimensions

### Tables

- **Quantity:** table count matches expected
- **Validity:**
  - Has header row
  - Consistent column count across rows
  - Cells contain readable text

### Code Snippets

- **Quantity:** fenced code block count matches
- **Validity:**
  - Language tag present (if in source)
  - Content non-empty

### Charts/Diagrams

- Treated as images for extraction
- Same validity checks as images

## Test Fixture Structure

```
tests/fixtures/
├── academic-paper/
│   ├── source.pdf
│   └── expected.json
├── technical-manual/
│   ├── source.pdf
│   └── expected.json
```

## Expected.json Schema

```json
{
  "structure": {
    "headings": [
      { "level": 1, "text": "Title" },
      { "level": 2, "text": "Section A" }
    ]
  },
  "content": {
    "images": {
      "count": 5,
      "minDimensions": { "width": 50, "height": 50 }
    },
    "tables": {
      "count": 3,
      "details": [
        { "rows": 5, "columns": 4 },
        { "rows": 10, "columns": 3 }
      ]
    },
    "codeBlocks": {
      "count": 2,
      "languages": ["python", "javascript"]
    }
  }
}
```

## Test Report Format

```
Document: academic-paper.pdf

STRUCTURE
  ✓ Heading count: 12/12
  ✓ Hierarchy valid (no skipped levels)
  ✓ Heading text match: 11/12 (92%)
  ✗ Mismatch at #4: expected "Methodology", got "Methods"

IMAGES
  ✓ Count: 5/5
  ✓ All readable (valid dimensions, decodable)

TABLES
  ✓ Count: 3/3
  ✓ Table 1: 5 rows × 4 cols (consistent)
  ✓ Table 2: 10 rows × 3 cols (consistent)
  ✗ Table 3: inconsistent column count (row 2 has 4, expected 3)

CODE BLOCKS
  ✓ Count: 2/2
  ✓ Languages detected: python, javascript

Overall: PASS (2 warnings)
```

## Running Tests

```bash
# Run all e2e tests
npm run test:e2e

# Run specific fixture
npm run test:e2e -- --fixture=academic-paper

# Update expected.json from current output
npm run test:e2e -- --update-snapshot
```
