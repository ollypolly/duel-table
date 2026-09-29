import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StepControls } from './StepControls'

const setup = (position: number) => {
  const onGoTo = vi.fn()
  const onPlaying = vi.fn()
  render(
    <StepControls
      position={position}
      labels={['Ojamatch', 'Summon LV5', 'Ojamagic']}
      playing={false}
      speed={1}
      onGoTo={onGoTo}
      onPlaying={onPlaying}
      onSpeed={vi.fn()}
    />,
  )
  return { onGoTo, onPlaying }
}

describe('StepControls', () => {
  it('lists setup plus every step label and marks the current one', () => {
    setup(2)
    expect(screen.getByRole('button', { name: /Summon LV5/ })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('button', { name: 'Setup' })).toBeInTheDocument()
  })

  it('steps and jumps', async () => {
    const { onGoTo, onPlaying } = setup(1)
    await userEvent.click(screen.getByTitle('Next (→)'))
    await userEvent.click(screen.getByTitle('Last (End)'))
    await userEvent.click(screen.getByRole('button', { name: /Ojamagic/ }))
    await userEvent.click(screen.getByTitle('Play/pause (space)'))
    expect(onGoTo.mock.calls).toEqual([[2], [3], [3]])
    expect(onPlaying).toHaveBeenCalledWith(true)
  })

  it('disables back buttons at the start', () => {
    setup(0)
    expect(screen.getByTitle('Previous (←)')).toBeDisabled()
    expect(screen.getByTitle('First (Home)')).toBeDisabled()
  })
})
