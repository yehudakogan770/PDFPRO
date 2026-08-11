import { GlobalWorkerOptions, PasswordResponses, getDocument, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist'
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import { PDFDocument, PageSizes, degrees } from 'pdf-lib'
import type { PageItem, SourceDoc } from '../types'

GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl

const THUMBNAIL_WIDTH = 520

/** The longest edge a page is rendered to when exported as a standalone
 * image, in pixels -- comfortably print-quality without being excessive. */
const EXPORT_IMAGE_LONG_EDGE = 2000

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/** Renders a pdf.js page to a thumbnail data URL at THUMBNAIL_WIDTH, honoring
 * the page's own rotation (pdf.js defaults to it when none is given). Also
 * returns the page's visual (rotation-applied) point dimensions. */
export async function renderPageThumbnail(page: PDFPageProxy, dpr: number): Promise<{ url: string; width: number; height: number }> {
  const unscaledViewport = page.getViewport({ scale: 1 })
  const scale = (THUMBNAIL_WIDTH / unscaledViewport.width) * dpr
  const viewport = page.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(viewport.width))
  canvas.height = Math.max(1, Math.ceil(viewport.height))
  const canvasContext = canvas.getContext('2d')
  if (!canvasContext) throw new Error('Canvas rendering is not supported in this browser.')

  await page.render({ canvasContext, viewport }).promise
  const url = canvas.toDataURL('image/jpeg', 0.82)
  page.cleanup()
  return { url, width: unscaledViewport.width, height: unscaledViewport.height }
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

/** Thrown when a PDF needs a password to open. `wrongPassword` is true when a
 * password was already tried and rejected (vs. never having been asked yet). */
export class PdfPasswordRequiredError extends Error {
  file: File
  wrongPassword: boolean

  constructor(file: File, wrongPassword: boolean) {
    super(wrongPassword ? 'Incorrect password.' : 'This PDF is password-protected.')
    this.name = 'PdfPasswordRequiredError'
    this.file = file
    this.wrongPassword = wrongPassword
  }
}

export interface LoadedPdf {
  source: SourceDoc
  pages: PageItem[]
}

/** Reads a File, renders a thumbnail for every page, and keeps a pristine byte
 * copy for later merging. The copy passed to pdf.js is a separate slice so the
 * original bytes are never at risk of being transferred/detached by the worker.
 * If the PDF is password-protected and no (or the wrong) password is given,
 * throws PdfPasswordRequiredError so the caller can prompt and retry. */
export async function loadPdfFile(file: File, password?: string): Promise<LoadedPdf> {
  const pristineBytes = await file.arrayBuffer()

  let pdf: PDFDocumentProxy
  try {
    pdf = await getDocument({ data: pristineBytes.slice(0), password }).promise
  } catch (err) {
    if (err instanceof Error && err.name === 'PasswordException') {
      const code = (err as Error & { code?: number }).code
      throw new PdfPasswordRequiredError(file, code === PasswordResponses.INCORRECT_PASSWORD)
    }
    throw new PdfLoadError(file.name, 'This file could not be read as a PDF.')
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
    let rendered: { url: string; width: number; height: number }
    try {
      rendered = await renderPageThumbnail(page, dpr)
    } catch (err) {
      console.error(err)
      throw new PdfLoadError(file.name, 'Canvas rendering is not supported in this browser.')
    }

    pages.push({
      id: uid(),
      sourceId,
      sourceName: file.name,
      pageIndex: i - 1,
      pageNumber: i,
      rotation: 0,
      thumbnailUrl: rendered.url,
      width: rendered.width,
      height: rendered.height,
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

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function downloadBytes(bytes: Uint8Array, filename: string): void {
  downloadBlob(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), filename)
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

/** Renders one page to a PNG blob at print-quality resolution, honoring both
 * the page's own baked-in rotation and any rotation applied in the editor. */
export async function exportPageAsImage(pageItem: PageItem, sources: Map<string, SourceDoc>): Promise<Blob> {
  const source = sources.get(pageItem.sourceId)
  if (!source) throw new Error('Missing source document')

  const pdf = await getDocument({ data: source.bytes.slice(0) }).promise
  try {
    const page = await pdf.getPage(pageItem.pageIndex + 1)
    const totalRotation = ((page.rotate + pageItem.rotation) % 360 + 360) % 360
    const unscaledViewport = page.getViewport({ scale: 1, rotation: totalRotation })
    const scale = EXPORT_IMAGE_LONG_EDGE / Math.max(unscaledViewport.width, unscaledViewport.height)
    const viewport = page.getViewport({ scale, rotation: totalRotation })

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.ceil(viewport.width))
    canvas.height = Math.max(1, Math.ceil(viewport.height))
    const canvasContext = canvas.getContext('2d')
    if (!canvasContext) throw new Error('Canvas rendering is not supported in this browser.')

    await page.render({ canvasContext, viewport }).promise
    page.cleanup()

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('Failed to export this page as an image.')
    return blob
  } finally {
    await pdf.loadingTask.destroy()
  }
}

/** Exports each given page as its own PNG, staggered so browsers don't
 * throttle a burst of same-gesture downloads. */
export async function downloadPagesAsImages(pages: PageItem[], sources: Map<string, SourceDoc>, baseName: string): Promise<void> {
  for (let i = 0; i < pages.length; i++) {
    const blob = await exportPageAsImage(pages[i], sources)
    const label = pages.length === 1 ? '' : `-${String(i + 1).padStart(2, '0')}`
    downloadBlob(blob, `${baseName}${label}.png`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

export function downloadText(text: string, filename: string): void {
  downloadBlob(new Blob([text], { type: 'text/plain' }), filename)
}

/** Best-effort plain-text extraction (pdf.js's text layer, not OCR -- pages
 * that are scanned images with no text layer will extract as empty). */
export async function extractPagesText(pages: PageItem[], sources: Map<string, SourceDoc>): Promise<string> {
  const pdfCache = new Map<string, PDFDocumentProxy>()
  const sections: string[] = []

  try {
    for (let i = 0; i < pages.length; i++) {
      const pageItem = pages[i]
      const source = sources.get(pageItem.sourceId)
      if (!source) continue

      let pdf = pdfCache.get(pageItem.sourceId)
      if (!pdf) {
        pdf = await getDocument({ data: source.bytes.slice(0) }).promise
        pdfCache.set(pageItem.sourceId, pdf)
      }

      const page = await pdf.getPage(pageItem.pageIndex + 1)
      const content = await page.getTextContent()
      let text = ''
      for (const item of content.items) {
        if (!('str' in item)) continue
        text += item.str + (item.hasEOL ? '\n' : ' ')
      }
      page.cleanup()

      sections.push(`--- Page ${i + 1} (${pageItem.sourceName} p${pageItem.pageNumber}) ---\n${text.trim()}`)
    }
  } finally {
    for (const pdf of pdfCache.values()) await pdf.loadingTask.destroy()
  }

  return sections.join('\n\n')
}
