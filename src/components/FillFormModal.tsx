import { useEffect, useState } from 'react'
import type { PageItem, SourceDoc } from '../types'
import { detectFormFields, fillAndFlattenForm } from '../lib/formFill'
import type { FormFieldInfo, FormFieldValue } from '../lib/formFill'
import { IconClipboardList, IconSpinner, IconX } from './Icons'

interface FillFormModalProps {
  pages: PageItem[]
  sources: Map<string, SourceDoc>
  onClose: () => void
  onApply: (sourceId: string, newBytes: Uint8Array) => Promise<void>
  onError: (message: string) => void
}

interface FormSourceOption {
  sourceId: string
  sourceName: string
  fieldCount: number
}

export function FillFormModal({ pages, sources, onClose, onApply, onError }: FillFormModalProps) {
  const [isScanning, setIsScanning] = useState(true)
  const [formSources, setFormSources] = useState<FormSourceOption[]>([])
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)
  const [fields, setFields] = useState<FormFieldInfo[]>([])
  const [values, setValues] = useState<Record<string, FormFieldValue>>({})
  const [isLoadingFields, setIsLoadingFields] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function scan() {
      const seenSourceIds = new Set(pages.map((p) => p.sourceId))
      const options: FormSourceOption[] = []
      for (const sourceId of seenSourceIds) {
        const source = sources.get(sourceId)
        if (!source) continue
        try {
          const detected = await detectFormFields(source.bytes)
          if (detected.length > 0) options.push({ sourceId, sourceName: source.name, fieldCount: detected.length })
        } catch {
          // Not a form (or unreadable) -- just skip it, this isn't an error worth surfacing.
        }
      }
      if (cancelled) return
      setFormSources(options)
      setIsScanning(false)
      if (options.length > 0) setSelectedSourceId(options[0].sourceId)
    }
    void scan()
    return () => {
      cancelled = true
    }
  }, [pages, sources])

  useEffect(() => {
    if (!selectedSourceId) return
    let cancelled = false
    async function loadFields() {
      setIsLoadingFields(true)
      const source = sources.get(selectedSourceId!)
      if (!source) return
      try {
        const detected = await detectFormFields(source.bytes)
        if (cancelled) return
        setFields(detected)
        setValues(Object.fromEntries(detected.map((f) => [f.name, f.value])))
      } catch {
        if (!cancelled) onError('Something went wrong while reading this form.')
      } finally {
        if (!cancelled) setIsLoadingFields(false)
      }
    }
    void loadFields()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSourceId])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleSave = async () => {
    if (!selectedSourceId || isSaving) return
    const source = sources.get(selectedSourceId)
    if (!source) return
    setIsSaving(true)
    try {
      const bytes = await fillAndFlattenForm(source.bytes, values)
      await onApply(selectedSourceId, bytes)
      onClose()
    } catch {
      onError('Something went wrong while filling this form. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 px-4 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="fill-form-title"
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 id="fill-form-title" className="text-base font-semibold text-slate-900">
            Fill form
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <IconX className="size-4.5" />
          </button>
        </div>

        {isScanning ? (
          <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
            <IconSpinner className="size-4" />
            Looking for fillable fields…
          </div>
        ) : formSources.length === 0 ? (
          <p className="mt-4 text-sm leading-relaxed text-slate-500">
            None of your loaded PDFs have a fillable form. This works with PDFs that have real AcroForm fields (text
            boxes, checkboxes, dropdowns) -- not plain documents.
          </p>
        ) : (
          <>
            {formSources.length > 1 && (
              <label className="mt-4 flex items-center gap-2 text-sm text-slate-600">
                Document
                <select
                  value={selectedSourceId ?? ''}
                  onChange={(e) => setSelectedSourceId(e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                >
                  {formSources.map((opt) => (
                    <option key={opt.sourceId} value={opt.sourceId}>
                      {opt.sourceName} ({opt.fieldCount} field{opt.fieldCount === 1 ? '' : 's'})
                    </option>
                  ))}
                </select>
              </label>
            )}

            {isLoadingFields ? (
              <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
                <IconSpinner className="size-4" />
                Loading fields…
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {fields.map((field) => (
                  <label key={field.name} className="block text-sm text-slate-700">
                    {field.type === 'checkbox' ? (
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={values[field.name] === true}
                          onChange={(e) => setValues((prev) => ({ ...prev, [field.name]: e.target.checked }))}
                          className="size-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400"
                        />
                        {field.name}
                      </span>
                    ) : (
                      <>
                        <span className="mb-1 block text-xs font-medium text-slate-500">{field.name}</span>
                        {field.type === 'text' ? (
                          <input
                            type="text"
                            value={typeof values[field.name] === 'string' ? (values[field.name] as string) : ''}
                            onChange={(e) => setValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
                            className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                          />
                        ) : (
                          <select
                            value={typeof values[field.name] === 'string' ? (values[field.name] as string) : ''}
                            onChange={(e) => setValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
                            className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                          >
                            <option value="">—</option>
                            {field.options?.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        )}
                      </>
                    )}
                  </label>
                ))}
              </div>
            )}

            <p className="mt-4 text-xs leading-relaxed text-slate-500">
              Applying will fill in these values and flatten the form (the fields become permanent, non-editable page
              content) across every page of this document.
            </p>
          </>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          {formSources.length > 0 && (
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving || isLoadingFields}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isSaving ? <IconSpinner className="size-4" /> : <IconClipboardList className="size-4" />}
              {isSaving ? 'Saving…' : 'Fill & flatten'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
