import { createContext } from 'react'

// Whether cards are drawn large enough to want the full-size scan rather than
// the small one. The board turns it on once you've zoomed in close.
export const FullArt = createContext(false)
