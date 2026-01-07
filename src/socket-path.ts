/**
 * Platform-specific socket path determination for MCP bridge IPC.
 *
 * This module provides the exact same socket paths as the C++ ESDMCPLocalServer
 * to ensure both sides connect to the same endpoint.
 *
 * Paths:
 *   macOS:   /tmp/elgato-streamdeck-mcp-bridge.sock
 *   Windows: \\.\pipe\streamdeck-mcp-bridge
 */
import * as path from "node:path";

/**
 * Get the platform-specific socket path for a given socket name.
 * @param socketName The base name of the socket without extension (e.g., "elgato-streamdeck-mcp-bridge")
 * @returns The socket path for the current platform
 */
function getPlatformSocketPath(socketName: string): string {
	switch (process.platform) {
		case "darwin": {
			return path.join("/tmp", `${socketName}.sock`);
		}

		case "win32": {
			// Windows: Use Named Pipe
			return `\\\\.\\pipe\\${socketName}`;
		}

		default: {
			console.error(`[MCP Bridge] Fatal error: unsupported platform: ${process.platform}`);
			process.exit(1);
		}
	}
}

/**
 * Get the platform-specific socket path for connecting to Stream Deck's MCP local server.
 * This must match exactly with ESDMCPLocalServer::getDefaultSocketPath() in C++.
 * @returns The socket path for the current platform
 */
export function getSocketPath(): string {
	return getPlatformSocketPath("elgato-streamdeck-mcp-bridge");
}

/**
 * Get a human-readable description of a socket path for logging.
 * @param socketPath The socket path to describe
 * @returns A human-readable description of the socket path
 */
function getSocketPathDescription(socketPath: string): string {
	if (process.platform === "win32") {
		return `Named Pipe: ${socketPath}`;
	}

	return `Unix Socket: ${socketPath}`;
}

/**
 * Get a human-readable description of the socket path for logging.
 * @returns A human-readable description of the socket path
 */
export function getSocketDescription(): string {
	return getSocketPathDescription(getSocketPath());
}

/**
 * Get the platform-specific signal socket path for receiving ready notifications.
 * The Stream Deck server will connect to this socket to signal it's ready.
 * @returns The signal socket path for the current platform
 */
export function getSignalSocketPath(): string {
	return getPlatformSocketPath("elgato-streamdeck-mcp-bridge-ready");
}

/**
 * Get a human-readable description of the signal socket path for logging.
 * @returns A human-readable description of the signal socket path
 */
export function getSignalSocketDescription(): string {
	return getSocketPathDescription(getSignalSocketPath());
}
