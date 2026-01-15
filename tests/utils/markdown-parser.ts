import type { Code, Heading, Image, Root, Table } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'

export interface HeadingInfo {
  level: number
  text: string
  position: number
}

export interface ImageInfo {
  alt: string
  url: string
}

export interface TableInfo {
  rows: number
  columns: number
}

export interface CodeBlockInfo {
  language: string | null
  content: string
}

export interface ParsedMarkdown {
  ast: Root
  headings: HeadingInfo[]
  images: ImageInfo[]
  tables: TableInfo[]
  codeBlocks: CodeBlockInfo[]
  parseErrors: string[]
}

/**
 * Parse Markdown content and extract structural information
 */
export function parseMarkdown(content: string): ParsedMarkdown {
  const headings: HeadingInfo[] = []
  const images: ImageInfo[] = []
  const tables: TableInfo[] = []
  const codeBlocks: CodeBlockInfo[] = []
  const parseErrors: string[] = []

  let headingPosition = 0

  try {
    const processor = unified().use(remarkParse).use(remarkGfm)
    const ast = processor.parse(content) as Root

    // Visit all nodes and extract information
    visit(ast, node => {
      switch (node.type) {
        case 'heading': {
          const heading = node as Heading
          const text = extractTextFromNode(heading)
          headings.push({
            level: heading.depth,
            text,
            position: headingPosition++,
          })
          break
        }

        case 'image': {
          const image = node as Image
          images.push({
            alt: image.alt || '',
            url: image.url || '',
          })
          break
        }

        case 'table': {
          const table = node as Table
          const rows = table.children.length
          const columns = table.children[0]?.children?.length || 0
          tables.push({ rows, columns })
          break
        }

        case 'code': {
          const code = node as Code
          codeBlocks.push({
            language: code.lang || null,
            content: code.value || '',
          })
          break
        }
      }
    })

    return {
      ast,
      headings,
      images,
      tables,
      codeBlocks,
      parseErrors,
    }
  } catch (error) {
    parseErrors.push(error instanceof Error ? error.message : String(error))
    return {
      ast: { type: 'root', children: [] },
      headings,
      images,
      tables,
      codeBlocks,
      parseErrors,
    }
  }
}

/**
 * Extract plain text from a node and its children
 */
function extractTextFromNode(node: unknown): string {
  const texts: string[] = []

  function traverse(n: unknown): void {
    if (!n || typeof n !== 'object') return

    const obj = n as Record<string, unknown>

    if (obj.type === 'text' && typeof obj.value === 'string') {
      texts.push(obj.value)
    }

    if (Array.isArray(obj.children)) {
      for (const child of obj.children) {
        traverse(child)
      }
    }
  }

  traverse(node)
  return texts.join('')
}
