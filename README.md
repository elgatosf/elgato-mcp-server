# Elgato MCP Server

[![npm version](https://img.shields.io/npm/v/@elgato/mcp-server.svg)](https://www.npmjs.com/package/@elgato/mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A Model Context Protocol (MCP) server that bridges AI assistants (like Claude Desktop) with Elgato apps.

## Overview

The Elgato MCP Server acts as a protocol bridge between MCP clients and Elgato apps via IPC:

```
MCP Client <--MCP Transport--> Bridge <--Unix Socket/Named Pipe--> Elgato App
```

**Key Features:**

- 🔌 **Dynamic Tool Discovery** — Automatically discovers and exposes tools from connected Elgato apps via MCP
- 🚀 **Dual Transport Support** — stdio (for Claude Desktop) and HTTP (for web clients)
- 🌐 **ngrok Integration** — Optional public tunnel for remote access
- 🔄 **Hot Reconnection** — Automatically reconnects when apps become available
- 💻 **Cross-Platform** — Supports Windows and macOS
- 📢 **Notification Forwarding** — Forwards app notifications to connected MCP clients

## Installation

```bash
# Global installation (recommended)
npm install -g @elgato/mcp-server

# Or with pnpm
pnpm add -g @elgato/mcp-server
```

## Usage

### stdio Transport (Default)

For integration with Claude Desktop or other MCP clients using standard I/O:

```bash
elgato-mcp-server
```

### HTTP Transport

For web-based clients or remote access:

```bash
# Start HTTP server on default port (9090)
elgato-mcp-server --http

# Custom port
elgato-mcp-server --http --port 3000

# With ngrok tunnel (requires NGROK_AUTHTOKEN env var)
NGROK_AUTHTOKEN=your_token elgato-mcp-server --http --ngrok
```

### CLI Options

```
Options:
  --transport <mode>  Transport mode: 'stdio' (default) or 'http'
  --http              Shorthand for --transport http
  --port <number>     HTTP server port (default: 9090)
  --ngrok             Enable ngrok tunnel (requires NGROK_AUTHTOKEN env var)
  --help, -h          Show help message
```

## Claude Desktop Configuration

Add the following to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
    "mcpServers": {
        "elgato": {
            "command": "elgato-mcp-server"
        }
    }
}
```

## HTTP Endpoints

When running in HTTP mode, the following endpoints are available:

| Endpoint  | Method | Description                            |
| --------- | ------ | -------------------------------------- |
| `/mcp`    | POST   | MCP request endpoint                   |
| `/mcp`    | GET    | Server-Sent Events (SSE) for streaming |
| `/mcp`    | DELETE | Close session                          |
| `/health` | GET    | Health check endpoint                  |

## Development

### Prerequisites

- Node.js 18+
- pnpm 10+

### Setup

```bash
# Clone the repository
git clone https://github.com/elgatosf/elgato-mcp-server.git
cd elgato-mcp-server

# Install dependencies
pnpm install

# Build
pnpm build

# Run locally
pnpm start
```

### Scripts

| Command                 | Description                         |
| ----------------------- | ----------------------------------- |
| `pnpm build`            | Compile TypeScript to JavaScript    |
| `pnpm start`            | Run the server with stdio transport |
| `pnpm http`             | Run the server with HTTP transport  |
| `pnpm ngrok`            | Run with HTTP + ngrok tunnel        |
| `pnpm lint`             | Run ESLint                          |
| `pnpm lint:fix`         | Fix formatting with Prettier        |
| `pnpm test`             | Run all tests                       |
| `pnpm test:unit`        | Run unit tests only                 |
| `pnpm test:integration` | Run integration tests only          |
| `pnpm test:coverage`    | Run tests with coverage report      |

### Testing

The project includes comprehensive unit and integration tests. For detailed information about the test suite, see [Test Documentation](./src/__tests__/README.md).

## Architecture

The server consists of four main components:

1. **IpcClient** — IPC client for communicating with a single app (e.g. Stream Deck) via Unix socket (macOS/Linux) or named pipe (Windows). Handles connection lifecycle, message parsing, and notification forwarding.
2. **ClientManager** — Manages multiple `IpcClient` instances (one per known app). Aggregates tools and resources with `appname__` prefixes and routes tool calls to the correct client.
3. **McpBridge** — Protocol translator between MCP and the `ClientManager`. Provides two initialization patterns:
    - `createInitializedBridge()` — For manual transport management (HTTP with multiple sessions)
    - `createConnectedBridge()` — For single transport scenarios (stdio)
4. **Transport Layer** — stdio or HTTP transport for MCP client communication

For detailed technical information, see [TECHNICAL_SPECIFICATION.md](./TECHNICAL_SPECIFICATION.md).

## Requirements

- Elgato app with MCP plugin support (e.g. Stream Deck)
- Node.js 18 or later
- Supported platforms: Windows, macOS

## License

MIT License - Copyright (c) Corsair Memory Inc.

See [LICENSE](./LICENSE) for details.

## Links

- [GitHub Repository](https://github.com/elgatosf/elgato-mcp-server)
- [npm Package](https://www.npmjs.com/package/@elgato/mcp-server)
- [Issue Tracker](https://github.com/elgatosf/elgato-mcp-server/issues)
- [Elgato](https://www.elgato.com)
