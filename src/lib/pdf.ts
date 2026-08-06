import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist'
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import { PDFDocument, degrees } from 'pdf-lib'
import type { PageItem, SourceDoc } from '../types'

GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl

const THUMBNAIL_WIDTH = 260

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export class PdfLoadError extends Error {
  fileName: string

  constructor(fileName: string, message: string) {
    super(message)
    this.name = 'PdfLoadError'
    this.fileName = fileName
  }
}

export interface LoadedPdf {
  source: SourceDoc
  pages: PageItem[]
}

/** Reads a File, renders a thumbnail for every page, and keeps a pristine byte
 * copy for later merging. The copy passed to pdf.js is a separate slice so the
 * original bytes are never at risk of being transferred/detached by the worker. */
export async function loadPdfFile(file: File): Promise<LoadedPdf> {
  const pristineBytes = await file.arrayBuffer()

  let pdf: PDFDocumentProxy
  try {
    pdf = await getDocument({ data: pristineBytes.slice(0) }).promise
  } catch (err) {
    const message =
      err instanceof Error && err.name === 'PasswordException'
        ? 'This PDF is password-protected and cannot be imported.'
        : 'This file could not be read as a PDF.'
    throw new PdfLoadError(file.name, message)
  }

  if (pdf.numPages === 0) {
    await pdf.loadingTask.destroy()
    throw new PdfLoadError(file.name, 'This PDF has no pages.')
  }

  const sourceId = uid()
  const pages: PageItem[] = []
  const dpr = Math.min(window.devicePixelRatio || 1, 2)

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const unscaledViewport = page.getViewport({ scale: 1 })
    const scale = (THUMBNAIL_WIDTH / unscaledViewport.width) * dpr
    const viewport = page.getViewport({ scale })

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.ceil(viewport.width))
    canvas.height = Math.max(1, Math.ceil(viewport.height))
    const canvasContext = canvas.getContext('2d')
    if (!canvasContext) throw new PdfLoadError(file.name, 'Canvas rendering is not supported in this browser.')

    await page.render({ canvasContext, viewport }).promise
    const thumbnailUrl = canvas.toDataURL('image/jpeg', 0.82)
    page.cleanup()

    pages.push({
      id: uid(),
      sourceId,
      sourceName: file.name,
      pageIndex: i - 1,
      pageNumber: i,
      rotation: 0,
      thumbnailUrl,
      width: unscaledViewport.width,
      height: unscaledViewport.height,
    })
  }

  await pdf.loadingTask.destroy()

  return {
    source: { id: sourceId, name: file.name, bytes: pristineBytes },
    pages,
  }
}

/** Builds one merged PDF document from the given pages, in the order given,
 * applying each page's accumulated rotation. Copies full page objects (not
 * flattened content), so links, form fields, and annotations survive. */
export async function buildMergedDoc(pages: PageItem[], sources: Map<string, SourceDoc>): Promise<PDFDocument> {
  const mergedPdf = await PDFDocument.create()
  const docCache = new Map<string, PDFDocument>()

  for (const pageItem of pages) {
    let doc = docCache.get(pageItem.sourceId)
    if (!doc) {
      const source = sources.get(pageItem.sourceId)
      if (!source) continue
      doc = await PDFDocument.load(source.bytes, { ignoreEncryption: true })
      docCache.set(pageItem.sourceId, doc)
    }

    const [copiedPage] = await mergedPdf.copyPages(doc, [pageItem.pageIndex])
    if (pageItem.rotation % 360 !== 0) {
      const currentAngle = copiedPage.getRotation().angle
      copiedPage.setRotation(degrees(currentAngle + pageItem.rotation))
    }
    mergedPdf.addPage(copiedPage)
  }

  return mergedPdf
}

export async function mergePages(pages: PageItem[], sources: Map<string, SourceDoc>): Promise<Uint8Array> {
  const mergedPdf = await buildMergedDoc(pages, sources)
  return mergedPdf.save()
}

export function ensurePdfExtension(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0) return 'merged.pdf'
  return /\.pdf$/i.test(trimmed) ? trimmed : `${trimmed}.pdf`
}

export function downloadBytes(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
