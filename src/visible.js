// Which key squares of a panel a Companion page shows. Shared by the runtime and the Generator. Pure, no Node imports.
import { cellsIn } from './vendor/panelrules.js';

// Companion's default page: 4 rows by 8 columns.
export const COMPANION_GRID = { rows: 4, cols: 8 };

// Name of the text variable that carries a key square's text.
export const squareVariable = (r, c) => `key_${r}_${c}`;

// Key squares inside the grid, counted from the top left, in row order. Squares past it are dropped without an error.
// A merged Cell keeps the squares that fit; root is true on its top-left square only.
export function visibleSquares(panel, grid = COMPANION_GRID) {
  const out = [];
  for (const cell of cellsIn(panel)) {
    for (let r = cell.r; r < cell.r + cell.rs; r++) {
      for (let c = cell.c; c < cell.c + cell.cs; c++) {
        if (r > grid.rows || c > grid.cols) continue;
        out.push({ r, c, cell, root: r === cell.r && c === cell.c });
      }
    }
  }
  return out.sort((a, b) => a.r - b.r || a.c - b.c);
}
