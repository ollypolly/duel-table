// Settings, opened from the right of the header.
import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { AccountSettings } from '../Accounts/AccountSettings'

// children: the control that imports a branch file.
export function SettingsDialog({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (open && !dialog?.open) dialog?.showModal()
    if (!open && dialog?.open) dialog.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      aria-label="Settings"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current.close()}
      className="panel m-auto w-[min(26rem,94vw)] p-0 text-ink backdrop:bg-bg/70 backdrop:backdrop-blur-md"
    >
      <div className="flex items-center border-b border-line px-5 py-3">
        <h2 className="flex-1 font-display text-lg font-semibold">Settings</h2>
        <button type="button" className="rounded p-1.5 text-muted hover:bg-raised hover:text-ink" aria-label="Close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="max-h-[80vh] overflow-y-auto">
        <AccountSettings />
        <section className="space-y-2 p-5">
          <h3 className="font-display text-sm font-semibold">Branches</h3>
          <p className="text-sm text-muted">A branch is your own line played on from a lesson, kept in this browser. Bring one in from a file someone exported.</p>
          {children}
        </section>
      </div>
    </dialog>
  )
}
