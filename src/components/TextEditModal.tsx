import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, MouseEvent as ReactMouseEvent } from 'react'
import { getDocument } from 'pdfjs-dist'
import type { PageItem, SourceDoc } from '../types'
import { applyPageEdits, detectTextRuns, rawPointToScreen, screenPointToRaw } from '../lib/textEdit'
import type { DetectedTextRun, ImageEdit, PageEdit, TextEdit } from '../lib/textEdit'
import type { LoadedPdf } from '../lib/pdf'
import { uid } from '../lib/pdf'
import { IconImage, IconMinus, IconPlus, IconSpinner, IconTrash } from './Icons'

interface TextEditModalProps {
  page: PageItem
  sources: Map<string, SourceDoc>
  onClose: () => void
  onApply: (pageId: string, loaded: LoadedPdf) => Promise<void>
  onError: (message: string) => void
}

interface PendingImage {
  bytes: ArrayBuffer
  format: 'png' | 'jpg'
  previewUrl: string
  aspectRatio: number
}

const EDITOR_LONG_EDGE = 1400
const NEW_TEXT_FONT_SIZE = 14
const DEFAULT_IMAGE_WIDTH = 150

const COLOR_SWATCHES: { label: string; value: { r: number; g: number; b: number } }[] = [
  { label: 'Black', value: { r: 0, g: 0, b: 0 } },
  { label: 'Red', value: { r: 0.82, g: 0.11, b: 0.11 } },
  { label: 'Blue', value: { r: 0.11, g: 0.31, b: 0.85 } },
  { label: 'Green', value: { r: 0.06, g: 0.5, b: 0.24 } },
]

async function loadImageForPlacement(file: File): Promise<PendingImage> {
  const bytes = await file.arrayBuffer()
  const format: 'png' | 'jpg' = file.type === 'image/png' || /\.png$/i.test(file.name) ? 'png' : 'jpg'
  const previewUrl = URL.createObjectURL(new Blob([bytes], { type: file.type }))
  const dims = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('Could not read this image.'))
    img.src = previewUrl
  })
  return { bytes, format, previewUrl, aspectRatio: dims.width / dims.height }
}

export function TextEditModal({ page, sources, onClose, onApply, onError }: TextEditModalProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [canvasUrl, setCanvasUrl] = useState<string | null>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [runs, setRuns] = useState<DetectedTextRun[]>([])
  const [edits, setEdits] = useState<Map<string, PageEdit>>(new Map())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [addMode, setAddMode] = useState<'text' | 'image' | null>(null)
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null)
  const [displayScale, setDisplayScale] = useState(1)

  const [viewportTransform, setViewportTransform] = useState<number[] | null>(null)
  const [pxPerPoint, setPxPerPoint] = useState(1)
  const imgRef = useRef<HTMLImageElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

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
      } catch (err) {
        console.error(err)
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
        kind: 'text',
        mode: 'replace',
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

  const updateActiveTextEdit = (patch: Partial<Pick<TextEdit, 'text' | 'fontSize' | 'color'>>) => {
    if (!activeId) return
    setEdits((prev) => {
      const existing = prev.get(activeId)
      if (!existing || existing.kind !== 'text') return prev
      const next = new Map(prev)
      next.set(activeId, { ...existing, ...patch })
      return next
    })
  }

  const updateActiveImageEdit = (patch: Partial<Pick<ImageEdit, 'width' | 'height'>>) => {
    if (!activeId) return
    setEdits((prev) => {
      const existing = prev.get(activeId)
      if (!existing || existing.kind !== 'image') return prev
      const next = new Map(prev)
      next.set(activeId, { ...existing, ...patch })
      return next
    })
  }

  const deleteActiveEdit = () => {
    if (!activeId) return
    const edit = edits.get(activeId)
    const shouldRemove = edit?.kind === 'image' || (edit?.kind === 'text' && edit.mode === 'add')
    if (shouldRemove) {
      setEdits((prev) => {
        const next = new Map(prev)
        next.delete(activeId)
        return next
      })
    } else {
      updateActiveTextEdit({ text: '' })
    }
    setActiveId(null)
  }

  const handleImageFileChosen = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const loaded = await loadImageForPlacement(file)
      setPendingImage(loaded)
      setAddMode('image')
      setActiveId(null)
    } catch (err) {
      console.error(err)
      onError('Could not read that image file.')
    }
  }

  const handleCanvasClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!addMode || !viewportTransform || !imgRef.current) return
    const bounds = imgRef.current.getBoundingClientRect()
    const canvasX = (e.clientX - bounds.left) / displayScale
    const canvasY = (e.clientY - bounds.top) / displayScale
    const raw = screenPointToRaw(viewportTransform, canvasX, canvasY)

    if (addMode === 'text') {
      const id = uid()
      const newEdit: TextEdit = {
        id,
        kind: 'text',
        mode: 'add',
        x: raw.x,
        y: raw.y - NEW_TEXT_FONT_SIZE * 0.8,
        text: '',
        fontSize: NEW_TEXT_FONT_SIZE,
        color: COLOR_SWATCHES[0].value,
      }
      setEdits((prev) => new Map(prev).set(id, newEdit))
      setActiveId(id)
      setAddMode(null)
      return
    }

    if (addMode === 'image' && pendingImage) {
      const id = uid()
      const width = DEFAULT_IMAGE_WIDTH
      const height = width / pendingImage.aspectRatio
      const newEdit: ImageEdit = {
        id,
        kind: 'image',
        x: raw.x,
        y: raw.y - height,
        width,
        height,
        aspectRatio: pendingImage.aspectRatio,
        format: pendingImage.format,
        bytes: pendingImage.bytes,
        previewUrl: pendingImage.previewUrl,
      }
      setEdits((prev) => new Map(prev).set(id, newEdit))
      setActiveId(id)
      setAddMode(null)
      setPendingImage(null)
    }
  }

  const handleSave = async () => {
    if (isSaving) return
    setIsSaving(true)
    try {
      const activeEdits = [...edits.values()].filter((edit) =>
        edit.kind === 'image' ? true : edit.mode === 'add' ? edit.text.trim().length > 0 : true,
      )
      const result = await applyPageEdits(page, sources, activeEdits)
      await onApply(page.id, result)
      onClose()
    } catch (err) {
      console.error(err)
      onError('Something went wrong while saving your edits. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  const hasChanges = [...edits.values()].some((edit) =>
    edit.kind === 'image' ? true : edit.mode === 'add' ? edit.text.trim().length > 0 : true,
  )
  const activeEdit = activeId ? (edits.get(activeId) ?? null) : null
  const addTextEdits = [...edits.values()].filter((edit): edit is TextEdit => edit.kind === 'text' && edit.mode === 'add')
  const imageEdits = [...edits.values()].filter((edit): edit is ImageEdit => edit.kind === 'image')

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900/90 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Edit page">
      <input ref={imageInputRef} type="file" accept="image/png,image/jpeg" onChange={(e) => void handleImageFileChosen(e)} className="hidden" />

      <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3 text-white sm:px-6">
        <p className="text-sm font-semibold">Edit page</p>
        <p className="hidden text-xs text-white/60 sm:block">
          {runs.length === 0 && !isLoading
            ? 'No editable text was detected on this page (it may be a scanned image) — you can still add text or an image.'
            : 'Click any text to edit it, or add new text/an image anywhere. Edited text is covered and redrawn, not securely removed from the file.'}
        </p>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setAddMode((prev) => (prev === 'text' ? null : 'text'))
              setPendingImage(null)
              setActiveId(null)
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              addMode === 'text' ? 'bg-indigo-500 text-white' : 'bg-white/10 text-white hover:bg-white/20'
            }`}
          >
            <IconPlus className="size-4" />
            Add text
          </button>
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              addMode === 'image' ? 'bg-indigo-500 text-white' : 'bg-white/10 text-white hover:bg-white/20'
            }`}
          >
            <IconImage className="size-4" />
            Add image
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

      {addMode === 'image' && pendingImage && (
        <div className="border-b border-white/10 bg-indigo-500/20 px-4 py-2 text-center text-xs text-white sm:px-6">
          Click anywhere on the page to place your image.
        </div>
      )}

      {activeEdit && (
        <div className="flex flex-wrap items-center gap-3 border-b border-white/10 bg-slate-800/80 px-4 py-2 text-white sm:px-6">
          <span className="text-xs text-white/60">{activeEdit.kind === 'image' ? 'Selected image' : 'Selected text'}</span>

          {activeEdit.kind === 'text' ? (
            <>
              <label className="flex items-center gap-1.5 text-xs">
                Size
                <button
                  type="button"
                  onClick={() => updateActiveTextEdit({ fontSize: Math.max(4, activeEdit.fontSize - 1) })}
                  className="rounded bg-white/10 p-1 hover:bg-white/20"
                >
                  <IconMinus className="size-3" />
                </button>
                <span className="w-6 text-center tabular-nums">{Math.round(activeEdit.fontSize)}</span>
                <button
                  type="button"
                  onClick={() => updateActiveTextEdit({ fontSize: Math.min(200, activeEdit.fontSize + 1) })}
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
                    onClick={() => updateActiveTextEdit({ color: swatch.value })}
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
            </>
          ) : (
            <label className="flex items-center gap-1.5 text-xs">
              Size
              <button
                type="button"
                onClick={() => {
                  const width = Math.max(20, activeEdit.width * 0.9)
                  updateActiveImageEdit({ width, height: width / activeEdit.aspectRatio })
                }}
                className="rounded bg-white/10 p-1 hover:bg-white/20"
              >
                <IconMinus className="size-3" />
              </button>
              <button
                type="button"
                onClick={() => {
                  const width = Math.min(2000, activeEdit.width * 1.1)
                  updateActiveImageEdit({ width, height: width / activeEdit.aspectRatio })
                }}
                className="rounded bg-white/10 p-1 hover:bg-white/20"
              >
                <IconPlus className="size-3" />
              </button>
            </label>
          )}

          <button
            type="button"
            onClick={deleteActiveEdit}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-red-500/20 px-2.5 py-1 text-xs font-medium text-red-200 hover:bg-red-500/30"
          >
            <IconTrash className="size-3.5" />
            {activeEdit.kind === 'image' || activeEdit.mode === 'add' ? 'Delete' : 'Clear text'}
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
                const textEdit = edit?.kind === 'text' ? edit : undefined
                const isActive = activeId === run.id
                const isEdited = !!textEdit && textEdit.text !== run.str
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
                    {isActive && textEdit && (
                      <input
                        autoFocus
                        value={textEdit.text}
                        onChange={(e) => updateActiveTextEdit({ text: e.target.value })}
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
                        onChange={(e) => updateActiveTextEdit({ text: e.target.value })}
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

              {imageEdits.map((edit) => {
                const isActive = activeId === edit.id
                const topLeft = viewportTransform ? rawPointToScreen(viewportTransform, edit.x, edit.y + edit.height) : { x: 0, y: 0 }
                return (
                  <div
                    key={edit.id}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation()
                      setActiveId(edit.id)
                    }}
                    className={`absolute cursor-move border-2 ${isActive ? 'z-20 border-indigo-500' : 'border-dashed border-indigo-400'}`}
                    style={{
                      left: topLeft.x * displayScale,
                      top: topLeft.y * displayScale,
                      width: edit.width * pxPerPoint * displayScale,
                      height: edit.height * pxPerPoint * displayScale,
                    }}
                  >
                    <img src={edit.previewUrl} alt="" className="h-full w-full select-none object-fill" draggable={false} />
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
