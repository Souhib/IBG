import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RoleRevealPhase } from './RoleRevealPhase'

describe('RoleRevealPhase', () => {
  const defaultProps = {
    myRole: 'civilian',
    myWord: 'Mosque',
    onDismiss: vi.fn(),
  }

  it('renders role for civilian', () => {
    render(<RoleRevealPhase {...defaultProps} myRole="civilian" />)
    expect(screen.getByText('games.undercover.roles.civilian')).toBeInTheDocument()
  })

  it('renders role for undercover', () => {
    render(<RoleRevealPhase {...defaultProps} myRole="undercover" />)
    expect(screen.getByText('games.undercover.roles.undercover')).toBeInTheDocument()
  })

  it('renders role for mr_white', () => {
    render(<RoleRevealPhase {...defaultProps} myRole="mr_white" myWord={undefined} />)
    expect(screen.getByText('games.undercover.roles.mrWhite')).toBeInTheDocument()
  })

  it('shows word when provided', () => {
    render(<RoleRevealPhase {...defaultProps} myWord="Mosque" />)
    expect(screen.getByText('Mosque')).toBeInTheDocument()
  })

  it('hides word for mr_white (no myWord prop)', () => {
    render(<RoleRevealPhase {...defaultProps} myRole="mr_white" myWord={undefined} />)
    expect(screen.queryByText('game.yourWord')).not.toBeInTheDocument()
  })

  it('calls onDismiss when button clicked', () => {
    const onDismiss = vi.fn()
    render(<RoleRevealPhase {...defaultProps} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByText('game.undercover.iUnderstand'))
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
