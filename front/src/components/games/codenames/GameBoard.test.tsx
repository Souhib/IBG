import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GameBoard } from './GameBoard'

function makeBoard() {
  return Array.from({ length: 25 }, (_, i) => ({
    word: `WORD${i}`,
    card_type: 'neutral' as const,
    revealed: false,
  }))
}

function defaultProps(overrides: Record<string, unknown> = {}) {
  return {
    board: makeBoard(),
    isSpymaster: false,
    canGuess: true,
    isFinished: false,
    onGuessCard: vi.fn(),
    ...overrides,
  }
}

describe('GameBoard', () => {
  it('renders 25 cards', () => {
    render(<GameBoard {...defaultProps()} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(25)
  })

  it('computes voteCounts from cardVotes', () => {
    const cardVotes = {
      'user-1': 3,
      'user-2': 3,
      'user-3': 7,
    }
    render(<GameBoard {...defaultProps({ cardVotes })} />)
    // Card at index 3 should show vote count of 2
    expect(screen.getByText('2')).toBeInTheDocument()
    // Card at index 7 should show vote count of 1
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('identifies myVote from currentUserId', () => {
    const cardVotes = {
      'user-1': 5,
      'user-2': 10,
    }
    render(<GameBoard {...defaultProps({ cardVotes, currentUserId: 'user-1' })} />)
    // The card at index 5 should have the ring class (myVote)
    const buttons = screen.getAllByRole('button')
    expect(buttons[5].className).toContain('ring-2')
    expect(buttons[5].className).toContain('ring-primary')
    // Other cards should not have the ring class
    expect(buttons[10].className).not.toContain('ring-2')
  })

  it('shows no vote badges when cardVotes is undefined', () => {
    render(<GameBoard {...defaultProps({ cardVotes: undefined })} />)
    // No span badges should exist inside buttons
    const buttons = screen.getAllByRole('button')
    for (const button of buttons) {
      const spans = button.querySelectorAll('span')
      expect(spans.length).toBe(0)
    }
  })

  it('forwards canGuess and isSpymaster to cards', () => {
    const board = makeBoard()
    board[0] = { word: 'SPY_WORD', card_type: 'red', revealed: false }

    render(<GameBoard {...defaultProps({ board, canGuess: false, isSpymaster: true })} />)

    const buttons = screen.getAllByRole('button')
    // All buttons should be disabled since canGuess is false
    for (const button of buttons) {
      expect(button).toBeDisabled()
    }
    // The first card (red, unrevealed) should show red color since isSpymaster is true
    expect(buttons[0].className).toContain('bg-red-200')
  })
})
