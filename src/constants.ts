import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import type { AppDefinition, ServerInfo } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

/** Elgato logo SVG read from the shared assets folder. */
const ELGATO_ICON_SVG_LIGHT = readFileSync(join(__dirname, "..", "assets", "elgato.svg"), "utf-8");
const ELGATO_ICON_SVG_DARK = readFileSync(join(__dirname, "..", "assets", "elgato_white.svg"), "utf-8");

/** Timeout for quick connection attempts (ms). */
export const QUICK_CONNECT_TIMEOUT_MS = 1000;

/** Polling interval for reconnection attempts (ms). */
export const RECONNECT_POLL_INTERVAL_MS = 3000;

/** Timeout for IPC requests (ms). */
export const REQUEST_TIMEOUT_MS = 30_000;

/** Timeout for elicitation requests (ms). User input may take longer. */
export const ELICITATION_TIMEOUT_MS = 5 * 60_000;

/** Maximum buffer size for IPC messages (1 MB). */
export const MAX_BUFFER_SIZE = 1024 * 1024;

/** Default HTTP server port. */
export const HTTP_DEFAULT_PORT = 9090;

/** Default session timeout: 1 hour in milliseconds */
export const DEFAULT_SESSION_TIMEOUT_MS = 60 * 60 * 1000;

/** Cleanup interval: check for idle sessions every 5 minutes */
export const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/** Known apps that the bridge can connect to. Add entries here to support new apps. */
export const KNOWN_APPS: AppDefinition[] = [
	{
		name: "streamdeck",
		socketBaseName: "elgato-mcp-streamdeck",
	},
];

/** Separator used when prefixing tool/resource names with the app name. */
export const TOOL_PREFIX_SEPARATOR = "__";

/**
 * Derives platform-specific socket paths from an app definition.
 * @param app - The app definition containing the socket base name.
 * @returns Object with `socketPath` and `signalSocketPath` for the current platform.
 */
export function getAppSocketPaths(app: AppDefinition): { signalSocketPath: string; socketPath: string } {
	const { socketBaseName } = app;
	if (process.platform === "win32") {
		return {
			signalSocketPath: `\\\\.\\pipe\\${socketBaseName}-ready`,
			socketPath: `\\\\.\\pipe\\${socketBaseName}`,
		};
	}
	return {
		signalSocketPath: `/tmp/${socketBaseName}-ready.sock`,
		socketPath: `/tmp/${socketBaseName}.sock`,
	};
}

/** Default server info when no apps are connected. */
export const DEFAULT_SERVER_INFO: ServerInfo = {
	name: "Elgato MCP Server",
	version: pkg.version,
	icons: [
		{
			src: `data:image/svg+xml,${encodeURIComponent(ELGATO_ICON_SVG_LIGHT)}`,
			mimeType: "image/svg+xml",
			theme: "light",
		},
		{
			src: `data:image/svg+xml,${encodeURIComponent(ELGATO_ICON_SVG_DARK)}`,
			mimeType: "image/svg+xml",
			theme: "dark",
		},
	],
};

/** Log message prefix. */
export const LOG_PREFIX = "[MCP Bridge]";

/** MCP error codes. */
export const MCP_ERROR_CODES = {
	INVALID_REQUEST: -32600,
	METHOD_NOT_FOUND: -32601,
	INVALID_PARAMS: -32602,
	INTERNAL_ERROR: -32603,
	SERVER_ERROR: -32000,
} as const;

/** SDK notification methods received from connected apps. */
export const SDK_NOTIFICATIONS = {
	TOOLS_LIST_CHANGED: "notifications/tools/list_changed",
	RESOURCES_LIST_CHANGED: "notifications/resources/list_changed",
	RESOURCES_UPDATED: "notifications/resources/updated",
} as const;
