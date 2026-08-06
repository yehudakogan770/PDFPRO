import { useId, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { IconPlus, IconUploadCloud } from './Icons'

interface DropzoneProps {
  onFiles: (files: File[]) => void
  variant?: 'empty' | 'button'
  disabled?: boolean
}

function extractFiles(fileList: FileList | null): File[] {
  if (!fileList) return []
  return Array.from(fileList)
}

export function Dropzone({ onFiles, variant = 'empty', disabled = false }: DropzoneProps) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  const openPicker = () => {
    if (!disabled) inputRef.current?.click()
  }

  const handleDrop = (e: DragEvent<HTMLDivElement | HTMLButtonElement>) => {
    e.preventDefault()
    setIsDragOver(false)
    if (disabled) return
    onFiles(extractFiles(e.dataTransfer.files))
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement | HTMLButtonElement>) => {
    e.preventDefault()
    if (!disabled) setIsDragOver(true)
  }

  const handleDragLeave = (e: DragEvent<HTMLDivElement | HTMLButtonElement>) => {
    e.preventDefault()
    setIsDragOver(false)
  }

  const input = (
    <input
      ref={inputRef}
      id={inputId}
      type="file"
      accept="application/pdf,.pdf,image/jpeg,image/png,.jpg,.jpeg,.png"
      multiple
      disabled={disabled}
      className="sr-only"
      onChange={(e) => {
        onFiles(extractFiles(e.target.files))
        e.target.value = ''
      }}
    />
  )

  if (variant === 'button') {
    return (
      <>
        <button
          type="button"
          onClick={openPicker}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          disabled={disabled}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            isDragOver
              ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          <IconPlus className="size-4" />
          Add Files
        </button>
        {input}
      </>
    )
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={openPicker}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          openPicker()
        }
      }}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      className={`flex w-full cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-20 text-center transition-colors ${
        isDragOver ? 'border-indigo-400 bg-indigo-50' : 'border-slate-300 bg-white hover:border-slate-400 hover:bg-slate-50'
      } ${disabled ? 'pointer-events-none opacity-50' : ''}`}
    >
      <div className={`flex size-16 items-center justify-center rounded-full ${isDragOver ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-500'}`}>
        <IconUploadCloud className="size-8" />
      </div>
      <p className="mt-5 text-base font-medium text-slate-800">Drop PDFs or images here, or click to browse</p>
      <p className="mt-1.5 text-sm text-slate-500">Import as many files as you like — you'll be able to drag pages into any order before merging.</p>
      {input}
    </div>
  )
}
