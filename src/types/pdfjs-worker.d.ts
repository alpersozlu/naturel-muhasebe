// pdf.js ships no typings for its worker build; it is imported only for its
// side effect (it registers itself on globalThis.pdfjsWorker).
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs";
