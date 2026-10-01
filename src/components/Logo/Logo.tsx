// The app's logo. With onClick it's a button (the way home), and glows when
// you point at it or tab to it.
export function Logo({ onClick, current, className = 'size-7' }: { onClick?: () => void; current?: boolean; className?: string }) {
  const img = <img src="/icon.svg" alt="" className={`rounded-md ${className}`} />
  if (!onClick) return img
  return (
    <button
      type="button"
      className="shrink-0 rounded-md transition duration-200 hover:scale-110 hover:shadow-[0_0_1rem_0.1rem_var(--color-gold)] focus-visible:shadow-[0_0_1rem_0.1rem_var(--color-gold)] active:scale-100"
      title="Home: your games, lessons and boards"
      aria-label="Home"
      aria-current={current ? 'page' : undefined}
      onClick={onClick}
    >
      {img}
    </button>
  )
}
