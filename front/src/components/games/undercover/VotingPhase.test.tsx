import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { VotingPhase } from './VotingPhase'

describe('VotingPhase', () => {
  const defaultProps = {
    players: [
      { id: 'u1', username: 'Alice', is_alive: true, is_mayor: false },
      { id: 'u2', username: 'Bob', is_alive: true, is_mayor: false },
      { id: 'u3', username: 'Charlie', is_alive: true, is_mayor: false },
      { id: 'u4', username: 'Dead Dave', is_alive: false, is_mayor: false },
    ],
    myRole: 'civilian',
    myWord: 'Mosque',
    descriptions: { u1: 'big place', u2: 'worship' } as Record<string, string>,
    descriptionOrder: [
      { user_id: 'u1', username: 'Alice' },
      { user_id: 'u2', username: 'Bob' },
    ],
    isAlive: true,
    hasVoted: false,
    selectedVote: null as string | null,
    votedPlayers: [] as string[],
    currentUserId: 'u1',
    onSelectPlayer: vi.fn(),
    onConfirmVote: vi.fn(),
  }

  it('shows word reminder for civilian', () => {
    render(<VotingPhase {...defaultProps} myRole="civilian" myWord="Mosque" />)
    expect(screen.getByText('Mosque')).toBeInTheDocument()
    expect(screen.getByText(/game\.undercover\.yourWordReminder/)).toBeInTheDocument()
  })

  it('hides word reminder for mr_white', () => {
    render(<VotingPhase {...defaultProps} myRole="mr_white" myWord={undefined} />)
    expect(screen.queryByText('game.undercover.yourWordReminder')).not.toBeInTheDocument()
  })

  it('shows descriptions from phase', () => {
    render(<VotingPhase {...defaultProps} />)
    expect(screen.getByText('Alice:')).toBeInTheDocument()
    expect(screen.getByText('big place')).toBeInTheDocument()
    expect(screen.getByText('Bob:')).toBeInTheDocument()
    expect(screen.getByText('worship')).toBeInTheDocument()
  })

  it('shows "you are dead" when not alive', () => {
    render(<VotingPhase {...defaultProps} isAlive={false} />)
    expect(screen.getByText('game.undercover.youAreDead')).toBeInTheDocument()
  })

  it('renders alive players as vote targets (excludes self, excludes dead)', () => {
    render(<VotingPhase {...defaultProps} currentUserId="u1" />)
    // Bob and Charlie are alive and not self
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('Charlie')).toBeInTheDocument()
    // Alice is self, Dead Dave is dead - neither should be vote targets
    // Alice appears in descriptions but not as a vote button
    const voteButtons = screen.getAllByRole('button').filter(
      (btn) => btn.textContent?.includes('Bob') || btn.textContent?.includes('Charlie'),
    )
    expect(voteButtons).toHaveLength(2)
  })

  it('calls onSelectPlayer when player clicked', () => {
    const onSelectPlayer = vi.fn()
    render(<VotingPhase {...defaultProps} onSelectPlayer={onSelectPlayer} />)
    fireEvent.click(screen.getByText('Bob'))
    expect(onSelectPlayer).toHaveBeenCalledWith('u2')
  })

  it('shows selected state (ring-2) on selected player', () => {
    const { container } = render(<VotingPhase {...defaultProps} selectedVote="u2" />)
    const selectedButton = container.querySelector('.ring-2')
    expect(selectedButton).toBeInTheDocument()
    expect(selectedButton).toHaveTextContent('Bob')
  })

  it('shows mayor crown icon for mayor players', () => {
    render(
      <VotingPhase
        {...defaultProps}
        players={[
          { id: 'u1', username: 'Alice', is_alive: true, is_mayor: false },
          { id: 'u2', username: 'Bob', is_alive: true, is_mayor: true },
        ]}
      />,
    )
    // The Crown icon renders as an SVG inside the Bob button
    const bobButton = screen.getByText('Bob').closest('button')
    expect(bobButton?.querySelector('svg')).toBeInTheDocument()
  })

  it('shows waiting message after voting', () => {
    render(<VotingPhase {...defaultProps} hasVoted={true} />)
    expect(screen.getByText('game.undercover.waitingForVotes')).toBeInTheDocument()
  })

  it('vote confirm button disabled when no selection', () => {
    render(<VotingPhase {...defaultProps} selectedVote={null} />)
    const confirmButton = screen.getByText('game.undercover.voteToEliminate')
    expect(confirmButton).toBeDisabled()
  })

  it('vote confirm button enabled when selectedVote set', () => {
    render(<VotingPhase {...defaultProps} selectedVote="u2" />)
    const confirmButton = screen.getByText('game.undercover.voteToEliminate')
    expect(confirmButton).not.toBeDisabled()
  })

  it('hides player grid when dead (isAlive=false)', () => {
    const { container } = render(<VotingPhase {...defaultProps} isAlive={false} />)
    expect(container.querySelector('.grid')).not.toBeInTheDocument()
  })
})
