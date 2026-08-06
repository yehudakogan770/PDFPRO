import { IconX } from './Icons'

interface UndoToastProps {
  message: string
  onUndo: () => void
  onDismiss: () => void
}

export function UndoToast({ message, onUndo, onDismiss }: UndoToastProps) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-3 rounded-xl bg-slate-900 py-3 pl-4 pr-2.5 text-sm text-white shadow-xl">
        <span>{message}</span>
        <button type="button" onClick={onUndo} className="font-semibold text-indigo-300 hover:text-indigo-200">
          Undo
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white"
        >
          <IconX className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
