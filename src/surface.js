// The Companion shell's logic without Companion's classes, so tests can drive it with a fake host.
// main.js is the only file that imports @companion-module/base.
import {
  COMPANION_GRID,
  SIDES,
  squareVariable,
  squareBgVariable,
  squareFgVariable,
  squarePictureVariable,
  squareInsetVariable,
  squareSideVariable,
} from './visible.js';
import { pulseLevel } from './timing.js';
import { COLOURS, textOn, textFor } from './colours.js';

export { COLOURS };

const channels = (fn) => [16, 8, 0].reduce((out, shift) => out | (fn(shift) << shift), 0);
const scale = (rgb, f) => channels((sh) => Math.round(((rgb >> sh) & 255) * f));
const blend = (a, b, t) => channels((sh) => Math.round(((a >> sh) & 255) * (1 - t) + ((b >> sh) & 255) * t));

// A pulse phase dims the state colour; 0 is steady.
const bgOf = ({ colour, pulse }) => {
  const rgb = COLOURS[colour] ?? COLOURS.none;
  return pulse ? scale(rgb, pulseLevel(pulse)) : rgb;
};

// A hold's fill is shown as the Take colour shifting to its armed colour; Companion has no partial fill for a button.
export function styleOf(look) {
  const bg = bgOf(look);
  const bgcolor = look.fill === undefined ? bg : blend(bg, COLOURS['take-armed'], look.fill);
  // Text colour follows the undimmed state colour so a pulse never flips it.
  return { text: look.text, color: textFor(look.colour), bgcolor };
}

const WHERE = [
  { id: 'row', type: 'number', label: 'Row', default: 1, min: 1, max: 99 },
  { id: 'col', type: 'number', label: 'Column', default: 1, min: 1, max: 99 },
];

// runtimeOf returns the live runtime, which a reconfigure replaces.
export const actionDefinitions = (runtimeOf) => ({
  press: {
    name: 'Press a panel key square',
    options: [
      ...WHERE,
      {
        id: 'event',
        type: 'dropdown',
        label: 'Event',
        default: 'down',
        choices: [
          { id: 'down', label: 'Down' },
          { id: 'up', label: 'Up' },
        ],
      },
    ],
    callback: async ({ options }) => {
      const runtime = runtimeOf();
      if (options.event === 'up') runtime?.release(options.row, options.col);
      else await runtime?.press(options.row, options.col);
    },
  },
});

export const feedbackDefinitions = (runtimeOf) => ({
  look: {
    type: 'advanced',
    name: 'Look of a panel key square',
    description: 'Text and colour of the Cell at this row and column of the panel.',
    options: WHERE,
    affectedProperties: ['text', 'color', 'bgcolor'],
    callback: ({ options }) => {
      const look = runtimeOf()?.look(options.row, options.col);
      return look ? styleOf(look) : {};
    },
  },
});

const FIXED_VARIABLES = {
  viewed: { name: 'Viewed destination' },
  current: { name: 'Current source of the viewed destination' },
  staged: { name: 'Staged route count' },
  error: { name: 'Last error' },
  router: { name: 'Router status (up, down or unknown)' },
};

const variableDefinitionsOf = (squares) => {
  const defs = { ...FIXED_VARIABLES };
  for (const { r, c } of squares) {
    defs[squareVariable(r, c)] = { name: `Text of row ${r} column ${c}` };
    defs[squareBgVariable(r, c)] = { name: `Background colour of row ${r} column ${c}` };
    defs[squareFgVariable(r, c)] = { name: `Text colour of row ${r} column ${c}` };
    defs[squarePictureVariable(r, c)] = { name: `Key picture of row ${r} column ${c}` };
    defs[squareInsetVariable(r, c)] = { name: `Border and inset drawn at row ${r} column ${c} (1 or 0)` };
    for (const side of SIDES) defs[squareSideVariable(r, c, side)] = { name: `Border width (%) ${side} of row ${r} column ${c}` };
  }
  return defs;
};

// Layer expressions cannot fall back to a static value, so until a panel loads the whole default grid holds blank colours.
const PLACEHOLDER = { text: '', colour: 'blank', pulse: 0 };
const placeholderSquares = () => {
  const out = [];
  for (let r = 1; r <= COMPANION_GRID.rows; r++) for (let c = 1; c <= COMPANION_GRID.cols; c++) out.push({ r, c });
  return out;
};

// Hand-built buttons use the look feedback over this style; generated pages read the colour variables instead.
const presetsOf = (cells, label) => {
  const presets = {};
  for (const cell of cells) {
    const where = { row: cell.r, col: cell.c };
    presets[`cell_${cell.r}_${cell.c}`] = {
      type: 'simple',
      name: `Row ${cell.r} column ${cell.c}: ${cell.kind}`,
      style: {
        text: `$(${label}:${squareVariable(cell.r, cell.c)})`,
        size: 'auto',
        color: textOn(COLOURS[cell.kind] ?? COLOURS.none),
        bgcolor: COLOURS[cell.kind] ?? COLOURS.none,
      },
      steps: [
        {
          down: [{ actionId: 'press', options: { ...where, event: 'down' } }],
          up: [{ actionId: 'press', options: { ...where, event: 'up' } }],
        },
      ],
      feedbacks: [{ feedbackId: 'look', options: where }],
    };
  }
  return presets;
};

// host: the Companion calls the surface makes. label: the connection's label, which variable references use.
export function createSurface({ runtime, host, label }) {
  const shapeOf = () => JSON.stringify([runtime.grid(), runtime.cells()]);
  let shape = null;
  let hasPresets = false;
  let sent = {};
  const loaded = () => runtime.grid().rows > 0;
  const squaresOf = () => (loaded() ? runtime.squares() : placeholderSquares());

  // Text variables plus a colour pair per key square, from the same look the feedback styles.
  const valuesOf = () => {
    const out = runtime.variables();
    for (const { r, c } of squaresOf()) {
      const look = loaded() ? runtime.look(r, c) : PLACEHOLDER;
      const style = styleOf(look);
      out[squareVariable(r, c)] ??= look.text;
      out[squareBgVariable(r, c)] = style.bgcolor;
      out[squareFgVariable(r, c)] = style.color;
      out[squarePictureVariable(r, c)] = '';
      out[squareInsetVariable(r, c)] = 0;
      for (const side of SIDES) out[squareSideVariable(r, c, side)] = 0;
    }
    return out;
  };

  return {
    // Called on every runtime change, pulse steps included, so rebuilding is gated on the shape.
    sync() {
      const { code, text } = runtime.status();
      host.updateStatus(code, text);
      const now = shapeOf();
      if (now !== shape) {
        shape = now;
        sent = {};
        const cells = runtime.cells();
        host.setVariableDefinitions(variableDefinitionsOf(squaresOf()));
        if (cells.length || hasPresets) {
          hasPresets = cells.length > 0;
          host.setPresetDefinitions(
            [{ id: 'cells', name: 'Panel cells', definitions: cells.map((c) => `cell_${c.r}_${c.c}`) }],
            presetsOf(cells, label),
          );
        }
      }
      const values = valuesOf();
      const changed = Object.fromEntries(Object.entries(values).filter(([id, v]) => sent[id] !== v));
      if (Object.keys(changed).length) host.setVariableValues(changed);
      sent = values;
      host.checkFeedbacks('look');
    },
  };
}
