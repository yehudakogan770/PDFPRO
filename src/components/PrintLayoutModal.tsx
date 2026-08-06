import { useEffect, useMemo, useRef, useState } from 'react'
import type { PageItem, SourceDoc } from '../types'
import {
  PAPER_SIZE_OPTIONS,
  bookletPageCount,
  buildPrintLayoutPdf,
} from '../lib/imposition'
import type { PaperSizeKey, PrintLayoutMode } from '../lib/imposition'
import { downloadBytes, ensurePdfExtension } from '../lib/pdf'
import { IconDownload, IconSpinner, IconX } from './Icons'

interface PrintLayoutModalProps {
  pages: PageItem[]
  sources: Map<string, SourceDoc>
  onClose: () => void
  onError: (message: string) => void
}

const MODE_OPTIONS: { value: PrintLayoutMode; label: string; description: string; filename: string }[] = [
  {
    value: 'normal',
    label: 'Normal',
    description: 'No layout changes — each page keeps its original size. Use the options below to add numbers, a watermark, or corner marks.',
    filename: 'printable.pdf',
  },
  {
    value: 'booklet',
    label: 'Booklet',
    description:
      'Two pages per sheet side, reordered so a folded, stapled stack reads in order. Best for saddle-stitched booklets.',
    filename: 'booklet.pdf',
  },
  {
    value: 'fit',
    label: '1 per sheet',
    description: 'One page per sheet, scaled to a uniform paper size. Useful when pages come from mismatched sources.',
    filename: 'print-ready.pdf',
  },
  {
    value: '2up',
    label: '2 per sheet',
    description: 'Two pages side by side per sheet, in normal reading order — no fold reordering, just saves paper.',
    filename: '2-up.pdf',
  },
  {
    value: '4up',
    label: '4 per sheet',
    description: 'Four pages per sheet in a 2x2 grid, in normal reading order.',
    filename: '4-up.pdf',
  },
]

export function PrintLayoutModal({ pages, sources, onClose, onError }: PrintLayoutModalProps) {
  const [mode, setMode] = useState<PrintLayoutMode>('normal')
  const [paperSize, setPaperSize] = useState<PaperSizeKey>('a4')
  const [outputName, setOutputName] = useState('printable.pdf')
  const [pageNumbers, setPageNumbers] = useState(false)
  const [watermarkText, setWatermarkText] = useState('')
  const [cornerMarks, setCornerMarks] = useState(false)
  const [isBuilding, setIsBuilding] = useState(false)
  const filenameTouched = useRef(false)

  const booklet = useMemo(() => bookletPageCount(pages.length), [pages.length])
  const activeMode = MODE_OPTIONS.find((option) => option.value === mode)

  useEffect(() => {
    if (!filenameTouched.current && activeMode) setOutputName(activeMode.filename)
  }, [activeMode])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleDownload = async () => {
    if (pages.length === 0 || isBuilding) return
    setIsBuilding(true)
    try {
      const bytes = await buildPrintLayoutPdf(mode, pages, sources, paperSize, {
        pageNumbers,
        watermarkText,
        cornerMarks,
      })
      downloadBytes(bytes, ensurePdfExtension(outputName))
      onClose()
    } catch {
      onError('Something went wrong while building the print layout. Please try again.')
    } finally {
      setIsBuilding(false)
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
        aria-labelledby="print-layout-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 id="print-layout-title" className="text-base font-semibold text-slate-900">
            Print layout
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

        <div className="mt-4 grid grid-cols-3 gap-2">
          {MODE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setMode(option.value)}
              className={`rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                mode === option.value
                  ? 'border-indigo-400 bg-indigo-50 text-indigo-800'
                  : 'border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        {activeMode && <p className="mt-2.5 text-xs leading-relaxed text-slate-500">{activeMode.description}</p>}

        {mode === 'booklet' && pages.length > 0 && (
          <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-600">
            {pages.length} page{pages.length === 1 ? '' : 's'} → {booklet.sheets} sheet{booklet.sheets === 1 ? '' : 's'} of
            paper{booklet.blanks > 0 && `, plus ${booklet.blanks} blank page${booklet.blanks === 1 ? '' : 's'} added to pad evenly`}.
            Print double-sided with <strong>flip on short edge</strong>, then fold the whole stack in half together and
            staple along the crease.
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {mode !== 'normal' && (
            <label className="flex items-center gap-2 text-sm text-slate-600">
              Paper
              <select
                value={paperSize}
                onChange={(e) => setPaperSize(e.target.value as PaperSizeKey)}
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              >
                {PAPER_SIZE_OPTIONS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-slate-600">
            Save as
            <input
              type="text"
              value={outputName}
              onChange={(e) => {
                filenameTouched.current = true
                setOutputName(e.target.value)
              }}
              placeholder="printable.pdf"
              className="w-full min-w-0 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </label>
        </div>

        <div className="mt-4 space-y-2.5 border-t border-slate-100 pt-4">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={pageNumbers}
              onChange={(e) => setPageNumbers(e.target.checked)}
              className="size-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400"
            />
            Add page numbers
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={cornerMarks}
              onChange={(e) => setCornerMarks(e.target.checked)}
              className="size-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400"
            />
            Add corner marks (for trimming/alignment)
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <span className="shrink-0">Watermark</span>
            <input
              type="text"
              value={watermarkText}
              onChange={(e) => setWatermarkText(e.target.value)}
              placeholder="e.g. DRAFT (leave blank for none)"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={pages.length === 0 || isBuilding}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isBuilding ? <IconSpinner className="size-4" /> : <IconDownload className="size-4" />}
            {isBuilding ? 'Building…' : 'Download'}
          </button>
        </div>
      </div>
    </div>
  )
}
