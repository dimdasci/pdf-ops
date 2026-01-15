import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DropZone } from '../../src/components/DropZone'

describe('DropZone', () => {
  describe('rendering', () => {
    it('displays instruction text when not dragging', () => {
      const onFileSelect = vi.fn()
      render(<DropZone onFileSelect={onFileSelect} />)

      expect(screen.getByText('Select PDF File')).toBeInTheDocument()
      expect(screen.getByText('Drag and drop or click to browse')).toBeInTheDocument()
    })
  })

  describe('file selection', () => {
    it('calls onFileSelect with file path when PDF is selected via input', async () => {
      const user = userEvent.setup()
      const onFileSelect = vi.fn()
      render(<DropZone onFileSelect={onFileSelect} />)

      // Create a mock PDF file
      const pdfFile = new File(['pdf content'], 'test-document.pdf', {
        type: 'application/pdf',
      })

      // Find the hidden file input and upload
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      expect(fileInput).toBeTruthy()

      await user.upload(fileInput, pdfFile)

      // The mock returns '/mock/path/filename'
      expect(onFileSelect).toHaveBeenCalledWith('/mock/path/test-document.pdf')
    })

    it('calls onFileSelect when PDF file is dropped', () => {
      const onFileSelect = vi.fn()
      const { container } = render(<DropZone onFileSelect={onFileSelect} />)

      const dropZone = container.firstChild as HTMLElement

      // Create a mock PDF file
      const pdfFile = new File(['pdf content'], 'document.pdf', {
        type: 'application/pdf',
      })

      // Create a mock dataTransfer object
      const dataTransfer = {
        files: [pdfFile] as unknown as FileList,
      }

      // Simulate drop event
      const dropEvent = new Event('drop', { bubbles: true })
      Object.defineProperty(dropEvent, 'dataTransfer', { value: dataTransfer })
      Object.defineProperty(dropEvent, 'preventDefault', { value: vi.fn() })

      dropZone.dispatchEvent(dropEvent)

      expect(onFileSelect).toHaveBeenCalledWith('/mock/path/document.pdf')
    })

    it('does not call onFileSelect when non-PDF file is dropped', () => {
      const onFileSelect = vi.fn()
      const { container } = render(<DropZone onFileSelect={onFileSelect} />)

      const dropZone = container.firstChild as HTMLElement

      // Create a non-PDF file (text file)
      const textFile = new File(['text content'], 'document.txt', {
        type: 'text/plain',
      })

      // Create a mock dataTransfer object
      const dataTransfer = {
        files: [textFile] as unknown as FileList,
      }

      // Simulate drop event
      const dropEvent = new Event('drop', { bubbles: true })
      Object.defineProperty(dropEvent, 'dataTransfer', { value: dataTransfer })
      Object.defineProperty(dropEvent, 'preventDefault', { value: vi.fn() })

      dropZone.dispatchEvent(dropEvent)

      // Should NOT call onFileSelect for non-PDF files
      expect(onFileSelect).not.toHaveBeenCalled()
    })
  })

  describe('drag feedback', () => {
    it('changes text to "Drop PDF here" during drag over', () => {
      const onFileSelect = vi.fn()
      const { container } = render(<DropZone onFileSelect={onFileSelect} />)

      const dropZone = container.firstChild as HTMLElement

      // Initial state - should show default text
      expect(screen.getByText('Select PDF File')).toBeInTheDocument()
      expect(screen.queryByText('Drop PDF here')).not.toBeInTheDocument()

      // Simulate dragover event using fireEvent
      fireEvent.dragOver(dropZone)

      // During drag - should show drag text
      expect(screen.getByText('Drop PDF here')).toBeInTheDocument()
      expect(screen.queryByText('Select PDF File')).not.toBeInTheDocument()
    })

    it('applies visual highlight styles during drag over', () => {
      const onFileSelect = vi.fn()
      const { container } = render(<DropZone onFileSelect={onFileSelect} />)

      const dropZone = container.firstChild as HTMLElement

      // Initial state - should have default border color (not the active drag highlight)
      expect(dropZone.className).toContain('border-zinc-700')
      // The class contains 'hover:border-indigo-500/50' which is different from 'border-indigo-500 '
      // So we check for the exact active state class
      expect(dropZone.className).not.toContain('bg-indigo-500/10')

      // Simulate dragover event using fireEvent
      fireEvent.dragOver(dropZone)

      // During drag - should have highlighted border and background
      expect(dropZone.className).toContain('border-indigo-500 ')
      expect(dropZone.className).toContain('bg-indigo-500/10')
    })

    it('reverts to default state after drag leave', () => {
      const onFileSelect = vi.fn()
      const { container } = render(<DropZone onFileSelect={onFileSelect} />)

      const dropZone = container.firstChild as HTMLElement

      // Simulate dragover event
      fireEvent.dragOver(dropZone)

      // Verify drag state is active
      expect(screen.getByText('Drop PDF here')).toBeInTheDocument()

      // Simulate dragleave event
      fireEvent.dragLeave(dropZone)

      // Should revert to default state
      expect(screen.getByText('Select PDF File')).toBeInTheDocument()
      expect(screen.queryByText('Drop PDF here')).not.toBeInTheDocument()
      expect(dropZone.className).toContain('border-zinc-700')
    })

    it('reverts to default state after drop', () => {
      const onFileSelect = vi.fn()
      const { container } = render(<DropZone onFileSelect={onFileSelect} />)

      const dropZone = container.firstChild as HTMLElement

      // Simulate dragover event
      fireEvent.dragOver(dropZone)

      // Verify drag state is active
      expect(screen.getByText('Drop PDF here')).toBeInTheDocument()

      // Create a mock PDF file and drop it
      const pdfFile = new File(['pdf content'], 'document.pdf', {
        type: 'application/pdf',
      })

      fireEvent.drop(dropZone, {
        dataTransfer: {
          files: [pdfFile],
        },
      })

      // Should revert to default state after drop
      expect(screen.getByText('Select PDF File')).toBeInTheDocument()
      expect(screen.queryByText('Drop PDF here')).not.toBeInTheDocument()
    })
  })
})
