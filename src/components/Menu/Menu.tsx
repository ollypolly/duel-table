// A button that opens a small dropdown of actions. Clicking an item closes
// it, unless the item (or a wrapper) has data-keep-open, as do Esc and a click
// outside. The panel stays mounted while closed, so a file input inside it
// survives the menu closing. It's drawn over the page from the button's place,
// so a scrolling box around the button neither clips it nor grows to hold it.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function Menu({
  label,
  title,
  align = 'left',
  side = 'bottom',
  className = 'btn',
  children,
}: {
  label: ReactNode
  title?: string
  align?: 'left' | 'right'
  side?: 'bottom' | 'top'
  className?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<CSSProperties>()
  const toggle = () => {
    const r = ref.current?.getBoundingClientRect()
    if (!open && r)
      setAt({
        ...(align === 'left' ? { left: r.left } : { right: window.innerWidth - r.right }),
        ...(side === 'bottom' ? { top: r.bottom + 4, maxHeight: window.innerHeight - r.bottom - 12 } : { bottom: window.innerHeight - r.top + 4, maxHeight: r.top - 12 }),
      })
    setOpen(!open)
  }
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && !panel.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const shut = () => setOpen(false)
    window.addEventListener('resize', shut)
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', shut)
    }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button type="button" className={className} aria-haspopup="menu" aria-expanded={open} title={title} onClick={toggle}>
        {label} <span className="text-[0.6rem] text-faint">▾</span>
      </button>
      {createPortal(
        <div
          ref={panel}
          role="menu"
          style={at}
          hidden={!open}
          // Solid, not glass: the table's status showed through blurred.
          className={`panel fixed z-50 flex max-w-[calc(100vw-1.5rem)] min-w-44 flex-col overflow-y-auto bg-surface p-1 backdrop-blur-none`}
          onClick={(e) => {
            const el = e.target as HTMLElement
            if (el.closest('button') && !el.closest('[data-keep-open]')) setOpen(false)
          }}
        >
          {children}
        </div>,
        document.body,
      )}
    </div>
  )
}

export function MenuItem({ children, danger, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`rounded px-2.5 py-1.5 text-left text-sm whitespace-nowrap hover:bg-raised disabled:opacity-40 disabled:hover:bg-transparent ${danger ? 'text-danger' : ''} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <p className="px-2.5 pb-0.5 pt-1.5 font-display text-[0.65rem] font-semibold uppercase tracking-widest text-faint">{children}</p>
}
