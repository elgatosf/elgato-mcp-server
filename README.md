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
  --verbose, -v       Enable verbose logging (default: silent)
```

### Logging

Logs are written to stderr with a severity label (`ERROR`, `WARN`, `INFO`, `DEBUG`). Errors and warnings always output; info/debug require `--verbose`.

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

## Requirements

- Elgato app with MCP plugin support (e.g. Stream Deck)
- Node.js 18 or later
- Supported platforms: Windows, macOS

## Contributing

We welcome contributions! For development setup, coding guidelines, and the contribution process, see [CONTRIBUTING.md](https://github.com/elgatosf/elgato-mcp-server/blob/main/CONTRIBUTING.md).

For detailed technical documentation and architecture information, see [TECHNICAL_SPECIFICATION.md](https://github.com/elgatosf/elgato-mcp-server/blob/main/TECHNICAL_SPECIFICATION.md).

## License

MIT License - Copyright (c) Corsair Memory Inc.

See [LICENSE](https://github.com/elgatosf/elgato-mcp-server/blob/main/LICENSE) for details.

## Links

- [GitHub Repository](https://github.com/elgatosf/elgato-mcp-server)
- [npm Package](https://www.npmjs.com/package/@elgato/mcp-server)
- [Issue Tracker](https://github.com/elgatosf/elgato-mcp-server/issues)
- [Elgato](https://www.elgato.com)
