import { useEffect, useMemo, useState } from 'react'
import type { PageItem, SourceDoc } from '../types'
import { downloadSplitChunks } from '../lib/pdf'
import { IconScissors, IconSpinner, IconX } from './Icons'

interface SplitModalProps {
  pages: PageItem[]
  sources: Map<string, SourceDoc>
  onClose: () => void
  onError: (message: string) => void
}

type SplitMode = 'single' | 'chunks'

export function SplitModal({ pages, sources, onClose, onError }: SplitModalProps) {
  const [mode, setMode] = useState<SplitMode>('single')
  const [chunkSize, setChunkSize] = useState(2)
  const [baseName, setBaseName] = useState('split')
  const [isExporting, setIsExporting] = useState(false)

  const pagesPerFile = mode === 'single' ? 1 : Math.max(1, Math.floor(chunkSize))
  const fileCount = pages.length === 0 ? 0 : Math.ceil(pages.length / pagesPerFile)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleExport = async () => {
    if (pages.length === 0 || isExporting) return
    setIsExporting(true)
    try {
      await downloadSplitChunks(pages, sources, pagesPerFile, baseName.trim() || 'split')
      onClose()
    } catch {
      onError('Something went wrong while splitting your PDF. Please try again.')
    } finally {
      setIsExporting(false)
    }
  }

  const fileCountLabel = useMemo(() => `${fileCount} file${fileCount === 1 ? '' : 's'}`, [fileCount])

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="split-title"
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 id="split-title" className="text-base font-semibold text-slate-900">
            Split into files
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

        <div className="mt-4 space-y-2">
          <label className="flex items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-700 has-checked:border-indigo-400 has-checked:bg-indigo-50">
            <input type="radio" name="split-mode" checked={mode === 'single'} onChange={() => setMode('single')} className="text-indigo-600 focus:ring-indigo-400" />
            One page per file
          </label>
          <label className="flex items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-700 has-checked:border-indigo-400 has-checked:bg-indigo-50">
            <input type="radio" name="split-mode" checked={mode === 'chunks'} onChange={() => setMode('chunks')} className="text-indigo-600 focus:ring-indigo-400" />
            Every
            <input
              type="number"
              min={1}
              value={chunkSize}
              onChange={(e) => {
                setMode('chunks')
                setChunkSize(Number(e.target.value) || 1)
              }}
              className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
            pages
          </label>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          {pages.length} page{pages.length === 1 ? '' : 's'} → {fileCountLabel}. Your browser may ask to allow multiple
          downloads.
        </p>

        <label className="mt-4 flex items-center gap-2 text-sm text-slate-600">
          File name prefix
          <input
            type="text"
            value={baseName}
            onChange={(e) => setBaseName(e.target.value)}
            placeholder="split"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={pages.length === 0 || isExporting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isExporting ? <IconSpinner className="size-4" /> : <IconScissors className="size-4" />}
            {isExporting ? 'Exporting…' : `Export ${fileCountLabel}`}
          </button>
        </div>
      </div>
    </div>
  )
}
