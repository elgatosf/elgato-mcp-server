/**
 * Platform-specific socket path utilities for Stream Deck IPC communication.
 *
 * Provides abstraction for Unix Domain Sockets (macOS) and Named Pipes (Windows).
 */

import * as path from "node:path";

/** Base name for the main IPC socket */
const SOCKET_NAME = "elgato-streamdeck-mcp-bridge";

/** Base name for the signal socket used for reconnection notifications */
const SIGNAL_SOCKET_NAME = "elgato-streamdeck-mcp-bridge-ready";

/**
 * Gets the platform-specific socket path for the given socket name.
 * @param socketName - The base name for the socket
 * @returns The full socket path appropriate for the current platform
 */
function getPlatformSocketPath(socketName: string): string {
	switch (process.platform) {
		case "darwin":
			return path.join("/tmp", `${socketName}.sock`);
		case "win32":
			return `\\\\.\\pipe\\${socketName}`;
		default:
			console.error(`Fatal error: unsupported platform: ${process.platform}`);
			process.exit(1);
	}
}

/**
 * Gets the main IPC socket path for communication with Stream Deck.
 * @returns The platform-specific socket path
 */
export function getSocketPath(): string {
	return getPlatformSocketPath(SOCKET_NAME);
}

/**
 * Gets the signal socket path for receiving ready notifications from Stream Deck.
 * @returns The platform-specific signal socket path
 */
export function getSignalSocketPath(): string {
	return getPlatformSocketPath(SIGNAL_SOCKET_NAME);
}

/**
 * Gets a human-readable description of the socket paths for logging.
 * @returns A description of the socket mechanism used on this platform
 */
export function getSocketDescription(): string {
	switch (process.platform) {
		case "darwin":
			return `Unix socket: ${getSocketPath()}`;
		case "win32":
			return `Named pipe: ${getSocketPath()}`;
		default:
			return `Unknown platform: ${process.platform}`;
	}
}

