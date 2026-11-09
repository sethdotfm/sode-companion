// Key colours shared by the module's look feedback and the Generator's default backgrounds. Pure, no Node imports.
// Dark-theme patchbay tokens from Sode's web/vendor/patchbay/css/patchbay.tokens.css; the idle pair is the oklab mix Sode's CSS uses.
const GREEN = 0x5ccf8f;
const ORANGE = 0xe8673c;
const AMBER = 0xf2b84b;
const RED = 0xf0605a;
const GREY = 0x9b958c;
const CONTROL = 0x1e1e1e;
const HOVER = 0x2c2c2c;
// Darker than CONTROL so a square with no Cell reads as unused beside an idle Take.
const BLANK = 0x111111;

export const WHITE = 0xffffff;
const DARK_TEXT = 0x14131f;

// One colour per Cell kind (idle), then the state classes the runtime's look() can return.
export const COLOURS = {
  source: 0x314739,
  'source-current': GREEN,
  'source-pending': GREEN,
  destination: 0x4e3229,
  'destination-view': ORANGE,
  'destination-staged': ORANGE,
  take: CONTROL,
  'take-armed': RED,
  'take-confirm': AMBER,
  preset: HOVER,
  'preset-pending': ORANGE,
  unavailable: CONTROL,
  clear: HOVER,
  current: CONTROL,
  'result-connected': GREEN,
  'result-already': GREY,
  'result-failed': RED,
  error: RED,
  offline: HOVER,
  blank: BLANK,
  none: 0x000000,
};

export const channelsOf = (rgb) => [16, 8, 0].map((s) => (rgb >> s) & 255);
export const rgbOf = ([r, g, b]) => (r << 16) | (g << 8) | b;

// Dark text on a light accent, white on a dark one.
export const textOn = (rgb) => {
  const [r, g, b] = channelsOf(rgb);
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? DARK_TEXT : WHITE;
};

// RED sits just under the luminance cut (white would be 3.2:1); dark text is 5.8:1.
const TEXT_OVERRIDE = { 'take-armed': DARK_TEXT };
export const textFor = (colour) => TEXT_OVERRIDE[colour] ?? textOn(COLOURS[colour] ?? COLOURS.none);
