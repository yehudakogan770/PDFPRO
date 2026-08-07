import { useState } from 'react'
import type { PageItem } from '../types'
import { IconImage, IconRotate, IconSpinner, IconTrash } from './Icons'

interface PreviewPanelProps {
  page: PageItem | null
  onRotate: (id: string) => void
  onRemove: (id: string) => void
  onSaveAsImage: (id: string) => Promise<void>
}

export function PreviewPanel({ page, onRotate, onRemove, onSaveAsImage }: PreviewPanelProps) {
  const [isSaving, setIsSaving] = useState(false)
  const rotated90 = !!page && page.rotation % 180 !== 0
  const aspectRatio = page ? (rotated90 ? `${page.height} / ${page.width}` : `${page.width} / ${page.height}`) : '3 / 4'

  const handleSave = async () => {
    if (!page || isSaving) return
    setIsSaving(true)
    try {
      await onSaveAsImage(page.id)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <aside className="lg:sticky lg:top-24 lg:self-start">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Preview</p>

        <div className="mt-3 flex items-center justify-center overflow-hidden rounded-xl bg-slate-100" style={{ aspectRatio }}>
          {page ? (
            <img
              src={page.thumbnailUrl}
              alt={`Page ${page.pageNumber} of ${page.sourceName}`}
              className="h-full w-full object-contain"
              style={{ transform: `rotate(${page.rotation}deg)` }}
            />
          ) : (
            <p className="px-6 text-center text-sm text-slate-400">Click a page to preview it here</p>
          )}
        </div>

        {page && (
          <>
            <p className="mt-3 truncate text-sm text-slate-600" title={`${page.sourceName} · page ${page.pageNumber}`}>
              {page.sourceName} <span className="text-slate-400">· p{page.pageNumber}</span>
            </p>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => onRotate(page.id)}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <IconRotate className="size-3.5" />
                Rotate
              </button>
              <button
                type="button"
                onClick={() => onRemove(page.id)}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
              >
                <IconTrash className="size-3.5" />
                Remove
              </button>
            </div>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving}
              className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? <IconSpinner className="size-3.5" /> : <IconImage className="size-3.5" />}
              {isSaving ? 'Saving…' : 'Save as image'}
            </button>
          </>
        )}
      </div>
    </aside>
  )
}
