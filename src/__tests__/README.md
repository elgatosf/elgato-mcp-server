# Elgato MCP Server - Test Suite

This directory contains comprehensive test coverage for the Elgato MCP Server project.

## Current Status

| Metric      | Status                    |
| ----------- | ------------------------- |
| Build       | ✅ Passing                |
| Test Suites | 12 of 12 passing (100%)   |
| Tests       | 294 of 294 passing (100%) |
| Skipped     | 0 tests                   |

### Coverage Metrics

| Metric     | Coverage | Threshold |
| ---------- | -------- | --------- |
| Statements | 87.33%   | 80% ✅    |
| Branches   | 81.25%   | 80% ✅    |
| Functions  | 90.25%   | 80% ✅    |
| Lines      | 87.73%   | 80% ✅    |

## Test Structure

```
src/__tests__/
├── helpers/                              # Test utilities and mocks
│   ├── MockMcpBridge.ts                  # Mock implementation of McpBridge
│   ├── MockSocket.ts                     # Mock implementation of net.Socket
│   ├── MockServer.ts                     # Mock implementation of net.Server
│   ├── MockTransport.ts                  # Mock implementation of MCP Transport
│   └── testUtils.ts                      # Helper functions for creating test data
├── unit/                                 # Unit tests (8 test files, 232 tests)
│   ├── constants.test.ts                 # Socket path generation tests (14 tests)
│   ├── utils.test.ts                     # Utility functions tests (53 tests)
│   ├── IpcClient.test.ts                 # IPC client tests (65 tests, includes elicitation)
│   ├── ClientManager.test.ts             # Client manager aggregation tests (42 tests)
│   ├── McpBridge.test.ts                 # MCP bridge logic tests (72 tests, includes elicitation)
│   ├── http-server-startup.test.ts       # HTTP server initialization tests (4 tests)
│   └── http-session-timeout.test.ts      # HTTP session timeout tests (6 tests)
└── integration/                          # Integration tests (4 test files, 53 tests)
    ├── transports.test.ts                # Stdio and HTTP transport tests
    ├── mcp-protocol.test.ts              # MCP protocol endpoint tests (49 tests)
    ├── http-cors.test.ts                 # CORS handling tests
    └── http-session-lifecycle.test.ts    # Session lifecycle tests
```

## Running Tests

```bash
pnpm test              # Run all tests
pnpm test:unit         # Run unit tests only
pnpm test:integration  # Run integration tests only
pnpm test:watch        # Run tests in watch mode
pnpm test:coverage     # Generate coverage report
pnpm test:ci           # Run tests in CI/CD mode
```

## Test Coverage Details

### Unit Tests

#### constants.test.ts (14 tests)

- Cross-platform socket path generation (Windows, macOS, Linux)
- Timeout constants validation
- Buffer size validation
- HTTP port validation
- Default server info validation
- Log prefix validation

#### utils.test.ts (53 tests)

- Tool conversion with various input formats
- Schema transformation correctness
- Annotations and icons preservation
- Complex input schemas
- CLI argument parsing (all options)
- Help message generation
- Logging functionality
- Resource conversion (`convertToMcpResources`)

#### IpcClient.test.ts (65 tests)

- Connection lifecycle (connect, disconnect, timeout, errors)
- Message parsing and buffer processing
- Partial message handling
- Multiple messages in one chunk
- Buffer overflow protection
- Request/response correlation by ID
- Timeout handling
- Error response handling
- API methods (getServerInfo, getTools, callTool)
- Signal listener functionality
- Notification handling (type guards, multiple callbacks, error isolation)
- Resources API (getResources, readResource)
- Elicitation handling (type guard, callback registration, response handling, timeout, error handling)

#### ClientManager.test.ts (42 tests)

- Multi-client aggregation of tools and resources
- `appname__` prefix application and stripping
- Routing of tool calls to the correct IpcClient
- Forwarding of onToolsChanged / onResourcesChanged / onNotification / onElicitation callbacks
- Handling connected/disconnected client states
- URI prefixing in RESOURCES_UPDATED notifications for subscription matching

#### McpBridge.test.ts (72 tests)

- Initialization (connected and disconnected modes)
- Server creation with custom info
- Callback notifications
- Error handling in callbacks
- Connection state management
- Handler registration
- Notification handling (tools/changed, resources/list_changed, resources/updated)
- Resource subscription tracking and forwarding
- Helper functions (createInitializedBridge, createConnectedBridge)
- Elicitation forwarding (callback registration, decline when no active server)

#### http-server-startup.test.ts (4 tests)

- EADDRINUSE error handling
- EACCES error handling
- EADDRNOTAVAIL error handling
- Generic error handling

#### http-session-timeout.test.ts (6 tests)

- Session timeout after idle period
- Multiple session cleanup
- Custom timeout configuration
- Session activity tracking

### Integration Tests

#### transports.test.ts

- stdio transport initialization
- HTTP transport with multiple sessions
- Session notification on tools change
- Stream Deck running before bridge
- Bridge starting before Stream Deck
- Stream Deck restart scenario
- Stream Deck crash mid-session
- Reconnection handling
- Callback notifications on reconnection

#### mcp-protocol.test.ts (49 tests)

- tools/list endpoint (cached tools, empty tools, refresh)
- tools/call endpoint (success, errors, disconnected state)
- Tool not found error
- Notifications on reconnection
- Multiple notification callbacks
- Error handling (network, malformed, timeout)
- Reconnection scenarios (success, failure, tool updates)
- Resources via MockTransport (list, read, subscribe, unsubscribe endpoints)

#### http-cors.test.ts

- CORS preflight requests (OPTIONS)
- CORS headers validation
- Cross-origin request handling
- Multiple origin support

#### http-session-lifecycle.test.ts

- Session creation and initialization
- Session cleanup on disconnect
- Multiple concurrent sessions
- Session reconnection scenarios
- Resource cleanup verification

## Test Utilities

### MockMcpBridge

Mock implementation of `McpBridge` for testing HTTP transport and MCP server functionality:

- Centralized mock to prevent synchronization issues with the real `McpBridge` class
- Includes all public methods: `initialize`, `close`, `createServer`, `onToolsChanged`, `onResourcesChanged`, `onClientNotification`
- `isConnected` getter/setter for controlling connection state
- `createMockMcpBridge(overrides)` - Factory function for easy customization

**Important**: This mock must be kept in sync with the real `McpBridge` class interface. When adding new public methods to `McpBridge`, update this mock accordingly.

### MockSocket

Mock implementation of `net.Socket` for testing IPC communication:

- `simulateData(data)` - Simulate receiving data
- `simulateConnect()` - Simulate connection event
- `simulateError(error)` - Simulate error event
- `getWrittenData()` - Get all written data
- `getLastWritten()` - Get last written data

### MockServer

Mock implementation of `net.Server` for testing signal listener:

- `simulateConnection(socket)` - Simulate new connection
- `isListening()` - Check if server is listening
- `getConnections()` - Get active connections

### MockTransport

Mock implementation of MCP Transport for testing MCP protocol communication:

- `start()` / `close()` - Transport lifecycle
- `send(message)` - Send JSON-RPC message
- `simulateIncomingMessage(message)` - Simulate receiving a message
- `simulateError(error)` / `simulateClose()` - Simulate transport events
- `getOutgoingMessages()` / `getLastOutgoingMessage()` - Inspect sent messages
- `waitForOutgoingMessage(timeout)` - Wait for next outgoing message

### Test Data Helpers (testUtils.ts)

- `createMockTool(overrides)` - Create mock tool definition
- `createMockResource(overrides)` - Create mock MCP resource
- `createMockServerInfo(overrides)` - Create mock server info
- `createMockClientManager(overrides)` - Create mock `ClientManager` for use in McpBridge and transport tests
- `createMockClient(overrides)` - Create mock IpcClient with getResources/readResource/onElicitation methods
- `createMockToolsListResponse(tools)` - Create mock tools list response
- `createMockCallToolResponse(result, error)` - Create mock call tool response
- `createMockErrorResponse(message, data)` - Create mock error response
- `wait(ms)` - Wait for specified time
- `waitFor(condition, timeout)` - Wait for condition to be true
- `createDeferred()` - Create deferred promise

## Test Configuration

| Setting          | Value                                 |
| ---------------- | ------------------------------------- |
| Test Framework   | Jest 30.2.0 with ts-jest              |
| Module System    | ESM (via `--experimental-vm-modules`) |
| Test Environment | Node.js                               |
| Test Timeout     | 10 seconds                            |
| Coverage Formats | text, lcov, html                      |

### Coverage Thresholds

The project maintains 80% coverage thresholds for all metrics:

- Statements: 80%
- Branches: 80%
- Functions: 80%
- Lines: 80%

## Key Features

- **Cross-Platform Testing** - Mocks `process.platform` to test Windows, macOS, and Linux paths
- **Comprehensive Mocking** - All external dependencies (net, fs) are mocked for isolation
- **Type Safety** - Full TypeScript support with proper type checking
- **ESM Support** - Uses experimental VM modules for ESM compatibility
- **CI/CD Ready** - Dedicated script for CI/CD pipelines with coverage reporting

## Implementation Notes

### IpcClient Dependency Injection

The `IpcClient` class uses dependency injection for testability:

- Accepts optional `socketFactory` and `serverFactory` parameters in its `IpcClientConfig`
- Defaults to actual `net.Socket` and `net.createServer` for production
- Enables full unit test coverage without complex ESM module mocking
- Maintains 100% backward compatibility with existing code
