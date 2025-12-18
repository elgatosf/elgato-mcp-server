/**
 * Stream Deck IPC Client
 *
 * Connects to Stream Deck's local socket server and provides an interface
 * for calling methods on the MCP local server.
 *
 * Protocol (matches mcp_dom.h / serializer.h):
 *
 * Requests:
 *   ServerInfoRequest:  { id: string, method: "server_info" }
 *   ToolsListRequest:   { id: string, method: "tools_list" }
 *   CallToolRequest:    { id: string, method: "call_tool", toolName: string, arguments?: object }
 *
 * Responses:
 *   ServerInfoResponse: { id, name, version, title?, icons? }
 *   ListToolsResponse:  { id, result: { tools: Tool[] }, error? }
 *   CallToolResponse:   { id, result: object }
 *   ResponseBase:       { id, result?, error? }  (for errors)
 */

import * as net from "node:net";
import { getSocketPath, getSocketDescription } from "./socket-path.js";

// Message framing: each JSON message is terminated by a newline (matches C++ side)
const MESSAGE_DELIMITER = "\n";

// ============================================================================
// Protocol Types (matching mcp_dom.h)
// ============================================================================

/** Base request fields */
interface RequestBase {
  id: string;
  method: string;
}

/** Server info request */
interface ServerInfoRequest extends RequestBase {
  method: "server_info";
}

/** Tools list request */
interface ToolsListRequest extends RequestBase {
  method: "tools_list";
}

/** Call tool request */
interface CallToolRequest extends RequestBase {
  method: "call_tool";
  toolName: string;
  arguments?: Record<string, unknown>;
}

/** Error structure (matches dom::Error) */
export interface McpError {
  message: string;
  data?: string;
}

/** Icon structure (matches dom::Icon) */
export interface McpIcon {
  src: string;
  mimeType?: string;
  sizes?: string[];
  theme?: "light" | "dark";
}

/** Tool annotations (matches dom::ToolAnnotations) */
export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** Tool definition from C++ side (matches dom::Tool) */
export interface McpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: ToolAnnotations;
  icons?: McpIcon[];
  _meta?: Record<string, unknown>;
}

// ============================================================================
// Response Types (matching mcp_dom.h hierarchy)
// All response types extend ResponseBase which contains the `id` field
// ============================================================================

/** Base response structure (matches dom::ResponseBase) */
interface ResponseBase {
  id: string;
  result?: unknown;
  error?: McpError;
}

/** Server info response (matches dom::ServerInfoResponse : ResponseBase) */
export interface ServerInfoResponse extends ResponseBase {
  name: string;
  version: string;
  title?: string;
  icons?: McpIcon[];
}

/** Tools list response (matches dom::ListToolsResponse : ResponseBase) */
export interface ToolsListResponse extends ResponseBase {
  result: {
    tools: McpTool[];
  };
}

/** Call tool response (matches dom::CallToolResponse : ResponseBase) */
interface CallToolResponse extends ResponseBase {
  result: unknown;
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export class StreamDeckClient {
  private socket: net.Socket | null = null;
  private buffer = "";
  private requestId = 0;
  private pendingRequests = new Map<number | string, PendingRequest>();
  private connected = false;

  // Retry configuration
  private readonly maxRetries = 10;
  private readonly initialRetryDelay = 500; // ms
  private readonly maxRetryDelay = 30000; // ms
  private readonly requestTimeout = 30000; // ms

  /**
   * Connect to Stream Deck's local socket server with retry logic.
   */
  async connect(): Promise<void> {
    const socketPath = getSocketPath();
    let retries = 0;
    let delay = this.initialRetryDelay;

    while (retries < this.maxRetries) {
      try {
        await this.attemptConnection(socketPath);
        console.error(`[MCP Bridge] Connected to ${getSocketDescription()}`);
        return;
      } catch (error) {
        retries++;
        if (retries >= this.maxRetries) {
          throw new Error(
            `Failed to connect to Stream Deck after ${this.maxRetries} attempts: ${error}`
          );
        }

        console.error(
          `[MCP Bridge] Connection attempt ${retries}/${this.maxRetries} failed, ` +
            `retrying in ${delay}ms...`
        );

        await this.sleep(delay);
        // Exponential backoff with jitter
        delay = Math.min(delay * 2 + Math.random() * 100, this.maxRetryDelay);
      }
    }
  }

  private attemptConnection(socketPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(socketPath);

      const onConnect = () => {
        this.connected = true;
        this.socket?.removeListener("error", onError);
        resolve();
      };

      const onError = (error: Error) => {
        this.socket?.removeListener("connect", onConnect);
        this.socket?.destroy();
        this.socket = null;
        reject(error);
      };

      this.socket.once("connect", onConnect);
      this.socket.once("error", onError);

      this.socket.on("data", (data) => this.onData(data));
      this.socket.on("close", () => this.onClose());
      this.socket.on("error", (error) => this.onError(error));
    });
  }

  /**
   * Get server info from Stream Deck.
   */
  async getServerInfo(): Promise<ServerInfoResponse> {
    const request: ServerInfoRequest = {
      id: String(++this.requestId),
      method: "server_info",
    };
    return this.sendRequest(request) as Promise<ServerInfoResponse>;
  }

  /**
   * Get list of available tools from Stream Deck.
   */
  async getToolsList(): Promise<ToolsListResponse> {
    const request: ToolsListRequest = {
      id: String(++this.requestId),
      method: "tools_list",
    };
    return this.sendRequest(request) as Promise<ToolsListResponse>;
  }

  /**
   * Call a tool on Stream Deck.
   */
  async callTool(
    toolName: string,
    args: Record<string, unknown> = {}
  ): Promise<unknown> {
    const request: CallToolRequest = {
      id: String(++this.requestId),
      method: "call_tool",
      toolName,
      arguments: args,
    };
    const response = (await this.sendRequest(request)) as CallToolResponse;
    return response.result;
  }

  /**
   * Send a request to Stream Deck and wait for response.
   */
  private sendRequest(request: RequestBase): Promise<unknown> {
    if (!this.connected || !this.socket) {
      throw new Error("Not connected to Stream Deck");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(new Error(`Request timeout for method: ${request.method}`));
      }, this.requestTimeout);

      this.pendingRequests.set(request.id, { resolve, reject, timeout });

      const message = JSON.stringify(request) + MESSAGE_DELIMITER;

      console.error(`[MCP Bridge] Sending message: ${message}`);

      this.socket!.write(message);
    });
  }

  /**
   * Disconnect from Stream Deck.
   */
    disconnect(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
    this.clearPendingRequests(new Error("Disconnected"));
  }

  isConnected(): boolean {
    return this.connected;
  }

  private onData(data: Buffer | string): void {
    this.buffer += data.toString();
    this.processBuffer();
  }

  private processBuffer(): void {
    let delimiterIndex: number;
    while ((delimiterIndex = this.buffer.indexOf(MESSAGE_DELIMITER)) !== -1) {
      const message = this.buffer.slice(0, delimiterIndex);
      this.buffer = this.buffer.slice(delimiterIndex + 1);

      if (message.trim()) {
        this.handleMessage(message);
      }
    }
  }

  /**
   * Handle incoming message from Stream Deck.
   * All response types extend ResponseBase and have an `id` field (matches mcp_dom.h).
   */
  private handleMessage(message: string): void {
    console.error(`[MCP Bridge] Received message: ${message}`);
    try {
      const response = JSON.parse(message) as ResponseBase;

      if (response.id === null || response.id === undefined) {
        // Notification from server (no id), ignore for now
        return;
      }

      const pending = this.pendingRequests.get(response.id);
      if (!pending) {
        console.error(
          `[MCP Bridge] Received response for unknown request: ${response.id}`
        );
        return;
      }

      this.pendingRequests.delete(response.id);
      clearTimeout(pending.timeout);

      if (response.error) {
        pending.reject(new Error(response.error.message));
      } else {
        pending.resolve(response);
      }
    } catch (error) {
      console.error(`[MCP Bridge] Failed to parse response: ${error}`);
    }
  }

  private onClose(): void {
    console.error("[MCP Bridge] Connection to Stream Deck closed");
    this.connected = false;
    this.clearPendingRequests(new Error("Connection closed"));
  }

  private onError(error: Error): void {
    console.error(`[MCP Bridge] Socket error: ${error.message}`);
  }

  private clearPendingRequests(error: Error): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
