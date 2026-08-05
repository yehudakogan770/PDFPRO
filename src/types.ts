export interface SourceDoc {
  id: string
  name: string
  /** Pristine copy of the file bytes, untouched by pdf.js, used later for merging. */
  bytes: ArrayBuffer
}

export interface PageItem {
  /** Unique id used as the dnd-kit sortable key; stable across reorders. */
  id: string
  sourceId: string
  sourceName: string
  /** 0-based page index within its source document. */
  pageIndex: number
  /** 1-based page number within its source document, for display. */
  pageNumber: number
  /** User-applied rotation in degrees, added on top of the page's own rotation. */
  rotation: number
  thumbnailUrl: string
  width: number
  height: number
}
