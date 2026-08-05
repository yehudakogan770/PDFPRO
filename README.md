# PDFPRO

Merge multiple PDFs into one. Import any number of files, drag pages into any
order, rotate or remove individual pages, then download the combined PDF.

Everything runs client-side in the browser — files are never uploaded to a
server.

## Features

- Import multiple PDF files at once (click to browse or drag & drop, including
  dropping anywhere on the page)
- Every page from every imported file shows up as a thumbnail in one grid
- Drag and drop to reorder pages, across files, in any order
- Rotate or remove individual pages
- Add more PDFs at any time before exporting
- Merge everything into a single PDF and download it with a custom filename

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

## Stack

- React + TypeScript + Vite
- Tailwind CSS
- [pdf-lib](https://github.com/Hopding/pdf-lib) for merging pages into the output PDF
- [pdf.js](https://github.com/mozilla/pdf.js) for rendering page thumbnails
- [dnd-kit](https://dndkit.com/) for drag-and-drop page reordering
