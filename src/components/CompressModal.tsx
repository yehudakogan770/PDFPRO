import { useEffect, useMemo, useState } from 'react'
import type { PageItem, SourceDoc } from '../types'
import { COMPRESSION_PRESETS, buildCompressedPdf } from '../lib/compress'
import type { CompressionLevel } from '../lib/compress'
import { downloadBytes, ensurePdfExtension } from '../lib/pdf'
import { IconMinimize, IconSpinner, IconX } from './Icons'

interface CompressModalProps {
  pages: PageItem[]
  sources: Map<string, SourceDoc>
  selectedIds: Set<string>
  onClose: () => void
  onError: (message: string) => void
}

const LEVELS = Object.keys(COMPRESSION_PRESETS) as CompressionLevel[]

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function CompressModal({ pages, sources, selectedIds, onClose, onError }: CompressModalProps) {
  const [level, setLevel] = useState<CompressionLevel>('balanced')
  const [onlySelected, setOnlySelected] = useState(selectedIds.size > 0)
  const [outputName, setOutputName] = useState('compressed.pdf')
  const [isCompressing, setIsCompressing] = useState(false)
  const [result, setResult] = useState<{ before: number; after: number } | null>(null)

  const effectivePages = useMemo(
    () => (onlySelected && selectedIds.size > 0 ? pages.filter((p) => selectedIds.has(p.id)) : pages),
    [pages, selectedIds, onlySelected],
  )

  const approxOriginalSize = useMemo(() => {
    const sourceIds = new Set(effectivePages.map((p) => p.sourceId))
    let total = 0
    for (const id of sourceIds) {
      const source = sources.get(id)
      if (source) total += source.bytes.byteLength
    }
    return total
  }, [effectivePages, sources])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleCompress = async () => {
    if (effectivePages.length === 0 || isCompressing) return
    setIsCompressing(true)
    setResult(null)
    try {
      const bytes = await buildCompressedPdf(effectivePages, sources, level)
      downloadBytes(bytes, ensurePdfExtension(outputName))
      setResult({ before: approxOriginalSize, after: bytes.byteLength })
    } catch {
      onError('Something went wrong while compressing your PDF. Please try again.')
    } finally {
      setIsCompressing(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="compress-title"
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 id="compress-title" className="text-base font-semibold text-slate-900">
            Compress PDF
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

        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          Converts each page to a compressed image. Great for scanned or photo-heavy PDFs; text will no longer be
          selectable in the output.
        </p>

        {selectedIds.size > 0 && (
          <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={onlySelected}
              onChange={(e) => setOnlySelected(e.target.checked)}
              className="size-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400"
            />
            Only include the {selectedIds.size} selected page{selectedIds.size === 1 ? '' : 's'}
          </label>
        )}

        <div className="mt-4 space-y-2">
          {LEVELS.map((key) => {
            const preset = COMPRESSION_PRESETS[key]
            return (
              <label
                key={key}
                className="flex items-start gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-700 has-checked:border-indigo-400 has-checked:bg-indigo-50"
              >
                <input
                  type="radio"
                  name="compression-level"
                  checked={level === key}
                  onChange={() => setLevel(key)}
                  className="mt-0.5 text-indigo-600 focus:ring-indigo-400"
                />
                <span>
                  <span className="block font-medium text-slate-800">{preset.label}</span>
                  <span className="block text-xs leading-relaxed text-slate-500">{preset.description}</span>
                </span>
              </label>
            )
          })}
        </div>

        {approxOriginalSize > 0 && (
          <p className="mt-3 text-xs text-slate-500">Original size (approx.): {formatBytes(approxOriginalSize)}</p>
        )}

        <label className="mt-4 flex items-center gap-2 text-sm text-slate-600">
          Save as
          <input
            type="text"
            value={outputName}
            onChange={(e) => setOutputName(e.target.value)}
            placeholder="compressed.pdf"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
        </label>

        {result && result.after < result.before && (
          <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2.5 text-xs leading-relaxed text-emerald-800">
            Downloaded — {formatBytes(result.before)} → {formatBytes(result.after)} (
            {Math.round((1 - result.after / result.before) * 100)}% smaller)
          </p>
        )}
        {result && result.after >= result.before && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-800">
            Downloaded — {formatBytes(result.before)} → {formatBytes(result.after)}. This document was already
            compact (likely vector text rather than scanned images), so rasterizing it didn't shrink it. Compression
            works best on scanned or photo-heavy PDFs.
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
            Close
          </button>
          <button
            type="button"
            onClick={() => void handleCompress()}
            disabled={effectivePages.length === 0 || isCompressing}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isCompressing ? <IconSpinner className="size-4" /> : <IconMinimize className="size-4" />}
            {isCompressing ? 'Compressing…' : 'Compress & Download'}
          </button>
        </div>
      </div>
    </div>
  )
}
