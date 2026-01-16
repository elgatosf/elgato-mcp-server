# Stream Deck MCP Bridge

[![npm version](https://img.shields.io/npm/v/@elgato/streamdeck-mcp.svg)](https://www.npmjs.com/package/@elgato/streamdeck-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A Model Context Protocol (MCP) server that bridges AI assistants (like Claude Desktop) with Elgato Stream Deck automation capabilities.

## Overview

The Stream Deck MCP Bridge acts as a protocol bridge between MCP clients and Stream Deck hardware:

```
MCP Client <--MCP Transport--> Bridge <--Unix Socket/Named Pipe--> Stream Deck
```

**Key Features:**
- 🔌 **Dynamic Tool Discovery** — Automatically discovers and exposes Stream Deck tools via MCP
- 🚀 **Dual Transport Support** — stdio (for Claude Desktop) and HTTP (for web clients)
- 🌐 **ngrok Integration** — Optional public tunnel for remote access
- 🔄 **Hot Reconnection** — Automatically reconnects when Stream Deck becomes available
- 💻 **Cross-Platform** — Supports Windows and macOS

## Installation

```bash
# Global installation (recommended)
npm install -g @elgato/streamdeck-mcp

# Or with pnpm
pnpm add -g @elgato/streamdeck-mcp
```

## Usage

### stdio Transport (Default)

For integration with Claude Desktop or other MCP clients using standard I/O:

```bash
mcp-server-streamdeck
```

### HTTP Transport

For web-based clients or remote access:

```bash
# Start HTTP server on default port (9090)
mcp-server-streamdeck --http

# Custom port
mcp-server-streamdeck --http --port 3000

# With ngrok tunnel (requires NGROK_AUTHTOKEN env var)
NGROK_AUTHTOKEN=your_token mcp-server-streamdeck --http --ngrok
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
    "streamdeck": {
      "command": "mcp-server-streamdeck"
    }
  }
}
```

## HTTP Endpoints

When running in HTTP mode, the following endpoints are available:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/mcp` | POST | MCP request endpoint |
| `/mcp` | GET | Server-Sent Events (SSE) for streaming |
| `/mcp` | DELETE | Close session |
| `/health` | GET | Health check endpoint |

## Development

### Prerequisites

- Node.js 18+
- pnpm 10+

### Setup

```bash
# Clone the repository
git clone https://github.com/elgatosf/streamdeck-mcp.git
cd streamdeck-mcp

# Install dependencies
pnpm install

# Build
pnpm build

# Run locally
pnpm start
```

### Scripts

| Command | Description |
|---------|-------------|
| `pnpm build` | Compile TypeScript to JavaScript |
| `pnpm start` | Run the bridge with stdio transport |
| `pnpm http` | Run the bridge with HTTP transport |
| `pnpm ngrok` | Run with HTTP + ngrok tunnel |
| `pnpm lint` | Run ESLint |
| `pnpm lint:fix` | Fix formatting with Prettier |
| `pnpm test` | Run all tests |
| `pnpm test:unit` | Run unit tests only |
| `pnpm test:integration` | Run integration tests only |
| `pnpm test:coverage` | Run tests with coverage report |

### Testing

The project includes comprehensive unit and integration tests. For detailed information about the test suite, see [Test Documentation](./src/__tests__/README.md).

## Architecture

The bridge consists of three main components:

1. **StreamDeckClient** — IPC client for communicating with Stream Deck via Unix socket (macOS/Linux) or named pipe (Windows)
2. **McpBridge** — Protocol translator between MCP and Stream Deck IPC
3. **Transport Layer** — stdio or HTTP transport for MCP client communication

For detailed technical information, see [TECHNICAL_SPECIFICATION.md](./TECHNICAL_SPECIFICATION.md).

## Requirements

- Stream Deck software with MCP plugin enabled
- Node.js 18 or later
- Supported platforms: Windows, macOS, Linux

## License

MIT License - Copyright (c) Corsair Memory Inc.

See [LICENSE](./LICENSE) for details.

## Links

- [GitHub Repository](https://github.com/elgatosf/streamdeck-mcp)
- [npm Package](https://www.npmjs.com/package/@elgato/streamdeck-mcp)
- [Issue Tracker](https://github.com/elgatosf/streamdeck-mcp/issues)
- [Elgato](https://www.elgato.com)

