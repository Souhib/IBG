import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ScorePanel } from './ScorePanel'

const defaultProps = {
  redRemaining: 8,
  blueRemaining: 7,
  currentTeam: 'red' as const,
  currentTurn: null,
  isMyTurn: false,
  isFinished: false,
}

function renderScorePanel(overrides: Partial<typeof defaultProps> = {}) {
  return render(<ScorePanel {...defaultProps} {...overrides} />)
}

describe('ScorePanel', () => {
  it('renders game title', () => {
    renderScorePanel()
    expect(screen.getByText('games.codenames.name')).toBeInTheDocument()
  })

  it('shows red remaining score', () => {
    renderScorePanel({ redRemaining: 8 })
    expect(screen.getByText('8')).toBeInTheDocument()
  })

  it('shows blue remaining score', () => {
    renderScorePanel({ blueRemaining: 7 })
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('shows your turn indicator when isMyTurn and not finished', () => {
    renderScorePanel({ isMyTurn: true, isFinished: false })
    expect(screen.getByText('game.codenames.yourTurn')).toBeInTheDocument()
  })

  it('hides your turn indicator when not my turn', () => {
    renderScorePanel({ isMyTurn: false })
    expect(screen.queryByText('game.codenames.yourTurn')).not.toBeInTheDocument()
  })

  it('hides your turn indicator when game is finished', () => {
    renderScorePanel({ isMyTurn: true, isFinished: true })
    expect(screen.queryByText('game.codenames.yourTurn')).not.toBeInTheDocument()
  })

  it('shows current team name for red', () => {
    renderScorePanel({ currentTeam: 'red' })
    expect(screen.getByText('games.codenames.teams.red')).toBeInTheDocument()
  })

  it('shows clue word and number when clue is given', () => {
    renderScorePanel({
      currentTurn: {
        team: 'blue',
        clue_word: 'prophet',
        clue_number: 2,
        guesses_made: 0,
        max_guesses: 3,
      },
    })
    expect(screen.getByText(/prophet/)).toBeInTheDocument()
    expect(screen.getByText(/\(2\)/)).toBeInTheDocument()
  })

  it('shows progress bar when clue is active with max_guesses > 0', () => {
    const { container } = renderScorePanel({
      currentTurn: {
        team: 'red',
        clue_word: 'faith',
        clue_number: 3,
        guesses_made: 1,
        max_guesses: 4,
      },
    })
    // Progress bar outer container
    const progressBar = container.querySelector('.h-1\\.5.w-full.rounded-full.bg-muted')
    expect(progressBar).toBeInTheDocument()
  })

  it('hides progress bar when no clue is given', () => {
    const { container } = renderScorePanel({ currentTurn: null })
    const progressBar = container.querySelector('.h-1\\.5.w-full.rounded-full.bg-muted')
    expect(progressBar).not.toBeInTheDocument()
  })
})
