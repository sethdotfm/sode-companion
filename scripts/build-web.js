// Bundles web/generator.js for the browser. Run `npm run build-web` after changing the Generator or bumping the module version.
import { build } from 'esbuild';

export const buildOptions = {
  entryPoints: ['web/generator.js'],
  bundle: true,
  format: 'iife',
  minify: false,
  legalComments: 'none',
  write: false,
  outfile: 'docs/generator/generator.js',
};

export async function bundle() {
  const { outputFiles } = await build(buildOptions);
  return outputFiles[0].text;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(buildOptions.outfile, await bundle());
  process.stdout.write(`Wrote ${buildOptions.outfile}\n`);
}
