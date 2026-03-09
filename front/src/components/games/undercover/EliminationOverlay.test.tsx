import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, className, ...props }: any) => <div className={className} {...props}>{children}</div>,
    h2: ({ children, className, ...props }: any) => <h2 className={className} {...props}>{children}</h2>,
    p: ({ children, className, ...props }: any) => <p className={className} {...props}>{children}</p>,
  },
}))

import { EliminationOverlay } from './EliminationOverlay'

describe('EliminationOverlay', () => {
  const defaultProps = {
    eliminatedUsername: 'Alice',
    eliminatedRole: 'civilian',
    onNextRound: vi.fn(),
  }

  it('shows eliminated title', () => {
    render(<EliminationOverlay {...defaultProps} />)
    expect(screen.getByText('game.eliminated')).toBeInTheDocument()
  })

  it('shows eliminated username', () => {
    render(<EliminationOverlay {...defaultProps} eliminatedUsername="Bob" />)
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })

  it('shows role label for civilian', () => {
    render(<EliminationOverlay {...defaultProps} eliminatedRole="civilian" />)
    expect(screen.getByText(/Civilian/)).toBeInTheDocument()
  })

  it('shows role label for undercover', () => {
    render(<EliminationOverlay {...defaultProps} eliminatedRole="undercover" />)
    expect(screen.getByText(/Undercover/)).toBeInTheDocument()
  })

  it('shows role label for mr_white', () => {
    render(<EliminationOverlay {...defaultProps} eliminatedRole="mr_white" />)
    expect(screen.getByText(/Mr. White/)).toBeInTheDocument()
  })

  it('calls onNextRound when button clicked', () => {
    const onNextRound = vi.fn()
    render(<EliminationOverlay {...defaultProps} onNextRound={onNextRound} />)
    fireEvent.click(screen.getByText('game.undercover.nextRound'))
    expect(onNextRound).toHaveBeenCalledOnce()
  })

  it('no username shown when undefined', () => {
    render(<EliminationOverlay {...defaultProps} eliminatedUsername={undefined} />)
    expect(screen.queryByText('Alice')).not.toBeInTheDocument()
  })
})
