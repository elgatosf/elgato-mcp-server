# Elgato MCP Server - Technical Specification

## 1. Project Overview

### 1.1 Purpose

The Elgato MCP Server is a TypeScript/Node.js application that acts as a protocol bridge between Model Context Protocol (MCP) clients (such as Claude Desktop) and Elgato apps. It enables AI assistants to discover and invoke tools exposed by connected Elgato apps through the standardized MCP protocol.

### 1.2 Goals

- **Seamless Integration**: Provide a transparent bridge between MCP clients and Elgato apps
- **Dynamic Tool Discovery**: Discover and expose app tools at runtime without hardcoding tool definitions
- **Multi-Transport Support**: Support both stdio (for desktop integration) and HTTP (for web clients) transports
- **Resilient Operation**: Start and operate independently of app availability, with automatic reconnection
- **Cross-Platform Compatibility**: Support macOS and Windows platforms

### 1.3 High-Level Architecture

```
┌──────────────────┐     MCP Protocol     ┌──────────────────┐     IPC Socket     ┌──────────────────┐
│   MCP Client     │◄────────────────────►│  MCP Server      │◄──────────────────►│  Elgato App      │
│ (Claude Desktop) │   (stdio or HTTP)    │  (This Server)   │  (Unix/Named Pipe) │   (e.g. Stream   │
└──────────────────┘                      └──────────────────┘                    │    Deck)         │
                                                                                   └──────────────────┘
```

The server operates in proxy mode:

1. Receives MCP requests from clients via stdio or HTTP transport
2. Forwards tool calls to the relevant Elgato app via local IPC socket
3. Returns responses back to MCP clients

---

## 2. System Requirements

### 2.1 Runtime Environment

| Requirement      | Version                        |
| ---------------- | ------------------------------ |
| Node.js          | v18+ (ES2022 support required) |
| Package Manager  | pnpm 10.26.0+                  |
| Operating System | macOS or Windows               |

### 2.2 Dependencies

#### Production Dependencies

| Package                     | Purpose                                |
| --------------------------- | -------------------------------------- |
| `@modelcontextprotocol/sdk` | MCP protocol implementation            |
| `@ngrok/ngrok`              | Optional HTTP tunnel for remote access |
| `cors`                      | CORS middleware for HTTP transport     |
| `express`                   | HTTP server framework                  |
| `zod`                       | Runtime type validation                |

#### Development Dependencies

| Package           | Purpose                  |
| ----------------- | ------------------------ |
| `typescript`      | TypeScript compiler      |
| `@types/node`     | Node.js type definitions |
| `@types/cors`     | CORS type definitions    |
| `@types/express`  | Express type definitions |
| `eslint`          | Code linting             |
| `prettier`        | Code formatting          |
| `@changesets/cli` | Version management       |

---

## 3. Architecture Design

### 3.1 Component Breakdown

The system consists of four main source files:

#### 3.1.1 Main Entry Point (`src/index.ts`)

**Responsibilities:**

- Parse command-line arguments and configure transport mode
- Initialize and manage MCP server instances
- Handle tool discovery and caching from connected apps
- Manage transport layer (stdio or HTTP)
- Coordinate graceful shutdown

#### 3.1.2 IPC Client (`src/IpcClient.ts`)

**Responsibilities:**

- Establish and maintain IPC connection to a single app (e.g. Stream Deck)
- Implement request/response protocol
- Handle automatic reconnection via signal socket
- Manage request timeouts and pending request tracking
- Handle elicitation requests from the app during tool calls

#### 3.1.2a Client Manager (`src/ClientManager.ts`)

**Responsibilities:**

- Manage one `IpcClient` instance per known app
- Aggregate tools and resources across all connected clients using `appname__` prefixes
- Route `tools/call` and `resources/read` requests to the correct client by stripping the prefix
- Forward `onToolsChanged`, `onResourcesChanged`, `onNotification`, and `onElicitation` events from any client to registered callbacks

#### 3.1.3 MCP Bridge (`src/McpBridge.ts`)

**Responsibilities:**

- Create and configure MCP server instances
- Handle tool and resource list requests by delegating to `ClientManager`
- Manage tool/resource list change notifications
- Forward app notifications to registered callbacks via `onClientNotification`
- Forward elicitation requests to MCP clients during tool calls

#### 3.1.4 Constants (`src/constants.ts`)

**Responsibilities:**

- Provide platform-specific socket paths
- Abstract platform differences (Unix sockets vs Windows Named Pipes)
- Define shared constants (timeouts, buffer sizes, log prefix)
- Define SDK notification types for Stream Deck communication

**Key Exports:**

- `SOCKET_PATH`: Main IPC socket path
- `SIGNAL_SOCKET_PATH`: Signal notification socket path
- `REQUEST_TIMEOUT`: Request timeout in milliseconds
- `MAX_BUFFER_SIZE`: Maximum buffer size for IPC messages
- `ELICITATION_TIMEOUT_MS`: Timeout for elicitation requests (300 seconds / 5 minutes)
- `SDK_NOTIFICATIONS`: Notification type constants for Stream Deck SDK
    - `TOOLS_LIST_CHANGED`: `"notifications/tools/list_changed"`
    - `RESOURCES_LIST_CHANGED`: `"notifications/resources/list_changed"`
    - `RESOURCES_UPDATED`: `"notifications/resources/updated"`

#### 3.1.5 Transport Layers (`src/transports/`)

**Files:**

- `src/transports/stdio.ts`: stdio transport for Claude Desktop integration
- `src/transports/http.ts`: HTTP transport for web-based clients

#### 3.1.6 Utilities (`src/utils.ts`)

**Responsibilities:**

- Provide logging utilities with consistent prefix
- Common helper functions

#### 3.1.7 Type Definitions (`src/types.ts`)

**Responsibilities:**

- Define TypeScript interfaces for IPC protocol
- Define request/response types for Stream Deck communication

### 3.2 Data Flow

```
MCP Client Request
       │
       ▼
┌──────────────────┐
│ Transport Layer  │ ← stdio (StdioServerTransport) or HTTP (StreamableHTTPServerTransport)
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  MCP Server      │ ← McpServer with custom request handlers
│  (Request        │
│   Handlers)      │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  ClientManager   │ ← Aggregates tools/resources, routes calls by appname__ prefix
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│    IpcClient     │ ← One per app; forwards call_tool requests over IPC
└────────┬─────────┘
         │
         ▼ (IPC Socket)
┌──────────────────┐
│  Stream Deck     │
│  (C++ Server)    │
└──────────────────┘
```

### 3.3 Integration Points

1. **MCP Protocol Layer**: Standard MCP types from `@modelcontextprotocol/sdk`
2. **Stream Deck IPC**: Custom JSON-over-socket protocol matching C++ implementation
3. **Signal Socket**: Connection-based notification system for reconnection

---

## 4. API Specifications

### 4.1 MCP Protocol (Client-Facing)

The bridge implements standard MCP protocol endpoints:

#### tools/list

Returns dynamically discovered tools from Stream Deck.

**Response:**

```json
{
  "tools": [
    {
      "name": "tool_name",
      "description": "Tool description",
      "inputSchema": { "type": "object", "properties": {...} },
      "icons": [...]
    }
  ]
}
```

#### tools/call

Forwards tool invocation to Stream Deck and returns the result.

**Request:**

```json
{
    "name": "tool_name",
    "arguments": { "param1": "value1" }
}
```

**Response (Success):**

```json
{
    "content": [{ "type": "text", "text": "..." }]
}
```

**Response (Error):**

```json
{
    "content": [{ "type": "text", "text": "Error message" }],
    "isError": true
}
```

#### resources/list

Returns dynamically discovered resources from Stream Deck.

**Response:**

```json
{
    "resources": [
        {
            "uri": "streamdeck://resource/identifier",
            "name": "resource_name",
            "description": "Resource description",
            "mimeType": "application/json"
        }
    ]
}
```

#### resources/read

Reads a specific resource by URI from Stream Deck.

**Request:**

```json
{
    "uri": "streamdeck://resource/identifier"
}
```

**Response (Success):**

```json
{
    "contents": [
        {
            "uri": "streamdeck://resource/identifier",
            "mimeType": "application/json",
            "text": "{\"key\": \"value\"}"
        }
    ]
}
```

#### resources/subscribe

Subscribes to updates for a specific resource URI.

**Request:**

```json
{
    "uri": "streamdeck://resource/identifier"
}
```

**Response:**

```json
{}
```

#### resources/unsubscribe

Unsubscribes from updates for a specific resource URI.

**Request:**

```json
{
    "uri": "streamdeck://resource/identifier"
}
```

**Response:**

```json
{}
```

#### Notifications

- `notifications/tools/list_changed`: Sent when Stream Deck connects/reconnects and tools are re-discovered
- `notifications/resources/list_changed`: Sent when the list of available resources changes
- `notifications/resources/updated`: Sent when a subscribed resource's content is updated (only forwarded if client has subscribed to the resource)
- Custom notifications: Non-standard notifications from connected apps are forwarded to registered callbacks via `onClientNotification()`

**Notification vs Response Distinction:**

- **Notifications**: Have a `method` field but no `id` field
- **Responses**: Have an `id` field that correlates with the request ID
- **Elicitation Requests**: Have BOTH `id` AND `method: "elicitation/create"` (unique hybrid type)

### 4.2 Elicitation Protocol

During a `tools/call` request, Stream Deck may need additional information from the user. It sends an elicitation request to the bridge, which forwards it to the MCP client, awaits the user's response, and sends it back to Stream Deck.

#### Elicitation Message Flow

```
Stream Deck → IpcClient → ClientManager → McpBridge → MCP Client → User
       ↑                                                             │
       └─────────────────────────────────────────────────────────────┘
                                  Response
```

#### Elicitation Request Format

Stream Deck sends an elicitation request during tool execution:

```json
{
    "id": "9b3908ad-40cf-4d82-96e1-abc123",
    "method": "elicitation/create",
    "params": {
        "message": "Please provide additional information",
        "mode": "form",
        "requestedSchema": {
            "type": "object",
            "properties": {
                "fieldName": { "type": "string" }
            }
        }
    }
}
```

**Key Fields:**

- `id`: Unique request ID for response correlation
- `method`: Always `"elicitation/create"`
- `params.message`: Prompt message to display to the user
- `params.mode`: Currently only `"form"` is supported
- `params.requestedSchema`: JSON Schema defining the expected user input

#### Elicitation Response Format

The bridge sends back the user's response:

```json
{
    "id": "9b3908ad-40cf-4d82-96e1-abc123",
    "method": "elicitation/response",
    "result": {
        "action": "accept",
        "content": { "fieldName": "user value" }
    }
}
```

**Response Actions:**

- `accept`: User provided input (includes `content` field)
- `decline`: User declined to provide input
- `cancel`: User cancelled the operation

#### Elicitation Timeout

Elicitation requests have a 300-second (5-minute) timeout (`ELICITATION_TIMEOUT_MS`). If the MCP client doesn't respond within this time, the bridge returns a `decline` response to Stream Deck.

#### Tool Call Timeout Extension During Elicitation

When a tool call triggers an elicitation request, the standard 30-second request timeout (`REQUEST_TIMEOUT_MS`) would normally expire before the user has a chance to respond. To handle this, the `IpcClient` automatically extends the timeout for the pending tool call when an elicitation request is received:

1. Tool call is sent to Stream Deck with a 30-second timeout
2. Stream Deck sends back an `elicitation/create` request with `relatedToolCallId` matching the tool call
3. The client detects the matching pending request and extends its timeout to 5 minutes (`ELICITATION_TIMEOUT_MS`)
4. User input can now take up to 5 minutes without the tool call timing out
5. Once the elicitation response is sent back, the tool call completes normally

### 4.3 Stream Deck IPC Protocol (Internal)

Communication with Stream Deck uses JSON messages terminated by newline (`\n`).

#### Request Types

**server_info**

```json
{ "id": "1", "method": "server_info" }
```

**tools_list**

```json
{ "id": "2", "method": "tools_list" }
```

**call_tool**

```json
{
    "id": "3",
    "method": "call_tool",
    "toolName": "button_press",
    "arguments": { "button_id": 5 }
}
```

**resources_list**

```json
{ "id": "4", "method": "resources_list" }
```

**resources_read**

```json
{
    "id": "5",
    "method": "resources_read",
    "uri": "streamdeck://resource/identifier"
}
```

#### Response Types

**ServerInfoResponse**

```json
{
  "id": "1",
  "result": {
    "name": "Elgato MCP Server",
    "version": "1.0.0",
    "title": "Elgato MCP Server",
    "icons": [...]
  }
}
```

**ToolsListResponse**

```json
{
  "id": "2",
  "result": {
    "tools": [
      {
        "name": "tool_name",
        "title": "Tool Title",
        "description": "Tool description",
        "inputSchema": {...},
        "annotations": {...},
        "icons": [...]
      }
    ]
  }
}
```

**CallToolResponse**

```json
{
  "id": "3",
  "result": { "success": true, "data": {...} }
}
```

**ResourcesListResponse**

```json
{
  "id": "4",
  "result": {
    "resources": [
      {
        "uri": "streamdeck://resource/identifier",
        "name": "resource_name",
        "title": "Resource Title",
        "description": "Resource description",
        "mimeType": "application/json",
        "annotations": {...},
        "icons": [...]
      }
    ]
  }
}
```

**ResourcesReadResponse**

```json
{
    "id": "5",
    "result": {
        "uri": "streamdeck://resource/identifier",
        "mimeType": "application/json",
        "content": { "key": "value" }
    }
}
```

**ErrorResponse**

```json
{
    "id": "3",
    "error": { "message": "Error description", "data": "..." }
}
```

### 4.4 Socket Paths

| Platform | Main Socket                       | Signal Socket                           |
| -------- | --------------------------------- | --------------------------------------- |
| macOS    | `/tmp/elgato-mcp-streamdeck.sock` | `/tmp/elgato-mcp-streamdeck-ready.sock` |
| Windows  | `\\.\pipe\elgato-mcp-streamdeck`  | `\\.\pipe\elgato-mcp-streamdeck-ready`  |

---

## 5. Implementation Requirements

### 5.1 Core Functionality

#### 5.1.1 MCP Server Implementation

**Dynamic Tool Handling Pattern:**
The bridge uses the low-level Server API (`server.server.setRequestHandler`) instead of `McpServer.registerTool()` for the following reasons:

1. Tools are discovered at runtime from Stream Deck, not statically defined
2. The bridge acts as a proxy—Stream Deck's C++ code is the single source of truth
3. Allows returning cached tools without re-registration on each request

```typescript
// Custom ListTools handler - returns cached tools from ClientManager
server.server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: clientManager.getTools() };
});

// Custom CallTool handler - forwards to ClientManager which routes to the correct app
server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await clientManager.callTool(request.params.name, request.params.arguments ?? {});
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
});
```

**Server Capabilities:**

```typescript
{
  capabilities: {
    tools: { listChanged: true },  // Enable tool list change notifications
    resources: { subscribe: true, listChanged: true }  // Enable resource subscriptions and list change notifications
  }
}
```

#### 5.1.2 Stream Deck Client Implementation

**Connection Management:**

- Uses Node.js `net` module for socket communication
- Implements request/response correlation via unique IDs
- 30-second request timeout with automatic cleanup
- 1MB maximum buffer size to prevent memory exhaustion

**Message Protocol:**

- JSON serialization
- Newline (`\n`) message delimiter
- Incremental request ID counter

```typescript
const MESSAGE_DELIMITER = "\n";

private sendRequest(request: RequestBase): Promise<ResponseBase> {
  const message = JSON.stringify(request) + MESSAGE_DELIMITER;
  this.socket.write(message);
  // ... handle pending request tracking
}
```

#### 5.1.3 Transport Layers

**stdio Transport:**

- Default transport mode for Claude Desktop integration
- Single MCP server instance
- Uses `StdioServerTransport` from MCP SDK

```typescript
const transport = new StdioServerTransport();
await server.connect(transport);
```

**HTTP Transport:**

- Streamable HTTP transport for web-based clients
- Session-based: each session gets its own MCP server instance
- Endpoints: `POST /mcp`, `GET /mcp` (SSE), `DELETE /mcp`, `GET /health`
- Optional ngrok tunnel integration
- Uses `createInitializedBridge()` for manual transport management

```typescript
const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
        /* track session */
    },
    onsessionclosed: (id) => {
        /* cleanup session */
    },
});
```

**Bridge Initialization Patterns:**

The McpBridge provides two initialization patterns for different use cases:

1. **`createInitializedBridge()`** - Creates and initializes a bridge without connecting to a transport. Use this when you need to manage transport connections manually (e.g., HTTP with multiple sessions).

```typescript
const bridge = await createInitializedBridge();
// Manually connect to transports as needed
```

2. **`createConnectedBridge(transport)`** - Creates, initializes, and connects a bridge to a single transport. Use this for simple scenarios like stdio where there's a single client connection.

```typescript
const transport = new StdioServerTransport();
const bridge = await createConnectedBridge(transport);
```

### 5.2 Connection Management and Resilience

#### 5.2.1 Resilient Startup

The MCP server starts immediately, even if Stream Deck is not available:

1. Attempt quick connection (1-second timeout)
2. If successful: use actual server info and tools
3. If failed: start with default server info, connect in background
4. MCP clients can connect regardless of Stream Deck availability

**Default Server Info:**

```typescript
const DEFAULT_SERVER_INFO: ServerInfoResponse = {
    id: "0",
    name: "Elgato MCP Server",
    version: "1.0.0",
};
```

#### 5.2.2 Signal-Based Reconnection

Instead of polling, the bridge uses a signal socket for reconnection:

1. Bridge listens on signal socket
2. Stream Deck connects to signal socket when ready
3. Bridge receives signal and attempts reconnection
4. Tools are re-discovered after successful reconnection
5. MCP clients receive `tools/list_changed` notification

**Signal Socket Server:**

```typescript
this.signalServer = net.createServer((clientSocket) => {
    console.error("[MCP Bridge] Received ready signal from Stream Deck");
    if (this.readyCallback) {
        this.readyCallback();
    }
    clientSocket.end();
});
```

#### 5.2.3 Connection Callback System

```typescript
// Register callback for connection events
clientManager.onClientConnected(async (appName) => {
    console.log(`${appName} connected`);
    // ClientManager automatically refreshes tools/resources and notifies callbacks
});

// Register callback for tools changed events (fired after any client connects/disconnects)
bridge.onToolsChanged(async () => {
    await mcpServer.sendToolListChanged();
});
```

#### 5.2.4 Notification Callback System

The bridge supports forwarding notifications from connected apps to registered callbacks:

```typescript
// Register callback for app notifications
bridge.onClientNotification((method, params) => {
    console.log(`Received notification: ${method}`, params);
});

// Register callback for tools changed events
bridge.onToolsChanged(async () => {
    await mcpServer.sendToolListChanged();
});

// Register callback for resources changed events
bridge.onResourcesChanged(async () => {
    await mcpServer.sendResourceListChanged();
});
```

**Notification Handling:**

- `notifications/tools/list_changed` - Triggers a tool refresh and invokes `onToolsChanged` callbacks
- `notifications/resources/list_changed` - Triggers a resource refresh and invokes `onResourcesChanged` callbacks
- `notifications/resources/updated` - Forwards resource update notifications only to clients that have subscribed to the specific resource URI
- All other notifications are forwarded to callbacks registered via `onClientNotification()`
- Multiple callbacks can be registered; errors in one callback don't affect others
- Callbacks are invoked in registration order

**Resource Subscription Tracking:**
The bridge maintains a `resourceSubscriptions` Set to track which resource URIs each client has subscribed to. When a `resources/updated` notification is received from Stream Deck, the bridge only forwards it if the client has subscribed to that specific resource via the `resources/subscribe` endpoint.

### 5.3 Error Handling and Recovery

#### 5.3.1 Request Timeout Handling

```typescript
const timeout = setTimeout(() => {
    this.pendingRequests.delete(request.id);
    reject(new Error(`Request timeout for method: ${request.method}`));
}, this.requestTimeout); // 30 seconds
```

#### 5.3.2 Buffer Overflow Protection

```typescript
private readonly maxBufferSize = 1024 * 1024;  // 1MB

private onData(data: Buffer | string): void {
  this.buffer += data.toString();
  if (this.buffer.length > this.maxBufferSize) {
    console.error("[MCP Bridge] Buffer overflow, disconnecting");
    this.disconnect();
    return;
  }
}
```

#### 5.3.3 Graceful Shutdown

```typescript
const shutdown = async () => {
    bridge.close();  // Closes all managed clients via ClientManager
    if (httpServerInstance) {
        httpServerInstance.close();
    }
    process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
```

#### 5.3.4 Tool Call Error Responses

When no apps are connected:

```typescript
return {
  content: [{
    type: "text",
    text: "No apps connected. Please start the required app and try again."
  }],
  isError: true,
};
```

---

## 6. Technical Constraints

### 6.1 Platform Support

| Platform | Support Level | IPC Mechanism       |
| -------- | ------------- | ------------------- |
| macOS    | Full          | Unix Domain Sockets |
| Windows  | Full          | Named Pipes         |
| Linux    | Not Supported | N/A                 |

```typescript
switch (process.platform) {
  case "darwin":
    return path.join("/tmp", `${socketName}.sock`);
  case "win32":
    return `\\\\.\\pipe\\${socketName}`;
  default:
    console.error(`Fatal error: unsupported platform: ${process.platform}`);
    process.exit(1);
}
```

### 6.2 Performance Requirements

| Metric                   | Requirement |
| ------------------------ | ----------- |
| Quick Connection Timeout | 1 second    |
| Request Timeout          | 30 seconds  |
| Elicitation Timeout      | 300 seconds |
| Maximum Buffer Size      | 1 MB        |
| HTTP Default Port        | 9090        |

### 6.3 Limitations

1. **Single Source of Truth**: Tools are defined in Stream Deck C++ code; the bridge cannot define tools
2. **Single Callback**: Only one `onConnected` callback can be registered at a time
3. **Signal Dependency**: If Stream Deck doesn't send ready signals, bridge waits indefinitely
4. **No Tool Validation**: Bridge trusts tool definitions from Stream Deck without schema validation

---

## 7. Development Guidelines

### 7.1 Code Structure

```
elgato-mcp-server/
├── src/
│   ├── index.ts              # Main entry point
│   ├── McpBridge.ts          # MCP server and tool management
│   ├── ClientManager.ts      # Multi-app IPC client aggregator
│   ├── IpcClient.ts          # Single-app IPC client
│   ├── constants.ts          # Platform-specific paths and constants
│   ├── types.ts              # TypeScript type definitions
│   ├── utils.ts              # Logging and utility functions
│   └── transports/
│       ├── stdio.ts          # stdio transport implementation
│       └── http.ts           # HTTP transport implementation
├── bin/                      # Compiled JavaScript output
├── package.json
├── tsconfig.json
├── eslint.config.js
└── pnpm-lock.yaml
```

### 7.2 TypeScript Configuration

```json
{
    "compilerOptions": {
        "strict": true, // Enable all strict checks
        "esModuleInterop": true, // CommonJS/ESM interop
        "skipLibCheck": true, // Skip type checking of declarations
        "lib": ["es2022"], // ES2022 standard library
        "module": "NodeNext", // Node.js ESM module system
        "moduleResolution": "NodeNext", // Node.js module resolution
        "noImplicitOverride": true, // Require 'override' keyword
        "noUncheckedIndexedAccess": true, // Strict index access
        "outDir": "bin/", // Output directory
        "target": "es2022", // ES2022 output
        "verbatimModuleSyntax": true // Strict import/export syntax
    },
    "include": ["src/"],
    "exclude": ["node_modules/"]
}
```

### 7.3 Build Process

```bash
# Install dependencies
pnpm install

# Build TypeScript
pnpm build          # Outputs to bin/

# Run linting
pnpm lint           # ESLint with zero warnings tolerance

# Fix formatting
pnpm lint:fix       # Prettier formatting
```

### 7.4 Package Configuration

```json
{
    "type": "module", // ESM module format
    "bin": {
        "elgato-mcp-server": "bin/index.js"
    },
    "files": ["bin/"], // Published files
    "exports": {
        "./package.json": "./package.json"
    }
}
```

### 7.5 Coding Standards

- Use Elgato's ESLint and Prettier configurations
- JSDoc comments for all public APIs
- Console output via structured logger to `console.error()` (preserves stdout for stdio transport)
- Prefix log messages with `[MCP Bridge]` and severity labels (`ERROR:`, `WARN:`, `INFO:`, `DEBUG:`)
- Error/warn always output; info/debug require `--verbose`/`-v`

---

## 8. Testing Strategy

### 8.1 Unit Testing Approach

**Testable Components:**

1. **Socket Path Generation**
    - Test platform-specific path generation
    - Mock `process.platform` for cross-platform testing

2. **Tool Conversion**
    - Test `convertToMcpTools()` with various input formats
    - Verify schema transformation correctness

3. **Message Parsing**
    - Test buffer processing and message extraction
    - Test handling of partial messages and multiple messages

4. **Request/Response Correlation**
    - Test ID matching and timeout handling
    - Test error response handling

5. **Notification Handling**
    - Test type guards (`isNotification()` vs `isIpcResponse()`)
    - Test multiple callback support
    - Test error isolation between callbacks
    - Test message stream parsing with mixed notifications and responses

6. **Elicitation Handling**
    - Test type guard (`isElicitationRequest()` - checks for both `id` and `method`)
    - Test callback registration and invocation
    - Test timeout handling (decline after timeout)
    - Test error handling (callback errors, destroyed socket)
    - Test message stream parsing with elicitation, responses, and notifications mixed
    - Test timeout extension for pending tool calls when elicitation is received

### 8.2 Integration Testing Requirements

**Connection Scenarios:**

| Scenario                          | Expected Behavior                            |
| --------------------------------- | -------------------------------------------- |
| Stream Deck running before bridge | Connect immediately, discover tools          |
| Bridge starts before Stream Deck  | Start with empty tools, wait for signal      |
| Stream Deck crashes mid-session   | Notify clients, wait for reconnection        |
| Stream Deck restarts              | Receive signal, reconnect, re-discover tools |

**Transport Testing:**

| Transport | Test Cases                                           |
| --------- | ---------------------------------------------------- |
| stdio     | Initialize request, tools/list, tools/call           |
| HTTP      | Session creation, multiple sessions, session cleanup |

### 8.3 Manual Testing Procedures

```bash
# Test stdio transport
pnpm start

# Test HTTP transport
pnpm http
# or
node bin/index.js --http --port 3000

# Test with ngrok
NGROK_AUTHTOKEN=xxx node bin/index.js --http --ngrok

# Health check (HTTP mode)
curl http://localhost:9090/health
```

---

## 9. Deployment Considerations

### 9.1 Distribution

The package is published as `@elgato/mcp-server` to npm registry.

**Published Files:**

- `bin/index.js` - Main entry point
- `bin/McpBridge.js` - MCP server and tool management
- `bin/ClientManager.js` - Multi-app IPC client aggregator
- `bin/IpcClient.js` - Single-app IPC client
- `bin/constants.js` - Platform-specific paths and constants
- `bin/types.js` - TypeScript type definitions
- `bin/utils.js` - Logging and utility functions
- `bin/transports/stdio.js` - stdio transport implementation
- `bin/transports/http.js` - HTTP transport implementation

### 9.2 Installation

```bash
# Global installation
npm install -g @elgato/mcp-server

# Local installation
npm install @elgato/mcp-server
```

### 9.3 Configuration

**Claude Desktop Configuration (`claude_desktop_config.json`):**

```json
{
    "mcpServers": {
        "elgato": {
            "command": "elgato-mcp-server",
            "args": []
        }
    }
}
```

### 9.4 Command-Line Interface

```
Usage: elgato-mcp-server [options]

Options:
  --transport <mode>  Transport mode: 'stdio' (default) or 'http'
  --http              Shorthand for --transport http
  --port <number>     HTTP server port (default: 9090)
  --ngrok             Enable ngrok tunnel (requires NGROK_AUTHTOKEN env var)
  --help, -h          Show help message
  --verbose, -v       Enable info/debug logging (errors and warnings always output)
```

### 9.5 Environment Variables

| Variable          | Purpose                                 |
| ----------------- | --------------------------------------- |
| `NGROK_AUTHTOKEN` | Required for ngrok tunnel functionality |

### 9.6 Runtime Scripts

```bash
# Start with stdio transport (default)
pnpm start

# Start with HTTP transport
pnpm http
```

---

## Appendix A: Type Definitions

### Protocol Types

```typescript
// Request base
interface RequestBase {
    id: string;
    method: string;
}

// Error structure
interface McpError {
    message: string;
    data?: string;
}

// Icon structure
interface McpIcon {
    src: string;
    mimeType?: string;
    sizes?: string[];
    theme?: "dark" | "light";
}

// Tool annotations
interface ToolAnnotations {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
}

// Tool definition
interface McpTool {
    name: string;
    title?: string;
    description?: string;
    inputSchema: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    annotations?: ToolAnnotations;
    icons?: McpIcon[];
    _meta?: Record<string, unknown>;
}

// Response base
interface ResponseBase {
    id: string;
    result?: unknown;
    error?: McpError;
}

// Server info response
interface ServerInfoResponse extends ResponseBase {
    name: string;
    version: string;
    title?: string;
    icons?: McpIcon[];
}

// Tools list response
interface ToolsListResponse extends ResponseBase {
    result: {
        tools: McpTool[];
    };
}

// Resource annotations
interface Annotations {
    audience?: Role[];
    priority?: number;
}

type Role = "user" | "assistant";

// Resource definition
interface McpResource {
    uri: string;
    name: string;
    description?: string;
    mimeType?: string;
    annotations?: Annotations;
    icons?: McpIcon[];
    _meta?: Record<string, unknown>;
}

// Resources list request/response
interface ResourcesListRequest extends RequestBase {
    method: "resources_list";
}

interface ResourcesListResponse extends ResponseBase {
    result?: {
        resources: McpResource[];
    };
}

// Resources read request/response
interface ResourcesReadRequest extends RequestBase {
    method: "resources_read";
    uri: string;
}

interface ResourcesReadResult {
    uri: string;
    mimeType: string;
    content: unknown;
}

interface ResourcesReadResponse extends ResponseBase {
    result?: ResourcesReadResult;
}

// Resources subscribe/unsubscribe requests
interface ResourcesSubscribeRequest extends RequestBase {
    method: "resources_subscribe";
    uri: string;
}

interface ResourcesUnsubscribeRequest extends RequestBase {
    method: "resources_unsubscribe";
    uri: string;
}

// Elicitation types
interface ElicitationParams {
    message: string;
    mode: "form";
    requestedSchema: Record<string, unknown>;
    relatedToolCallId: string;
}

interface ElicitationRequest {
    id: string;
    method: "elicitation/create";
    params: ElicitationParams;
}

interface ElicitationResponse {
    action: "accept" | "cancel" | "decline";
    content?: Record<string, unknown>;
}

type ElicitationCallback = (params: ElicitationParams) => Promise<ElicitationResponse>;
```

### Configuration Types

```typescript
interface Config {
    transport: "http" | "stdio";
    port: number;
    enableNgrok: boolean;
}
```

---

## Appendix B: Sequence Diagrams

### Startup Sequence (Stream Deck Available)

```
┌─────────┐     ┌─────────────┐      ┌───────────┐
│ Bridge  │     │  App (IPC)  │      │MCP Client │
└────┬────┘     └──────┬──────┘      └─────┬─────┘
     │                 │                   │
     │──connect()─────►│                   │
     │◄────connected───│                   │
     │                 │                   │
     │──server_info───►│                   │
     │◄───{name,ver}───│                   │
     │                 │                   │
     │──tools_list────►│                   │
     │◄──{tools:[...]}─│                   │
     │                 │                   │
     │◄────────────────────────initialize──│
     │─────────────────────────{server}───►│
     │                 │                   │
     │◄────────────────────────tools/list──│
     │───────────────────────{tools:[...]}►│
```

### Reconnection Sequence

```
┌─────────┐     ┌─────────────┐      ┌───────────┐
│ Bridge  │     │  App (IPC)  │      │MCP Client │
└────┬────┘     └──────┬──────┘      └─────┬─────┘
     │                 │                   │
     │    (connection lost)                │
     │                 │                   │
     │   (App restarts)                    │
     │                 │                   │
     │◄──signal ready──│                   │
     │──connect()─────►│                   │
     │◄────connected───│                   │
     │                 │                   │
     │──tools_list────►│                   │
     │◄──{tools:[...]}─│                   │
     │                 │                   │
     │───tools/list_changed───────────────►│
     │                 │                   │
     │◄────────────────────────tools/list──│
     │───────────────────────{tools:[...]}►│
```

### Elicitation Sequence (During Tool Call)

```
┌─────────┐     ┌─────────────┐      ┌───────────┐      ┌──────┐
│ Bridge  │     │  App (IPC)  │      │MCP Client │      │ User │
└────┬────┘     └──────┬──────┘      └─────┬─────┘      └──┬───┘
     │                 │                   │               │
     │◄───────────────────────tools/call───│               │
     │──call_tool─────►│                   │               │
     │                 │                   │               │
     │   (Stream Deck needs user input)    │               │
     │                 │                   │               │
     │◄elicitation/cre─│                   │               │
     │──────────elicit_input──────────────►│               │
     │                 │                   │───prompt─────►│
     │                 │                   │◄──response────│
     │◄────────{action,content}────────────│               │
     │──{id,result}───►│                   │               │
     │                 │                   │               │
     │◄──{result}──────│                   │               │
     │──────────────────────{content:[]}──►│               │
```

**Key Points:**

- Elicitation occurs mid-tool-call when Stream Deck needs additional user input
- The bridge holds a reference to the active MCP server during tool execution
- The `elicitInput()` method on the MCP server is used to prompt the user
- Timeout: 300 seconds (configurable via `ELICITATION_TIMEOUT_MS`)
- If timeout or error, the bridge returns `{ action: "decline" }` to Stream Deck
