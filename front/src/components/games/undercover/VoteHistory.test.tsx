import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { VoteHistory } from './VoteHistory'

interface VoteEntry {
  voter: string
  voter_id: string
  target: string
  target_id: string
}

interface EliminatedInfo {
  username: string
  role: string
  user_id: string
}

interface VoteRound {
  round: number
  votes: VoteEntry[]
  eliminated: EliminatedInfo | null
}

describe('VoteHistory', () => {
  const sampleHistory: VoteRound[] = [
    {
      round: 1,
      votes: [
        { voter: 'Alice', voter_id: 'u1', target: 'Bob', target_id: 'u2' },
        { voter: 'Charlie', voter_id: 'u3', target: 'Bob', target_id: 'u2' },
      ],
      eliminated: { username: 'Bob', role: 'undercover', user_id: 'u2' },
    },
    {
      round: 2,
      votes: [
        { voter: 'Alice', voter_id: 'u1', target: 'Charlie', target_id: 'u3' },
      ],
      eliminated: { username: 'Charlie', role: 'civilian', user_id: 'u3' },
    },
  ]

  it('returns null when history empty', () => {
    const { container } = render(<VoteHistory history={[]} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders round entries', () => {
    render(<VoteHistory history={sampleHistory} />)
    const roundLabels = screen.getAllByText('game.undercover.round')
    expect(roundLabels).toHaveLength(2)
  })

  it('expands round on click - shows vote details', () => {
    render(<VoteHistory history={sampleHistory} />)
    // Click the first round button (the round label spans)
    const roundLabels = screen.getAllByText('game.undercover.round')
    fireEvent.click(roundLabels[0])
    // After expanding, vote arrows should be visible
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('shows eliminated player name in collapsed view', () => {
    render(<VoteHistory history={sampleHistory} />)
    // Eliminated names are shown in collapsed view
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('Charlie')).toBeInTheDocument()
  })

  it('shows vote arrows (voter -> target) when expanded', () => {
    render(<VoteHistory history={sampleHistory} />)
    const roundButtons = screen.getAllByText('game.undercover.round')
    fireEvent.click(roundButtons[0])
    // Voter and target names should be visible in the expanded section
    expect(screen.getByText('Alice')).toBeInTheDocument()
    // The arrow character is &rarr; (→)
    const arrowElements = screen.getAllByText('→')
    expect(arrowElements.length).toBeGreaterThan(0)
  })

  it('shows elimination details when expanded', () => {
    render(<VoteHistory history={sampleHistory} />)
    const roundButtons = screen.getAllByText('game.undercover.round')
    fireEvent.click(roundButtons[0])
    expect(screen.getByText('game.undercover.wasEliminated')).toBeInTheDocument()
  })

  it('collapses on second click (toggle)', () => {
    render(<VoteHistory history={sampleHistory} />)
    const roundButtons = screen.getAllByText('game.undercover.round')
    // Expand
    fireEvent.click(roundButtons[0])
    expect(screen.getByText('game.undercover.wasEliminated')).toBeInTheDocument()
    // Collapse
    fireEvent.click(roundButtons[0])
    expect(screen.queryByText('game.undercover.wasEliminated')).not.toBeInTheDocument()
  })

  it('applies role color for eliminated undercover - "text-red-600" class', () => {
    render(<VoteHistory history={sampleHistory} />)
    // Bob is eliminated as undercover in round 1 - shown in collapsed view
    const bobSpan = screen.getByText('Bob')
    expect(bobSpan.className).toContain('text-red-600')
  })
})
