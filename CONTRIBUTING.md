# Contributing to Elgato MCP Server

Thank you for your interest in contributing to the Elgato MCP Server! This document provides guidelines and information for contributors.

## Development Setup

### Prerequisites

- Node.js 18+
- pnpm 10+

### Getting Started

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

## Available Scripts

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
| `pnpm test:watch`       | Run tests in watch mode             |

## Testing

### Running Tests

```bash
# Run all tests
pnpm test

# Run with coverage report
pnpm test:coverage

# Run a single test file
node --experimental-vm-modules node_modules/jest/bin/jest.js src/__tests__/unit/McpBridge.test.ts

# Run tests matching a pattern
node --experimental-vm-modules node_modules/jest/bin/jest.js -t "test name pattern"
```

### Coverage Requirements

All contributions must maintain the following coverage thresholds:

| Metric     | Threshold |
| ---------- | --------- |
| Statements | 80%       |
| Branches   | 80%       |
| Functions  | 80%       |
| Lines      | 80%       |

For detailed information about the test suite, see [src/\_\_tests\_\_/README.md](./src/__tests__/README.md).

## Development Workflow

All feature additions, bug fixes, and refactoring follow a three-phase workflow:

1. **Analysis & Planning** — Analyze the request, identify affected components, and present a detailed plan before making changes
2. **Implementation & Testing** — Implement changes, add/update tests, ensure coverage thresholds are met
3. **Documentation** — Update relevant documentation (TECHNICAL_SPECIFICATION.md, README.md, test docs)

For the complete workflow specification, see [.augment/rules/workflow.md](./.augment/rules/workflow.md).

## Code Style

This project follows strict code style guidelines:

- **Module System**: ESM modules (`"type": "module"` in package.json)
- **TypeScript**: Strict mode, target ES2022
- **Indentation**: Tabs
- **Line Length**: 120 characters maximum
- **Line Endings**: LF
- **Imports**: Use `.js` extensions (ESM requirement with NodeNext module resolution)
- **Documentation**: JSDoc required for public methods

The project uses:
- [`@elgato/eslint-config`](https://www.npmjs.com/package/@elgato/eslint-config) for linting
- [`@elgato/prettier-config`](https://www.npmjs.com/package/@elgato/prettier-config) for formatting

Run `pnpm lint` to check for issues and `pnpm lint:fix` to auto-format.

## Project Architecture

The server consists of four main components:

1. **IpcClient** — IPC client for communicating with Elgato apps via Unix socket (macOS) or named pipe (Windows)
2. **ClientManager** — Manages multiple IpcClient instances and aggregates tools/resources
3. **McpBridge** — Protocol translator between MCP and the ClientManager
4. **Transport Layer** — stdio or HTTP transport for MCP client communication

For detailed technical information, see [TECHNICAL_SPECIFICATION.md](./TECHNICAL_SPECIFICATION.md).

## Submitting Changes

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Make your changes following the development workflow
4. Ensure all tests pass (`pnpm test`)
5. Ensure code passes linting (`pnpm lint`)
6. Commit your changes with clear, descriptive messages
7. Push to your fork and submit a Pull Request

## Questions?

If you have questions or need help, please [open an issue](https://github.com/elgatosf/elgato-mcp-server/issues).

