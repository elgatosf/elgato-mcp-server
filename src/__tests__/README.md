# Stream Deck MCP Bridge - Test Suite

This directory contains comprehensive test coverage for the Stream Deck MCP Bridge project.

## Test Structure

```
src/__tests__/
├── helpers/                              # Test utilities and mocks
│   ├── MockSocket.ts                     # Mock implementation of net.Socket
│   ├── MockServer.ts                     # Mock implementation of net.Server
│   ├── MockTransport.ts                  # Mock implementation of MCP Transport
│   └── testUtils.ts                      # Helper functions for creating test data
├── unit/                                 # Unit tests (6 test files)
│   ├── constants.test.ts                 # Socket path generation tests
│   ├── utils.test.ts                     # Utility functions tests
│   ├── StreamDeckClient.test.ts          # IPC client tests
│   ├── McpBridge.test.ts                 # MCP bridge logic tests
│   ├── http-server-startup.test.ts       # HTTP server initialization tests
│   └── http-session-timeout.test.ts      # HTTP session timeout tests
└── integration/                          # Integration tests (4 test files)
    ├── transports.test.ts                # Stdio and HTTP transport tests
    ├── mcp-protocol.test.ts              # MCP protocol endpoint tests
    ├── http-cors.test.ts                 # CORS handling tests
    └── http-session-lifecycle.test.ts    # Session lifecycle tests
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

6. **HTTP Server Startup** (`http-server-startup.test.ts`)
   - Server initialization and port binding
   - Error handling for port conflicts
   - Graceful startup failure handling
   - Bridge initialization integration

7. **HTTP Session Timeout** (`http-session-timeout.test.ts`)
   - Session inactivity detection
   - Automatic session cleanup
   - Cleanup interval management
   - Timeout threshold configuration
   - Session state tracking

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

4. **HTTP CORS Handling** (`http-cors.test.ts`)
   - CORS preflight requests (OPTIONS)
   - CORS headers validation
   - Cross-origin request handling
   - Multiple origin support

5. **HTTP Session Lifecycle** (`http-session-lifecycle.test.ts`)
   - Session creation and initialization
   - Session cleanup on disconnect
   - Multiple concurrent sessions
   - Session reconnection scenarios
   - Resource cleanup verification

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
- `getConnections()` - Get active connections

### MockTransport
Mock implementation of MCP Transport for testing MCP protocol communication:
- `start()` - Start the transport
- `send(message)` - Send JSON-RPC message
- `close()` - Close the transport
- `simulateIncomingMessage(message)` - Simulate receiving a message
- `simulateError(error)` - Simulate transport error
- `simulateClose()` - Simulate transport closure
- `getOutgoingMessages()` - Get all sent messages
- `getLastOutgoingMessage()` - Get last sent message
- `waitForOutgoingMessage(timeout)` - Wait for next outgoing message

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

## Test Configuration

- **Test Framework**: Jest 30.2.0 with TypeScript support via ts-jest
- **Module System**: ESM modules enabled via `--experimental-vm-modules` flag
- **Test Environment**: Node.js
- **Test Timeout**: 10 seconds per test
- **Mock Management**: Mocks are explicitly cleared in `beforeEach` hooks (configured with `clearMocks: false` for better control)
- **External Dependencies**: All external dependencies (net, fs, etc.) are mocked for isolation

