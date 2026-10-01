// Scroll the chat log (not the page, which scrollIntoView would also move) so
// an entry sits at its top.
export function scrollLogTo(el: Element, smooth = false) {
  const log = el.closest('[role=log]')
  if (!log) return
  const top = log.scrollTop + el.getBoundingClientRect().top - log.getBoundingClientRect().top - 4
  log.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' })
}
