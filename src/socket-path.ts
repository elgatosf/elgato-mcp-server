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
import * as fs from "node:fs";

/**
 * Get the platform-specific socket path for connecting to Stream Deck's MCP local server.
 * This must match exactly with ESDMCPLocalServer::getDefaultSocketPath() in C++.
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
 */
export function getSocketDescription(): string {
  const socketPath = getSocketPath();

  if (process.platform === "win32") {
    return `Named Pipe: ${socketPath}`;
  }

  return `Unix Socket: ${socketPath}`;
}

