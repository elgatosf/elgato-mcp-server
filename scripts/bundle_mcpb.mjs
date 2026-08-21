/**
 * Bundles the MCP server into a single CommonJS file for the MCPB package.
 *
 * Usage: node scripts/bundle_mcpb.mjs [outfile]
 *
 * The bundle expects the following layout relative to itself (see src/constants.ts):
 *   ../package.json           - version read at startup
 *   ../assets/elgato.svg      - icon read at startup
 *   ../assets/elgato_white.svg
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outfile = process.argv[2] ?? `${root}dist/mcpb-server/index.cjs`;

await build({
	entryPoints: [`${root}src/index.ts`],
	bundle: true,
	platform: "node",
	format: "cjs",
	target: "node18",
	outfile,
	// Native N-API addon; cannot be bundled. http.ts degrades gracefully when absent.
	external: ["@ngrok/ngrok"],
	// CJS shim so import.meta.url (src/constants.ts) works in the bundle.
	define: { "import.meta.url": "import_meta_url" },
	banner: { js: "const import_meta_url = require('node:url').pathToFileURL(__filename).href;" },
	sourcemap: false,
	minify: false,
	logLevel: "info",
});
