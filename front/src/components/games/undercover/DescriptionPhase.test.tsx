import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DescriptionPhase } from './DescriptionPhase'

describe('DescriptionPhase', () => {
  const defaultProps = {
    myRole: 'civilian',
    myWord: 'Mosque',
    descriptionOrder: [
      { user_id: 'u1', username: 'Alice' },
      { user_id: 'u2', username: 'Bob' },
      { user_id: 'u3', username: 'Charlie' },
    ],
    currentDescriberIndex: 0,
    descriptions: {} as Record<string, string>,
    currentUserId: 'u1',
    isMyTurnToDescribe: false,
    isAlive: true,
    descriptionInput: '',
    descriptionError: '',
    isSubmittingDescription: false,
    onDescriptionInputChange: vi.fn(),
    onSubmitDescription: vi.fn(),
  }

  it('shows word reminder for non-mr_white', () => {
    render(<DescriptionPhase {...defaultProps} myRole="civilian" myWord="Mosque" />)
    expect(screen.getByText('Mosque')).toBeInTheDocument()
    expect(screen.getByText(/game\.undercover\.yourWordReminder/)).toBeInTheDocument()
  })

  it('hides word reminder for mr_white', () => {
    render(<DescriptionPhase {...defaultProps} myRole="mr_white" myWord={undefined} />)
    expect(screen.queryByText('game.undercover.yourWordReminder')).not.toBeInTheDocument()
  })

  it('shows description order list', () => {
    render(<DescriptionPhase {...defaultProps} />)
    expect(screen.getByText(/Alice/)).toBeInTheDocument()
    expect(screen.getByText(/Bob/)).toBeInTheDocument()
    expect(screen.getByText(/Charlie/)).toBeInTheDocument()
  })

  it('highlights current describer', () => {
    const { container } = render(<DescriptionPhase {...defaultProps} currentDescriberIndex={1} />)
    const highlightedEntry = container.querySelector('.bg-primary\\/10')
    expect(highlightedEntry).toBeInTheDocument()
    expect(highlightedEntry).toHaveTextContent('Bob')
  })

  it('shows "(you)" for current user', () => {
    render(<DescriptionPhase {...defaultProps} currentUserId="u2" />)
    expect(screen.getByText(/\(you\)/)).toBeInTheDocument()
  })

  it('shows submitted descriptions', () => {
    render(
      <DescriptionPhase
        {...defaultProps}
        descriptions={{ u1: 'big building' }}
      />,
    )
    expect(screen.getByText('big building')).toBeInTheDocument()
  })

  it('shows input when isMyTurnToDescribe and isAlive', () => {
    render(<DescriptionPhase {...defaultProps} isMyTurnToDescribe={true} isAlive={true} />)
    expect(screen.getByRole('textbox', { name: /game.undercover.describeYourWord/i })).toBeInTheDocument()
  })

  it('hides input when not my turn', () => {
    render(<DescriptionPhase {...defaultProps} isMyTurnToDescribe={false} />)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('calls onSubmitDescription on button click', () => {
    const onSubmitDescription = vi.fn()
    render(
      <DescriptionPhase
        {...defaultProps}
        isMyTurnToDescribe={true}
        isAlive={true}
        descriptionInput="a word"
        onSubmitDescription={onSubmitDescription}
      />,
    )
    fireEvent.click(screen.getByText('game.undercover.submitDescription'))
    expect(onSubmitDescription).toHaveBeenCalledOnce()
  })

  it('shows error message when descriptionError set', () => {
    render(
      <DescriptionPhase
        {...defaultProps}
        isMyTurnToDescribe={true}
        isAlive={true}
        descriptionError="Too short"
      />,
    )
    expect(screen.getByText('Too short')).toBeInTheDocument()
  })

  it('submit button disabled when input empty', () => {
    render(
      <DescriptionPhase
        {...defaultProps}
        isMyTurnToDescribe={true}
        isAlive={true}
        descriptionInput=""
      />,
    )
    const submitButton = screen.getByText('game.undercover.submitDescription')
    expect(submitButton).toBeDisabled()
  })

  it('shows waiting message when not my turn and there is a current describer', () => {
    render(
      <DescriptionPhase
        {...defaultProps}
        isMyTurnToDescribe={false}
        currentDescriberIndex={1}
        currentUserId="u3"
      />,
    )
    expect(screen.getByText('game.undercover.waitingForDescription')).toBeInTheDocument()
  })
})
