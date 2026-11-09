// Artwork bytes in, Key picture out, with pure-JavaScript decoders so the packaging tool needs no native addon.
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { GifReader } from 'omggif';

export const KEY_SIZE = 72;
// Sode refuses artwork over 1 MB; the pixel cap keeps a small file with a huge canvas from exhausting memory.
export const MAX_BYTES = 1024 * 1024;
const MAX_PIXELS = 16_000_000;

const startsWith = (bytes, ...sig) => sig.every((b, i) => bytes[i] === b);

// RGBA pixels of a PNG, JPEG or GIF (first frame), or null for any other kind. The type comes from the bytes, as in Sode.
function decode(bytes) {
  if (startsWith(bytes, 0x89, 0x50, 0x4e, 0x47)) {
    const img = PNG.sync.read(Buffer.from(bytes));
    return { width: img.width, height: img.height, data: img.data };
  }
  if (startsWith(bytes, 0xff, 0xd8, 0xff)) {
    const img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: MAX_PIXELS / 1e6 });
    return { width: img.width, height: img.height, data: img.data };
  }
  if (startsWith(bytes, 0x47, 0x49, 0x46, 0x38)) {
    const reader = new GifReader(bytes);
    const data = new Uint8Array(reader.width * reader.height * 4);
    reader.decodeAndBlitFrameRGBA(0, data);
    return { width: reader.width, height: reader.height, data };
  }
  return null;
}

// Area-averaged scale into the middle of a size by size transparent square, so the whole picture fits and nothing is cropped.
function fit({ width, height, data }, size) {
  const scale = Math.min(size / width, size / height);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const x0 = Math.floor((size - w) / 2);
  const y0 = Math.floor((size - h) / 2);
  const out = new PNG({ width: size, height: size });
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
      const o = ((y0 + y) * size + x0 + x) * 4;
      if (a > 0) out.data.set([Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round(a / n)], o);
    }
  }
  return PNG.sync.write(out);
}

// Sode sniffs SVG the same way: optional BOM, prolog, doctype and comments, then an svg root.
const SVG_START = /^(?:\uFEFF)?\s*(?:<\?xml[^>]*\?>\s*|<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<svg[\s>/]/i;
const isSvg = (bytes) => SVG_START.test(Buffer.from(bytes.subarray(0, 2048)).toString('utf8'));

// The Key picture, or null when the bytes are too large, are not a supported image or do not decode.
// Rasters come back as raw base64 of a PNG. An SVG is passed on undecoded as a data URL for Companion to draw; the module never parses or runs it.
export function keyPicture(bytes, size = KEY_SIZE) {
  if (bytes.length > MAX_BYTES) return null;
  if (isSvg(bytes)) return `data:image/svg+xml;base64,${Buffer.from(bytes).toString('base64')}`;
  try {
    const img = decode(bytes);
    if (!img || img.width * img.height > MAX_PIXELS) return null;
    return fit(img, size).toString('base64');
  } catch {
    return null;
  }
}
