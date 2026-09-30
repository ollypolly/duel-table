import { MotionConfig } from 'motion/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { CardLinkInspector } from './components/CardLink/CardLink'
import { initUrlSync } from './hooks/urlSync'
import { rawScenarios } from './scenarios/load'
import { useCosmeticsStore } from './store/cosmeticsStore'

if (new URLSearchParams(location.search).has('debug-viewport')) void import('./debugViewport')
initUrlSync()
// Sleeves etc. picked per seat, before they were per deck, go to the free
// table's decks.
const freeTable = rawScenarios['free-table'] as { players?: Record<'p1' | 'p2', { deck?: string }> } | undefined
void useCosmeticsStore.getState().load({ p1: freeTable?.players?.p1.deck, p2: freeTable?.players?.p2.deck })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Honour the OS "reduce motion" setting for every Motion animation. */}
    <MotionConfig reducedMotion="user">
      <App />
      {/* A card name linked in text opens here on click. */}
      <CardLinkInspector />
    </MotionConfig>
  </StrictMode>,
)
