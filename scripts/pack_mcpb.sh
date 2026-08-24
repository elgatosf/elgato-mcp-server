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
# "/." source form copies directory contents on both GNU (Linux) and BSD (macOS) cp;
# a trailing slash alone is contents-copy on BSD but whole-directory-copy on GNU.
cp -R "$BUNDLE_DIR/." "$STAGE_DIR/"

# Typecheck gate (esbuild does not typecheck).
echo "Typechecking"
"$ROOT_DIR/node_modules/.bin/tsc" -p "$ROOT_DIR/tsconfig.json"

echo "Bundling server"
node "$ROOT_DIR/scripts/bundle_mcpb.mjs" "$STAGE_DIR/server/index.cjs"

# Runtime files resolved relative to the bundle (see src/constants.ts).
cp "$ROOT_DIR/assets/elgato.svg" "$ROOT_DIR/assets/elgato_white.svg" "$STAGE_DIR/assets/"

echo "Setting bundle version to $VERSION"
VERSION="$VERSION" STAGE_DIR="$STAGE_DIR" node -e '
const fs = require("fs");
const manifestPath = process.env.STAGE_DIR + "/manifest.json";
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
manifest.version = process.env.VERSION;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

// Minimal package.json so the bundle can resolve its version at runtime.
fs.writeFileSync(
	process.env.STAGE_DIR + "/package.json",
	JSON.stringify({ name: "@elgato/mcp-server", version: process.env.VERSION, private: true }, null, 2) + "\n",
);
'

mkdir -p "$ROOT_DIR/dist"
echo "Packing $OUTPUT"
"$MCPB_BIN" pack "$STAGE_DIR" "$OUTPUT"
