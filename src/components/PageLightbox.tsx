import { useEffect, useRef, useState } from 'react'
import type { PageItem } from '../types'
import { IconChevronLeft, IconChevronRight, IconEdit, IconImage, IconRotate, IconRotateCcw, IconSpinner, IconTrash, IconX } from './Icons'

interface PageLightboxProps {
  pages: PageItem[]
  pageId: string
  onClose: () => void
  onNavigate: (id: string) => void
  onRotate: (id: string, direction?: 1 | -1) => void
  onRemove: (id: string) => void
  onSaveAsImage: (id: string) => Promise<void>
  onEditText: (id: string) => void
}

export function PageLightbox({ pages, pageId, onClose, onNavigate, onRotate, onRemove, onSaveAsImage, onEditText }: PageLightboxProps) {
  const [isSaving, setIsSaving] = useState(false)
  const lastIndexRef = useRef(0)
  const currentIndex = pages.findIndex((p) => p.id === pageId)
  const page = currentIndex === -1 ? null : pages[currentIndex]

  useEffect(() => {
    if (pages.length === 0) {
      onClose()
      return
    }
    if (currentIndex === -1) {
      onNavigate(pages[Math.min(lastIndexRef.current, pages.length - 1)].id)
    } else {
      lastIndexRef.current = currentIndex
    }
  }, [pages, currentIndex, onNavigate, onClose])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (currentIndex === -1) return
      if (e.key === 'ArrowLeft') onNavigate(pages[(currentIndex - 1 + pages.length) % pages.length].id)
      if (e.key === 'ArrowRight') onNavigate(pages[(currentIndex + 1) % pages.length].id)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, onNavigate, pages, currentIndex])

  if (!page) return null

  const rotated90 = page.rotation % 180 !== 0
  const aspectRatio = rotated90 ? `${page.height} / ${page.width}` : `${page.width} / ${page.height}`
  const handleSave = async () => {
    if (isSaving) return
    setIsSaving(true)
    try {
      await onSaveAsImage(page.id)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col bg-slate-900/80 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Page ${page.pageNumber} of ${page.sourceName}`}
    >
      <div className="flex items-center justify-between px-4 py-3 text-white sm:px-6">
        <p className="truncate text-sm">
          {page.sourceName} <span className="text-white/60">· p{page.pageNumber}</span>
          <span className="ml-3 text-white/60">
            {currentIndex + 1} / {pages.length}
          </span>
        </p>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          aria-label="Close preview"
          className="rounded-md p-1.5 text-white/80 hover:bg-white/10 hover:text-white"
        >
          <IconX className="size-5" />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-4 sm:px-16">
        {pages.length > 1 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onNavigate(pages[(currentIndex - 1 + pages.length) % pages.length].id)
            }}
            aria-label="Previous page"
            className="absolute left-1 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 sm:left-3 sm:p-3"
          >
            <IconChevronLeft className="size-5 sm:size-6" />
          </button>
        )}

        <div
          className="max-h-[calc(100vh-11rem)] max-w-full overflow-hidden rounded-lg bg-white shadow-2xl"
          style={{ aspectRatio }}
          onClick={(e) => e.stopPropagation()}
        >
          <img
            key={page.id}
            src={page.thumbnailUrl}
            alt={`Page ${page.pageNumber} of ${page.sourceName}`}
            className="h-full w-full object-contain"
            style={{ transform: `rotate(${page.rotation}deg)` }}
          />
        </div>

        {pages.length > 1 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onNavigate(pages[(currentIndex + 1) % pages.length].id)
            }}
            aria-label="Next page"
            className="absolute right-1 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 sm:right-3 sm:p-3"
          >
            <IconChevronRight className="size-5 sm:size-6" />
          </button>
        )}
      </div>

      <div
        className="flex flex-wrap items-center justify-center gap-2 px-4 pb-5"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => onRotate(page.id, -1)}
          aria-label="Rotate counter-clockwise"
          title="Rotate counter-clockwise"
          className="inline-flex items-center justify-center rounded-lg bg-white/10 px-3 py-2 text-sm font-medium text-white hover:bg-white/20"
        >
          <IconRotateCcw className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => onRotate(page.id, 1)}
          aria-label="Rotate clockwise"
          title="Rotate clockwise"
          className="inline-flex items-center justify-center rounded-lg bg-white/10 px-3 py-2 text-sm font-medium text-white hover:bg-white/20"
        >
          <IconRotate className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => onEditText(page.id)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-sm font-medium text-white hover:bg-white/20"
        >
          <IconEdit className="size-4" />
          Edit text
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={isSaving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-sm font-medium text-white hover:bg-white/20 disabled:opacity-60"
        >
          {isSaving ? <IconSpinner className="size-4" /> : <IconImage className="size-4" />}
          Save as image
        </button>
        <button
          type="button"
          onClick={() => onRemove(page.id)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/20 px-3 py-2 text-sm font-medium text-red-200 hover:bg-red-500/30"
        >
          <IconTrash className="size-4" />
          Remove
        </button>
      </div>
    </div>
  )
}
