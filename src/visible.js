// Which key squares of a panel a Companion page shows. Pure, no Node imports.
import { drawnCells } from './vendor/panelrules.js';

// Companion's default page: 4 rows by 8 columns. Only the Generator and the pre-load placeholder keys use it.
export const COMPANION_GRID = { rows: 4, cols: 8 };

export const squareVariable = (r, c) => `key_${r}_${c}`;
// Names of the colour variables (0xRRGGBB numbers) that the generated buttons' layer expressions read.
export const squareBgVariable = (r, c) => `${squareVariable(r, c)}_bg`;
export const squareFgVariable = (r, c) => `${squareVariable(r, c)}_fg`;
// Picture variables: the Key picture (base64 image, empty when none), its opacity in percent, 1 when the Border and inset
// plate are drawn, and the Border width in percent of the key on each side (left, top, right, bottom).
export const squarePictureVariable = (r, c) => `${squareVariable(r, c)}_pic`;
export const squareOpacityVariable = (r, c) => `${squareVariable(r, c)}_op`;
export const squareInsetVariable = (r, c) => `${squareVariable(r, c)}_inset`;
export const SIDES = ['bl', 'bt', 'br', 'bb'];
export const squareSideVariable = (r, c, side) => `${squareVariable(r, c)}_${side}`;

// Key squares of the panel's drawn Cells in row order; root is true on a Cell's top-left square only.
export function visibleSquares(panel) {
  const out = [];
  for (const cell of drawnCells(panel)) {
    for (let r = cell.r; r < cell.r + cell.rs; r++) {
      for (let c = cell.c; c < cell.c + cell.cs; c++) {
        out.push({ r, c, cell, root: r === cell.r && c === cell.c });
      }
    }
  }
  return out.sort((a, b) => a.r - b.r || a.c - b.c);
}

// Every key square of the panel in row order: the drawn ones from visibleSquares plus blank ones (cell null, root false).
export function keySquares(panel) {
  const drawn = new Map(visibleSquares(panel).map((sq) => [`${sq.r},${sq.c}`, sq]));
  const out = [];
  for (let r = 1; r <= (panel.rows || 0); r++) {
    for (let c = 1; c <= (panel.cols || 0); c++) {
      out.push(drawn.get(`${r},${c}`) ?? { r, c, cell: null, root: false });
    }
  }
  return out;
}
