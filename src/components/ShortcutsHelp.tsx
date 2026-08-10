import { useEffect } from 'react'
import { IconX } from './Icons'

interface ShortcutsHelpProps {
  onClose: () => void
}

const SHORTCUTS: { keys: string; description: string }[] = [
  { keys: 'Ctrl/Cmd + Z', description: 'Undo the last remove / bulk remove / clear all' },
  { keys: 'Ctrl/Cmd + A', description: 'Select every page' },
  { keys: 'Delete / Backspace', description: 'Remove the selected pages' },
  { keys: 'Escape', description: 'Clear the current selection, or close a dialog' },
  { keys: '?', description: 'Toggle this shortcuts panel' },
]

export function ShortcutsHelp({ onClose }: ShortcutsHelpProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 id="shortcuts-title" className="text-base font-semibold text-slate-900">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <IconX className="size-4.5" />
          </button>
        </div>

        <ul className="mt-4 space-y-2.5">
          {SHORTCUTS.map((shortcut) => (
            <li key={shortcut.keys} className="flex items-center justify-between gap-4 text-sm">
              <span className="text-slate-600">{shortcut.description}</span>
              <kbd className="shrink-0 rounded-md border border-slate-300 bg-slate-50 px-2 py-1 font-mono text-xs text-slate-700">
                {shortcut.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
