import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { CluePanel } from './CluePanel'

const defaultProps = {
  clueWord: 'desert',
  clueNumber: 3,
  isSubmitting: false,
  onClueWordChange: vi.fn(),
  onClueNumberChange: vi.fn(),
  onSubmit: vi.fn(),
}

function renderCluePanel(overrides: Partial<typeof defaultProps> = {}) {
  return render(<CluePanel {...defaultProps} {...overrides} />)
}

describe('CluePanel', () => {
  it('renders heading with translation key', () => {
    renderCluePanel()
    expect(screen.getByText('game.codenames.giveClue')).toBeInTheDocument()
  })

  it('renders clue word input with value', () => {
    renderCluePanel({ clueWord: 'mosque' })
    const input = screen.getByPlaceholderText('game.codenames.cluePlaceholder')
    expect(input).toHaveValue('mosque')
  })

  it('renders clue number input with value', () => {
    renderCluePanel({ clueNumber: 5 })
    const input = screen.getByDisplayValue('5')
    expect(input).toHaveAttribute('type', 'number')
  })

  it('calls onClueWordChange on text input change', () => {
    const onClueWordChange = vi.fn()
    renderCluePanel({ onClueWordChange })
    const input = screen.getByPlaceholderText('game.codenames.cluePlaceholder')
    fireEvent.change(input, { target: { value: 'prayer' } })
    expect(onClueWordChange).toHaveBeenCalledWith('prayer')
  })

  it('calls onClueNumberChange on number input change', () => {
    const onClueNumberChange = vi.fn()
    renderCluePanel({ onClueNumberChange })
    const input = screen.getByDisplayValue('3')
    fireEvent.change(input, { target: { value: '7' } })
    expect(onClueNumberChange).toHaveBeenCalledWith(7)
  })

  it('calls onSubmit on button click', () => {
    const onSubmit = vi.fn()
    renderCluePanel({ onSubmit })
    fireEvent.click(screen.getByRole('button'))
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it('disables submit button when isSubmitting', () => {
    renderCluePanel({ isSubmitting: true })
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('shows sending text when isSubmitting', () => {
    renderCluePanel({ isSubmitting: true })
    expect(screen.getByRole('button')).toHaveTextContent('game.codenames.sending')
  })
})
