import { useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import type { PageItem } from '../types'
import { PageCard } from './PageCard'

interface PageGridProps {
  pages: PageItem[]
  onReorder: (pages: PageItem[]) => void
  onRotate: (id: string) => void
  onRemove: (id: string) => void
}

export function PageGrid({ pages, onReorder, onRotate, onRemove }: PageGridProps) {
  const [activeId, setActiveId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id))
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = pages.findIndex((p) => p.id === active.id)
    const newIndex = pages.findIndex((p) => p.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    onReorder(arrayMove(pages, oldIndex, newIndex))
  }

  const activePage = activeId ? pages.find((p) => p.id === activeId) : undefined

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext items={pages.map((p) => p.id)} strategy={rectSortingStrategy}>
        <div className={`grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 ${activeId ? 'dragging-active' : ''}`}>
          {pages.map((page, index) => (
            <PageCard key={page.id} page={page} position={index + 1} onRotate={onRotate} onRemove={onRemove} />
          ))}
        </div>
      </SortableContext>
      <DragOverlay>
        {activePage ? (
          <div className="rotate-3 rounded-xl bg-white p-2.5 opacity-95 shadow-2xl ring-2 ring-indigo-400">
            <div
              className="overflow-hidden rounded-lg bg-slate-100"
              style={{
                aspectRatio:
                  activePage.rotation % 180 !== 0
                    ? `${activePage.height} / ${activePage.width}`
                    : `${activePage.width} / ${activePage.height}`,
                width: 160,
              }}
            >
              <img
                src={activePage.thumbnailUrl}
                alt=""
                className="h-full w-full object-contain"
                style={{ transform: `rotate(${activePage.rotation}deg)` }}
              />
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
