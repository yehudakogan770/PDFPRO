import { PDFDocument, degrees } from 'pdf-lib'
import { getDocument } from 'pdfjs-dist'
import type { PageItem, SourceDoc } from '../types'
import { renderPageThumbnail, toArrayBuffer, uid } from './pdf'
import type { LoadedPdf } from './pdf'

/** Inset fractions (0-0.45) trimmed from each visual edge of the page. */
export interface CropInsets {
  top: number
  bottom: number
  left: number
  right: number
}

/** Maps a point in visual (displayed, rotation-applied) space back to the
 * page's raw content-stream space -- the same convention used for stamp
 * placement in imposition.ts, re-derived here since crop only needs the one
 * helper and pulling in the whole imposition module would be overkill. */
function visualPointToRaw(rotation: number, rawWidth: number, rawHeight: number, visualX: number, visualY: number): { x: number; y: number } {
  if (rotation === 90) return { x: rawWidth - visualY, y: visualX }
  if (rotation === 180) return { x: rawWidth - visualX, y: rawHeight - visualY }
  if (rotation === 270) return { x: visualY, y: rawHeight - visualX }
  return { x: visualX, y: visualY }
}

/** Crops a page by setting its CropBox (the original content is preserved,
 * just no longer shown/printed outside the box -- the standard, non-destructive
 * way PDF viewers and printers crop). Bakes in the page's current rotation,
 * producing a fresh standalone single-page source like the text editor does. */
export async function applyCrop(pageItem: PageItem, sources: Map<string, SourceDoc>, insets: CropInsets): Promise<LoadedPdf> {
  const source = sources.get(pageItem.sourceId)
  if (!source) throw new Error('Missing source document')

  const srcDoc = await PDFDocument.load(source.bytes, { ignoreEncryption: true })
  const outDoc = await PDFDocument.create()
  const [copiedPage] = await outDoc.copyPages(srcDoc, [pageItem.pageIndex])
  outDoc.addPage(copiedPage)

  const totalRotation = ((copiedPage.getRotation().angle + pageItem.rotation) % 360 + 360) % 360
  if (pageItem.rotation % 360 !== 0) {
    copiedPage.setRotation(degrees(copiedPage.getRotation().angle + pageItem.rotation))
  }

  const rawWidth = copiedPage.getWidth()
  const rawHeight = copiedPage.getHeight()
  const visualWidth = totalRotation % 180 !== 0 ? rawHeight : rawWidth
  const visualHeight = totalRotation % 180 !== 0 ? rawWidth : rawHeight

  const visualRect = {
    x: insets.left * visualWidth,
    y: insets.bottom * visualHeight,
    width: (1 - insets.left - insets.right) * visualWidth,
    height: (1 - insets.top - insets.bottom) * visualHeight,
  }

  const corners = [
    visualPointToRaw(totalRotation, rawWidth, rawHeight, visualRect.x, visualRect.y),
    visualPointToRaw(totalRotation, rawWidth, rawHeight, visualRect.x + visualRect.width, visualRect.y),
    visualPointToRaw(totalRotation, rawWidth, rawHeight, visualRect.x, visualRect.y + visualRect.height),
    visualPointToRaw(totalRotation, rawWidth, rawHeight, visualRect.x + visualRect.width, visualRect.y + visualRect.height),
  ]
  const xs = corners.map((c) => c.x)
  const ys = corners.map((c) => c.y)
  const rawX = Math.min(...xs)
  const rawY = Math.min(...ys)

  copiedPage.setCropBox(rawX, rawY, Math.max(...xs) - rawX, Math.max(...ys) - rawY)

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
