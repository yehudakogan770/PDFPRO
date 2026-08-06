import { Dropzone } from './Dropzone'
import { IconImage, IconLayoutGrid, IconPrinter, IconScissors, IconShield } from './Icons'

interface EmptyStateProps {
  onFiles: (files: File[]) => void
  disabled: boolean
}

const FEATURES = [
  {
    icon: IconLayoutGrid,
    title: 'Merge & reorder',
    description: 'Combine any number of PDFs into one, then drag pages into exactly the order you want.',
  },
  {
    icon: IconPrinter,
    title: 'Booklets & print layouts',
    description: 'Saddle-stitch booklets, 2/4-up handouts, page numbers, watermarks, and custom paper sizes.',
  },
  {
    icon: IconScissors,
    title: 'Split & extract',
    description: 'Export any page range as its own file, or break a document into one-page-per-file exports.',
  },
  {
    icon: IconImage,
    title: 'Photos & blank pages',
    description: 'Drop in JPGs or PNGs alongside your PDFs, or insert blank pages exactly where you need them.',
  },
]

export function EmptyState({ onFiles, disabled }: EmptyStateProps) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Your local PDF & print toolkit</h1>
      <p className="mx-auto mt-2.5 max-w-xl text-sm leading-relaxed text-slate-500 sm:text-base">
        Merge, reorder, split, and lay out PDFs for printing — booklets, handouts, and more. Everything runs in your
        browser; nothing is ever uploaded.
      </p>

      <div className="mt-8">
        <Dropzone variant="empty" onFiles={onFiles} disabled={disabled} />
      </div>

      <div className="mt-10 grid grid-cols-1 gap-4 text-left sm:grid-cols-2">
        {FEATURES.map((feature) => (
          <div key={feature.title} className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
              <feature.icon className="size-4.5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">{feature.title}</div>
              <div className="mt-0.5 text-xs leading-relaxed text-slate-500">{feature.description}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3.5 py-1.5 text-xs font-medium text-slate-600">
        <IconShield className="size-3.5" />
        Private by design — your files never leave this browser tab
      </div>
    </div>
  )
}
