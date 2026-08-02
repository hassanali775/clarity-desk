// lib/parsers/pdf-polyfills.ts
//
// pdfjs-dist's display build references the browser-only `DOMMatrix` global at
// MODULE SCOPE (`const SCALE_MATRIX = new DOMMatrix()` in its canvas module).
// In Node/Vercel's serverless runtime that global does not exist, and pdfjs's
// own fallback (require("@napi-rs/canvas")) is unavailable there, so module
// evaluation throws `ReferenceError: DOMMatrix is not defined` before
// getDocument() ever runs.
//
// This module installs a spec-compliant, pure-JS DOMMatrix (and Path2D, for
// parity with pdfjs's own Node polyfill path) BEFORE pdfjs is imported — see
// pdf.ts, where this module MUST stay as the first import. Text extraction
// never renders, so ImageData (only used by render paths) is intentionally not
// polyfilled; that was verified against pdfjs-dist 6.1.200.
//
// Both packages are tiny, pure-JS, MIT, and have no native bindings:
//   - dommatrix -> DOMMatrix/CSSMatrix (the polyfill pdfjs's maintainers used
//     for Node; pdf.js PR #13530)
//   - path2d    -> Path2D (the polyfill pdfjs uses for Node rendering; pdf.js
//     PR #17830)

import CSSMatrix from 'dommatrix';
import { Path2D } from 'path2d';

const globals = globalThis as unknown as { DOMMatrix?: unknown; Path2D?: unknown };

if (!globals.DOMMatrix) {
  globals.DOMMatrix = CSSMatrix;
}
if (!globals.Path2D) {
  globals.Path2D = Path2D;
}
