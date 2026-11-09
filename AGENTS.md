# AGENTS.md

Notes for AI agents working in this repo. Only the non-obvious is here; code and git history hold the rest.

A Bitfocus Companion connection module that signs in to Sode (sethdotfm/sode, branch `integration/panels` while panels are alpha) and runs a panel on Companion surfaces such as a Stream Deck. Companion's module guide is https://companion.free/for-developers/module-development/. Sode's API is `/api/v1`, documented in `docs/api.md` in the Sode repo.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for sethdotfm/sode-companion, through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
