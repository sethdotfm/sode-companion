// The Key picture of each key square: fetched Artwork, Icon A and Icon B. See AGENTS.md for the rules.
import { keyPicture, keyPictures, cropSvg, svgDataUrl, MAX_BYTES } from './artwork.js';
import { iconMarkup, glyphOf, iconSvg } from './icons.js';
import { textFor, WHITE } from './colours.js';

// Sode's pattern for an artwork id (web/panellook.js); any other art string is an icon or dropped.
const ART_ID = /^a-[0-9a-f]{8}$/;
// Percent of the key.
const BORDER_PERCENT = 8;
const PICTURE_OPACITY = 30;

const artIdOf = (cell) => (typeof cell.art === 'string' && ART_ID.test(cell.art) ? cell.art : '');
const sizeOf = (cell) => ({ rs: cell.rs ?? 1, cs: cell.cs ?? 1 });

// The square at (r, c) of a Cell's group from cut(rs, cs), which gives rows of columns or null when the group cannot be cut.
const squareOf = (cell, r, c, cut) => {
  const { rs, cs } = sizeOf(cell);
  return cut(rs, cs)?.[r - cell.r]?.[c - cell.c];
};

const edgesOf = (cell, r, c) => {
  const { rs, cs } = sizeOf(cell);
  return { bl: c === cell.c, bt: r === cell.r, br: c === cell.c + cs - 1, bb: r === cell.r + rs - 1 };
};

// Sode hides text only under art or a valid Icon B, so a Cell with neither keeps its label. Any art string counts, valid or
// not, so a bad id or icon name does not bring the label back.
export const textHidden = (cell) => cell.hideText === true && ((typeof cell.art === 'string' && cell.art !== '') || glyphOf(cell) !== '');

// request(path) is the runtime's authenticated GET; changed() tells it a picture arrived.
export function createPictures({ request, changed }) {
  // Artwork by art id: its bytes, the picture for one key square, and the crops made per merged group size.
  const loaded = new Map();
  const fetching = new Set();
  let drawn = [];
  let stopped = false;

  async function fetchArtwork(panelId, id) {
    fetching.add(id);
    let entry = null;
    try {
      const res = await request(`panels/${encodeURIComponent(panelId)}/artwork/${id}`);
      // The header is checked before the body so an oversize file is never buffered.
      if (res.ok && !(Number(res.headers.get('content-length')) > MAX_BYTES)) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        const single = keyPicture(bytes);
        if (single) entry = { bytes, single, groups: new Map() };
      }
    } catch {
      // Any failure leaves the key plain; the next applied panel tries again.
    }
    fetching.delete(id);
    // A panel applied meanwhile may have dropped the id.
    if (stopped || !entry || !drawn.some((cell) => artIdOf(cell) === id)) return;
    loaded.set(id, entry);
    changed();
  }

  const artworkAt = (cell, r, c) => {
    const entry = loaded.get(artIdOf(cell));
    if (!entry) return undefined;
    return squareOf(cell, r, c, (rs, cs) => {
      if (rs === 1 && cs === 1) return [[entry.single]];
      const id = `${rs}x${cs}`;
      if (!entry.groups.has(id)) entry.groups.set(id, keyPictures(entry.bytes, { rs, cs, border: BORDER_PERCENT }));
      return entry.groups.get(id);
    });
  };

  return {
    // Each id is fetched once; ids no Cell names any more are dropped, and failed ones retry on the next call.
    sync(panelId, cells) {
      drawn = cells;
      const wanted = new Set(cells.map(artIdOf).filter(Boolean));
      for (const id of [...loaded.keys()]) if (!wanted.has(id)) loaded.delete(id);
      for (const id of wanted) if (!loaded.has(id) && !fetching.has(id)) fetchArtwork(panelId, id);
    },
    // The picture of one square with its Border, edges and opacity, or {}. An Icon keeps the solid fill, so it has no Border.
    at(cell, r, c, colour) {
      const opacity = textHidden(cell) ? 100 : PICTURE_OPACITY;
      const edges = edgesOf(cell, r, c);
      const artwork = artworkAt(cell, r, c);
      if (artwork) return { picture: artwork, border: BORDER_PERCENT, edges, opacity };
      const markup = iconMarkup(cell.art);
      // Icon B is text, so it cannot share a raster Artwork picture; beside Artwork it is not drawn.
      const glyph = artIdOf(cell) ? '' : glyphOf(cell);
      if (!markup && !glyph) return {};
      const svg = iconSvg(markup, glyph, cell.hideText === true ? WHITE : textFor(colour));
      const picture = squareOf(cell, r, c, (rs, cs) => (rs === 1 && cs === 1 ? [[svgDataUrl(svg)]] : cropSvg(svg, { rs, cs, border: 0 })));
      return picture ? { picture, border: 0, edges, opacity } : {};
    },
    stop() {
      stopped = true;
    },
  };
}
