# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP server bridging AI assistants (Claude Desktop) and Elgato Stream Deck via the Model Context Protocol. The bridge discovers tools/resources from Stream Deck over IPC and exposes them to MCP clients through stdio or HTTP transports.

## Commands

```bash
pnpm build              # Compile TypeScript (outputs to bin/)
pnpm lint               # ESLint with zero warnings tolerance
pnpm lint:fix           # Prettier formatting
pnpm test               # All tests (Jest with ESM via --experimental-vm-modules)
pnpm test:unit          # Unit tests only
pnpm test:integration   # Integration tests only
pnpm test:coverage      # Tests with coverage report
pnpm test:watch         # Watch mode
```

**Run a single test file:**
```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js src/__tests__/unit/McpBridge.test.ts
```

**Run a single test by name:**
```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js -t "test name pattern"
```

## Architecture

**Data flow:** MCP Client → Transport (stdio/HTTP) → McpBridge → StreamDeckClient → Stream Deck IPC socket

Three core components:

- **StreamDeckClient** (`src/StreamDeckClient.ts`) — IPC socket client for Stream Deck. Manages connection lifecycle with dual reconnection strategy (signal socket + polling fallback). Handles request/response correlation with timeouts. Platform-aware: Unix sockets on macOS/Linux, named pipes on Windows.

- **McpBridge** (`src/McpBridge.ts`) — Protocol bridge creating the MCP server with tool/resource handlers. Caches tools and resources, manages change notifications, and forwards elicitation requests. Two factory functions: `createInitializedBridge()` for HTTP (manual transport attachment) and `createConnectedBridge(transport)` for stdio (single transport).

- **Transport layer** (`src/transports/`) — `stdio.ts` wraps StdioServerTransport for Claude Desktop. `http.ts` runs Express with StreamableHTTPServerTransport, session management, idle timeout cleanup, CORS, and optional ngrok tunneling.

Supporting modules: `types.ts` (IPC protocol types), `constants.ts` (socket paths, timeouts), `utils.ts` (tool/resource conversion, CLI parsing).

## Development Workflow

All feature additions, bug fixes, and refactoring follow a three-phase workflow (see `.augment/rules/workflow.md`):

1. **Analysis & Planning** — Analyze the request, present a detailed plan (files, approach, risks, scope), then **stop and wait for user approval**
2. **Implementation & Testing** — Implement changes, add/update tests, run `pnpm test` and `pnpm test:coverage`. If coverage thresholds can't be met after 2 iterations, ask the user
3. **Documentation** — Update `TECHNICAL_SPECIFICATION.md`, `README.md`, and `src/__tests__/README.md` as applicable

## Testing

- Jest 30 with ts-jest ESM preset. Config in `jest.config.js`
- Coverage thresholds: 80% for statements, branches, functions, and lines
- Test helpers and mocks in `src/__tests__/helpers/testUtils.ts` (MockSocket, MockServer, MockTransport, MockMcpBridge)
- `clearMocks`, `resetMocks`, `restoreMocks` are all **false** — tests manage their own mock lifecycle
- `src/index.ts` is excluded from coverage (tested via integration tests)

## Code Style

- ESM modules (`"type": "module"` in package.json), target ES2022, strict TypeScript
- Tabs for indentation, 120 char max line length, LF line endings
- Uses `@elgato/eslint-config` and `@elgato/prettier-config`
- JSDoc required for public methods
- All `.js` extensions in imports (ESM requirement with NodeNext module resolution)
