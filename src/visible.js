// Which key squares of a panel a Companion page shows. Shared by the runtime and the Generator. Pure, no Node imports.
import { cellsIn } from './vendor/panelrules.js';

// Companion's default page: 4 rows by 8 columns.
export const COMPANION_GRID = { rows: 4, cols: 8 };

// Name of the text variable that carries a key square's text.
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

// Every key square of the panel inside the grid, in row order: the drawn ones from visibleSquares plus blank ones
// (cell null, root false) where no drawn Cell sits. Squares outside the panel's own rows and columns are not included.
export function keySquares(panel, grid = COMPANION_GRID) {
  const drawn = new Map(visibleSquares(panel, grid).map((sq) => [`${sq.r},${sq.c}`, sq]));
  const out = [];
  for (let r = 1; r <= Math.min(panel.rows || 0, grid.rows); r++) {
    for (let c = 1; c <= Math.min(panel.cols || 0, grid.cols); c++) {
      out.push(drawn.get(`${r},${c}`) ?? { r, c, cell: null, root: false });
    }
  }
  return out;
}
