import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type { PageItem, SourceDoc } from './types'
import {
  PdfLoadError,
  createBlankPage,
  downloadBytes,
  ensurePdfExtension,
  isImageFile,
  loadImageFile,
  loadPdfFile,
  mergePages,
  uid,
} from './lib/pdf'
import { Dropzone } from './components/Dropzone'
import { PageGrid } from './components/PageGrid'
import { ImportIssues } from './components/ImportIssues'
import type { ImportIssue } from './components/ImportIssues'
import { PrintLayoutModal } from './components/PrintLayoutModal'
import { SplitModal } from './components/SplitModal'
import { IconDownload, IconFilePlus, IconFileText, IconPrinter, IconScissors, IconSpinner, IconUploadCloud } from './components/Icons'

function App() {
  const [pages, setPages] = useState<PageItem[]>([])
  const [sources, setSources] = useState<Map<string, SourceDoc>>(new Map())
  const [issues, setIssues] = useState<ImportIssue[]>([])
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null)
  const [isMerging, setIsMerging] = useState(false)
  const [outputName, setOutputName] = useState('merged.pdf')
  const [printModalOpen, setPrintModalOpen] = useState(false)
  const [splitModalOpen, setSplitModalOpen] = useState(false)
  const [windowDragActive, setWindowDragActive] = useState(false)
  const dragCounter = useRef(0)

  const fileCount = sources.size
  const isImporting = importProgress !== null

  useEffect(() => {
    if (pages.length === 0) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [pages.length])

  const pushIssue = useCallback((message: string) => {
    setIssues((prev) => [...prev, { id: uid(), message }])
  }, [])

  const handleFiles = useCallback(
    async (incoming: File[]) => {
      const isPdf = (f: File) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
      const importable = incoming.filter((f) => isPdf(f) || isImageFile(f))
      const rejectedCount = incoming.length - importable.length
      if (rejectedCount > 0) {
        pushIssue(
          rejectedCount === 1
            ? '1 file was skipped — only PDF, JPG, and PNG files are supported.'
            : `${rejectedCount} files were skipped — only PDF, JPG, and PNG files are supported.`,
        )
      }
      if (importable.length === 0) return

      setImportProgress({ done: 0, total: importable.length })

      for (const file of importable) {
        try {
          const { source, pages: newPages } = isPdf(file) ? await loadPdfFile(file) : await loadImageFile(file)
          setSources((prev) => {
            const next = new Map(prev)
            next.set(source.id, source)
            return next
          })
          setPages((prev) => [...prev, ...newPages])
        } catch (err) {
          if (!(err instanceof PdfLoadError)) console.error(err)
          const message = err instanceof PdfLoadError ? err.message : `${file.name}: could not be imported.`
          pushIssue(message)
        } finally {
          setImportProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : null))
        }
      }

      setImportProgress(null)
    },
    [pushIssue],
  )

  const handleDuplicate = useCallback((id: string) => {
    setPages((prev) => {
      const index = prev.findIndex((p) => p.id === id)
      if (index === -1) return prev
      const copy: PageItem = { ...prev[index], id: uid() }
      return [...prev.slice(0, index + 1), copy, ...prev.slice(index + 1)]
    })
  }, [])

  const handleAddBlankPage = useCallback(async () => {
    const last = pages[pages.length - 1]
    const width = last ? (last.rotation % 180 !== 0 ? last.height : last.width) : undefined
    const height = last ? (last.rotation % 180 !== 0 ? last.width : last.height) : undefined
    try {
      const { source, pages: newPages } = await createBlankPage(width, height)
      setSources((prev) => {
        const next = new Map(prev)
        next.set(source.id, source)
        return next
      })
      setPages((prev) => [...prev, ...newPages])
    } catch {
      pushIssue('Something went wrong while adding a blank page.')
    }
  }, [pages, pushIssue])

  const handleRotate = useCallback((id: string) => {
    setPages((prev) => prev.map((p) => (p.id === id ? { ...p, rotation: (p.rotation + 90) % 360 } : p)))
  }, [])

  const handleRemove = useCallback((id: string) => {
    setPages((prev) => prev.filter((p) => p.id !== id))
  }, [])

  const handleReorder = useCallback((next: PageItem[]) => {
    setPages(next)
  }, [])

  const handleClearAll = useCallback(() => {
    setPages([])
    setSources(new Map())
    setIssues([])
  }, [])

  const handleMerge = useCallback(async () => {
    if (pages.length === 0 || isMerging) return
    setIsMerging(true)
    try {
      const bytes = await mergePages(pages, sources)
      downloadBytes(bytes, ensurePdfExtension(outputName))
    } catch {
      pushIssue('Something went wrong while merging your PDFs. Please try again.')
    } finally {
      setIsMerging(false)
    }
  }, [pages, sources, outputName, isMerging, pushIssue])

  const dismissIssue = useCallback((id: string) => {
    setIssues((prev) => prev.filter((i) => i.id !== id))
  }, [])

  const dismissAllIssues = useCallback(() => setIssues([]), [])

  const summary = useMemo(() => {
    if (pages.length === 0) return ''
    const pageWord = pages.length === 1 ? 'page' : 'pages'
    const fileWord = fileCount === 1 ? 'file' : 'files'
    return `${pages.length} ${pageWord} from ${fileCount} ${fileWord}`
  }, [pages.length, fileCount])

  const onWindowDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    dragCounter.current += 1
    setWindowDragActive(true)
  }
  const onWindowDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
  }
  const onWindowDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    dragCounter.current = Math.max(0, dragCounter.current - 1)
    if (dragCounter.current === 0) setWindowDragActive(false)
  }
  const onWindowDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    dragCounter.current = 0
    setWindowDragActive(false)
    if (e.dataTransfer.files.length > 0) {
      void handleFiles(Array.from(e.dataTransfer.files))
    }
  }

  return (
    <div
      className="relative min-h-screen bg-slate-50 text-slate-900"
      onDragEnter={onWindowDragEnter}
      onDragOver={onWindowDragOver}
      onDragLeave={onWindowDragLeave}
      onDrop={onWindowDrop}
    >
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <IconFileText className="size-4.5" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-bold tracking-tight text-slate-900">PDFPRO</div>
              <div className="text-[11px] text-slate-500">Merge, reorder &amp; print PDFs</div>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {pages.length > 0 && (
              <>
                <label className="hidden items-center gap-1.5 text-sm text-slate-500 sm:flex">
                  Save as
                  <input
                    type="text"
                    value={outputName}
                    onChange={(e) => setOutputName(e.target.value)}
                    className="w-36 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                    placeholder="merged.pdf"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void handleAddBlankPage()}
                  className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                >
                  <IconFilePlus className="size-4" />
                  Blank page
                </button>
                <button
                  type="button"
                  onClick={() => setSplitModalOpen(true)}
                  className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                >
                  <IconScissors className="size-4" />
                  Split
                </button>
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                >
                  Clear all
                </button>
              </>
            )}
            <Dropzone variant="button" onFiles={handleFiles} disabled={isImporting} />
            {pages.length > 0 && (
              <button
                type="button"
                onClick={() => setPrintModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                <IconPrinter className="size-4" />
                Print Layout
              </button>
            )}
            <button
              type="button"
              onClick={handleMerge}
              disabled={pages.length === 0 || isMerging}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isMerging ? <IconSpinner className="size-4" /> : <IconDownload className="size-4" />}
              {isMerging ? 'Merging…' : 'Merge & Download'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <ImportIssues issues={issues} onDismiss={dismissIssue} onDismissAll={dismissAllIssues} />

        {pages.length === 0 ? (
          <Dropzone variant="empty" onFiles={handleFiles} disabled={isImporting} />
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-slate-500">
                {summary} — drag any page to reorder
              </p>
            </div>
            <PageGrid pages={pages} onReorder={handleReorder} onRotate={handleRotate} onRemove={handleRemove} onDuplicate={handleDuplicate} />
          </>
        )}

        {isImporting && importProgress && (
          <div className="mt-6 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <IconSpinner className="size-5 text-indigo-600" />
            <div className="flex-1">
              <div className="text-sm font-medium text-slate-700">
                Importing file {Math.min(importProgress.done + 1, importProgress.total)} of {importProgress.total}…
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all duration-300"
                  style={{ width: `${(importProgress.done / importProgress.total) * 100}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="pb-10 pt-4 text-center text-xs text-slate-400">
        Everything runs locally in your browser — your files are never uploaded anywhere.
      </footer>

      {printModalOpen && (
        <PrintLayoutModal pages={pages} sources={sources} onClose={() => setPrintModalOpen(false)} onError={pushIssue} />
      )}

      {splitModalOpen && (
        <SplitModal pages={pages} sources={sources} onClose={() => setSplitModalOpen(false)} onError={pushIssue} />
      )}

      {windowDragActive && (
        <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center bg-indigo-600/10 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-indigo-400 bg-white/95 px-12 py-10 shadow-xl">
            <IconUploadCloud className="size-10 text-indigo-600" />
            <p className="text-lg font-semibold text-indigo-900">Drop files to import</p>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
