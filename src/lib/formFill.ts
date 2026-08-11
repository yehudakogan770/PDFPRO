import { PDFCheckBox, PDFDocument, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFTextField } from 'pdf-lib'

export type FormFieldValue = string | boolean

export interface FormFieldInfo {
  name: string
  type: 'text' | 'checkbox' | 'dropdown' | 'radio' | 'list'
  options?: string[]
  value: FormFieldValue
}

/** Lists the fillable fields in a PDF's AcroForm, with their current values.
 * Returns an empty array for PDFs with no form (or an unsupported field type
 * for every field, e.g. signature-only forms). */
export async function detectFormFields(bytes: ArrayBuffer): Promise<FormFieldInfo[]> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const form = doc.getForm()
  const fields: FormFieldInfo[] = []

  for (const field of form.getFields()) {
    const name = field.getName()
    if (field instanceof PDFTextField) {
      fields.push({ name, type: 'text', value: field.getText() ?? '' })
    } else if (field instanceof PDFCheckBox) {
      fields.push({ name, type: 'checkbox', value: field.isChecked() })
    } else if (field instanceof PDFDropdown) {
      fields.push({ name, type: 'dropdown', options: field.getOptions(), value: field.getSelected()[0] ?? '' })
    } else if (field instanceof PDFRadioGroup) {
      fields.push({ name, type: 'radio', options: field.getOptions(), value: field.getSelected() ?? '' })
    } else if (field instanceof PDFOptionList) {
      fields.push({ name, type: 'list', options: field.getOptions(), value: field.getSelected()[0] ?? '' })
    }
  }

  return fields
}

/** Fills the given field values into the PDF's form and flattens it (bakes
 * the values into the page content and removes interactivity), returning the
 * resulting bytes. Unknown field names in `values` are ignored. */
export async function fillAndFlattenForm(bytes: ArrayBuffer, values: Record<string, FormFieldValue>): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const form = doc.getForm()

  for (const field of form.getFields()) {
    const name = field.getName()
    if (!(name in values)) continue
    const value = values[name]

    if (field instanceof PDFTextField && typeof value === 'string') {
      field.setText(value)
    } else if (field instanceof PDFCheckBox && typeof value === 'boolean') {
      if (value) field.check()
      else field.uncheck()
    } else if (field instanceof PDFDropdown && typeof value === 'string' && value) {
      field.select(value)
    } else if (field instanceof PDFRadioGroup && typeof value === 'string' && value) {
      field.select(value)
    } else if (field instanceof PDFOptionList && typeof value === 'string' && value) {
      field.select(value)
    }
  }

  form.flatten()
  return doc.save()
}
