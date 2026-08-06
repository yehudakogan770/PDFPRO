import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { PageItem } from '../types'
import { IconCheck, IconCopy, IconGrip, IconRotate, IconTrash } from './Icons'

interface PageCardProps {
  page: PageItem
  position: number
  selected: boolean
  onRotate: (id: string) => void
  onRemove: (id: string) => void
  onDuplicate: (id: string) => void
  onToggleSelect: (id: string) => void
}

export function PageCard({ page, position, selected, onRotate, onRemove, onDuplicate, onToggleSelect }: PageCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const rotated90 = page.rotation % 180 !== 0
  const aspectRatio = rotated90 ? `${page.height} / ${page.width}` : `${page.width} / ${page.height}`

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative touch-none rounded-xl bg-white p-2.5 shadow-sm ring-1 transition-shadow hover:shadow-md ${
        selected ? 'ring-2 ring-indigo-500' : 'ring-slate-200'
      } ${isDragging ? 'z-10 opacity-50 shadow-lg ring-indigo-300' : ''}`}
    >
      <button
        type="button"
        onClick={() => onToggleSelect(page.id)}
        aria-label={selected ? `Deselect page ${position}` : `Select page ${position}`}
        aria-pressed={selected}
        className={`absolute left-1.5 top-1.5 z-10 flex size-6 items-center justify-center rounded-full text-xs font-semibold shadow-sm transition-colors ${
          selected ? 'bg-indigo-600 text-white' : 'bg-slate-900/80 text-white hover:bg-indigo-600'
        }`}
      >
        {selected ? <IconCheck className="size-3.5" /> : position}
      </button>

      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Drag to reorder page ${position}`}
        className="absolute right-1.5 top-1.5 z-10 flex size-7 cursor-grab items-center justify-center rounded-md bg-white/90 text-slate-500 opacity-0 shadow-sm ring-1 ring-slate-200 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 active:cursor-grabbing"
      >
        <IconGrip className="size-4" />
      </button>

      <div className="flex items-center justify-center overflow-hidden rounded-lg bg-slate-100" style={{ aspectRatio }}>
        <img
          src={page.thumbnailUrl}
          alt={`Page ${page.pageNumber} of ${page.sourceName}`}
          draggable={false}
          className="h-full w-full select-none object-contain transition-transform duration-200"
          style={{ transform: `rotate(${page.rotation}deg)` }}
        />
      </div>

      <div className="mt-2 truncate text-center text-xs text-slate-500" title={`${page.sourceName} · page ${page.pageNumber}`}>
        {page.sourceName} <span className="text-slate-400">· p{page.pageNumber}</span>
      </div>

      <div className="mt-1.5 flex items-center justify-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          type="button"
          onClick={() => onRotate(page.id)}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        >
          <IconRotate className="size-3.5" />
          Rotate
        </button>
        <button
          type="button"
          onClick={() => onDuplicate(page.id)}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        >
          <IconCopy className="size-3.5" />
          Duplicate
        </button>
        <button
          type="button"
          onClick={() => onRemove(page.id)}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 hover:text-red-700"
        >
          <IconTrash className="size-3.5" />
          Remove
        </button>
      </div>
    </div>
  )
}
