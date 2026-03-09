import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { GameOverScreen } from './GameOverScreen'

vi.mock('@/api/client', () => ({
  default: vi.fn(),
  getApiErrorMessage: vi.fn(() => 'Error'),
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}))

const defaultProps = {
  winner: 'red' as const,
  roomId: 'room-123',
  onBackToRoom: vi.fn(),
  onLeaveRoom: vi.fn(),
}

function renderGameOver(overrides: Partial<typeof defaultProps> = {}) {
  return render(<GameOverScreen {...defaultProps} {...overrides} />)
}

describe('GameOverScreen', () => {
  it('shows game over title', () => {
    renderGameOver()
    expect(screen.getByText('game.gameOver')).toBeInTheDocument()
  })

  it('shows red team wins with red color class', () => {
    renderGameOver({ winner: 'red' })
    const winnerText = screen.getByText(/games.codenames.teams.red/)
    expect(winnerText).toHaveClass('text-red-600')
  })

  it('shows blue team wins with blue color class', () => {
    renderGameOver({ winner: 'blue' })
    const winnerText = screen.getByText(/games.codenames.teams.blue/)
    expect(winnerText).toHaveClass('text-blue-600')
  })

  it('shows play again button when roomId is provided', () => {
    renderGameOver({ roomId: 'room-123' })
    expect(screen.getByText('game.playAgain')).toBeInTheDocument()
  })

  it('hides play again button when roomId is null', () => {
    renderGameOver({ roomId: null })
    expect(screen.queryByText('game.playAgain')).not.toBeInTheDocument()
  })

  it('calls onLeaveRoom when leave button is clicked', () => {
    const onLeaveRoom = vi.fn()
    renderGameOver({ onLeaveRoom })
    fireEvent.click(screen.getByText('room.leave'))
    expect(onLeaveRoom).toHaveBeenCalledOnce()
  })

  it('calls API and onBackToRoom when play again is clicked', async () => {
    const { default: apiClient } = await import('@/api/client')
    const mockedApiClient = vi.mocked(apiClient)
    mockedApiClient.mockResolvedValueOnce({ data: {}, status: 200, statusText: 'OK' })

    const onBackToRoom = vi.fn()
    renderGameOver({ roomId: 'room-456', onBackToRoom })

    fireEvent.click(screen.getByText('game.playAgain'))

    await waitFor(() => {
      expect(mockedApiClient).toHaveBeenCalledWith({
        method: 'POST',
        url: '/api/v1/rooms/room-456/rematch',
      })
    })

    await waitFor(() => {
      expect(onBackToRoom).toHaveBeenCalledOnce()
    })
  })
})
