import { getDocument, type PDFPageProxy } from 'pdfjs-dist'
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont } from 'pdf-lib'
import unicodeFontUrl from '@fontsource/noto-sans-hebrew/files/noto-sans-hebrew-hebrew-400-normal.woff?url'
import type { PageItem, SourceDoc } from '../types'
import { renderPageThumbnail, toArrayBuffer, uid } from './pdf'
import type { LoadedPdf } from './pdf'

function isEncodable(font: PDFFont, text: string): boolean {
  try {
    font.encodeText(text)
    return true
  } catch {
    return false
  }
}

/** Hebrew letters/points plus Hebrew presentation forms -- StandardFonts (WinAnsi)
 * can't encode any of these, so text containing them needs the embedded Unicode font. */
const NEEDS_UNICODE_FONT = /[֐-׿יִ-ﭏ]/

export interface TextRect {
  x: number
  y: number
  width: number
  height: number
}

export interface TextColor {
  r: number
  g: number
  b: number
}

export interface TextEdit {
  id: string
  kind: 'text'
  /** 'replace' covers the original run with white before drawing; 'add' draws straight onto the page. */
  mode: 'replace' | 'add'
  /** Baseline-left origin, in the page's raw (unrotated) PDF point space -- matches pdf-lib's drawText convention. */
  x: number
  y: number
  text: string
  fontSize: number
  color: TextColor
  /** Only set for 'replace' edits -- the area to whiteout before redrawing. */
  whiteoutRect?: TextRect
}

export interface ImageEdit {
  id: string
  kind: 'image'
  /** Bottom-left origin and size, in the page's raw (unrotated) PDF point space. */
  x: number
  y: number
  width: number
  height: number
  /** Natural aspect ratio (width / height) of the source image, for resize-preserving-shape. */
  aspectRatio: number
  format: 'png' | 'jpg'
  bytes: ArrayBuffer
  /** Only used by the editor for rendering the on-canvas preview. */
  previewUrl: string
}

export type PageEdit = TextEdit | ImageEdit

export interface DetectedTextRun {
  id: string
  str: string
  /** Raw (unrotated) PDF point space, matching pdf-lib's coordinate system. */
  rawRect: TextRect
  /** CSS pixel space within the rendered editor canvas. */
  screenRect: TextRect
  fontSize: number
  /** Baseline-left origin in raw PDF space -- what pdf-lib's drawText expects for x/y. */
  baseline: { x: number; y: number }
}

/** 2D affine matrix helpers, [a, b, c, d, e, f] representing [[a,c,e],[b,d,f],[0,0,1]]. */
function transformPoint(m: number[], x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

function invertMatrix(m: number[]): number[] {
  const det = m[0] * m[3] - m[1] * m[2]
  const invDet = det === 0 ? 0 : 1 / det
  return [
    m[3] * invDet,
    -m[1] * invDet,
    -m[2] * invDet,
    m[0] * invDet,
    (m[2] * m[5] - m[3] * m[4]) * invDet,
    (m[1] * m[4] - m[0] * m[5]) * invDet,
  ]
}

function rectFromCorners(corners: [number, number][]): TextRect {
  const xs = corners.map((c) => c[0])
  const ys = corners.map((c) => c[1])
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

function rawRectToScreenRect(viewportTransform: number[], rect: TextRect): TextRect {
  return rectFromCorners([
    transformPoint(viewportTransform, rect.x, rect.y),
    transformPoint(viewportTransform, rect.x + rect.width, rect.y),
    transformPoint(viewportTransform, rect.x, rect.y + rect.height),
    transformPoint(viewportTransform, rect.x + rect.width, rect.y + rect.height),
  ])
}

/** Converts a click position (CSS pixels, relative to the rendered canvas) into
 * the page's raw PDF point space, for placing newly-added text. */
export function screenPointToRaw(viewportTransform: number[], screenX: number, screenY: number): { x: number; y: number } {
  const [x, y] = transformPoint(invertMatrix(viewportTransform), screenX, screenY)
  return { x, y }
}

/** Converts a raw PDF-space point (e.g. an edit's baseline) back into CSS
 * pixels within the rendered editor canvas, for positioning overlay boxes. */
export function rawPointToScreen(viewportTransform: number[], x: number, y: number): { x: number; y: number } {
  const [sx, sy] = transformPoint(viewportTransform, x, y)
  return { x: sx, y: sy }
}

/** Detects each text run on a rendered page and computes both its raw PDF-space
 * bounding box (for baking edits with pdf-lib) and its on-screen box within the
 * editor canvas (for positioning the click/edit overlay). Runs with only
 * whitespace are skipped. */
export async function detectTextRuns(page: PDFPageProxy, viewportTransform: number[]): Promise<DetectedTextRun[]> {
  const content = await page.getTextContent()
  const runs: DetectedTextRun[] = []

  for (const item of content.items) {
    if (!('str' in item) || item.str.trim().length === 0) continue

    const transform = item.transform
    const fontSize = Math.hypot(transform[2], transform[3]) || 10
    const width = item.width || fontSize * 0.5 * item.str.length
    const ascent = fontSize * 0.75
    const descent = fontSize * 0.25
    const pad = fontSize * 0.12

    const rawRect: TextRect = {
      x: transform[4] - pad,
      y: transform[5] - descent,
      width: width + pad * 2,
      height: ascent + descent,
    }

    runs.push({
      id: uid(),
      str: item.str,
      rawRect,
      screenRect: rawRectToScreenRect(viewportTransform, rawRect),
      fontSize,
      baseline: { x: transform[4], y: transform[5] },
    })
  }

  return runs
}

/** Bakes a set of text/image edits into a fresh copy of the given page
 * (preserving its current rotation), producing a new standalone single-page
 * PDF "source" -- the same shape createBlankPage/loadImageFile produce, so
 * the rest of the app (thumbnails, print layout, split, merge...) needs no
 * special-casing. */
export async function applyPageEdits(
  pageItem: PageItem,
  sources: Map<string, SourceDoc>,
  edits: PageEdit[],
): Promise<LoadedPdf> {
  const source = sources.get(pageItem.sourceId)
  if (!source) throw new Error('Missing source document')

  const srcDoc = await PDFDocument.load(source.bytes, { ignoreEncryption: true })
  const outDoc = await PDFDocument.create()
  const [copiedPage] = await outDoc.copyPages(srcDoc, [pageItem.pageIndex])
  outDoc.addPage(copiedPage)
  if (pageItem.rotation % 360 !== 0) {
    const currentAngle = copiedPage.getRotation().angle
    copiedPage.setRotation(degrees(currentAngle + pageItem.rotation))
  }

  const latinFont = await outDoc.embedFont(StandardFonts.Helvetica)
  let unicodeFont: PDFFont | null = null
  const getUnicodeFont = async () => {
    if (!unicodeFont) {
      const { default: fontkit } = await import('@pdf-lib/fontkit')
      outDoc.registerFontkit(fontkit)
      const fontBytes = await fetch(unicodeFontUrl).then((res) => res.arrayBuffer())
      unicodeFont = await outDoc.embedFont(fontBytes, { subset: true })
    }
    return unicodeFont
  }

  for (const edit of edits) {
    if (edit.kind === 'image') {
      const image = edit.format === 'png' ? await outDoc.embedPng(edit.bytes) : await outDoc.embedJpg(edit.bytes)
      copiedPage.drawImage(image, { x: edit.x, y: edit.y, width: edit.width, height: edit.height })
      continue
    }

    const hasText = edit.text.trim().length > 0
    const font = hasText ? (NEEDS_UNICODE_FONT.test(edit.text) ? await getUnicodeFont() : latinFont) : null
    // A run whose original text contains characters neither font can encode (e.g. a
    // symbol/dingbat font's "text" layer) can't be faithfully redrawn -- skip that one
    // edit rather than losing every other edit on the page to a single encoding error.
    const canDraw = !hasText || isEncodable(font!, edit.text)
    if (!canDraw) {
      console.warn('Skipping a text edit with characters this app cannot render:', edit.text)
      continue
    }

    if (edit.mode === 'replace' && edit.whiteoutRect) {
      copiedPage.drawRectangle({
        x: edit.whiteoutRect.x,
        y: edit.whiteoutRect.y,
        width: edit.whiteoutRect.width,
        height: edit.whiteoutRect.height,
        color: rgb(1, 1, 1),
      })
    }
    if (hasText && font) {
      copiedPage.drawText(edit.text, {
        x: edit.x,
        y: edit.y,
        size: edit.fontSize,
        lineHeight: edit.fontSize * 1.25,
        font,
        color: rgb(edit.color.r, edit.color.g, edit.color.b),
      })
    }
  }

  const pdfBytes = await outDoc.save()

  const reloaded = await getDocument({ data: pdfBytes.slice() }).promise
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const renderedPage = await reloaded.getPage(1)
  const thumbnail = await renderPageThumbnail(renderedPage, dpr)
  await reloaded.loadingTask.destroy()

  const sourceId = uid()
  return {
    source: { id: sourceId, name: pageItem.sourceName, bytes: toArrayBuffer(pdfBytes) },
    pages: [
      {
        id: uid(),
        sourceId,
        sourceName: pageItem.sourceName,
        pageIndex: 0,
        pageNumber: 1,
        rotation: 0,
        thumbnailUrl: thumbnail.url,
        width: thumbnail.width,
        height: thumbnail.height,
      },
    ],
  }
}
