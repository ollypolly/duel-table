import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useUiStore } from '../../store/uiStore'
import { CardLinkInspector, CardMarkdown } from './CardLink'

describe('CardMarkdown', () => {
  it('links card names, leaves code alone, and opens the card on click', async () => {
    render(
      <>
        <CardMarkdown>{'Activate **Ojamatch**, not `Ojamatch`.'}</CardMarkdown>
        <CardLinkInspector />
      </>,
    )
    const links = screen.getAllByRole('button', { name: 'Ojamatch' })
    expect(links).toHaveLength(1)
    await userEvent.click(links[0])
    expect(useUiStore.getState().inspectedCard).toBeDefined()
    expect(await screen.findByRole('dialog', { name: 'Ojamatch' })).toBeInTheDocument()
  })

  it("links a deck by name or id, and opens the deck hub on it", async () => {
    render(<CardMarkdown>{'Try Super Quant (`super-quant`) with Super Quantum Blue Layer.'}</CardMarkdown>)
    expect(screen.getByRole('button', { name: 'Super Quantum Blue Layer' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Super Quant' }))
    expect(useUiStore.getState().decks).toEqual({ deck: 'super-quant' })
    useUiStore.getState().closeDecks()
    await userEvent.click(screen.getByRole('button', { name: 'super-quant' }))
    expect(useUiStore.getState().decks).toEqual({ deck: 'super-quant' })
  })
})
