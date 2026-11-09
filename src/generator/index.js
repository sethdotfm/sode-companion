// The Generator core: a grid size and a connection id in, a Companion page file out as plain data. Pure and
// deterministic, no Node imports. Format details live in export-format.js.
import { buttonOf, pageOf } from './export-format.js';

// Companion's page editor tops out well below this; the bound keeps a typo from writing a huge file.
export const MAX_GRID = 32;

const checkSize = (name, n) => {
  if (!Number.isInteger(n) || n < 1 || n > MAX_GRID) throw new RangeError(`${name} must be a whole number from 1 to ${MAX_GRID}.`);
};

// Every square is the same universal button bound to its row and column. label is the connection's label, which
// Companion's variable references use. connection is the host, port and tls written to the connection's config.
export function generatePage({ rows, cols }, connectionId, { label = connectionId, connection = {}, moduleVersion = '0.0.1' } = {}) {
  checkSize('rows', rows);
  checkSize('cols', cols);
  if (!connectionId) throw new RangeError('A connection id is required.');
  const buttons = [];
  for (let r = 1; r <= rows; r++) for (let c = 1; c <= cols; c++) buttons.push({ r, c, button: buttonOf({ r, c }, connectionId, label) });
  return pageOf({
    id: `sode_${rows}x${cols}`,
    name: `Sode ${rows}x${cols}`,
    grid: { rows, cols },
    buttons,
    connectionId,
    label,
    connection,
    moduleVersion,
  });
}
