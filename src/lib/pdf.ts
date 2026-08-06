import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist'
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import { PDFDocument, PageSizes, degrees } from 'pdf-lib'
import type { PageItem, SourceDoc } from '../types'

GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl

const THUMBNAIL_WIDTH = 260

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

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

export function isImageFile(file: File): boolean {
  return file.type === 'image/jpeg' || file.type === 'image/png' || /\.(jpe?g|png)$/i.test(file.name)
}

function renderBlankThumbnail(pageWidth: number, pageHeight: number): string {
  const scale = THUMBNAIL_WIDTH / pageWidth
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(pageWidth * scale))
  canvas.height = Math.max(1, Math.round(pageHeight * scale))
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = '#e2e8f0'
    ctx.lineWidth = 2
    ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2)
  }
  return canvas.toDataURL('image/png')
}

async function renderImageThumbnail(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = THUMBNAIL_WIDTH / bitmap.width
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas rendering is not supported in this browser.')
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.85)
  } finally {
    bitmap.close()
  }
}

/** The longest edge a photo is scaled to when it becomes its own page, in
 * points (10in at 72pt/in). Keeps imported photos a sensible, printable page
 * size no matter their pixel resolution, without guessing a source DPI. */
const IMAGE_PAGE_LONG_EDGE = 720

/** Wraps a JPG/PNG file as a single-page PDF "source" so it can flow through
 * the same page list, reorder, rotate, merge, and print pipeline as any
 * other imported PDF. */
export async function loadImageFile(file: File): Promise<LoadedPdf> {
  const bytes = await file.arrayBuffer()
  const isPng = file.type === 'image/png' || /\.png$/i.test(file.name)
  const doc = await PDFDocument.create()

  const image = await (isPng ? doc.embedPng(bytes) : doc.embedJpg(bytes)).catch(() => {
    throw new PdfLoadError(file.name, 'This image could not be read.')
  })

  const scale = IMAGE_PAGE_LONG_EDGE / Math.max(image.width, image.height)
  const pageWidth = image.width * scale
  const pageHeight = image.height * scale
  doc.addPage([pageWidth, pageHeight]).drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight })

  const pdfBytes = await doc.save()
  const thumbnailUrl = await renderImageThumbnail(file)
  const sourceId = uid()

  return {
    source: { id: sourceId, name: file.name, bytes: toArrayBuffer(pdfBytes) },
    pages: [
      {
        id: uid(),
        sourceId,
        sourceName: file.name,
        pageIndex: 0,
        pageNumber: 1,
        rotation: 0,
        thumbnailUrl,
        width: pageWidth,
        height: pageHeight,
      },
    ],
  }
}

/** Creates a single blank page "source", sized to match (width, height) --
 * pass the dimensions of an existing page to match it, or omit for A4. */
export async function createBlankPage(width = PageSizes.A4[0], height = PageSizes.A4[1]): Promise<LoadedPdf> {
  const doc = await PDFDocument.create()
  doc.addPage([width, height])
  const pdfBytes = await doc.save()
  const sourceId = uid()

  return {
    source: { id: sourceId, name: 'Blank page', bytes: toArrayBuffer(pdfBytes) },
    pages: [
      {
        id: uid(),
        sourceId,
        sourceName: 'Blank page',
        pageIndex: 0,
        pageNumber: 1,
        rotation: 0,
        thumbnailUrl: renderBlankThumbnail(width, height),
        width,
        height,
      },
    ],
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

/** Opens the browser's native print dialog for the given PDF bytes, via a
 * hidden iframe (no navigation, no popup blocker since it's same-tab). */
export function printBytes(bytes: Uint8Array): void {
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = 'none'
  iframe.src = url

  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    iframe.remove()
    URL.revokeObjectURL(url)
  }

  iframe.onload = () => {
    const win = iframe.contentWindow
    if (!win) {
      cleanup()
      return
    }
    win.focus()
    win.print()
    // Most browsers fire this once the print dialog is dismissed; a handful
    // never do, so also clean up on a generous fallback timer.
    win.onafterprint = cleanup
    setTimeout(cleanup, 5 * 60 * 1000)
  }

  document.body.appendChild(iframe)
}

export interface SplitChunk {
  pages: PageItem[]
  filename: string
}

/** Groups pages into fixed-size chunks (1 = one file per page), naming each
 * chunk after the page range it covers. */
export function chunkPages(pages: PageItem[], pagesPerFile: number, baseName: string): SplitChunk[] {
  const size = Math.max(1, Math.floor(pagesPerFile))
  const chunks: SplitChunk[] = []
  for (let i = 0; i < pages.length; i += size) {
    const chunk = pages.slice(i, i + size)
    const start = i + 1
    const end = Math.min(i + size, pages.length)
    const label = start === end ? `${start}` : `${start}-${end}`
    chunks.push({ pages: chunk, filename: `${baseName}-${label}.pdf` })
  }
  return chunks
}

/** Builds and downloads each chunk as its own PDF, staggered slightly so
 * browsers don't throttle a burst of same-gesture downloads. */
export async function downloadSplitChunks(
  pages: PageItem[],
  sources: Map<string, SourceDoc>,
  pagesPerFile: number,
  baseName: string,
): Promise<void> {
  const chunks = chunkPages(pages, pagesPerFile, baseName)
  for (const chunk of chunks) {
    const bytes = await mergePages(chunk.pages, sources)
    downloadBytes(bytes, ensurePdfExtension(chunk.filename))
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}
