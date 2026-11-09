#!/bin/sh
# Copies Sode's pure panel model into src/vendor and records the source commit in src/vendor/SOURCE.
# Usage: scripts/sync-model.sh [path to sode checkout, default ../sode]
set -eu
src="${1:-$(dirname "$0")/../../sode}"
out="$(dirname "$0")/../src/vendor"
for f in panelmodel.js panelrules.js panellink.js panelupdate.js; do cp "$src/web/$f" "$out/$f"; done
printf '%s %s\n' "$(git -C "$src" rev-parse HEAD)" "$(git -C "$src" branch --show-current)" > "$out/SOURCE"
