import { useEffect, useState } from 'react'
import type { PageItem, SourceDoc } from '../types'
import { applyCrop } from '../lib/crop'
import type { CropInsets } from '../lib/crop'
import type { LoadedPdf } from '../lib/pdf'
import { IconCrop, IconSpinner, IconX } from './Icons'

interface CropModalProps {
  page: PageItem
  sources: Map<string, SourceDoc>
  onClose: () => void
  onApply: (pageId: string, loaded: LoadedPdf) => Promise<void>
  onError: (message: string) => void
}

const MAX_INSET = 45

export function CropModal({ page, sources, onClose, onApply, onError }: CropModalProps) {
  const [insets, setInsets] = useState({ top: 0, bottom: 0, left: 0, right: 0 })
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const setInset = (side: keyof typeof insets, value: number) => {
    setInsets((prev) => ({ ...prev, [side]: Math.max(0, Math.min(MAX_INSET, value)) }))
  }

  const hasCrop = insets.top > 0 || insets.bottom > 0 || insets.left > 0 || insets.right > 0

  const handleApply = async () => {
    if (isSaving || !hasCrop) return
    setIsSaving(true)
    try {
      const cropInsets: CropInsets = {
        top: insets.top / 100,
        bottom: insets.bottom / 100,
        left: insets.left / 100,
        right: insets.right / 100,
      }
      const result = await applyCrop(page, sources, cropInsets)
      await onApply(page.id, result)
      onClose()
    } catch (err) {
      console.error(err)
      onError('Something went wrong while cropping this page. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  const rotated90 = page.rotation % 180 !== 0
  const aspectRatio = rotated90 ? `${page.height} / ${page.width}` : `${page.width} / ${page.height}`

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 px-4 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="crop-title"
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 id="crop-title" className="text-base font-semibold text-slate-900">
            Crop page
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <IconX className="size-4.5" />
          </button>
        </div>

        <div className="mt-4 flex items-center justify-center overflow-hidden rounded-xl bg-slate-100" style={{ aspectRatio, maxHeight: '40vh' }}>
          <div className="relative h-full w-full">
            <img
              src={page.thumbnailUrl}
              alt={`Page ${page.pageNumber} of ${page.sourceName}`}
              className="h-full w-full object-contain"
              style={{ transform: `rotate(${page.rotation}deg)` }}
            />
            <div className="pointer-events-none absolute inset-x-0 top-0 bg-slate-900/55" style={{ height: `${insets.top}%` }} />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-slate-900/55" style={{ height: `${insets.bottom}%` }} />
            <div
              className="pointer-events-none absolute left-0 bg-slate-900/55"
              style={{ top: `${insets.top}%`, bottom: `${insets.bottom}%`, width: `${insets.left}%` }}
            />
            <div
              className="pointer-events-none absolute right-0 bg-slate-900/55"
              style={{ top: `${insets.top}%`, bottom: `${insets.bottom}%`, width: `${insets.right}%` }}
            />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          {(['top', 'bottom', 'left', 'right'] as const).map((side) => (
            <label key={side} className="flex items-center gap-2 text-sm text-slate-600">
              <span className="w-12 capitalize">{side}</span>
              <input
                type="number"
                min={0}
                max={MAX_INSET}
                value={insets[side]}
                onChange={(e) => setInset(side, Number(e.target.value) || 0)}
                className="w-16 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
              <span className="text-slate-400">%</span>
            </label>
          ))}
        </div>

        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          Trims the page's visible area from each edge. The trimmed content isn't deleted from the file, just no longer
          shown or printed.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleApply()}
            disabled={isSaving || !hasCrop}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isSaving ? <IconSpinner className="size-4" /> : <IconCrop className="size-4" />}
            {isSaving ? 'Cropping…' : 'Apply crop'}
          </button>
        </div>
      </div>
    </div>
  )
}
