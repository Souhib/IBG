import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/api/client', () => ({
  default: vi.fn(),
  getApiErrorMessage: vi.fn(() => 'Error'),
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}))

import apiClient from '@/api/client'
import { GameOverScreen } from './GameOverScreen'

describe('GameOverScreen', () => {
  const defaultProps = {
    winner: 'Civilians',
    roomId: 'room-123' as string | null,
    onBackToRoom: vi.fn(),
    onLeaveRoom: vi.fn(),
  }

  it('shows game over title', () => {
    render(<GameOverScreen {...defaultProps} />)
    expect(screen.getByText('game.gameOver')).toBeInTheDocument()
  })

  it('shows winner name', () => {
    render(<GameOverScreen {...defaultProps} winner="Civilians" />)
    expect(screen.getByText(/Civilians/)).toBeInTheDocument()
  })

  it('shows play again button when roomId provided', () => {
    render(<GameOverScreen {...defaultProps} roomId="room-123" />)
    expect(screen.getByText('game.playAgain')).toBeInTheDocument()
  })

  it('hides play again button when roomId is null', () => {
    render(<GameOverScreen {...defaultProps} roomId={null} />)
    expect(screen.queryByText('game.playAgain')).not.toBeInTheDocument()
  })

  it('calls onLeaveRoom when leave button clicked', () => {
    const onLeaveRoom = vi.fn()
    render(<GameOverScreen {...defaultProps} onLeaveRoom={onLeaveRoom} />)
    fireEvent.click(screen.getByText('room.leave'))
    expect(onLeaveRoom).toHaveBeenCalledOnce()
  })

  it('play again button calls API and onBackToRoom', async () => {
    const onBackToRoom = vi.fn()
    vi.mocked(apiClient).mockResolvedValueOnce({} as any)

    render(<GameOverScreen {...defaultProps} roomId="room-123" onBackToRoom={onBackToRoom} />)
    fireEvent.click(screen.getByText('game.playAgain'))

    await waitFor(() => {
      expect(apiClient).toHaveBeenCalledWith({
        method: 'POST',
        url: '/api/v1/rooms/room-123/rematch',
      })
    })

    await waitFor(() => {
      expect(onBackToRoom).toHaveBeenCalledOnce()
    })
  })
})
