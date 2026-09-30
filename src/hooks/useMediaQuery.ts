import { useSyncExternalStore } from 'react'

// Whether a media query matches, kept up to date. False where there's no
// matchMedia (tests).
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof matchMedia !== 'function') return () => {}
      const list = matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => typeof matchMedia === 'function' && matchMedia(query).matches,
  )
}
