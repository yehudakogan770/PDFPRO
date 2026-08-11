# PDFPRO

**A complete PDF workstation that runs entirely in your browser.**

Merge, reorder, split, and print-format PDFs; build saddle-stitched booklets
and multi-up print layouts; stamp page numbers, watermarks, and corner marks;
drop in JPGs/PNGs as pages; and export back out as PDF or PNG — all without a
single byte ever leaving your device.

**Live app:** https://yehudakogan770.github.io/PDFPRO/

## Features

### Import
- Drag and drop PDFs, JPGs, or PNGs anywhere on the page, or click to browse
- Import any number of files at once, with per-file progress and per-file
  error reporting that doesn't block the rest of the batch
- Password-protected PDFs prompt for a password inline (with a clear
  incorrect-password message) instead of just failing to import
- Images are automatically placed on their own page, scaled to a sensible size
- Add blank pages, then drag them wherever you need extra space

### Organize
- Every page from every imported file shows up as a large, readable thumbnail
  in one grid, regardless of source file
- Drag and drop to reorder pages, across files, in any order (mouse, touch,
  and full keyboard support)
- Rotate (clockwise or counter-clockwise), duplicate, or remove individual
  pages
- Multi-select pages (click, Ctrl/Cmd+A, Escape to clear, or type a page
  range like `1-3,5` and hit "Select range") for bulk rotate, duplicate,
  remove, "save as image," "extract as PDF," or "extract text"
- Reverse the entire page order in one click
- Undo the last destructive change (remove / bulk remove / clear all / text
  edit) from a toast notification, or with Ctrl/Cmd+Z
- Click any page to open a full-size lightbox with prev/next paging through
  the whole document, plus rotate/edit-text/crop/save-as-image/remove
- Full keyboard shortcuts (press `?` for the full list): Ctrl/Cmd+Z undo,
  Ctrl/Cmd+A select all, Escape to deselect, Delete/Backspace to remove the
  current selection

### Edit page
- Click into any detected line of text on a page to edit it in place, or
  switch to "Add text" and click anywhere to insert something new
- Adjustable font size and color; edits are baked into a fresh copy of the
  page (covered and redrawn, not securely removed from the underlying file)
- "Add image" drops a PNG/JPG onto the page at the point you click, with a
  +/- stepper to resize it (aspect ratio locked)
- Hebrew text is fully supported (editing existing Hebrew lines and typing
  new ones), alongside the default Latin-script font
- Gracefully detects pages with no text layer (e.g. scanned images) and
  still lets you add new text or an image on top

### Crop
- Trim any page's visible margins from the lightbox, with a live preview
  of exactly what will be kept
- Non-destructive in the PDF sense (sets the page's CropBox), correctly
  accounts for the page's current rotation

### Fill Form
- Detects real AcroForm fields (text, checkboxes, dropdowns, radio groups,
  list boxes) in any loaded PDF and lists them with their current values
- Fill them in and flatten the form -- the values become permanent page
  content instead of editable fields

### Print Layout Studio
- **Normal** — no layout changes, just stamps/metadata
- **Booklet** — automatic saddle-stitch imposition: pages are reordered and
  paired two-per-sheet so a folded, stapled stack reads in order, with
  automatic blank-page padding when the count doesn't divide evenly
- **1-up / 2-up / 4-up** — scale every page onto a uniform paper size, one,
  two, or four to a sheet
- Paper size presets (A4, Letter, Legal) or a fully custom size in mm or
  inches
- Optional page numbers (6 positions, 3 formats), a diagonal watermark with
  custom text, and corner trim/alignment marks — all correctly oriented even
  on rotated pages
- Document title and author metadata embedded in the exported PDF
- Restrict any layout to just the currently-selected pages
- Print directly from the browser's print dialog, or download the generated
  PDF

### Compress
- Shrinks a PDF by rasterizing pages to JPEG at a chosen quality (High /
  Balanced / Smallest size), with an "only selected pages" toggle
- Reports the before/after size and warns when compression didn't actually
  help (common for already-compact, text-only PDFs)

### Split & export
- Split the current page set into one-PDF-per-page, or fixed-size chunks
  every N pages, each downloaded with a custom filename prefix
- Extract just the selected pages as their own PDF, or as a plain .txt file
  of their text content
- Export any page — or a whole multi-selection — as a high-resolution PNG
- Merge everything into a single PDF with a custom filename

### Privacy by design
- 100% client-side — there is no server, no upload, no analytics
- Your files never leave your device; closing the tab discards everything

## Getting started

```bash
npm install
npm run dev
```

Then open the printed local URL in your browser.

## Other commands

```bash
npm run build    # type-check and build for production
npm run preview  # preview the production build locally
npm run lint     # run ESLint
```

Pushes to `main` automatically build and deploy to GitHub Pages via
[`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml).

## Stack

- React 19 + TypeScript + Vite
- Tailwind CSS v4
- [pdf-lib](https://github.com/Hopding/pdf-lib) for building and stamping
  the output PDFs
- [pdf.js](https://github.com/mozilla/pdf.js) for rendering page thumbnails,
  previews, and PNG export
- [dnd-kit](https://dndkit.com/) for drag-and-drop page reordering
