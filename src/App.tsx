import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type { PageItem, SourceDoc } from './types'
import {
  PdfLoadError,
  createBlankPage,
  downloadBlob,
  downloadBytes,
  downloadPagesAsImages,
  ensurePdfExtension,
  exportPageAsImage,
  isImageFile,
  loadImageFile,
  loadPdfFile,
  mergePages,
  uid,
} from './lib/pdf'
import { Dropzone } from './components/Dropzone'
import { PageGrid } from './components/PageGrid'
import { EmptyState } from './components/EmptyState'
import { ImportIssues } from './components/ImportIssues'
import type { ImportIssue } from './components/ImportIssues'
import { PrintLayoutModal } from './components/PrintLayoutModal'
import { SplitModal } from './components/SplitModal'
import { PreviewPanel } from './components/PreviewPanel'
import { UndoToast } from './components/UndoToast'
import {
  IconCopy,
  IconDownload,
  IconFilePlus,
  IconFileText,
  IconImage,
  IconPrinter,
  IconRotate,
  IconScissors,
  IconSpinner,
  IconTrash,
  IconUploadCloud,
} from './components/Icons'

const UNDO_TIMEOUT_MS = 8000

interface UndoSnapshot {
  pages: PageItem[]
  sources: Map<string, SourceDoc>
  message: string
}

function App() {
  const [pages, setPages] = useState<PageItem[]>([])
  const [sources, setSources] = useState<Map<string, SourceDoc>>(new Map())
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [issues, setIssues] = useState<ImportIssue[]>([])
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null)
  const [isMerging, setIsMerging] = useState(false)
  const [outputName, setOutputName] = useState('merged.pdf')
  const [printModalOpen, setPrintModalOpen] = useState(false)
  const [splitModalOpen, setSplitModalOpen] = useState(false)
  const [previewPageId, setPreviewPageId] = useState<string | null>(null)
  const [undoSnapshot, setUndoSnapshot] = useState<UndoSnapshot | null>(null)
  const [windowDragActive, setWindowDragActive] = useState(false)
  const [isExportingImages, setIsExportingImages] = useState(false)
  const dragCounter = useRef(0)
  const undoTimerRef = useRef<number | null>(null)
  const pagesRef = useRef(pages)
  const sourcesRef = useRef(sources)

  useEffect(() => {
    pagesRef.current = pages
    sourcesRef.current = sources
  })

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

  const pushUndoSnapshot = useCallback((message: string) => {
    setUndoSnapshot({ pages: pagesRef.current, sources: sourcesRef.current, message })
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current)
    undoTimerRef.current = window.setTimeout(() => setUndoSnapshot(null), UNDO_TIMEOUT_MS)
  }, [])

  const handleUndo = useCallback(() => {
    setUndoSnapshot((snapshot) => {
      if (!snapshot) return snapshot
      setPages(snapshot.pages)
      setSources(snapshot.sources)
      if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current)
      return null
    })
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

  const handleRemove = useCallback(
    (id: string) => {
      pushUndoSnapshot('Page removed')
      setPages((prev) => prev.filter((p) => p.id !== id))
      setSelectedIds((prev) => {
        if (!prev.has(id)) return prev
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    },
    [pushUndoSnapshot],
  )

  const handleReorder = useCallback((next: PageItem[]) => {
    setPages(next)
  }, [])

  const handleReverseOrder = useCallback(() => {
    setPages((prev) => [...prev].reverse())
  }, [])

  const handleClearAll = useCallback(() => {
    if (pagesRef.current.length === 0) return
    pushUndoSnapshot('Cleared all pages')
    setPages([])
    setSources(new Map())
    setIssues([])
    setSelectedIds(new Set())
  }, [pushUndoSnapshot])

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(pages.map((p) => p.id)))
  }, [pages])

  const handleDeselectAll = useCallback(() => setSelectedIds(new Set()), [])

  const handleBulkRemove = useCallback(() => {
    if (selectedIds.size === 0) return
    pushUndoSnapshot(selectedIds.size === 1 ? '1 page removed' : `${selectedIds.size} pages removed`)
    setPages((prev) => prev.filter((p) => !selectedIds.has(p.id)))
    setSelectedIds(new Set())
  }, [selectedIds, pushUndoSnapshot])

  const handleBulkRotate = useCallback(() => {
    setPages((prev) => prev.map((p) => (selectedIds.has(p.id) ? { ...p, rotation: (p.rotation + 90) % 360 } : p)))
  }, [selectedIds])

  const handleBulkDuplicate = useCallback(() => {
    setPages((prev) => {
      const next: PageItem[] = []
      for (const p of prev) {
        next.push(p)
        if (selectedIds.has(p.id)) next.push({ ...p, id: uid() })
      }
      return next
    })
    setSelectedIds(new Set())
  }, [selectedIds])

  const handleSaveAsImage = useCallback(
    async (id: string) => {
      const page = pagesRef.current.find((p) => p.id === id)
      if (!page) return
      try {
        const blob = await exportPageAsImage(page, sourcesRef.current)
        downloadBlob(blob, `page-${String(page.pageNumber).padStart(2, '0')}.png`)
      } catch {
        pushIssue('Something went wrong while saving this page as an image.')
      }
    },
    [pushIssue],
  )

  const handleBulkSaveAsImages = useCallback(async () => {
    if (selectedIds.size === 0 || isExportingImages) return
    setIsExportingImages(true)
    try {
      const selected = pages.filter((p) => selectedIds.has(p.id))
      await downloadPagesAsImages(selected, sources, 'page')
    } catch {
      pushIssue('Something went wrong while saving pages as images.')
    } finally {
      setIsExportingImages(false)
    }
  }, [pages, sources, selectedIds, isExportingImages, pushIssue])

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

  const previewPage = useMemo(() => {
    if (pages.length === 0) return null
    return pages.find((p) => p.id === previewPageId) ?? pages[0]
  }, [pages, previewPageId])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const isTyping = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
      const mod = e.metaKey || e.ctrlKey

      if (mod && e.key.toLowerCase() === 'z') {
        if (isTyping) return
        e.preventDefault()
        handleUndo()
        return
      }
      if (isTyping) return
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        handleSelectAll()
        return
      }
      if (e.key === 'Escape' && selectedIds.size > 0) {
        handleDeselectAll()
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
        e.preventDefault()
        handleBulkRemove()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleUndo, handleSelectAll, handleDeselectAll, handleBulkRemove, selectedIds.size])

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

  const toolbarButtonClass =
    'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-white hover:text-slate-900'
  const divider = <div className="mx-0.5 h-5 w-px shrink-0 bg-slate-300" aria-hidden="true" />

  return (
    <div
      className="relative min-h-screen bg-slate-50 text-slate-900"
      onDragEnter={onWindowDragEnter}
      onDragOver={onWindowDragOver}
      onDragLeave={onWindowDragLeave}
      onDrop={onWindowDrop}
    >
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <IconFileText className="size-4.5" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-bold tracking-tight text-slate-900">PDFPRO</div>
              <div className="text-[11px] text-slate-500">Local PDF &amp; print toolkit</div>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
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
            {pages.length > 0 && (
              <button
                type="button"
                onClick={handleMerge}
                disabled={isMerging}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {isMerging ? <IconSpinner className="size-4" /> : <IconDownload className="size-4" />}
                {isMerging ? 'Merging…' : 'Merge & Download'}
              </button>
            )}
          </div>
        </div>

        {pages.length > 0 && (
          <div className="border-t border-slate-100 bg-slate-50/70">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-2 sm:px-6">
              {selectedIds.size > 0 ? (
                <>
                  <p className="text-sm font-medium text-slate-700">{selectedIds.size} selected</p>
                  <div className="ml-auto flex flex-wrap items-center gap-0.5">
                    <button type="button" onClick={handleBulkDuplicate} className={toolbarButtonClass}>
                      <IconCopy className="size-3.5" />
                      Duplicate
                    </button>
                    <button type="button" onClick={handleBulkRotate} className={toolbarButtonClass}>
                      <IconRotate className="size-3.5" />
                      Rotate
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleBulkSaveAsImages()}
                      disabled={isExportingImages}
                      className={toolbarButtonClass}
                    >
                      {isExportingImages ? <IconSpinner className="size-3.5" /> : <IconImage className="size-3.5" />}
                      Save as image
                    </button>
                    <button
                      type="button"
                      onClick={handleBulkRemove}
                      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
                    >
                      <IconTrash className="size-3.5" />
                      Remove
                    </button>
                    {divider}
                    <button type="button" onClick={handleDeselectAll} className={toolbarButtonClass}>
                      Deselect all
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-slate-500">{summary} — drag any page to reorder</p>
                  <div className="ml-auto flex flex-wrap items-center gap-1">
                    <button type="button" onClick={handleSelectAll} className={toolbarButtonClass}>
                      Select all
                    </button>
                    {divider}
                    <label className="hidden items-center gap-1.5 pl-1 text-sm text-slate-500 sm:flex">
                      Save as
                      <input
                        type="text"
                        value={outputName}
                        onChange={(e) => setOutputName(e.target.value)}
                        className="w-36 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                        placeholder="merged.pdf"
                      />
                    </label>
                    <button type="button" onClick={() => void handleAddBlankPage()} className={toolbarButtonClass}>
                      <IconFilePlus className="size-3.5" />
                      Blank page
                    </button>
                    <button type="button" onClick={handleReverseOrder} className={toolbarButtonClass}>
                      Reverse order
                    </button>
                    <button type="button" onClick={() => setSplitModalOpen(true)} className={toolbarButtonClass}>
                      <IconScissors className="size-3.5" />
                      Split
                    </button>
                    {divider}
                    <button
                      type="button"
                      onClick={handleClearAll}
                      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
                    >
                      Clear all
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <ImportIssues issues={issues} onDismiss={dismissIssue} onDismissAll={dismissAllIssues} />

        {pages.length === 0 ? (
          <EmptyState onFiles={handleFiles} disabled={isImporting} />
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
            <PageGrid
              pages={pages}
              selectedIds={selectedIds}
              onReorder={handleReorder}
              onRotate={handleRotate}
              onRemove={handleRemove}
              onDuplicate={handleDuplicate}
              onToggleSelect={handleToggleSelect}
              onPreview={(page) => setPreviewPageId(page.id)}
            />
            <PreviewPanel page={previewPage} onRotate={handleRotate} onRemove={handleRemove} onSaveAsImage={handleSaveAsImage} />
          </div>
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
        <PrintLayoutModal
          pages={pages}
          sources={sources}
          selectedIds={selectedIds}
          onClose={() => setPrintModalOpen(false)}
          onError={pushIssue}
        />
      )}

      {splitModalOpen && (
        <SplitModal pages={pages} sources={sources} onClose={() => setSplitModalOpen(false)} onError={pushIssue} />
      )}

      {undoSnapshot && (
        <UndoToast message={undoSnapshot.message} onUndo={handleUndo} onDismiss={() => setUndoSnapshot(null)} />
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
