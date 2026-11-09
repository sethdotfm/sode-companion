# AGENTS.md

Notes for AI agents working in this repo. Only the non-obvious is here; code and git history hold the rest.

A Bitfocus Companion connection module that signs in to Sode (sethdotfm/sode, branch `integration/panels` while panels are alpha) and runs a panel on Companion surfaces such as a Stream Deck. Companion's module guide is https://companion.free/for-developers/module-development/. Sode's API is `/api/v1`, documented in `docs/api.md` in the Sode repo.

## Layout and checks

- `src/runtime.js` is the panel runtime and knows nothing of Companion. `src/main.js` is the thin Companion shell, and `src/companion-status.js` maps runtime status codes to Companion's.
- `npm test` runs `node --test` against a fake Sode (`test/fake-sode.js`). Never print, log or commit a key: compare headers with `assert.ok`, since `assert.equal` prints both values on failure.
- `npm run link-dev -- <developer modules folder>` symlinks the repo into Companion's developer folder. `npm run package` builds the side-loadable package.

## Vendored panel model

`src/vendor/` is a copy of Sode's `web/panelmodel.js`, `panelrules.js` and `panellink.js`. `src/vendor/SOURCE` holds the Sode commit and branch it came from. Refresh it with `scripts/sync-model.sh [sode checkout]`, and keep it in step with Sode while panels are alpha. Do not edit the copies by hand.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for sethdotfm/sode-companion, through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
