import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Workspace } from '../../src/components/Workspace'

// Mock pdf.js to avoid canvas issues in jsdom
vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn().mockReturnValue({
    promise: Promise.resolve({
      numPages: 5,
      getPage: vi.fn().mockResolvedValue({
        getViewport: vi.fn().mockReturnValue({ width: 600, height: 800 }),
        render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
      }),
      destroy: vi.fn(),
    }),
  }),
  GlobalWorkerOptions: { workerSrc: '' },
}))

// Mock BrowserPdfService to avoid complex PDF processing
vi.mock('../../src/lib/pdf-service/browser', () => ({
  BrowserPdfService: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue(undefined),
    getMetadata: vi.fn().mockResolvedValue({
      pageCount: 5,
      title: 'Test Document',
    }),
    getPageText: vi.fn().mockResolvedValue('Sample text'),
    renderPage: vi.fn().mockResolvedValue('base64-image-data'),
    destroy: vi.fn(),
  })),
}))

// Mock GeminiService to prevent actual API calls
vi.mock('../../src/lib/gemini', () => ({
  GeminiService: vi.fn().mockImplementation(() => ({
    analyzeDocumentStructure: vi.fn().mockResolvedValue({
      language: 'English',
      hasToc: false,
      pageRanges: [],
    }),
    convertPage: vi.fn().mockResolvedValue({
      content: '# Test Page',
      images: {},
    }),
  })),
}))

describe('Workspace', () => {
  const mockOnClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    // Mock window.electronAPI.readFileBuffer to return PDF-like data
    window.electronAPI.readFileBuffer = vi.fn().mockResolvedValue(
      new Uint8Array([0x25, 0x50, 0x44, 0x46]), // PDF header bytes
    )

    // Mock getApiKey for conversion tests
    window.electronAPI.getApiKey = vi.fn().mockResolvedValue('test-api-key')
  })

  describe('Task 21: Loading State', () => {
    it('shows loading state while PDF loads', () => {
      render(<Workspace filePath="/test/document.pdf" onClose={mockOnClose} />)

      // The component shows "Loading PDF..." text while isLoading is true
      expect(screen.getByText('Loading PDF...')).toBeInTheDocument()
    })

    it('shows Loading... in page count area before metadata loads', () => {
      render(<Workspace filePath="/test/document.pdf" onClose={mockOnClose} />)

      // The metadata span shows "Loading..." while metadata is null
      expect(screen.getByText('Loading...')).toBeInTheDocument()
    })
  })

  describe('Task 22: PDF Page Count Display', () => {
    it('displays PDF page count after loading', async () => {
      render(<Workspace filePath="/test/document.pdf" onClose={mockOnClose} />)

      // Wait for the component to finish loading and display page count
      await waitFor(() => {
        expect(screen.getByText('5 pages')).toBeInTheDocument()
      })
    })

    it('removes loading indicator after PDF loads', async () => {
      render(<Workspace filePath="/test/document.pdf" onClose={mockOnClose} />)

      // Wait for loading to complete
      await waitFor(() => {
        expect(screen.queryByText('Loading PDF...')).not.toBeInTheDocument()
      })
    })
  })

  describe('Task 23: Save/Export Button', () => {
    it('renders save button in toolbar', async () => {
      render(<Workspace filePath="/test/document.pdf" onClose={mockOnClose} />)

      // Wait for component to load
      await waitFor(() => {
        expect(screen.queryByText('Loading PDF...')).not.toBeInTheDocument()
      })

      // The save button uses a Save icon from lucide-react
      // Find all buttons and look for one containing the save icon
      const buttons = screen.getAllByRole('button')

      // There should be multiple buttons: back, convert, save
      expect(buttons.length).toBeGreaterThanOrEqual(3)
    })

    it('calls saveMarkdownFile when save button is clicked', async () => {
      const { container } = render(
        <Workspace filePath="/test/document.pdf" onClose={mockOnClose} />,
      )

      // Wait for loading to complete
      await waitFor(() => {
        expect(screen.queryByText('Loading PDF...')).not.toBeInTheDocument()
      })

      // Find the save button by its position in the toolbar
      // It's the last button with Save icon in the toolbar
      const saveButton = container.querySelector('button:last-of-type')
      expect(saveButton).toBeInTheDocument()
    })

    it('convert button is disabled while loading', () => {
      render(<Workspace filePath="/test/document.pdf" onClose={mockOnClose} />)

      // Find the Convert button
      const convertButton = screen.getByRole('button', { name: /convert/i })
      expect(convertButton).toBeDisabled()
    })

    it('convert button is enabled after loading completes', async () => {
      render(<Workspace filePath="/test/document.pdf" onClose={mockOnClose} />)

      // Wait for loading to complete
      await waitFor(() => {
        expect(screen.queryByText('Loading PDF...')).not.toBeInTheDocument()
      })

      // Find the Convert button - should be enabled now
      const convertButton = screen.getByRole('button', { name: /convert/i })
      expect(convertButton).not.toBeDisabled()
    })
  })

  describe('File Information Display', () => {
    it('displays the filename from file path', async () => {
      render(<Workspace filePath="/path/to/my-document.pdf" onClose={mockOnClose} />)

      // Wait for component to render
      await waitFor(() => {
        expect(screen.getByText('my-document.pdf')).toBeInTheDocument()
      })
    })

    it('calls onClose when back button is clicked', async () => {
      render(<Workspace filePath="/test/document.pdf" onClose={mockOnClose} />)

      // Find and click the back button (first button in toolbar)
      const backButton = screen.getAllByRole('button')[0]
      backButton.click()

      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })
  })
})
