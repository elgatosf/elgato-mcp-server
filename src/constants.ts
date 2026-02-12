import type { ServerInfo } from "./types.js";

const SOCKET_BASE_NAME = "elgato-streamdeck-mcp-bridge";

/**
 * Get IPC socket path for Stream Deck communication.
 * @returns The platform-specific socket path.
 */
export const getSocketPath = (): string =>
	process.platform === "win32" ? `\\\\.\\pipe\\${SOCKET_BASE_NAME}` : `/tmp/${SOCKET_BASE_NAME}.sock`;

/**
 * Get signal socket path for reconnection notifications.
 * @returns The platform-specific signal socket path.
 */
export const getSignalSocketPath = (): string =>
	process.platform === "win32" ? `\\\\.\\pipe\\${SOCKET_BASE_NAME}-ready` : `/tmp/${SOCKET_BASE_NAME}-ready.sock`;

/** IPC socket path for Stream Deck communication. */
export const SOCKET_PATH = getSocketPath();

/** Signal socket path for reconnection notifications. */
export const SIGNAL_SOCKET_PATH = getSignalSocketPath();

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

/** Default server info when Stream Deck is not connected. */
export const DEFAULT_SERVER_INFO: ServerInfo = {
	name: "Stream Deck MCP Server",
	version: "1.0.0",
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

/** SDK notification methods received from Stream Deck. */
export const SDK_NOTIFICATIONS = {
	TOOLS_LIST_CHANGED: "notifications/tools/list_changed",
	RESOURCES_LIST_CHANGED: "notifications/resources/list_changed",
	RESOURCES_UPDATED: "notifications/resources/updated",
} as const;
