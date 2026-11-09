#!/bin/sh
# Builds the package and checks it holds the Lucide sprite (bundled into main.js) and its licence at the package root.
set -eu
cd "$(dirname "$0")/.."
npm run package >/dev/null
tgz=sode-panels-$(node -p "require('./package.json').version").tgz
tar -tzf "$tgz" | grep -qx 'sode-panels/LICENSE-lucide' || { echo "LICENSE-lucide missing from $tgz" >&2; exit 1; }
tar -xzOf "$tgz" sode-panels/main.js | grep 'lucide-static v' >/dev/null || { echo "Lucide sprite missing from main.js in $tgz" >&2; exit 1; }
echo "$tgz carries the Lucide sprite and LICENSE-lucide"
