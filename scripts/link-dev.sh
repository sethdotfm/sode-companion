#!/bin/sh
# Symlinks this repo into Companion's developer modules folder as sode-panels.
# Usage: scripts/link-dev.sh <developer modules folder>   (the folder set in Companion's Settings, Advanced)
set -eu
dev="${1:?usage: scripts/link-dev.sh <developer modules folder>}"
repo="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$dev"
ln -sfn "$repo" "$dev/sode-panels"
echo "linked $dev/sode-panels -> $repo"
