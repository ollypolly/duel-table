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
})
