// The only file that knows Companion's page export shape, matched to a Companion 5.1.2 one-page export
// (test/fixtures/speedtest-export.companionconfig). Keep all format wrapping here.
import { COLOURS } from '../colours.js';
import {
  SIDES,
  squareVariable,
  squareBgVariable,
  squareFgVariable,
  squarePictureVariable,
  squareOpacityVariable,
  squareInsetVariable,
  squareSideVariable,
} from '../visible.js';

export const EXPORT_VERSION = 12;
export const COMPANION_BUILD = '5.1.2+10019-stable-98d5d4e1a1';
export const MODULE_ID = 'sode-panels';

// Companion wraps every option and layer property so it can hold an expression instead.
const val = (value) => ({ value, isExpression: false });
const expression = (value) => ({ value, isExpression: true });

const GEOMETRY = { x: val(0), y: val(0), width: val(100), height: val(100) };
const LAYER = (id, name, type, pinnedProperties) => ({ id, name, usage: 'auto', type, ...(pinnedProperties ? { pinnedProperties } : {}) });

// The Border widths shrink the inset plate and the picture to one frame; all zero means the whole key.
function layersOf({ text, bg, fg, pic, op, inset, bl, bt, br, bb }) {
  const frame = {
    x: expression(bl),
    y: expression(bt),
    width: expression(`100 - ${bl} - ${br}`),
    height: expression(`100 - ${bt} - ${bb}`),
  };
  const box = (id, name, over) => ({
    ...LAYER(id, name, 'box', ['color']),
    enabled: val(true),
    opacity: val(100),
    ...GEOMETRY,
    rotation: val(0),
    color: null,
    cornerRadius: val(0),
    borderWidth: val(0),
    borderColor: val(0),
    borderPosition: val('inside'),
    ...over,
  });
  return [
    { ...LAYER('canvas', 'Canvas', 'canvas'), decoration: val('none'), showStatusIcons: val('default') },
    // Border plate: the state colour over the whole key.
    box('box0', 'Background', { color: expression(bg) }),
    // Dark plate inside the Border, opaque only on keys with Artwork.
    box('box1', 'Inset', { color: val(COLOURS.blank), opacity: expression(`100 * ${inset}`), ...frame }),
    {
      ...LAYER('image0', 'Image', 'image', ['base64Image', 'halign', 'valign']),
      enabled: val(true),
      opacity: expression(op),
      ...GEOMETRY,
      ...frame,
      rotation: val(0),
      base64Image: expression(pic),
      halign: val('center'),
      valign: val('center'),
      fillMode: val('fit'),
    },
    {
      ...LAYER('text0', 'Text', 'text', ['text', 'fontsize', 'fontsizeAllowShrink', 'color', 'halign', 'valign']),
      enabled: val(true),
      opacity: val(100),
      ...GEOMETRY,
      rotation: val(0),
      text: val(text),
      color: expression(fg),
      halign: val('center'),
      valign: val('center'),
      fontsize: val(29.4),
      fontsizeAllowShrink: val(true),
      font: val('companion-sans'),
      weight: val('normal'),
      styles: val([]),
      outlineColor: val(4278190080),
    },
  ];
}

const refs = (label, r, c) => {
  const ref = (name) => `$(${label}:${name})`;
  const [bl, bt, br, bb] = SIDES.map((side) => ref(squareSideVariable(r, c, side)));
  return {
    text: ref(squareVariable(r, c)),
    bg: ref(squareBgVariable(r, c)),
    fg: ref(squareFgVariable(r, c)),
    pic: ref(squarePictureVariable(r, c)),
    op: ref(squareOpacityVariable(r, c)),
    inset: ref(squareInsetVariable(r, c)),
    bl,
    bt,
    br,
    bb,
  };
};

// Ids only need to be unique inside the file.
export function buttonOf({ r, c }, connectionId, label) {
  const at = { row: val(r), col: val(c) };
  const action = (event) => ({
    type: 'action',
    id: `${event}_${r}_${c}`,
    connectionId,
    definitionId: 'press',
    options: { ...at, event: val(event) },
    upgradeIndex: 0,
  });
  return {
    type: 'button-layered',
    // Changing fields are variable expressions the module keeps current; a layer field has no static fallback.
    style: { layers: layersOf(refs(label, r, c)) },
    options: { stepProgression: 'auto', stepExpression: '', rotaryActions: false, canModifyStyleInApis: false, notes: '' },
    feedbacks: [],
    steps: { 0: { action_sets: { down: [action('down')], up: [action('up')] }, options: { runWhileHeld: [] } } },
    localVariables: [],
  };
}

// The connection the buttons are bound to. The key is never written: the user sets it after the import.
const instanceOf = (label, config, moduleVersion) => ({
  moduleInstanceType: 'connection',
  moduleId: MODULE_ID,
  moduleVersionId: moduleVersion,
  updatePolicy: 'stable',
  sortOrder: 0,
  label,
  isFirstInit: false,
  config,
  secrets: {},
  lastUpgradeIndex: 0,
  enabled: true,
});

// Bound positions count from 1; Companion counts controls from 0, by row then column, as strings.
export function pageOf({ panel, grid, buttons, connectionId, label, connection, moduleVersion }) {
  const controls = {};
  for (const { r, c, button } of buttons) (controls[r - 1] ||= {})[c - 1] = button;
  return {
    version: EXPORT_VERSION,
    type: 'page',
    companionBuild: COMPANION_BUILD,
    page: {
      id: `sode_${panel.slug || panel.id}`,
      name: panel.name,
      controls,
      gridSize: { minColumn: 0, maxColumn: grid.cols - 1, minRow: 0, maxRow: grid.rows - 1 },
      pageVariables: [],
    },
    instances: { [connectionId]: instanceOf(label, { ...connection, panel: panel.slug || panel.id }, moduleVersion) },
    connectionCollections: [],
    oldPageNumber: 1,
    imageLibrary: [],
    imageLibraryCollections: [],
  };
}
