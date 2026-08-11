import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type { PageItem, SourceDoc } from './types'
import { getDocument } from 'pdfjs-dist'
import {
  PdfLoadError,
  PdfPasswordRequiredError,
  createBlankPage,
  downloadBlob,
  downloadBytes,
  downloadPagesAsImages,
  downloadText,
  ensurePdfExtension,
  exportPageAsImage,
  extractPagesText,
  isImageFile,
  loadImageFile,
  loadPdfFile,
  mergePages,
  renderPageThumbnail,
  toArrayBuffer,
  uid,
} from './lib/pdf'
import type { LoadedPdf } from './lib/pdf'
import { Dropzone } from './components/Dropzone'
import { PageGrid } from './components/PageGrid'
import { EmptyState } from './components/EmptyState'
import { ImportIssues } from './components/ImportIssues'
import type { ImportIssue } from './components/ImportIssues'
import { PrintLayoutModal } from './components/PrintLayoutModal'
import { SplitModal } from './components/SplitModal'
import { CompressModal } from './components/CompressModal'
import { ShortcutsHelp } from './components/ShortcutsHelp'
import { PageLightbox } from './components/PageLightbox'
import { TextEditModal } from './components/TextEditModal'
import { CropModal } from './components/CropModal'
import { FillFormModal } from './components/FillFormModal'
import { PasswordPromptModal } from './components/PasswordPromptModal'
import { UndoToast } from './components/UndoToast'
import {
  IconClipboardList,
  IconCopy,
  IconDownload,
  IconFileOutput,
  IconFilePlus,
  IconFileText,
  IconFileTxt,
  IconHelpCircle,
  IconImage,
  IconMinimize,
  IconPrinter,
  IconRotate,
  IconRotateCcw,
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
  const [lightboxPageId, setLightboxPageId] = useState<string | null>(null)
  const [textEditPageId, setTextEditPageId] = useState<string | null>(null)
  const [cropPageId, setCropPageId] = useState<string | null>(null)
  const [fillFormModalOpen, setFillFormModalOpen] = useState(false)
  const [passwordQueue, setPasswordQueue] = useState<File[]>([])
  const [passwordChecking, setPasswordChecking] = useState(false)
  const [passwordWrong, setPasswordWrong] = useState(false)
  const [rangeInput, setRangeInput] = useState('')
  const [isExtractingText, setIsExtractingText] = useState(false)
  const [undoSnapshot, setUndoSnapshot] = useState<UndoSnapshot | null>(null)
  const [windowDragActive, setWindowDragActive] = useState(false)
  const [isExportingImages, setIsExportingImages] = useState(false)
  const [isExtracting, setIsExtracting] = useState(false)
  const [compressModalOpen, setCompressModalOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
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
          if (err instanceof PdfPasswordRequiredError) {
            setPasswordQueue((prev) => [...prev, file])
            continue
          }
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

  const handleRotate = useCallback((id: string, direction: 1 | -1 = 1) => {
    setPages((prev) => prev.map((p) => (p.id === id ? { ...p, rotation: (p.rotation + 90 * direction + 360) % 360 } : p)))
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

  const handleBulkRotate = useCallback(
    (direction: 1 | -1 = 1) => {
      setPages((prev) =>
        prev.map((p) => (selectedIds.has(p.id) ? { ...p, rotation: (p.rotation + 90 * direction + 360) % 360 } : p)),
      )
    },
    [selectedIds],
  )

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

  // Shared by the text editor and crop tool: both replace one page's content
  // with a freshly baked single-page source, keyed by the same PageItem id.
  const handleReplacePageContent = useCallback(
    async (pageId: string, loaded: LoadedPdf, undoMessage: string) => {
      pushUndoSnapshot(undoMessage)
      const newSource = loaded.source
      const newPage = loaded.pages[0]
      setSources((prev) => {
        const next = new Map(prev)
        next.set(newSource.id, newSource)
        return next
      })
      setPages((prev) =>
        prev.map((p) =>
          p.id === pageId
            ? {
                ...p,
                sourceId: newPage.sourceId,
                pageIndex: newPage.pageIndex,
                rotation: newPage.rotation,
                thumbnailUrl: newPage.thumbnailUrl,
                width: newPage.width,
                height: newPage.height,
              }
            : p,
        ),
      )
    },
    [pushUndoSnapshot],
  )

  const handleApplyTextEdits = useCallback(
    (pageId: string, loaded: LoadedPdf) => handleReplacePageContent(pageId, loaded, 'Text edited'),
    [handleReplacePageContent],
  )

  const handleApplyCrop = useCallback(
    (pageId: string, loaded: LoadedPdf) => handleReplacePageContent(pageId, loaded, 'Page cropped'),
    [handleReplacePageContent],
  )

  // The lightbox and any full-screen sub-tool (text editor, crop) each have
  // their own "Escape closes me" listener; keeping both mounted at once means
  // a single Escape (e.g. to dismiss an in-progress text box) closes both.
  // Close the lightbox while the sub-tool is open and reopen it (on the same
  // page) once it's done.
  const handleEditTextFromLightbox = useCallback((id: string) => {
    setLightboxPageId(null)
    setTextEditPageId(id)
  }, [])

  const handleCloseTextEditor = useCallback(() => {
    if (textEditPageId !== null) setLightboxPageId(textEditPageId)
    setTextEditPageId(null)
  }, [textEditPageId])

  const handleCropFromLightbox = useCallback((id: string) => {
    setLightboxPageId(null)
    setCropPageId(id)
  }, [])

  const handleCloseCropModal = useCallback(() => {
    if (cropPageId !== null) setLightboxPageId(cropPageId)
    setCropPageId(null)
  }, [cropPageId])

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

  const handleExtractSelected = useCallback(async () => {
    if (selectedIds.size === 0 || isExtracting) return
    setIsExtracting(true)
    try {
      const selected = pages.filter((p) => selectedIds.has(p.id))
      const bytes = await mergePages(selected, sources)
      downloadBytes(bytes, ensurePdfExtension(selected.length === 1 ? 'page.pdf' : 'extracted.pdf'))
    } catch {
      pushIssue('Something went wrong while extracting the selected pages.')
    } finally {
      setIsExtracting(false)
    }
  }, [pages, sources, selectedIds, isExtracting, pushIssue])

  const handleExtractText = useCallback(async () => {
    if (selectedIds.size === 0 || isExtractingText) return
    setIsExtractingText(true)
    try {
      const selected = pages.filter((p) => selectedIds.has(p.id))
      const text = await extractPagesText(selected, sources)
      downloadText(text, 'extracted-text.txt')
    } catch {
      pushIssue('Something went wrong while extracting text from the selected pages.')
    } finally {
      setIsExtractingText(false)
    }
  }, [pages, sources, selectedIds, isExtractingText, pushIssue])

  const parsePageRange = useCallback((input: string, total: number): number[] => {
    const indices = new Set<number>()
    for (const part of input.split(',')) {
      const trimmed = part.trim()
      if (!trimmed) continue
      const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/)
      if (rangeMatch) {
        let start = parseInt(rangeMatch[1], 10)
        let end = parseInt(rangeMatch[2], 10)
        if (start > end) [start, end] = [end, start]
        for (let i = start; i <= end; i++) if (i >= 1 && i <= total) indices.add(i - 1)
      } else if (/^\d+$/.test(trimmed)) {
        const n = parseInt(trimmed, 10)
        if (n >= 1 && n <= total) indices.add(n - 1)
      }
    }
    return [...indices].sort((a, b) => a - b)
  }, [])

  const handleSelectRange = useCallback(() => {
    const indices = parsePageRange(rangeInput, pages.length)
    if (indices.length === 0) {
      pushIssue('No valid pages matched that range, e.g. try "1-3,5,8".')
      return
    }
    setSelectedIds(new Set(indices.map((i) => pages[i].id)))
  }, [rangeInput, pages, parsePageRange, pushIssue])

  const handleApplyFormFill = useCallback(
    async (sourceId: string, newBytes: Uint8Array) => {
      pushUndoSnapshot('Form filled')
      const affectedIndices = new Set(pagesRef.current.filter((p) => p.sourceId === sourceId).map((p) => p.pageIndex))
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const thumbByIndex = new Map<number, { url: string; width: number; height: number }>()

      const pdf = await getDocument({ data: newBytes.slice() }).promise
      try {
        for (const idx of affectedIndices) {
          const page = await pdf.getPage(idx + 1)
          thumbByIndex.set(idx, await renderPageThumbnail(page, dpr))
        }
      } finally {
        await pdf.loadingTask.destroy()
      }

      const newBuffer = toArrayBuffer(newBytes)
      setSources((prev) => {
        const next = new Map(prev)
        const existing = next.get(sourceId)
        if (existing) next.set(sourceId, { ...existing, bytes: newBuffer })
        return next
      })
      setPages((prev) =>
        prev.map((p) => {
          if (p.sourceId !== sourceId) return p
          const thumb = thumbByIndex.get(p.pageIndex)
          return thumb ? { ...p, thumbnailUrl: thumb.url, width: thumb.width, height: thumb.height } : p
        }),
      )
    },
    [pushUndoSnapshot],
  )

  const handleUnlockSubmit = useCallback(
    async (password: string) => {
      const file = passwordQueue[0]
      if (!file || passwordChecking) return
      setPasswordChecking(true)
      try {
        const { source, pages: newPages } = await loadPdfFile(file, password)
        setSources((prev) => {
          const next = new Map(prev)
          next.set(source.id, source)
          return next
        })
        setPages((prev) => [...prev, ...newPages])
        setPasswordQueue((prev) => prev.slice(1))
        setPasswordWrong(false)
      } catch (err) {
        if (err instanceof PdfPasswordRequiredError && err.wrongPassword) {
          setPasswordWrong(true)
        } else {
          pushIssue(`${file.name}: could not be imported.`)
          setPasswordQueue((prev) => prev.slice(1))
          setPasswordWrong(false)
        }
      } finally {
        setPasswordChecking(false)
      }
    },
    [passwordQueue, passwordChecking, pushIssue],
  )

  const handleSkipPasswordFile = useCallback(() => {
    setPasswordQueue((prev) => prev.slice(1))
    setPasswordWrong(false)
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
      if (e.key === '?') {
        e.preventDefault()
        setShortcutsOpen((prev) => !prev)
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
        <div className="mx-auto flex max-w-[1800px] items-center gap-3 px-4 py-3 sm:px-6">
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
                onClick={() => setFillFormModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                <IconClipboardList className="size-4" />
                Fill Form
              </button>
            )}
            {pages.length > 0 && (
              <button
                type="button"
                onClick={() => setCompressModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                <IconMinimize className="size-4" />
                Compress
              </button>
            )}
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
            <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-2 px-4 py-2 sm:px-6">
              {selectedIds.size > 0 ? (
                <>
                  <p className="text-sm font-medium text-slate-700">{selectedIds.size} selected</p>
                  <div className="ml-auto flex flex-wrap items-center gap-0.5">
                    <button type="button" onClick={handleBulkDuplicate} className={toolbarButtonClass}>
                      <IconCopy className="size-3.5" />
                      Duplicate
                    </button>
                    <button
                      type="button"
                      onClick={() => handleBulkRotate(-1)}
                      aria-label="Rotate selected pages counter-clockwise"
                      title="Rotate counter-clockwise"
                      className={toolbarButtonClass}
                    >
                      <IconRotateCcw className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleBulkRotate(1)}
                      aria-label="Rotate selected pages clockwise"
                      title="Rotate clockwise"
                      className={toolbarButtonClass}
                    >
                      <IconRotate className="size-3.5" />
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
                      onClick={() => void handleExtractSelected()}
                      disabled={isExtracting}
                      className={toolbarButtonClass}
                    >
                      {isExtracting ? <IconSpinner className="size-3.5" /> : <IconFileOutput className="size-3.5" />}
                      Extract as PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleExtractText()}
                      disabled={isExtractingText}
                      className={toolbarButtonClass}
                    >
                      {isExtractingText ? <IconSpinner className="size-3.5" /> : <IconFileTxt className="size-3.5" />}
                      Extract text
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
                    <label className="hidden items-center gap-1.5 text-sm text-slate-500 md:flex">
                      <input
                        type="text"
                        value={rangeInput}
                        onChange={(e) => setRangeInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSelectRange()
                        }}
                        placeholder="e.g. 1-3,5"
                        className="w-24 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                      />
                      <button type="button" onClick={handleSelectRange} className={toolbarButtonClass}>
                        Select range
                      </button>
                    </label>
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

      <main className="mx-auto max-w-[1800px] px-4 py-10 sm:px-6">
        <ImportIssues issues={issues} onDismiss={dismissIssue} onDismissAll={dismissAllIssues} />

        {pages.length === 0 ? (
          <EmptyState onFiles={handleFiles} disabled={isImporting} />
        ) : (
          <PageGrid
            pages={pages}
            selectedIds={selectedIds}
            onReorder={handleReorder}
            onRotate={handleRotate}
            onRemove={handleRemove}
            onDuplicate={handleDuplicate}
            onToggleSelect={handleToggleSelect}
            onPreview={(page) => setLightboxPageId(page.id)}
          />
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

      <footer className="flex items-center justify-center gap-3 pb-10 pt-4 text-center text-xs text-slate-400">
        <span>Everything runs locally in your browser — your files are never uploaded anywhere.</span>
        <button
          type="button"
          onClick={() => setShortcutsOpen(true)}
          className="inline-flex items-center gap-1 text-slate-400 underline decoration-dotted underline-offset-2 hover:text-slate-600"
        >
          <IconHelpCircle className="size-3.5" />
          Keyboard shortcuts
        </button>
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

      {compressModalOpen && (
        <CompressModal
          pages={pages}
          sources={sources}
          selectedIds={selectedIds}
          onClose={() => setCompressModalOpen(false)}
          onError={pushIssue}
        />
      )}

      {fillFormModalOpen && (
        <FillFormModal
          pages={pages}
          sources={sources}
          onClose={() => setFillFormModalOpen(false)}
          onApply={handleApplyFormFill}
          onError={pushIssue}
        />
      )}

      {shortcutsOpen && <ShortcutsHelp onClose={() => setShortcutsOpen(false)} />}

      {lightboxPageId && (
        <PageLightbox
          pages={pages}
          pageId={lightboxPageId}
          onClose={() => setLightboxPageId(null)}
          onNavigate={setLightboxPageId}
          onRotate={handleRotate}
          onRemove={handleRemove}
          onSaveAsImage={handleSaveAsImage}
          onEditText={handleEditTextFromLightbox}
          onCrop={handleCropFromLightbox}
        />
      )}

      {textEditPageId &&
        (() => {
          const editPage = pages.find((p) => p.id === textEditPageId)
          if (!editPage) return null
          return (
            <TextEditModal
              page={editPage}
              sources={sources}
              onClose={handleCloseTextEditor}
              onApply={handleApplyTextEdits}
              onError={pushIssue}
            />
          )
        })()}

      {cropPageId &&
        (() => {
          const cropPage = pages.find((p) => p.id === cropPageId)
          if (!cropPage) return null
          return (
            <CropModal
              page={cropPage}
              sources={sources}
              onClose={handleCloseCropModal}
              onApply={handleApplyCrop}
              onError={pushIssue}
            />
          )
        })()}

      {passwordQueue.length > 0 && (
        <PasswordPromptModal
          fileName={passwordQueue[0].name}
          wrongPassword={passwordWrong}
          isChecking={passwordChecking}
          remaining={passwordQueue.length - 1}
          onSubmit={(password) => void handleUnlockSubmit(password)}
          onSkip={handleSkipPasswordFile}
        />
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
