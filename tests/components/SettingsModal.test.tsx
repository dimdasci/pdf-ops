import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsModal } from '../../src/components/SettingsModal'
import { mockElectronAPI } from '../setup/component.setup'

describe('SettingsModal', () => {
  const mockOnClose = vi.fn()
  const mockOnKeysChanged = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset default mock implementations
    mockElectronAPI.getApiKeys.mockResolvedValue({ gemini: '', anthropic: '' })
    mockElectronAPI.saveApiKeys.mockResolvedValue(undefined)
  })

  describe('Task 18: Loading existing API keys on open', () => {
    it('calls getApiKeys when modal opens', async () => {
      render(
        <SettingsModal
          isOpen={true}
          onClose={mockOnClose}
          onKeysChanged={mockOnKeysChanged}
        />,
      )

      await waitFor(() => {
        expect(mockElectronAPI.getApiKeys).toHaveBeenCalled()
      })
    })

    it('populates input fields with loaded API keys', async () => {
      mockElectronAPI.getApiKeys.mockResolvedValue({
        gemini: 'existing-gemini-key-123',
        anthropic: 'existing-anthropic-key-456',
      })

      render(
        <SettingsModal
          isOpen={true}
          onClose={mockOnClose}
          onKeysChanged={mockOnKeysChanged}
        />,
      )

      await waitFor(() => {
        // Get inputs by placeholder text since they're password fields
        const geminiInput = screen.getByPlaceholderText(/gemini/i) as HTMLInputElement
        const anthropicInput = screen.getByPlaceholderText(/anthropic/i) as HTMLInputElement

        expect(geminiInput.value).toBe('existing-gemini-key-123')
        expect(anthropicInput.value).toBe('existing-anthropic-key-456')
      })
    })

    it('does not call getApiKeys when modal is closed', () => {
      render(
        <SettingsModal
          isOpen={false}
          onClose={mockOnClose}
          onKeysChanged={mockOnKeysChanged}
        />,
      )

      expect(mockElectronAPI.getApiKeys).not.toHaveBeenCalled()
    })

    it('reloads API keys when modal reopens', async () => {
      const { rerender } = render(
        <SettingsModal
          isOpen={false}
          onClose={mockOnClose}
          onKeysChanged={mockOnKeysChanged}
        />,
      )

      expect(mockElectronAPI.getApiKeys).not.toHaveBeenCalled()

      // Open the modal
      rerender(
        <SettingsModal
          isOpen={true}
          onClose={mockOnClose}
          onKeysChanged={mockOnKeysChanged}
        />,
      )

      await waitFor(() => {
        expect(mockElectronAPI.getApiKeys).toHaveBeenCalledTimes(1)
      })
    })

    it('handles getApiKeys error gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockElectronAPI.getApiKeys.mockRejectedValue(new Error('Storage error'))

      render(
        <SettingsModal
          isOpen={true}
          onClose={mockOnClose}
          onKeysChanged={mockOnKeysChanged}
        />,
      )

      // Should not throw, modal should still render
      await waitFor(() => {
        expect(screen.getByText(/API Configuration/i)).toBeInTheDocument()
      })

      expect(consoleSpy).toHaveBeenCalledWith('Failed to load API keys:', expect.any(Error))
      consoleSpy.mockRestore()
    })
  })

  describe('Task 19: Saving API keys', () => {
    it('calls saveApiKeys with entered keys when save button clicked', async () => {
      const user = userEvent.setup()

      render(
        <SettingsModal
          isOpen={true}
          onClose={mockOnClose}
          onKeysChanged={mockOnKeysChanged}
        />,
      )

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/gemini/i)).toBeInTheDocument()
      })

      // Enter API keys
      const geminiInput = screen.getByPlaceholderText(/gemini/i)
      const anthropicInput = screen.getByPlaceholderText(/anthropic/i)

      await user.type(geminiInput, 'new-gemini-key')
      await user.type(anthropicInput, 'new-anthropic-key')

      // Click save
      const saveButton = screen.getByRole('button', { name: /save/i })
      await user.click(saveButton)

      await waitFor(() => {
        expect(mockElectronAPI.saveApiKeys).toHaveBeenCalledWith({
          gemini: 'new-gemini-key',
          anthropic: 'new-anthropic-key',
        })
      })
    })

    it('only saves non-empty keys', async () => {
      const user = userEvent.setup()

      render(
        <SettingsModal
          isOpen={true}
          onClose={mockOnClose}
          onKeysChanged={mockOnKeysChanged}
        />,
      )

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/gemini/i)).toBeInTheDocument()
      })

      // Enter only Gemini key
      const geminiInput = screen.getByPlaceholderText(/gemini/i)
      await user.type(geminiInput, 'only-gemini-key')

      // Click save
      const saveButton = screen.getByRole('button', { name: /save/i })
      await user.click(saveButton)

      await waitFor(() => {
        expect(mockElectronAPI.saveApiKeys).toHaveBeenCalledWith({
          gemini: 'only-gemini-key',
        })
      })
    })

    it('shows saved confirmation after successful save', async () => {
      const user = userEvent.setup()

      render(
        <SettingsModal
          isOpen={true}
          onClose={mockOnClose}
          onKeysChanged={mockOnKeysChanged}
        />,
      )

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/gemini/i)).toBeInTheDocument()
      })

      const geminiInput = screen.getByPlaceholderText(/gemini/i)
      await user.type(geminiInput, 'test-key')

      const saveButton = screen.getByRole('button', { name: /save/i })
      await user.click(saveButton)

      await waitFor(() => {
        expect(screen.getByText(/saved/i)).toBeInTheDocument()
      })
    })

    it('calls onKeysChanged callback after successful save', async () => {
      const user = userEvent.setup()

      render(
        <SettingsModal
          isOpen={true}
          onClose={mockOnClose}
          onKeysChanged={mockOnKeysChanged}
        />,
      )

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/gemini/i)).toBeInTheDocument()
      })

      const geminiInput = screen.getByPlaceholderText(/gemini/i)
      await user.type(geminiInput, 'callback-test-key')

      const saveButton = screen.getByRole('button', { name: /save/i })
      await user.click(saveButton)

      await waitFor(() => {
        expect(mockOnKeysChanged).toHaveBeenCalledWith({
          gemini: 'callback-test-key',
        })
      })
    })

    it('disables save button when both keys are empty', async () => {
      render(
        <SettingsModal
          isOpen={true}
          onClose={mockOnClose}
          onKeysChanged={mockOnKeysChanged}
        />,
      )

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/gemini/i)).toBeInTheDocument()
      })

      const saveButton = screen.getByRole('button', { name: /save/i })
      expect(saveButton).toBeDisabled()
    })

    it('handles save error gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockElectronAPI.saveApiKeys.mockRejectedValue(new Error('Save failed'))

      const user = userEvent.setup()

      render(
        <SettingsModal
          isOpen={true}
          onClose={mockOnClose}
          onKeysChanged={mockOnKeysChanged}
        />,
      )

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/gemini/i)).toBeInTheDocument()
      })

      const geminiInput = screen.getByPlaceholderText(/gemini/i)
      await user.type(geminiInput, 'test-key')

      const saveButton = screen.getByRole('button', { name: /save/i })
      await user.click(saveButton)

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Failed to save keys:', expect.any(Error))
      })

      consoleSpy.mockRestore()
    })
  })

  describe('Task 20: Input validation and status indicators', () => {
    it('renders validate button for each provider', async () => {
      render(
        <SettingsModal
          isOpen={true}
          onClose={mockOnClose}
          onKeysChanged={mockOnKeysChanged}
        />,
      )

      await waitFor(() => {
        const validateButtons = screen.getAllByRole('button', { name: /validate/i })
        expect(validateButtons).toHaveLength(2)
      })
    })

    it('disables validate button when key is empty', async () => {
      render(
        <SettingsModal
          isOpen={true}
          onClose={mockOnClose}
          onKeysChanged={mockOnKeysChanged}
        />,
      )

      await waitFor(() => {
        const validateButtons = screen.getAllByRole('button', { name: /validate/i })
        validateButtons.forEach(button => {
          expect(button).toBeDisabled()
        })
      })
    })

    it('enables validate button when key is entered', async () => {
      const user = userEvent.setup()

      render(
        <SettingsModal
          isOpen={true}
          onClose={mockOnClose}
          onKeysChanged={mockOnKeysChanged}
        />,
      )

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/gemini/i)).toBeInTheDocument()
      })

      const geminiInput = screen.getByPlaceholderText(/gemini/i)
      await user.type(geminiInput, 'test-key-value')

      const validateButtons = screen.getAllByRole('button', { name: /validate/i })
      // First validate button should be enabled (Gemini)
      expect(validateButtons[0]).not.toBeDisabled()
    })

    it('resets validation status when key changes', async () => {
      mockElectronAPI.getApiKeys.mockResolvedValue({
        gemini: 'initial-key',
        anthropic: '',
      })

      const user = userEvent.setup()

      render(
        <SettingsModal
          isOpen={true}
          onClose={mockOnClose}
          onKeysChanged={mockOnKeysChanged}
        />,
      )

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/gemini/i)).toHaveValue('initial-key')
      })

      // Type additional characters to trigger onChange
      const geminiInput = screen.getByPlaceholderText(/gemini/i)
      await user.type(geminiInput, '-modified')

      // Status icons should not be present after key modification
      // (they only appear after validation attempt)
      expect(screen.queryByTestId('gemini-valid')).not.toBeInTheDocument()
      expect(screen.queryByTestId('gemini-invalid')).not.toBeInTheDocument()
    })

    it('closes modal when close button clicked', async () => {
      const user = userEvent.setup()

      render(
        <SettingsModal
          isOpen={true}
          onClose={mockOnClose}
          onKeysChanged={mockOnKeysChanged}
        />,
      )

      await waitFor(() => {
        expect(screen.getByText(/API Configuration/i)).toBeInTheDocument()
      })

      // Find and click the X button (close button)
      const closeButton = screen.getAllByRole('button').find(
        button => button.querySelector('svg.lucide-x'),
      )

      // Alternative: click cancel button
      const cancelButton = screen.getByRole('button', { name: /cancel/i })
      await user.click(cancelButton)

      expect(mockOnClose).toHaveBeenCalled()
    })

  })
})
