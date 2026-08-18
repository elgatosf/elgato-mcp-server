#!/usr/bin/env bash
#
# Packs the MCP bundle for a given version.
#
# Usage: scripts/pack_mcpb.sh <version>
#
set -euo pipefail

if [[ $# -ne 1 ]]; then
	echo "Usage: $0 <version>" >&2
	exit 1
fi

VERSION="$1"

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
	echo "Error: '$VERSION' is not a valid semantic version (e.g. 1.2.3 or 1.2.3-beta.1)." >&2
	exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_DIR="$ROOT_DIR/mcpb"
MCPB_BIN="$ROOT_DIR/node_modules/.bin/mcpb"
OUTPUT="$ROOT_DIR/dist/elgato_stream_deck-$VERSION.mcpb"

if [[ ! -f "$BUNDLE_DIR/manifest.json" ]]; then
	echo "Error: manifest not found at $BUNDLE_DIR/manifest.json" >&2
	exit 1
fi

if [[ ! -x "$MCPB_BIN" ]]; then
	echo "Error: 'mcpb' CLI not found at $MCPB_BIN. Run 'pnpm install' first." >&2
	exit 1
fi

# Stage the bundle so the tracked manifest is never modified.
STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGE_DIR"' EXIT
cp -R "$BUNDLE_DIR/" "$STAGE_DIR/"

echo "Setting bundle version to $VERSION"
VERSION="$VERSION" MANIFEST="$STAGE_DIR/manifest.json" node -e '
const fs = require("fs");
const path = process.env.MANIFEST;
const manifest = JSON.parse(fs.readFileSync(path, "utf8"));
manifest.version = process.env.VERSION;
fs.writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
'

mkdir -p "$ROOT_DIR/dist"
echo "Packing $OUTPUT"
"$MCPB_BIN" pack "$STAGE_DIR" "$OUTPUT"
