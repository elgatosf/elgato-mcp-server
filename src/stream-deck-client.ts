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

import { getSocketDescription, getSocketPath } from "./socket-path.js";

// Message framing: each JSON message is terminated by a newline (matches C++ side)
const MESSAGE_DELIMITER = "\n";

// ============================================================================
// Protocol Types (matching mcp_dom.h)
// ============================================================================

/** Base request fields */
interface RequestBase {
	/** Request ID */
	id: string;
	/** Method name */
	method: string;
}

/** Server info request */
interface ServerInfoRequest extends RequestBase {
	/** Method name for server info */
	method: "server_info";
}

/** Tools list request */
interface ToolsListRequest extends RequestBase {
	/** Method name for tools list */
	method: "tools_list";
}

/** Call tool request */
interface CallToolRequest extends RequestBase {
	/** Method name for call tool */
	method: "call_tool";
	/** Name of the tool to call */
	toolName: string;
	/** Arguments for the tool */
	arguments?: Record<string, unknown>;
}

/** Error structure (matches dom::Error) */
export interface McpError {
	/** Error message */
	message: string;
	/** Additional error data */
	data?: string;
}

/** Icon structure (matches dom::Icon) */
export interface McpIcon {
	/** Icon source URL */
	src: string;
	/** MIME type of the icon */
	mimeType?: string;
	/** Icon sizes */
	sizes?: string[];
	/** Icon theme */
	theme?: "dark" | "light";
}

/** Tool annotations (matches dom::ToolAnnotations) */
export interface ToolAnnotations {
	/** Tool title */
	title?: string;
	/** Read-only hint */
	readOnlyHint?: boolean;
	/** Destructive hint */
	destructiveHint?: boolean;
	/** Idempotent hint */
	idempotentHint?: boolean;
	/** Open world hint */
	openWorldHint?: boolean;
}

/** Tool definition from C++ side (matches dom::Tool) */
export interface McpTool {
	/** Tool name */
	name: string;
	/** Tool title */
	title?: string;
	/** Tool description */
	description?: string;
	/** Input schema */
	inputSchema: Record<string, unknown>;
	/** Output schema */
	outputSchema?: Record<string, unknown>;
	/** Tool annotations */
	annotations?: ToolAnnotations;
	/** Tool icons */
	icons?: McpIcon[];
	/** Metadata */
	_meta?: Record<string, unknown>;
}

// ============================================================================
// Response Types (matching mcp_dom.h hierarchy)
// All response types extend ResponseBase which contains the `id` field
// ============================================================================

/** Base response structure (matches dom::ResponseBase) */
interface ResponseBase {
	/** Response ID */
	id: string;
	/** Response result */
	result?: unknown;
	/** Response error */
	error?: McpError;
}

/** Server info response (matches dom::ServerInfoResponse : ResponseBase) */
export interface ServerInfoResponse extends ResponseBase {
	/** Server name */
	name: string;
	/** Server version */
	version: string;
	/** Server title */
	title?: string;
	/** Server icons */
	icons?: McpIcon[];
}

/** Tools list response (matches dom::ListToolsResponse : ResponseBase) */
export interface ToolsListResponse extends ResponseBase {
	/** Response result */
	result: {
		/** List of tools */
		tools: McpTool[];
	};
}

/** Call tool response (matches dom::CallToolResponse : ResponseBase) */
interface CallToolResponse extends ResponseBase {
	/** Response result */
	result: unknown;
}

/** Pending request structure */
interface PendingRequest {
	/** Resolve function */
	resolve: (result: unknown) => void;
	/** Reject function */
	reject: (error: Error) => void;
	/** Timeout handle */
	timeout: NodeJS.Timeout;
}

/**
 * Stream Deck IPC client for communicating with Stream Deck's local socket server.
 */
export class StreamDeckClient {
	// Class properties (alphabetically ordered)
	/** Buffer for incoming data */
	private buffer = "";
	/** Connection status */
	private connected = false;
	/** Initial retry delay in milliseconds */
	private readonly initialRetryDelay = 500; // ms
	/** Maximum number of connection retries */
	private readonly maxRetries = 10;
	/** Maximum retry delay in milliseconds */
	private readonly maxRetryDelay = 30000; // ms
	/** Map of pending requests */
	private pendingRequests = new Map<number | string, PendingRequest>();
	/** Request ID counter */
	private requestId = 0;
	/** Request timeout in milliseconds */
	private readonly requestTimeout = 30000; // ms
	/** Socket connection to Stream Deck */
	private socket: net.Socket | null = null;

	/**
	 * Call a tool on Stream Deck.
	 * @param toolName - Name of the tool to call
	 * @param args - Arguments for the tool
	 * @returns Promise resolving to the tool result
	 */
	public async callTool(toolName: string, args: Record<string, unknown> = {}): Promise<unknown> {
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
	 * Connect to Stream Deck's local socket server with retry logic.
	 */
	public async connect(): Promise<void> {
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
					throw new Error(`Failed to connect to Stream Deck after ${this.maxRetries} attempts: ${error}`);
				}

				console.error(
					`[MCP Bridge] Connection attempt ${retries}/${this.maxRetries} failed, ` + `retrying in ${delay}ms...`,
				);

				await this.sleep(delay);
				// Exponential backoff with jitter
				delay = Math.min(delay * 2 + Math.random() * 100, this.maxRetryDelay);
			}
		}
	}

	/**
	 * Disconnect from Stream Deck.
	 */
	public disconnect(): void {
		if (this.socket) {
			this.socket.destroy();
			this.socket = null;
		}
		this.connected = false;
		this.clearPendingRequests(new Error("Disconnected"));
	}

	/**
	 * Get server info from Stream Deck.
	 * @returns Promise resolving to server info response
	 */
	public async getServerInfo(): Promise<ServerInfoResponse> {
		const request: ServerInfoRequest = {
			id: String(++this.requestId),
			method: "server_info",
		};
		return this.sendRequest(request) as Promise<ServerInfoResponse>;
	}

	/**
	 * Get list of available tools from Stream Deck.
	 * @returns Promise resolving to tools list response
	 */
	public async getToolsList(): Promise<ToolsListResponse> {
		const request: ToolsListRequest = {
			id: String(++this.requestId),
			method: "tools_list",
		};
		return this.sendRequest(request) as Promise<ToolsListResponse>;
	}

	/**
	 * Check if connected to Stream Deck.
	 * @returns True if connected
	 */
	public isConnected(): boolean {
		return this.connected;
	}

	/**
	 * Attempt a single connection to the socket.
	 * @param socketPath - Path to the socket
	 * @returns Promise that resolves when connected
	 */
	private attemptConnection(socketPath: string): Promise<void> {
		return new Promise((resolve, reject) => {
			this.socket = net.createConnection(socketPath);

			/** Handle successful connection */
			const onConnect = (): void => {
				this.connected = true;
				this.socket?.removeListener("error", onError);
				resolve();
			};

			/**
			 * Handle connection error
			 * @param error - Connection error
			 */
			const onError = (error: Error): void => {
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
	 * Clear all pending requests with an error.
	 * @param error - Error to reject pending requests with
	 */
	private clearPendingRequests(error: Error): void {
		for (const [, pending] of this.pendingRequests) {
			clearTimeout(pending.timeout);
			pending.reject(error);
		}
		this.pendingRequests.clear();
	}

	/**
	 * Handle incoming message from Stream Deck.
	 * All response types extend ResponseBase and have an `id` field (matches mcp_dom.h).
	 * @param message - JSON message string
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
				console.error(`[MCP Bridge] Received response for unknown request: ${response.id}`);
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

	/**
	 * Handle socket close event.
	 */
	private onClose(): void {
		console.error("[MCP Bridge] Connection to Stream Deck closed");
		this.connected = false;
		this.clearPendingRequests(new Error("Connection closed"));
	}

	/**
	 * Handle incoming data from the socket.
	 * @param data - Data received from the socket
	 */
	private onData(data: Buffer | string): void {
		this.buffer += data.toString();
		this.processBuffer();
	}

	/**
	 * Handle socket error event.
	 * @param error - Error that occurred
	 */
	private onError(error: Error): void {
		console.error(`[MCP Bridge] Socket error: ${error.message}`);
	}

	/**
	 * Process the buffer to extract complete messages.
	 */
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
	 * Send a request to Stream Deck and wait for response.
	 * @param request - Request to send
	 * @returns Promise resolving to the response
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
	 * Sleep for a specified duration.
	 * @param ms - Milliseconds to sleep
	 * @returns Promise that resolves after the specified duration
	 */
	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
