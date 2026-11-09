// Builds small test images and reads back what the module publishes. The PNG library is the module's own.
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { GifWriter } from 'omggif';

// paint(x, y) returns [r, g, b].
const pixels = (w, h, paint) => {
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = paint(x, y);
      data.set([r, g, b, 255], (y * w + x) * 4);
    }
  return data;
};

export const png = (w, h, paint) => {
  const img = new PNG({ width: w, height: h });
  pixels(w, h, paint).copy(img.data);
  return PNG.sync.write(img);
};

export const jpg = (w, h, paint) => Buffer.from(jpeg.encode({ width: w, height: h, data: pixels(w, h, paint) }, 95).data);

// Two-colour GIF: paint returns 0 or 1 for the palette entries a and b.
export const gif = (w, h, paint, a, b) => {
  const out = Buffer.alloc(w * h + 1000);
  const rgb = (c) => (c[0] << 16) | (c[1] << 8) | c[2];
  const writer = new GifWriter(out, w, h, { palette: [rgb(a), rgb(b), 0, 0] });
  const index = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) index[y * w + x] = paint(x, y);
  writer.addFrame(0, 0, w, h, index);
  return Buffer.from(out.subarray(0, writer.end()));
};

// Reads a Key picture variable: the raw base64 of a PNG.
export const decodeKeyPicture = (value) => {
  const img = PNG.sync.read(Buffer.from(value, 'base64'));
  const at = (x, y) => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];
  return { width: img.width, height: img.height, at };
};

export const RED = [220, 30, 30];
export const BLUE = [30, 30, 220];
export const GREEN = [30, 200, 30];
