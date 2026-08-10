import { useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { getDocument } from 'pdfjs-dist'
import type { PageItem, SourceDoc } from '../types'
import { applyTextEdits, detectTextRuns, rawPointToScreen, screenPointToRaw } from '../lib/textEdit'
import type { DetectedTextRun, TextEdit } from '../lib/textEdit'
import type { LoadedPdf } from '../lib/pdf'
import { uid } from '../lib/pdf'
import { IconMinus, IconPlus, IconSpinner, IconTrash } from './Icons'

interface TextEditModalProps {
  page: PageItem
  sources: Map<string, SourceDoc>
  onClose: () => void
  onApply: (pageId: string, loaded: LoadedPdf) => Promise<void>
  onError: (message: string) => void
}

const EDITOR_LONG_EDGE = 1400
const NEW_TEXT_FONT_SIZE = 14

const COLOR_SWATCHES: { label: string; value: { r: number; g: number; b: number } }[] = [
  { label: 'Black', value: { r: 0, g: 0, b: 0 } },
  { label: 'Red', value: { r: 0.82, g: 0.11, b: 0.11 } },
  { label: 'Blue', value: { r: 0.11, g: 0.31, b: 0.85 } },
  { label: 'Green', value: { r: 0.06, g: 0.5, b: 0.24 } },
]

export function TextEditModal({ page, sources, onClose, onApply, onError }: TextEditModalProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [canvasUrl, setCanvasUrl] = useState<string | null>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [runs, setRuns] = useState<DetectedTextRun[]>([])
  const [edits, setEdits] = useState<Map<string, TextEdit>>(new Map())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [addMode, setAddMode] = useState(false)
  const [displayScale, setDisplayScale] = useState(1)

  const [viewportTransform, setViewportTransform] = useState<number[] | null>(null)
  const [pxPerPoint, setPxPerPoint] = useState(1)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const source = sources.get(page.sourceId)
      if (!source) {
        onError('Missing source document.')
        onClose()
        return
      }
      try {
        const pdf = await getDocument({ data: source.bytes.slice(0) }).promise
        const pdfPage = await pdf.getPage(page.pageIndex + 1)
        const totalRotation = ((pdfPage.rotate + page.rotation) % 360 + 360) % 360
        const unscaled = pdfPage.getViewport({ scale: 1, rotation: totalRotation })
        const scale = EDITOR_LONG_EDGE / Math.max(unscaled.width, unscaled.height)
        const viewport = pdfPage.getViewport({ scale, rotation: totalRotation })

        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.ceil(viewport.width))
        canvas.height = Math.max(1, Math.ceil(viewport.height))
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Canvas rendering is not supported in this browser.')
        await pdfPage.render({ canvasContext: ctx, viewport }).promise

        const detected = await detectTextRuns(pdfPage, viewport.transform)
        pdfPage.cleanup()
        await pdf.loadingTask.destroy()
        if (cancelled) return

        setViewportTransform(viewport.transform)
        setPxPerPoint(scale)
        setCanvasUrl(canvas.toDataURL('image/png'))
        setCanvasSize({ width: viewport.width, height: viewport.height })
        setRuns(detected)
      } catch {
        if (!cancelled) {
          onError('Something went wrong while opening this page for editing.')
          onClose()
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !activeId) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, activeId])

  const updateScale = () => {
    if (imgRef.current && canvasSize.width > 0) {
      setDisplayScale(imgRef.current.clientWidth / canvasSize.width)
    }
  }

  useEffect(() => {
    window.addEventListener('resize', updateScale)
    return () => window.removeEventListener('resize', updateScale)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasSize])

  const startEditingRun = (run: DetectedTextRun) => {
    if (addMode) return
    setEdits((prev) => {
      if (prev.has(run.id)) return prev
      const next = new Map(prev)
      next.set(run.id, {
        id: run.id,
        kind: 'replace',
        x: run.baseline.x,
        y: run.baseline.y,
        text: run.str,
        fontSize: run.fontSize,
        color: COLOR_SWATCHES[0].value,
        whiteoutRect: run.rawRect,
      })
      return next
    })
    setActiveId(run.id)
  }

  const updateActiveEdit = (patch: Partial<TextEdit>) => {
    if (!activeId) return
    setEdits((prev) => {
      const existing = prev.get(activeId)
      if (!existing) return prev
      const next = new Map(prev)
      next.set(activeId, { ...existing, ...patch })
      return next
    })
  }

  const deleteActiveEdit = () => {
    if (!activeId) return
    const edit = edits.get(activeId)
    if (edit?.kind === 'add') {
      setEdits((prev) => {
        const next = new Map(prev)
        next.delete(activeId)
        return next
      })
    } else {
      updateActiveEdit({ text: '' })
    }
    setActiveId(null)
  }

  const handleCanvasClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!addMode || !viewportTransform || !imgRef.current) return
    const bounds = imgRef.current.getBoundingClientRect()
    const canvasX = (e.clientX - bounds.left) / displayScale
    const canvasY = (e.clientY - bounds.top) / displayScale
    const raw = screenPointToRaw(viewportTransform, canvasX, canvasY)
    const id = uid()
    const newEdit: TextEdit = {
      id,
      kind: 'add',
      x: raw.x,
      y: raw.y - NEW_TEXT_FONT_SIZE * 0.8,
      text: '',
      fontSize: NEW_TEXT_FONT_SIZE,
      color: COLOR_SWATCHES[0].value,
    }
    setEdits((prev) => new Map(prev).set(id, newEdit))
    setActiveId(id)
    setAddMode(false)
  }

  const handleSave = async () => {
    if (isSaving) return
    setIsSaving(true)
    try {
      const activeEdits = [...edits.values()].filter((edit) => edit.kind === 'add' ? edit.text.trim().length > 0 : true)
      const result = await applyTextEdits(page, sources, activeEdits)
      await onApply(page.id, result)
      onClose()
    } catch {
      onError('Something went wrong while saving your text edits. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  const hasChanges = [...edits.values()].some((edit) => (edit.kind === 'add' ? edit.text.trim().length > 0 : true))
  const activeEdit = activeId ? edits.get(activeId) : null
  const addTextEdits = [...edits.values()].filter((edit) => edit.kind === 'add')

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900/90 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Edit text">
      <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3 text-white sm:px-6">
        <p className="text-sm font-semibold">Edit text</p>
        <p className="hidden text-xs text-white/60 sm:block">
          {runs.length === 0 && !isLoading
            ? 'No editable text was detected on this page (it may be a scanned image) — you can still add new text.'
            : 'Click any text to edit it, or add new text anywhere. Edited text is covered and redrawn, not securely removed from the file.'}
        </p>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setAddMode((prev) => !prev)
              setActiveId(null)
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              addMode ? 'bg-indigo-500 text-white' : 'bg-white/10 text-white hover:bg-white/20'
            }`}
          >
            <IconPlus className="size-4" />
            Add text
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3.5 py-1.5 text-sm font-medium text-white/80 hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving || !hasChanges}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-500"
          >
            {isSaving ? <IconSpinner className="size-4" /> : null}
            {isSaving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      {activeEdit && (
        <div className="flex flex-wrap items-center gap-3 border-b border-white/10 bg-slate-800/80 px-4 py-2 text-white sm:px-6">
          <span className="text-xs text-white/60">Selected text</span>
          <label className="flex items-center gap-1.5 text-xs">
            Size
            <button
              type="button"
              onClick={() => updateActiveEdit({ fontSize: Math.max(4, activeEdit.fontSize - 1) })}
              className="rounded bg-white/10 p-1 hover:bg-white/20"
            >
              <IconMinus className="size-3" />
            </button>
            <span className="w-6 text-center tabular-nums">{Math.round(activeEdit.fontSize)}</span>
            <button
              type="button"
              onClick={() => updateActiveEdit({ fontSize: Math.min(200, activeEdit.fontSize + 1) })}
              className="rounded bg-white/10 p-1 hover:bg-white/20"
            >
              <IconPlus className="size-3" />
            </button>
          </label>
          <div className="flex items-center gap-1.5">
            {COLOR_SWATCHES.map((swatch) => (
              <button
                key={swatch.label}
                type="button"
                onClick={() => updateActiveEdit({ color: swatch.value })}
                aria-label={swatch.label}
                title={swatch.label}
                className={`size-5 rounded-full ring-2 ring-offset-1 ring-offset-slate-800 ${
                  activeEdit.color.r === swatch.value.r && activeEdit.color.g === swatch.value.g && activeEdit.color.b === swatch.value.b
                    ? 'ring-white'
                    : 'ring-transparent'
                }`}
                style={{ backgroundColor: `rgb(${swatch.value.r * 255}, ${swatch.value.g * 255}, ${swatch.value.b * 255})` }}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={deleteActiveEdit}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-red-500/20 px-2.5 py-1 text-xs font-medium text-red-200 hover:bg-red-500/30"
          >
            <IconTrash className="size-3.5" />
            {activeEdit.kind === 'add' ? 'Delete' : 'Clear text'}
          </button>
          <button
            type="button"
            onClick={() => setActiveId(null)}
            className="rounded-lg bg-white/10 px-2.5 py-1 text-xs font-medium hover:bg-white/20"
          >
            Done
          </button>
        </div>
      )}

      <div className="flex flex-1 items-center justify-center overflow-auto p-4 sm:p-8">
        {isLoading ? (
          <IconSpinner className="size-8 text-white/70" />
        ) : (
          canvasUrl && (
            <div
              className={`relative ${addMode ? 'cursor-crosshair' : ''}`}
              style={{ width: canvasSize.width * displayScale || undefined }}
              onClick={handleCanvasClick}
            >
              <img
                ref={imgRef}
                src={canvasUrl}
                alt="Page being edited"
                onLoad={updateScale}
                className="max-h-[calc(100vh-11rem)] w-full select-none rounded-lg shadow-2xl"
                draggable={false}
              />

              {runs.map((run) => {
                const edit = edits.get(run.id)
                const isActive = activeId === run.id
                const isEdited = !!edit && edit.text !== run.str
                return (
                  <div
                    key={run.id}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation()
                      startEditingRun(run)
                    }}
                    className={`absolute cursor-text rounded-sm border transition-colors ${
                      isActive
                        ? 'z-20 border-indigo-500 bg-white'
                        : isEdited
                          ? 'border-indigo-400 bg-indigo-100/70'
                          : 'border-transparent hover:border-indigo-300 hover:bg-indigo-50/40'
                    }`}
                    style={{
                      left: run.screenRect.x * displayScale,
                      top: run.screenRect.y * displayScale,
                      width: run.screenRect.width * displayScale,
                      height: run.screenRect.height * displayScale,
                    }}
                  >
                    {isActive && edit && (
                      <input
                        autoFocus
                        value={edit.text}
                        onChange={(e) => updateActiveEdit({ text: e.target.value })}
                        onFocus={(e) => e.currentTarget.select()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === 'Escape') {
                            e.preventDefault()
                            e.stopPropagation()
                            setActiveId(null)
                          }
                        }}
                        style={{ fontSize: Math.max(9, run.fontSize * pxPerPoint * displayScale) }}
                        className="h-full w-full border-0 bg-transparent px-0.5 text-slate-900 outline-none"
                      />
                    )}
                  </div>
                )
              })}

              {addTextEdits.map((edit) => {
                const isActive = activeId === edit.id
                const topLeft = viewportTransform
                  ? rawPointToScreen(viewportTransform, edit.x, edit.y + edit.fontSize * 0.8)
                  : { x: 0, y: 0 }
                const screenX = topLeft.x * displayScale
                const screenY = topLeft.y * displayScale
                const screenFontSize = edit.fontSize * pxPerPoint * displayScale
                return (
                  <div
                    key={edit.id}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation()
                      setActiveId(edit.id)
                    }}
                    className={`absolute min-w-[80px] cursor-text rounded-sm border ${
                      isActive ? 'z-20 border-indigo-500 bg-white' : 'border-dashed border-indigo-400 bg-white/90'
                    }`}
                    style={{ left: screenX, top: screenY, fontSize: Math.max(9, screenFontSize) }}
                  >
                    {isActive ? (
                      <textarea
                        autoFocus
                        rows={1}
                        value={edit.text}
                        onChange={(e) => updateActiveEdit({ text: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            e.preventDefault()
                            e.stopPropagation()
                            setActiveId(null)
                          }
                        }}
                        placeholder="Type…"
                        className="block min-w-[120px] resize border-0 bg-transparent px-1 leading-tight text-slate-900 outline-none"
                        style={{ fontSize: Math.max(9, screenFontSize), color: `rgb(${edit.color.r * 255}, ${edit.color.g * 255}, ${edit.color.b * 255})` }}
                      />
                    ) : (
                      <span
                        className="block whitespace-pre px-1 leading-tight"
                        style={{ color: `rgb(${edit.color.r * 255}, ${edit.color.g * 255}, ${edit.color.b * 255})` }}
                      >
                        {edit.text || ' '}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )
        )}
      </div>
    </div>
  )
}
