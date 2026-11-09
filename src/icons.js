// Looks up Lucide icons by the name in a Cell's `icon:<name>` art string. Pure, no Node imports.
// The sprite is a recorded copy of Sode's (src/vendor/lucide/SOURCE); symbols carry only paths, so the caller supplies the 24x24 box and stroke.
import sprite from './vendor/lucide/sprite.js';

// Same pattern as Sode's panellook.js.
const ICON = /^icon:([a-z0-9-]+)$/;

let symbols;
const load = () => {
  symbols = new Map();
  for (const m of sprite.matchAll(/<symbol id="([^"]+)">([\s\S]*?)<\/symbol>/g)) symbols.set(m[1], m[2].trim());
  return symbols;
};

// The drawing inside the icon's symbol, or undefined when the art is not an icon or the name is not in the set.
export const iconMarkup = (art) => {
  const name = typeof art === 'string' ? ICON.exec(art)?.[1] : undefined;
  return name === undefined ? undefined : (symbols ?? load()).get(name);
};

// Icon B is a glyph 0 to 16 or A to Z, as in Sode's ART_B_CHOICES (web/panellook.js). Anything else draws nothing.
const GLYPH = /^(?:\d|1[0-6]|[A-Z])$/;
export const glyphOf = (cell) => (typeof cell?.artB === 'string' && GLYPH.test(cell.artB) ? cell.artB : '');

// Sode's artwork row on a 24 unit box with a 4 unit pad: Icon A or Icon B alone fills it, together Icon A takes 40% of the width
// and Icon B 60%. The glyph is 70% of the height, capped by its width share as in web/panels.css.
export const iconSvg = (markup, glyph, rgb) => {
  const colour = `#${rgb.toString(16).padStart(6, '0')}`;
  const both = markup !== undefined && glyph !== '';
  const parts = [];
  // Under the 0.4 scale the stroke is thicker so the small Icon keeps a readable line.
  if (markup !== undefined)
    parts.push(both ? `<g transform="translate(0 7.2) scale(0.4)" stroke-width="4">${markup}</g>` : `<g stroke-width="2">${markup}</g>`);
  if (glyph !== '') {
    const size = both ? (glyph.length > 1 ? 12 : 14.4) : 16.8;
    // The baseline sits about 0.36em below the middle of a digit or capital.
    const y = Number((12 + size * 0.36).toFixed(2));
    parts.push(
      `<text x="${both ? 16.8 : 12}" y="${y}" font-size="${size}" font-family="sans-serif" font-weight="700" ` +
        `text-anchor="middle" fill="${colour}" stroke="none">${glyph}</text>`,
    );
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 32 32" fill="none" stroke="${colour}" ` +
    `stroke-linecap="round" stroke-linejoin="round">${parts.join('')}</svg>`
  );
};
