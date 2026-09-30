import { render, screen } from '@testing-library/react'
import { NarrationPanel } from './NarrationPanel'

describe('NarrationPanel', () => {
  it('renders markdown narration, the intent badge and warnings', () => {
    render(
      <NarrationPanel
        step={{ label: 'Ojamatch', narration: 'Send **Ojamagic** as the cost', intent: { type: 'activate', card: 'x' }, actions: [] }}
        position={1}
        warnings={['Step 1, action 1: something odd']}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Ojamatch' })).toBeInTheDocument()
    // Bold, and a link to the card.
    expect(screen.getByRole('button', { name: 'Ojamagic' }).closest('strong')).not.toBeNull()
    expect(screen.getByText('Activate')).toBeInTheDocument()
    expect(screen.getByText(/something odd/)).toBeInTheDocument()
  })

  it('shows the scenario description at setup', () => {
    render(<NarrationPanel position={0} description="Turns 1 to 3" warnings={[]} />)
    expect(screen.getByRole('heading', { name: 'Setup' })).toBeInTheDocument()
    expect(screen.getByText('Turns 1 to 3')).toBeInTheDocument()
  })
})
