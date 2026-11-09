// The Generator core: a panel and a connection id in, a Companion page out. Pure, no Node imports,
// so it can move into Sode. Format details live in export-format.js.
import { COMPANION_GRID, visibleSquares } from '../visible.js';
import { buttonOf, pageOf } from './export-format.js';

// label is the connection's label, which Companion's variable references use. Pass it so the text layers resolve.
export function generatePage(panel, connectionId, { grid = COMPANION_GRID, label = connectionId } = {}) {
  const buttons = visibleSquares(panel, grid).map((sq) => ({ r: sq.r, c: sq.c, button: buttonOf(sq, connectionId, label) }));
  return pageOf(panel.name, grid, buttons);
}
