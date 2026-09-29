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
  return { onGoTo, onPlaying, openDrawer: () => userEvent.click(screen.getByTitle('Playback: scrub, speed, jump to a step')) }
}

describe('StepControls', () => {
  it('shows the current step, and lists every step in the drawer', async () => {
    const { openDrawer } = setup(2)
    expect(screen.getByText('Summon LV5')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Jump to step' })).toBeNull()
    await openDrawer()
    const jump = screen.getByRole('combobox', { name: 'Jump to step' })
    expect(jump).toHaveValue('2')
    expect(screen.getByRole('option', { name: '2/3 · Summon LV5' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Setup' })).toBeInTheDocument()
  })

  it('steps and jumps', async () => {
    const { onGoTo, onPlaying, openDrawer } = setup(1)
    await userEvent.click(screen.getByTitle('Next (→)'))
    await openDrawer()
    await userEvent.click(screen.getByTitle('Last (End)'))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Jump to step' }), '3/3 · Ojamagic')
    await userEvent.click(screen.getByTitle('Play/pause (space)'))
    expect(onGoTo.mock.calls).toEqual([[2], [3], [3]])
    expect(onPlaying).toHaveBeenCalledWith(true)
  })

  it('disables back buttons at the start', async () => {
    await setup(0).openDrawer()
    expect(screen.getByTitle('Previous (←)')).toBeDisabled()
    expect(screen.getByTitle('First (Home)')).toBeDisabled()
  })
})
