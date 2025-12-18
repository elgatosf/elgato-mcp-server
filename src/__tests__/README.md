# Stream Deck MCP Bridge - Test Suite

This directory contains comprehensive test coverage for the Stream Deck MCP Bridge project.

## Test Structure

```
src/__tests__/
├── helpers/          # Test utilities and mocks
│   ├── MockSocket.ts    # Mock implementation of net.Socket
│   ├── MockServer.ts    # Mock implementation of net.Server
│   └── testUtils.ts     # Helper functions for creating test data
├── unit/             # Unit tests
│   ├── constants.test.ts        # Tests for socket path generation
│   ├── utils.test.ts            # Tests for utility functions
│   ├── StreamDeckClient.test.ts # Tests for IPC client
│   └── McpBridge.test.ts        # Tests for MCP bridge logic
└── integration/      # Integration tests
    ├── transports.test.ts       # Tests for stdio and HTTP transports
    └── mcp-protocol.test.ts     # Tests for MCP protocol endpoints
```

## Running Tests

### All Tests
```bash
pnpm test
```

### Unit Tests Only
```bash
pnpm test:unit
```

### Integration Tests Only
```bash
pnpm test:integration
```

### Watch Mode
```bash
pnpm test:watch
```

### Coverage Report
```bash
pnpm test:coverage
```

### CI/CD Pipeline
```bash
pnpm test:ci
```

## Test Coverage

The test suite covers:

### Unit Tests

1. **Socket Path Generation** (`constants.test.ts`)
   - Cross-platform path generation (Windows, macOS, Linux)
   - Mocking of `process.platform`

2. **Tool Conversion** (`utils.test.ts`)
   - `convertToMcpTools()` with various input formats
   - Schema transformation correctness
   - CLI argument parsing
   - Help message generation

3. **Message Parsing** (`StreamDeckClient.test.ts`)
   - Buffer processing and message extraction
   - Handling of partial messages
   - Multiple messages in one chunk
   - Buffer overflow protection

4. **Request/Response Correlation** (`StreamDeckClient.test.ts`)
   - ID matching and timeout handling
   - Error response handling
   - Concurrent request handling

5. **MCP Bridge Logic** (`McpBridge.test.ts`)
   - Tool caching
   - Server creation
   - Handler registration
   - Callback notifications
   - Error handling

### Integration Tests

1. **Connection Scenarios** (`transports.test.ts`)
   - Stream Deck running before bridge
   - Bridge starts before Stream Deck
   - Stream Deck crashes mid-session
   - Stream Deck restarts

2. **Transport Testing** (`transports.test.ts`)
   - stdio transport initialization
   - HTTP transport with multiple sessions
   - Session cleanup

3. **MCP Protocol Endpoints** (`mcp-protocol.test.ts`)
   - `tools/list` endpoint
   - `tools/call` endpoint
   - Notifications
   - Reconnection scenarios

## Test Utilities

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

### Test Utilities
Helper functions for creating test data:
- `createMockTool(overrides)` - Create mock tool definition
- `createMockServerInfo(overrides)` - Create mock server info
- `createMockToolsListResponse(tools)` - Create mock tools list response
- `createMockCallToolResponse(result, error)` - Create mock call tool response
- `createMockErrorResponse(message, data)` - Create mock error response
- `wait(ms)` - Wait for specified time
- `waitFor(condition, timeout)` - Wait for condition to be true
- `createDeferred()` - Create deferred promise

## Coverage Thresholds

The project maintains the following coverage thresholds:
- Branches: 80%
- Functions: 80%
- Lines: 80%
- Statements: 80%

## Notes

- Tests use Jest with TypeScript support via ts-jest
- ESM modules are enabled via `--experimental-vm-modules`
- Mocks are automatically cleared between tests
- All external dependencies (net, fs) are mocked

