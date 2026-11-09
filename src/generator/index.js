// The Generator core: a panel and a connection id in, a Companion page file out as plain data. Pure, no Node imports,
// so it can move into Sode. Format details live in export-format.js.
import { COMPANION_GRID, keySquares } from '../visible.js';
import { buttonOf, pageOf } from './export-format.js';

// label is the connection's label, which Companion's variable references use. connection is the host, port and tls
// written to the connection's config. moduleVersion is the module version the connection is recorded against.
export function generatePage(
  panel,
  connectionId,
  { grid = COMPANION_GRID, label = connectionId, connection = {}, moduleVersion = '0.0.1' } = {},
) {
  const buttons = keySquares(panel, grid).map((sq) => ({ r: sq.r, c: sq.c, button: buttonOf(sq, connectionId, label) }));
  return pageOf({ panel, grid, buttons, connectionId, label, connection, moduleVersion });
}
