#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

npm run build

if [ -n "${OBSIDIAN_PLUGIN_DIR:-}" ]; then
  mkdir -p "$OBSIDIAN_PLUGIN_DIR"
  cp dist/main.js "$OBSIDIAN_PLUGIN_DIR/main.js"
  cp manifest.json "$OBSIDIAN_PLUGIN_DIR/manifest.json"
  echo "Plugin built and copied to $OBSIDIAN_PLUGIN_DIR"
else
  echo "Plugin built. Set OBSIDIAN_PLUGIN_DIR in .env to auto-install into a vault."
fi
