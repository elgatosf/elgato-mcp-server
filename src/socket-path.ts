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
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Get the platform-specific socket path for connecting to Stream Deck's MCP local server.
 * This must match exactly with ESDMCPLocalServer::getDefaultSocketPath() in C++.
 * @returns The socket path for the current platform
 */
export function getSocketPath(): string {
	switch (process.platform) {
		case "darwin": {
			return path.join("/tmp", "elgato-streamdeck-mcp-bridge.sock");
		}

		case "win32": {
			// Windows: Use Named Pipe
			return "\\\\.\\pipe\\streamdeck-mcp-bridge";
		}

		default: {
			console.error(`[MCP Bridge] Fatal error: unsupported platform: ${process.platform}`);
			process.exit(1);
		}
	}
}

/**
 * Check if the socket file exists (Unix) or is potentially available (Windows).
 * This is a quick check before attempting connection.
 * @returns True if the socket exists or is potentially available
 */
export function socketExists(): boolean {
	const socketPath = getSocketPath();

	if (process.platform === "win32") {
		// Named pipes on Windows don't have a simple existence check,
		// we'll need to try connecting to verify
		return true;
	}

	return fs.existsSync(socketPath);
}

/**
 * Get a human-readable description of the socket path for logging.
 * @returns A human-readable description of the socket path
 */
export function getSocketDescription(): string {
	const socketPath = getSocketPath();

	if (process.platform === "win32") {
		return `Named Pipe: ${socketPath}`;
	}

	return `Unix Socket: ${socketPath}`;
}
