import { PDFDocument, PageSizes, StandardFonts, degrees, rgb } from 'pdf-lib'
import type { PDFFont, PDFPage } from 'pdf-lib'
import type { PageItem, SourceDoc } from '../types'
import { buildMergedDoc } from './pdf'

export type PrintLayoutMode = 'normal' | 'fit' | '2up' | '4up' | 'booklet'

/** A paper size in PDF points (1/72in), width x height, portrait orientation. */
export type PaperPoints = [number, number]

export const PAPER_PRESETS: { key: string; label: string; points: PaperPoints }[] = [
  { key: 'a4', label: 'A4', points: PageSizes.A4 },
  { key: 'letter', label: 'Letter', points: PageSizes.Letter },
  { key: 'legal', label: 'Legal', points: PageSizes.Legal },
]

export const MM_PER_POINT = 25.4 / 72
export const POINTS_PER_MM = 72 / 25.4
export const POINTS_PER_INCH = 72

export type PageNumberPosition = 'bottom-center' | 'bottom-left' | 'bottom-right' | 'top-center' | 'top-left' | 'top-right'
export type PageNumberFormat = 'number' | 'number-of-total' | 'page-x-of-y'

export interface StampOptions {
  pageNumbers: boolean
  pageNumberPosition: PageNumberPosition
  pageNumberFormat: PageNumberFormat
  watermarkText: string
  cornerMarks: boolean
}

export interface DocMetadata {
  title: string
  author: string
}

/** Margin around the outer edge of each sheet, and gutter between cells, in points. */
const SHEET_MARGIN = 24
const CELL_GUTTER = 16

interface Cell {
  x: number
  y: number
  width: number
  height: number
}

/** Splits a sheet into a rows x cols grid of cells, inset by a margin, separated by a gutter. */
function computeCells(sheetWidth: number, sheetHeight: number, cols: number, rows: number): Cell[] {
  const usableWidth = sheetWidth - SHEET_MARGIN * 2 - CELL_GUTTER * (cols - 1)
  const usableHeight = sheetHeight - SHEET_MARGIN * 2 - CELL_GUTTER * (rows - 1)
  const cellWidth = usableWidth / cols
  const cellHeight = usableHeight / rows

  const cells: Cell[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      cells.push({
        x: SHEET_MARGIN + col * (cellWidth + CELL_GUTTER),
        // PDF space has y=0 at the bottom; row 0 is the visual top row.
        y: sheetHeight - SHEET_MARGIN - (row + 1) * cellHeight - row * CELL_GUTTER,
        width: cellWidth,
        height: cellHeight,
      })
    }
  }
  return cells
}

/** Draws one source page into a grid cell, fitted and centered, honoring both the
 * page's own baked-in /Rotate and the user's extra rotation from the editor. */
async function drawPageIntoCell(
  outputDoc: PDFDocument,
  outputPage: PDFPage,
  sourcePage: PDFPage,
  extraRotation: number,
  cell: Cell,
): Promise<void> {
  const embedded = await outputDoc.embedPage(sourcePage)
  const intrinsicRotation = ((sourcePage.getRotation().angle % 360) + 360) % 360
  const totalRotation = (intrinsicRotation + extraRotation + 360) % 360

  const swapped = totalRotation % 180 !== 0
  const visualNativeWidth = swapped ? embedded.height : embedded.width
  const visualNativeHeight = swapped ? embedded.width : embedded.height

  const scale = Math.min(cell.width / visualNativeWidth, cell.height / visualNativeHeight)
  const drawnWidth = visualNativeWidth * scale
  const drawnHeight = visualNativeHeight * scale
  const visX = cell.x + (cell.width - drawnWidth) / 2
  const visY = cell.y + (cell.height - drawnHeight) / 2

  // drawPage rotates counter-clockwise about (x, y), so the anchor corner and the
  // width/height options swap depending on which quadrant the rotation lands the
  // page's own bottom-left corner in. These four cases are the closed-form solution
  // for placing a `totalRotation`-rotated page so it exactly fills the visual box
  // [visX, visX+drawnWidth] x [visY, visY+drawnHeight].
  let x: number, y: number, width: number, height: number
  if (totalRotation === 90) {
    x = visX + drawnWidth
    y = visY
    width = drawnHeight
    height = drawnWidth
  } else if (totalRotation === 180) {
    x = visX + drawnWidth
    y = visY + drawnHeight
    width = drawnWidth
    height = drawnHeight
  } else if (totalRotation === 270) {
    x = visX
    y = visY + drawnHeight
    width = drawnHeight
    height = drawnWidth
  } else {
    x = visX
    y = visY
    width = drawnWidth
    height = drawnHeight
  }

  outputPage.drawPage(embedded, { x, y, width, height, rotate: degrees(totalRotation) })
}

/** Renders a flat sequence of grid slots (one entry per cell, sheet by sheet,
 * row-major) to a new PDF document. A `null` slot leaves that cell blank. */
async function renderImposedDoc(
  slots: (PageItem | null)[],
  sources: Map<string, SourceDoc>,
  sheetWidth: number,
  sheetHeight: number,
  cols: number,
  rows: number,
): Promise<PDFDocument> {
  const outputDoc = await PDFDocument.create()
  const docCache = new Map<string, PDFPage[]>()

  const getSourcePages = async (sourceId: string): Promise<PDFPage[]> => {
    const cached = docCache.get(sourceId)
    if (cached) return cached
    const source = sources.get(sourceId)
    if (!source) throw new Error(`Missing source document: ${sourceId}`)
    const doc = await PDFDocument.load(source.bytes, { ignoreEncryption: true })
    const pages = doc.getPages()
    docCache.set(sourceId, pages)
    return pages
  }

  const cells = computeCells(sheetWidth, sheetHeight, cols, rows)
  const perSheet = cols * rows

  for (let i = 0; i < slots.length; i += perSheet) {
    const sheetSlots = slots.slice(i, i + perSheet)
    if (sheetSlots.every((slot) => slot === null)) continue

    const outputPage = outputDoc.addPage([sheetWidth, sheetHeight])
    for (let cellIndex = 0; cellIndex < sheetSlots.length; cellIndex++) {
      const pageItem = sheetSlots[cellIndex]
      if (!pageItem) continue
      const sourcePages = await getSourcePages(pageItem.sourceId)
      const sourcePage = sourcePages[pageItem.pageIndex]
      await drawPageIntoCell(outputDoc, outputPage, sourcePage, pageItem.rotation, cells[cellIndex])
    }
  }

  return outputDoc
}

/** Reorders pages into the standard "surround" imposition sequence for a
 * saddle-stitched booklet: sheet by sheet, front then back, so that once the
 * printed stack is folded in half and stapled, pages read in order. Pads with
 * blanks so the page count is a multiple of 4. */
function buildBookletSlots(pages: PageItem[]): (PageItem | null)[] {
  const n = pages.length
  const padded = Math.max(4, Math.ceil(n / 4) * 4)
  const at = (oneBasedPosition: number): PageItem | null =>
    oneBasedPosition >= 1 && oneBasedPosition <= n ? pages[oneBasedPosition - 1] : null

  const slots: (PageItem | null)[] = []
  for (let sheet = 0; sheet < padded / 4; sheet++) {
    slots.push(at(padded - 2 * sheet), at(1 + 2 * sheet))
    slots.push(at(2 + 2 * sheet), at(padded - 1 - 2 * sheet))
  }
  return slots
}

/** How many physical sheets a booklet will use, and how many trailing blank
 * pages get added to pad the count to a multiple of 4. For display in the UI. */
export function bookletPageCount(pageCount: number): { sheets: number; blanks: number } {
  if (pageCount === 0) return { sheets: 0, blanks: 0 }
  const padded = Math.max(4, Math.ceil(pageCount / 4) * 4)
  return { sheets: padded / 4, blanks: padded - pageCount }
}

/** Short registration/trim marks near each of a page's four corners. */
function drawCornerMarks(page: PDFPage): void {
  const width = page.getWidth()
  const height = page.getHeight()
  const gap = 6
  const armLength = 14
  const color = rgb(0.45, 0.45, 0.45)
  const thickness = 0.75

  const corners: { x: number; y: number; dx: 1 | -1; dy: 1 | -1 }[] = [
    { x: 0, y: 0, dx: 1, dy: 1 },
    { x: width, y: 0, dx: -1, dy: 1 },
    { x: 0, y: height, dx: 1, dy: -1 },
    { x: width, y: height, dx: -1, dy: -1 },
  ]

  for (const corner of corners) {
    const originX = corner.x + corner.dx * gap
    const originY = corner.y + corner.dy * gap
    page.drawLine({
      start: { x: originX, y: originY },
      end: { x: corner.x + corner.dx * (gap + armLength), y: originY },
      thickness,
      color,
    })
    page.drawLine({
      start: { x: originX, y: originY },
      end: { x: originX, y: corner.y + corner.dy * (gap + armLength) },
      thickness,
      color,
    })
  }
}

/** /Rotate is a display-time transform: page.getWidth/Height and drawText/drawLine
 * coordinates are all in the page's *raw*, unrotated space. To place a stamp at a
 * fixed spot in the *visually displayed* page (e.g. "bottom center"), or to draw it
 * at a fixed visual angle, we have to counter-rotate: pre-rotate drawn content by
 * +rotation (drawText's rotate is counter-clockwise, same convention as /Rotate's
 * clockwise-for-display, so this cancels out), and map the desired visual point
 * back through the inverse of the viewer's rotate-then-normalize transform. */
function getVisualRotation(page: PDFPage): number {
  return ((page.getRotation().angle % 360) + 360) % 360
}

function visualPointToRaw(rotation: number, rawWidth: number, rawHeight: number, visualX: number, visualY: number): { x: number; y: number } {
  if (rotation === 90) return { x: rawWidth - visualY, y: visualX }
  if (rotation === 180) return { x: rawWidth - visualX, y: rawHeight - visualY }
  if (rotation === 270) return { x: visualY, y: rawHeight - visualX }
  return { x: visualX, y: visualY }
}

/** A large, pale, diagonal watermark centered on the page. */
function drawWatermark(page: PDFPage, text: string, font: PDFFont): void {
  const width = page.getWidth()
  const height = page.getHeight()
  const rotation = getVisualRotation(page)
  // The page's geometric center is invariant under the rotate-then-normalize
  // transform, so only the angle (not the position) needs compensating here.
  const angleDeg = 45 + rotation
  const angleRad = (angleDeg * Math.PI) / 180

  const diagonal = Math.hypot(width, height)
  const rawSize = diagonal / Math.max(1, text.length * 0.62)
  const size = Math.min(96, Math.max(14, rawSize))
  const textWidth = font.widthOfTextAtSize(text, size)

  // Center the rotated text block on the page: find the local-space center of
  // the (unrotated) text box, then solve for the origin that puts the
  // *rotated* center at the page's center (same rotation convention as
  // drawPageIntoCell above — counter-clockwise about the text's own origin).
  const localCenterX = textWidth / 2
  const localCenterY = size * 0.35
  const rotatedOffsetX = localCenterX * Math.cos(angleRad) - localCenterY * Math.sin(angleRad)
  const rotatedOffsetY = localCenterX * Math.sin(angleRad) + localCenterY * Math.cos(angleRad)

  page.drawText(text, {
    x: width / 2 - rotatedOffsetX,
    y: height / 2 - rotatedOffsetY,
    size,
    font,
    color: rgb(0.6, 0.6, 0.6),
    opacity: 0.25,
    rotate: degrees(angleDeg),
  })
}

function formatPageNumber(format: PageNumberFormat, position: number, total: number): string {
  if (format === 'number') return `${position}`
  if (format === 'page-x-of-y') return `Page ${position} of ${total}`
  return `${position} / ${total}`
}

function drawPageNumber(
  page: PDFPage,
  position: number,
  total: number,
  font: PDFFont,
  placement: PageNumberPosition,
  format: PageNumberFormat,
): void {
  const rawWidth = page.getWidth()
  const rawHeight = page.getHeight()
  const rotation = getVisualRotation(page)
  const visualWidth = rotation % 180 !== 0 ? rawHeight : rawWidth
  const visualHeight = rotation % 180 !== 0 ? rawWidth : rawHeight

  const text = formatPageNumber(format, position, total)
  const size = 9
  const margin = 12
  const textWidth = font.widthOfTextAtSize(text, size)

  const [vertical, horizontal] = placement.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right']
  const visualX =
    horizontal === 'left' ? margin : horizontal === 'right' ? visualWidth - margin - textWidth : (visualWidth - textWidth) / 2
  const visualY = vertical === 'top' ? visualHeight - margin - size * 0.8 : margin

  const origin = visualPointToRaw(rotation, rawWidth, rawHeight, visualX, visualY)
  page.drawText(text, {
    x: origin.x,
    y: origin.y,
    size,
    font,
    color: rgb(0.45, 0.45, 0.45),
    rotate: degrees(rotation),
  })
}

async function applyStamps(doc: PDFDocument, options: StampOptions): Promise<void> {
  const watermarkText = options.watermarkText.trim()
  if (!options.pageNumbers && !watermarkText && !options.cornerMarks) return

  const font = await doc.embedFont(StandardFonts.Helvetica)
  const pages = doc.getPages()
  pages.forEach((page, index) => {
    if (options.cornerMarks) drawCornerMarks(page)
    if (watermarkText) drawWatermark(page, watermarkText, font)
    if (options.pageNumbers) drawPageNumber(page, index + 1, pages.length, font, options.pageNumberPosition, options.pageNumberFormat)
  })
}

export async function buildPrintLayoutPdf(
  mode: PrintLayoutMode,
  pages: PageItem[],
  sources: Map<string, SourceDoc>,
  paperSize: PaperPoints,
  stamps: StampOptions,
  metadata?: DocMetadata,
): Promise<Uint8Array> {
  const [portraitWidth, portraitHeight] = paperSize

  let doc: PDFDocument
  if (mode === 'normal') {
    doc = await buildMergedDoc(pages, sources)
  } else if (mode === 'fit') {
    doc = await renderImposedDoc(pages, sources, portraitWidth, portraitHeight, 1, 1)
  } else if (mode === '4up') {
    doc = await renderImposedDoc(pages, sources, portraitWidth, portraitHeight, 2, 2)
  } else if (mode === '2up') {
    doc = await renderImposedDoc(pages, sources, portraitHeight, portraitWidth, 2, 1)
  } else {
    doc = await renderImposedDoc(buildBookletSlots(pages), sources, portraitHeight, portraitWidth, 2, 1)
  }

  await applyStamps(doc, stamps)

  const title = metadata?.title.trim()
  const author = metadata?.author.trim()
  if (title) doc.setTitle(title)
  if (author) doc.setAuthor(author)
  doc.setProducer('PDFPRO')
  doc.setCreator('PDFPRO')

  return doc.save()
}
