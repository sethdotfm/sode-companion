// Artwork bytes in, Key picture out, with pure-JavaScript decoders so the packaging tool needs no native addon.
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { GifReader } from 'omggif';

const KEY_SIZE = 72;
// Sode refuses artwork over 1 MB. A small file can still declare a huge canvas, so the pixel cap is checked from the PNG and GIF
// headers before any pixels are allocated; jpeg-js enforces it itself.
export const MAX_BYTES = 1024 * 1024;
const MAX_PIXELS = 16_000_000;

const startsWith = (bytes, ...sig) => sig.every((b, i) => bytes[i] === b);

const overCap = (w, h) => w * h > MAX_PIXELS;

// RGBA pixels of a PNG, JPEG or GIF (first frame), or null for any other kind or one over the pixel cap. The type comes from the bytes, as in Sode.
function decode(bytes) {
  if (startsWith(bytes, 0x89, 0x50, 0x4e, 0x47)) {
    // IHDR width and height, big-endian, right after the signature and chunk header.
    const head = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.length, 24));
    if (head.length < 24 || overCap(head.readUInt32BE(16), head.readUInt32BE(20))) return null;
    const img = PNG.sync.read(Buffer.from(bytes));
    return { width: img.width, height: img.height, data: img.data };
  }
  if (startsWith(bytes, 0xff, 0xd8, 0xff)) {
    const img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: MAX_PIXELS / 1e6 });
    return { width: img.width, height: img.height, data: img.data };
  }
  if (startsWith(bytes, 0x47, 0x49, 0x46, 0x38)) {
    // Logical screen width and height, little-endian, after the 6 byte signature.
    if (bytes.length < 10 || overCap(bytes[6] | (bytes[7] << 8), bytes[8] | (bytes[9] << 8))) return null;
    const reader = new GifReader(bytes);
    const data = new Uint8Array(reader.width * reader.height * 4);
    reader.decodeAndBlitFrameRGBA(0, data);
    return { width: reader.width, height: reader.height, data };
  }
  return null;
}

// Area-averaged scale into the middle of a transparent canvas, so the whole picture fits and nothing is cropped.
function fitRaw({ width, height, data }, cw, ch) {
  const scale = Math.min(cw / width, ch / height);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const x0 = Math.floor((cw - w) / 2);
  const y0 = Math.floor((ch - h) / 2);
  const out = new PNG({ width: cw, height: ch });
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor((y * height) / h);
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * height) / h));
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor((x * width) / w);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * width) / w));
      // Premultiplied, so a transparent pixel does not tint its neighbours.
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = sy0; sy < sy1; sy++)
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * width + sx) * 4;
          const pa = data[i + 3];
          r += data[i] * pa;
          g += data[i + 1] * pa;
          b += data[i + 2] * pa;
          a += pa;
        }
      const n = (sy1 - sy0) * (sx1 - sx0);
      const o = ((y0 + y) * cw + x0 + x) * 4;
      if (a > 0) out.data.set([Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round(a / n)], o);
    }
  }
  return out;
}

const fit = (img, size) => PNG.sync.write(fitRaw(img, size, size));

function crop(src, x0, y0, x1, y1) {
  const out = new PNG({ width: x1 - x0, height: y1 - y0 });
  for (let y = y0; y < y1; y++) src.data.copy(out.data, (y - y0) * out.width * 4, (y * src.width + x0) * 4, (y * src.width + x1) * 4);
  return out;
}

const bandOf = (borderPercent) => Math.round((borderPercent / 100) * KEY_SIZE);

// Each square of an rs by cs group as a rectangle in px, with the group drawn at KEY_SIZE per square. The Border band is cut
// off the group's outer edges, so an edge square is that much smaller. Neighbouring rectangles abut exactly.
function tilesOf({ rs, cs, border }) {
  const band = bandOf(border);
  const [gw, gh] = [cs * KEY_SIZE, rs * KEY_SIZE];
  const rows = [];
  for (let i = 0; i < rs; i++) {
    const row = [];
    for (let j = 0; j < cs; j++) {
      row.push({
        x0: Math.max(j * KEY_SIZE, band),
        x1: Math.min((j + 1) * KEY_SIZE, gw - band),
        y0: Math.max(i * KEY_SIZE, band),
        y1: Math.min((i + 1) * KEY_SIZE, gh - band),
      });
    }
    rows.push(row);
  }
  return { rows, band, inner: [gw - 2 * band, gh - 2 * band] };
}

// Sode sniffs SVG the same way: optional BOM, prolog, doctype and comments, then an svg root.
const SVG_START = /^(?:\uFEFF)?\s*(?:<\?xml[^>]*\?>\s*|<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<svg[\s>/]/i;
const isSvg = (bytes) => SVG_START.test(Buffer.from(bytes.subarray(0, 2048)).toString('utf8'));
export const svgDataUrl = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

// { svg: bytes } or { img: RGBA pixels }, or null when too large, unsupported or over the pixel cap. Throws on a corrupt file.
function read(bytes) {
  if (bytes.length > MAX_BYTES) return null;
  if (isSvg(bytes)) return { svg: bytes };
  const img = decode(bytes);
  return img && { img };
}

// The Key picture, or null when the bytes are too large, are not a supported image or do not decode.
// Rasters come back as raw base64 of a PNG. An SVG is passed on undecoded as a data URL for Companion to draw; the module never parses or runs it.
export function keyPicture(bytes, size = KEY_SIZE) {
  try {
    const file = read(bytes);
    if (!file) return null;
    return file.svg ? svgDataUrl(file.svg) : fit(file.img, size).toString('base64');
  } catch {
    return null;
  }
}

const attrOf = (name) => new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
const ROOT_ATTRS = /\s(?:viewBox|width|height|preserveAspectRatio)\s*=\s*(?:"[^"]*"|'[^']*')/gi;
// Only a bare number or px has a ratio to the view box units; a percentage or other unit cannot be cropped against.
const plainSize = (v) => {
  const m = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*(?:px)?\s*$/i.exec(v ?? '');
  return m ? Number(m[1]) : NaN;
};

// The first ">" outside quotes, since an attribute value may hold one.
function tagEnd(text, from) {
  let quote = '';
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '>') return i;
  }
  return -1;
}

// One data URL per square of the group, each with a root view box that shows only the part under that square. The picture fits
// the group inside the Border band as it would on one key. Null when the root has neither a view box nor a plain width and height.
export function cropSvg(text, geometry) {
  const open = SVG_START.exec(text);
  if (!open) return null;
  // The match ends in "<svg" plus one more character.
  const start = open[0].length - 5;
  const end = tagEnd(text, start);
  if (end < 0) return null;
  let root = text.slice(start, end);
  const selfClosing = /\/\s*$/.test(root);
  if (selfClosing) root = root.replace(/\s*\/\s*$/, '');
  const read = (name) => {
    const m = attrOf(name).exec(root);
    return m ? (m[1] ?? m[2]) : undefined;
  };
  let [vx, vy, vw, vh] = (read('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (!(vw > 0 && vh > 0)) {
    [vx, vy, vw, vh] = [0, 0, plainSize(read('width')), plainSize(read('height'))];
    if (!(vw > 0 && vh > 0)) return null;
  }
  const { rows, band, inner } = tilesOf(geometry);
  const s = Math.min(inner[0] / vw, inner[1] / vh);
  const [ox, oy] = [band + (inner[0] - vw * s) / 2, band + (inner[1] - vh * s) / 2];
  const bare = root.replace(ROOT_ATTRS, '');
  return rows.map((row) =>
    row.map((t) => {
      const view = [vx + (t.x0 - ox) / s, vy + (t.y0 - oy) / s, (t.x1 - t.x0) / s, (t.y1 - t.y0) / s].map((n) => Number(n.toFixed(4)));
      const tag = `${bare} viewBox="${view.join(' ')}" width="${t.x1 - t.x0}" height="${t.y1 - t.y0}"${selfClosing ? '/' : ''}`;
      return svgDataUrl(text.slice(0, start) + tag + text.slice(end));
    }),
  );
}

// The Key pictures of a merged Cell as rows of columns, or null when the bytes cannot be shown. geometry is
// { rs, cs, border } with the Border in percent of a key. Rasters are cropped to each square; an SVG gets a narrower view box.
export function keyPictures(bytes, geometry) {
  try {
    const file = read(bytes);
    if (!file) return null;
    if (file.svg) return cropSvg(Buffer.from(file.svg).toString('utf8'), geometry);
    const { rows, band, inner } = tilesOf(geometry);
    const fitted = fitRaw(file.img, inner[0], inner[1]);
    return rows.map((row) =>
      row.map((t) => PNG.sync.write(crop(fitted, t.x0 - band, t.y0 - band, t.x1 - band, t.y1 - band)).toString('base64')),
    );
  } catch {
    return null;
  }
}
