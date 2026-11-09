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
