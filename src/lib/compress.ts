import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist'
import { PDFDocument } from 'pdf-lib'
import type { PageItem, SourceDoc } from '../types'

export type CompressionLevel = 'high' | 'balanced' | 'small'

interface CompressionPreset {
  label: string
  description: string
  scale: number
  quality: number
}

export const COMPRESSION_PRESETS: Record<CompressionLevel, CompressionPreset> = {
  high: {
    label: 'High quality',
    description: 'Largest file, sharpest detail. Best for documents that will be zoomed in or printed professionally.',
    scale: 2,
    quality: 0.92,
  },
  balanced: {
    label: 'Balanced',
    description: 'Noticeably smaller with only minor quality loss. A good default for emailing or general sharing.',
    scale: 1.5,
    quality: 0.8,
  },
  small: {
    label: 'Smallest size',
    description: 'Maximum compression. Best when file size matters more than sharpness.',
    scale: 1,
    quality: 0.6,
  },
}

/** Rebuilds the PDF by rasterizing each page to a JPEG at the chosen quality
 * and re-embedding it as a full-bleed image. This trades vector sharpness and
 * selectable text for a much smaller file -- most effective on scanned or
 * photo-heavy documents, and on PDFs built from high-resolution images. */
export async function buildCompressedPdf(
  pages: PageItem[],
  sources: Map<string, SourceDoc>,
  level: CompressionLevel,
): Promise<Uint8Array> {
  const { scale, quality } = COMPRESSION_PRESETS[level]
  const outDoc = await PDFDocument.create()
  const pdfCache = new Map<string, PDFDocumentProxy>()

  try {
    for (const pageItem of pages) {
      const source = sources.get(pageItem.sourceId)
      if (!source) continue

      let pdf = pdfCache.get(pageItem.sourceId)
      if (!pdf) {
        pdf = await getDocument({ data: source.bytes.slice(0) }).promise
        pdfCache.set(pageItem.sourceId, pdf)
      }

      const page = await pdf.getPage(pageItem.pageIndex + 1)
      const totalRotation = ((page.rotate + pageItem.rotation) % 360 + 360) % 360
      const viewport = page.getViewport({ scale, rotation: totalRotation })

      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.ceil(viewport.width))
      canvas.height = Math.max(1, Math.ceil(viewport.height))
      const canvasContext = canvas.getContext('2d')
      if (!canvasContext) throw new Error('Canvas rendering is not supported in this browser.')

      await page.render({ canvasContext, viewport }).promise
      page.cleanup()

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
      if (!blob) throw new Error('Failed to compress this page.')
      const jpegBytes = await blob.arrayBuffer()
      const image = await outDoc.embedJpg(jpegBytes)

      const pageWidthPts = viewport.width / scale
      const pageHeightPts = viewport.height / scale
      const outPage = outDoc.addPage([pageWidthPts, pageHeightPts])
      outPage.drawImage(image, { x: 0, y: 0, width: pageWidthPts, height: pageHeightPts })
    }
  } finally {
    for (const pdf of pdfCache.values()) await pdf.loadingTask.destroy()
  }

  outDoc.setProducer('PDFPRO')
  outDoc.setCreator('PDFPRO')
  return outDoc.save()
}
