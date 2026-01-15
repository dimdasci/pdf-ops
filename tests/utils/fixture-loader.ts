import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export interface ExpectedSchema {
  metadata: {
    name: string
    pageCount: number
    language: string
  }
  structure: {
    headings: {
      byLevel: {
        h1: number
        h2: number
        h3: number
        h4: number
        h5: number
        h6: number
      }
      items: Array<{ level: number; text: string }>
    }
    hierarchyValid: boolean
  }
  content: {
    images: {
      count: number
      minDimensions?: { width: number; height: number }
    }
    tables: {
      count: number
      details?: Array<{ rows: number; columns: number }>
    }
    codeBlocks: {
      count: number
      languages: string[]
    }
  }
  format: {
    shouldParse: boolean
    allowedWarnings?: string[]
  }
}

export interface Fixture {
  name: string
  pdfBuffer: Uint8Array
  expected: ExpectedSchema
  pdfPath: string
}

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures')

/**
 * Load a test fixture by name
 */
export async function loadFixture(fixtureName: string): Promise<Fixture> {
  const fixtureDir = path.join(FIXTURES_DIR, fixtureName)

  // Check fixture directory exists
  try {
    await fs.access(fixtureDir)
  } catch {
    throw new Error(`Fixture not found: ${fixtureName}`)
  }

  // Load PDF file
  const pdfPath = path.join(fixtureDir, 'source.pdf')
  let pdfBuffer: Uint8Array
  try {
    const buffer = await fs.readFile(pdfPath)
    pdfBuffer = new Uint8Array(buffer)
  } catch {
    throw new Error(`PDF file not found: ${pdfPath}`)
  }

  // Load expected.json
  const expectedPath = path.join(fixtureDir, 'expected.json')
  let expected: ExpectedSchema
  try {
    const expectedContent = await fs.readFile(expectedPath, 'utf-8')
    expected = JSON.parse(expectedContent)
  } catch (error) {
    throw new Error(
      `expected.json not found or invalid: ${expectedPath}. ${
        error instanceof Error ? error.message : ''
      }`,
    )
  }

  return {
    name: fixtureName,
    pdfBuffer,
    expected,
    pdfPath,
  }
}

/**
 * List all available fixtures
 */
export async function listFixtures(): Promise<string[]> {
  try {
    const entries = await fs.readdir(FIXTURES_DIR, { withFileTypes: true })
    const fixtures: string[] = []

    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Check if it has source.pdf
        const pdfPath = path.join(FIXTURES_DIR, entry.name, 'source.pdf')
        try {
          await fs.access(pdfPath)
          fixtures.push(entry.name)
        } catch {
          // Skip directories without source.pdf
        }
      }
    }

    return fixtures.sort()
  } catch {
    return []
  }
}

/**
 * Check if a fixture has expected.json
 */
export async function hasExpectedJson(fixtureName: string): Promise<boolean> {
  const expectedPath = path.join(FIXTURES_DIR, fixtureName, 'expected.json')
  try {
    await fs.access(expectedPath)
    return true
  } catch {
    return false
  }
}
