// A button that opens a small dropdown of actions. Clicking an item closes
// it, unless the item (or a wrapper) has data-keep-open, as do Esc and a click
// outside. The panel stays mounted while closed, so a file input inside it
// survives the menu closing.
import { useEffect, useRef, useState, type ReactNode } from 'react'

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
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button type="button" className={className} aria-haspopup="menu" aria-expanded={open} title={title} onClick={() => setOpen(!open)}>
        {label} <span className="text-[0.6rem] text-faint">▾</span>
      </button>
      <div
        role="menu"
        hidden={!open}
        className={`panel absolute z-40 flex min-w-44 flex-col p-1 ${align === 'left' ? 'left-0' : 'right-0'} ${side === 'bottom' ? 'top-full mt-1' : 'bottom-full mb-1'}`}
        onClick={(e) => {
          const el = e.target as HTMLElement
          if (el.closest('button') && !el.closest('[data-keep-open]')) setOpen(false)
        }}
      >
        {children}
      </div>
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
