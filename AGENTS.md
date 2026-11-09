# AGENTS.md

Notes for AI agents working in this repo. Only the non-obvious is here; code and git history hold the rest.

A Bitfocus Companion connection module that signs in to Sode (sethdotfm/sode, branch `integration/panels` while panels are alpha) and runs a panel on Companion surfaces such as a Stream Deck. Companion's module guide is https://companion.free/for-developers/module-development/. Sode's API is `/api/v1`, documented in `docs/api.md` in the Sode repo.

## Layout and checks

- `src/runtime.js` is the panel runtime and knows nothing of Companion. `src/main.js` is the thin Companion shell, and `src/companion-status.js` maps runtime status codes to Companion's.
- `npm test` runs `node --test` against a fake Sode (`test/fake-sode.js`). Never print, log or commit a key: compare headers with `assert.ok`, since `assert.equal` prints both values on failure.
- `npm run link-dev -- <developer modules folder>` symlinks the repo into Companion's developer folder. `npm run package` builds the side-loadable package.

## Live stream

- `/stream` frames carry `topic`, as `docs/api.md` shows. `onFrame` in `src/runtime.js` ignores a change frame without one. This needs a Sode build that sends `topic`; `src/vendor/SOURCE` records the commit the stream was checked against.
- While the stream is up, only protected and presets are polled, and tally is re-read every `rereadMs` (30 s) on its own injectable timer, so a missed delta heals. Down, tally and status poll every `pollMs`.

## Generator

`npm run generate -- --rows <n> --cols <m> --label <label> --connection-id <id> --out <file>` writes a Companion page file of n by m universal buttons (default `COMPANION_GRID`, 4 by 8; at most `MAX_GRID`, 32). It reads nothing from Sode, takes no key and does no I/O beyond the output file, and the same input gives the same bytes. `generatePage` in `src/generator/index.js` is pure and takes the grid, not a panel. The module and Sode own which Cell sits on which square. `src/generator/export-format.js` is the only file that knows the page export shape, matched to `test/fixtures/speedtest-export.companionconfig` (a Companion 5.1.2 export). Generated pages carry no `look` feedback: Companion 5.1.2 needs `styleOverrides` for an advanced feedback and we do not know that format. Layer fields read the `key_<r>_<c>_bg` and `_fg` variables instead (`src/surface.js` publishes them from `styleOf`). The `look` feedback and presets stay for hand-built buttons. `src/colours.js` holds the key colours. Refresh the fixture with a new export if Companion's format changes.

Layer stack of a generated button, bottom to top: `box0` (the Border plate, state colour over the whole key), `box1` (dark inset plate, opacity `100 * _inset`), `image0` (the Key picture, opacity from `_op`), `text0`. `box1` and `image0` share a frame of `_bl`, `_bt`, `_br`, `_bb` (Border widths in percent). `src/surface.js` publishes all of these per key square beside the text and colour variables, as plain values (empty picture, zeros, `_op` 100) for a key without one. Keys without a picture must stay identical to the solid-colour look. `_op` is 30 for a picture (Artwork, Icon or Icon B) under a label, and 100 once its text is hidden (as in Sode's `web/panels.css`) or when the key has no picture. On an Artwork key the label colour (`_fg`) is white, since the label sits on the dark inset; an Icon key keeps the state text colour.

Icon B is the Cell's `artB`, a glyph 0 to 16 or A to Z (`glyphOf` in `src/icons.js`). It is drawn as SVG text, in the same picture as Icon A (`iconSvg`): alone it fills the key, beside Icon A it takes 60% of the width and Icon A 40%, as in Sode's `web/panels.css`. It uses the Icon colour rule (key text colour, white under hidden text). Beside raster or SVG Artwork it is not drawn, since the Artwork picture is bytes we do not rewrite, but a valid Icon B still counts as art for hidden text.

`src/artwork.js` turns Artwork bytes (PNG, JPEG, GIF via pngjs, jpeg-js, omggif, all pure JavaScript) into a 72 px square Key picture, published as raw base64 of a PNG. The runtime fetches each art id once from `panels/{id}/artwork/{art}`, drops ids no Cell names after a panel change, and retries failures then. SVG passes through as a data URL. A merged Cell's picture is cut per key square (`keyPictures`, `cropSvg`): rasters are cropped and SVGs get a narrower view box, with the 8% Border band only on the group's outer edges, so the square's `_b*` variables are 0 on inner sides. Oversize (Content-Length or bytes over 1 MB, or PNG and GIF header dimensions over the pixel cap) and unsupported Artwork stays plain. A hidden-text Cell with any art string shows no label, even when the art does not resolve.

Every generated button is the same: it reads its text, colour and picture variables from the module, so a Cell added later in Sode's editor appears without regenerating. The module's Presets list still covers only drawn Cells (`visibleSquares`).

## Vendored panel model

`src/vendor/` is a copy of Sode's `web/panelmodel.js`, `panelrules.js`, `panellink.js` and `panelupdate.js`. `src/vendor/SOURCE` holds the Sode commit and branch it came from. Refresh it with `scripts/sync-model.sh [sode checkout]`, and keep it in step with Sode while panels are alpha. Do not edit the copies by hand.

`src/vendor/lucide/` is a copy of Sode's Lucide sprite (`web/vendor/patchbay/icons/lucide.svg`) wrapped as the JS string `sprite.js` so the packaging tool bundles it, with the ISC licence in `LICENSE-lucide`. Its `SOURCE` line holds the Sode commit, branch and Lucide version. Refresh it with `scripts/sync-icons.sh [sode checkout]`. `build-config.cjs` copies the licence into the package. `src/icons.js` resolves a Cell's `icon:<name>` art string.

`src/live-panel.js` diverges from Sode's web page on purpose: a newer panel applies at once and drops the view and staged routes, held only while a take is in flight.

Other divergences from Sode's web page, kept in the runtime (`src/runtime.js`, `src/timing.js`), not the vendored model:

- After a take the viewed destination stays viewed. Only Clear or a newly applied panel drops it. Sode's page has no idle clear (upstream removed it from the model), so neither has the module.
- A double-press Take shows "Press\nagain" in `take-confirm` (amber) from the first press until the 1.5 s window lapses or the second press fires. The hold guard keeps the armed look and its fill.
- The `takeMessages` option (off by default) puts those two Take prompts on the viewed Destination and staged Source keys (`onRoute`, `takePrompt` in `src/runtime.js`), in the Take's own colour class and without the hold fill. A hidden-text Cell on the route speaks them, as on the Take. `configUpdated` rebuilds the runtime, so a change applies on save.
- Take colours (`take-armed` red, `take-confirm` amber) mirror Sode's `web/panels.css` and need a manual re-check when Sode changes them.
- The pulse has 4 phases of 333 ms (500 ms at 1.5x speed), breathing between 72% and 100% of the state colour.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for sethdotfm/sode-companion, through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
