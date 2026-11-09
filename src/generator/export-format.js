// The only file that knows Companion's page and button shapes. Companion's import format is undocumented, so
// this shape is a guess until a real 5.1.2 export is matched. Keep all format wrapping here.
import { squareVariable } from '../visible.js';

const WHITE = 0xffffff;
const BLACK = 0x000000;

export function buttonOf({ r, c }, connectionId, label) {
  const ref = { type: 'action', connectionId, definitionId: 'press', upgradeIndex: 0 };
  return {
    type: 'button-layered',
    style: {
      layers: [
        { id: 'background', type: 'box', color: BLACK },
        { id: 'text', type: 'text', text: `$(${label}:${squareVariable(r, c)})`, fontsize: 'auto', color: WHITE },
      ],
    },
    options: { stepProgression: 'auto', stepExpression: '' },
    feedbacks: [{ type: 'feedback', id: `look_${r}_${c}`, connectionId, definitionId: 'look', options: { row: r, col: c }, isInverted: false, upgradeIndex: 0 }],
    steps: {
      0: {
        action_sets: {
          down: [{ ...ref, id: `down_${r}_${c}`, options: { row: r, col: c, event: 'down' } }],
          up: [{ ...ref, id: `up_${r}_${c}`, options: { row: r, col: c, event: 'up' } }],
        },
        options: { runWhileHeld: [] },
      },
    },
    localVariables: [],
  };
}

export function pageOf(name, grid, buttons) {
  const controls = {};
  for (const { r, c, button } of buttons) (controls[r] ||= {})[c] = button;
  return { name, gridSize: { rows: grid.rows, columns: grid.cols }, controls };
}
