import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CardCell } from './CardCell'

function makeCard(overrides: Partial<{ word: string; card_type: 'red' | 'blue' | 'neutral' | 'assassin' | null; revealed: boolean }> = {}) {
  return {
    word: 'QURAN',
    card_type: 'red' as const,
    revealed: false,
    ...overrides,
  }
}

function defaultProps(overrides: Record<string, unknown> = {}) {
  return {
    card: makeCard(),
    index: 3,
    isSpymaster: false,
    canGuess: true,
    isFinished: false,
    onGuess: vi.fn(),
    ...overrides,
  }
}

describe('CardCell', () => {
  it('renders card word', () => {
    render(<CardCell {...defaultProps()} />)
    expect(screen.getByText('QURAN')).toBeInTheDocument()
  })

  it('calls onGuess with index when clicked', () => {
    const onGuess = vi.fn()
    render(<CardCell {...defaultProps({ onGuess, index: 7 })} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onGuess).toHaveBeenCalledWith(7)
  })

  it('is disabled when canGuess is false', () => {
    render(<CardCell {...defaultProps({ canGuess: false })} />)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('is disabled when card is revealed', () => {
    render(<CardCell {...defaultProps({ card: makeCard({ revealed: true }) })} />)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('is disabled when game is finished', () => {
    render(<CardCell {...defaultProps({ isFinished: true })} />)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('shows vote badge when voteCount > 0 and not revealed', () => {
    render(<CardCell {...defaultProps({ voteCount: 3 })} />)
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('hides vote badge when voteCount is 0', () => {
    render(<CardCell {...defaultProps({ voteCount: 0 })} />)
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('hides vote badge when card is revealed', () => {
    const { container } = render(<CardCell {...defaultProps({ voteCount: 2, card: makeCard({ revealed: true }) })} />)
    // The vote badge should not be rendered when the card is revealed
    const button = container.querySelector('button')!
    const spans = button.querySelectorAll('span')
    expect(spans.length).toBe(0)
  })

  it('applies ring class when isMyVote and not revealed', () => {
    const { container } = render(<CardCell {...defaultProps({ isMyVote: true })} />)
    const button = container.querySelector('button')!
    expect(button.className).toContain('ring-2')
    expect(button.className).toContain('ring-primary')
    expect(button.className).toContain('ring-offset-1')
  })

  it('does not apply ring class when isMyVote but revealed', () => {
    const { container } = render(<CardCell {...defaultProps({ isMyVote: true, card: makeCard({ revealed: true }) })} />)
    const button = container.querySelector('button')!
    expect(button.className).not.toContain('ring-2')
  })

  it('shows red bg when card_type is red and revealed', () => {
    const { container } = render(<CardCell {...defaultProps({ card: makeCard({ card_type: 'red', revealed: true }) })} />)
    const button = container.querySelector('button')!
    expect(button.className).toContain('bg-red-500')
  })

  it('spymaster sees colors for unrevealed cards', () => {
    const { container } = render(<CardCell {...defaultProps({ isSpymaster: true, card: makeCard({ card_type: 'blue', revealed: false }) })} />)
    const button = container.querySelector('button')!
    // Spymaster should see the blue color even when card is not revealed
    expect(button.className).toContain('bg-blue-200')
  })

  it('operative sees neutral bg for unrevealed cards', () => {
    const { container } = render(<CardCell {...defaultProps({ isSpymaster: false, card: makeCard({ card_type: 'blue', revealed: false }) })} />)
    const button = container.querySelector('button')!
    // Operative should see the neutral card background, not blue
    expect(button.className).toContain('bg-card')
    expect(button.className).not.toContain('bg-blue-200')
    expect(button.className).not.toContain('bg-blue-500')
  })
})
