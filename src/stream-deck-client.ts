/**
 * Stream Deck IPC Client
 *
 * Establishes and maintains IPC connection to Stream Deck application.
 * Implements JSON-over-socket protocol with newline delimiters.
 *
 * Protocol matches mcp_dom.h / serializer.h in Stream Deck codebase.
 */

import * as net from "node:net";
import * as fs from "node:fs";
import { getSignalSocketPath, getSocketPath } from "./socket-path.js";

/** Message delimiter for the JSON-over-socket protocol */
const MESSAGE_DELIMITER = "\n";

// =============================================================================
// Type Definitions
// =============================================================================

/** Base interface for all requests */
interface RequestBase {
	/** Unique request identifier */
	id: string;
	/** Request method name */
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

/** Request for calling a tool on Stream Deck */
interface CallToolRequest extends RequestBase {
	/** Method name for calling a tool */
	method: "call_tool";
	/** Arguments to pass to the tool */
	arguments: Record<string, unknown>;
	/** Name of the tool to call */
	toolName: string;
}

/** Error structure in responses */
interface McpError {
	/** Error message */
	message: string;
	/** Optional additional error data */
	data?: string;
}

/** Icon structure for tools and server info */
export interface McpIcon {
	/** Icon source URL or data */
	src: string;
	/** MIME type of the icon */
	mimeType?: string;
	/** Available icon sizes */
	sizes?: string[];
	/** Icon theme variant */
	theme?: "dark" | "light";
}

/** Tool annotations describing behavior hints */
export interface ToolAnnotations {
	/** Display title for the tool */
	title?: string;
	/** Whether the tool is read-only */
	readOnlyHint?: boolean;
	/** Whether the tool is destructive */
	destructiveHint?: boolean;
	/** Whether the tool is idempotent */
	idempotentHint?: boolean;
	/** Whether the tool operates in an open world */
	openWorldHint?: boolean;
}

/** Tool definition from Stream Deck */
export interface McpTool {
	/** Tool name */
	name: string;
	/** Display title */
	title?: string;
	/** Tool description */
	description?: string;
	/** JSON schema for tool inputs */
	inputSchema: Record<string, unknown>;
	/** JSON schema for tool outputs */
	outputSchema?: Record<string, unknown>;
	/** Tool behavior annotations */
	annotations?: ToolAnnotations;
	/** Tool icons */
	icons?: McpIcon[];
	/** Additional metadata */
	_meta?: Record<string, unknown>;
}

// ============================================================================
// Response Types
// ============================================================================

/** Base interface for all responses */
interface ResponseBase {
	/** Response identifier matching request */
	id: string;
	/** Response result data */
	result?: unknown;
	/** Error information if failed */
	error?: McpError;
}

/** Server info response from Stream Deck */
export interface ServerInfoResponse extends ResponseBase {
	/** Result containing server info */
	result: {
		/** Server name */
		name: string;
		/** Server version */
		version: string;
		/** Display title */
		title?: string;
		/** Server icons */
		icons?: McpIcon[];
	};
}

/** Tools list response from Stream Deck */
export interface ToolsListResponse extends ResponseBase {
	/** Result containing tools array */
	result: {
		/** Array of available tools */
		tools: McpTool[];
	};
}

/** Call tool response from Stream Deck */
export interface CallToolResponse extends ResponseBase {
	/** Result of tool execution */
	result?: unknown;
}

/** Pending request tracking with timeout handling */
interface PendingRequest {
	/** Promise resolve function */
	resolve: (response: ResponseBase) => void;
	/** Promise reject function */
	reject: (error: Error) => void;
	/** Timeout handle for cleanup */
	timeout: NodeJS.Timeout;
}

// =============================================================================
// StreamDeckClient Class
// =============================================================================

/**
 * Client for communicating with Stream Deck via local IPC socket.
 *
 * Features:
 * - Request/response correlation with unique IDs
 * - 30-second request timeout
 * - Signal-based reconnection mechanism
 * - 1MB maximum buffer size protection
 */
export class StreamDeckClient {
	/** Incoming data buffer */
	private buffer = "";

	/** Maximum buffer size to prevent memory exhaustion (1MB) */
	private readonly maxBufferSize = 1024 * 1024;

	/** Map of pending requests awaiting responses */
	private pendingRequests = new Map<string, PendingRequest>();

	/** Callback invoked when Stream Deck becomes ready */
	private readyCallback: (() => void) | null = null;

	/** Counter for generating unique request IDs */
	private requestCounter = 0;

	/** Request timeout in milliseconds (30 seconds) */
	private readonly requestTimeout = 30_000;

	/** Server listening for ready signals from Stream Deck */
	private signalServer: net.Server | null = null;

	/** Socket connection to Stream Deck */
	private socket: net.Socket | null = null;

	/**
	 * Calls a tool on Stream Deck.
	 * @param toolName - Name of the tool to call
	 * @param args - Arguments to pass to the tool
	 * @returns Promise resolving to the tool call response
	 */
	public async callTool(
		toolName: string,
		args: Record<string, unknown>,
	): Promise<CallToolResponse> {
		const request: CallToolRequest = {
			id: this.nextId(),
			method: "call_tool",
			toolName,
			arguments: args,
		};
		const response = await this.sendRequest(request);
		return response as CallToolResponse;
	}

	/**
	 * Attempts to connect to Stream Deck with a timeout.
	 * @param timeoutMs - Connection timeout in milliseconds
	 * @returns Promise that resolves to true if connected, false if timed out
	 */
	public connect(timeoutMs = 1000): Promise<boolean> {
		return new Promise((resolve) => {
			const socketPath = getSocketPath();
			const socket = net.createConnection({ path: socketPath });
			let settled = false;

			const timeout = setTimeout(() => {
				if (!settled) {
					settled = true;
					socket.destroy();
					resolve(false);
				}
			}, timeoutMs);

			socket.on("connect", () => {
				if (!settled) {
					settled = true;
					clearTimeout(timeout);
					this.socket = socket;
					this.setupSocketHandlers();
					console.error("[MCP Bridge] Connected to Stream Deck");
					resolve(true);
				} else {
					// Timeout already fired, clean up
					socket.destroy();
				}
			});

			socket.on("error", () => {
				if (!settled) {
					settled = true;
					clearTimeout(timeout);
					resolve(false);
				}
			});
		});
	}

	/**
	 * Disconnects from Stream Deck and cleans up resources.
	 */
	public disconnect(): void {
		// Reject all pending requests
		for (const [id, pending] of this.pendingRequests) {
			clearTimeout(pending.timeout);
			pending.reject(new Error("Connection closed"));
			this.pendingRequests.delete(id);
		}

		if (this.socket) {
			this.socket.destroy();
			this.socket = null;
		}

		this.buffer = "";
		console.error("[MCP Bridge] Disconnected from Stream Deck");
	}

	/**
	 * Gets server information from Stream Deck.
	 * @returns Promise resolving to server info response
	 */
	public async getServerInfo(): Promise<ServerInfoResponse> {
		const request: ServerInfoRequest = {
			id: this.nextId(),
			method: "server_info",
		};
		const response = await this.sendRequest(request);
		return response as ServerInfoResponse;
	}

	/**
	 * Gets the list of available tools from Stream Deck.
	 * @returns Promise resolving to the tools list response
	 */
	public async getToolsList(): Promise<ToolsListResponse> {
		const request: ToolsListRequest = {
			id: this.nextId(),
			method: "tools_list",
		};
		const response = await this.sendRequest(request);
		return response as ToolsListResponse;
	}

	/**
	 * Checks if the client is currently connected to Stream Deck.
	 * @returns True if connected, false otherwise
	 */
	public isConnected(): boolean {
		return this.socket !== null && !this.socket.destroyed;
	}

	/**
	 * Registers a callback to be invoked when Stream Deck connects/reconnects.
	 * @param callback - Function to call on connection
	 */
	public onConnected(callback: () => void): void {
		this.readyCallback = callback;
	}

	/**
	 * Starts listening for ready signals from Stream Deck.
	 * Stream Deck will connect to this socket when it becomes available.
	 */
	public startSignalServer(): void {
		const signalPath = getSignalSocketPath();

		// Clean up existing socket file on Unix platforms
		if (process.platform === "darwin") {
			try {
				fs.unlinkSync(signalPath);
			} catch {
				// Socket file doesn't exist, which is fine
			}
		}

		this.signalServer = net.createServer((clientSocket) => {
			console.error("[MCP Bridge] Received ready signal from Stream Deck");
			if (this.readyCallback) {
				this.readyCallback();
			}
			clientSocket.end();
		});

		this.signalServer.on("error", (error) => {
			console.error("[MCP Bridge] Signal server error:", error.message);
		});

		this.signalServer.listen(signalPath, () => {
			console.error(`[MCP Bridge] Listening for signals on ${signalPath}`);
		});
	}

	/**
	 * Stops the signal server.
	 */
	public stopSignalServer(): void {
		if (this.signalServer) {
			this.signalServer.close();
			this.signalServer = null;
		}
	}

	// ===========================================================================
	// Private Methods
	// ===========================================================================

	/**
	 * Generates the next unique request ID.
	 * @returns The next unique request ID
	 */
	private nextId(): string {
		return String(++this.requestCounter);
	}

	/**
	 * Handles incoming data from the socket.
	 * @param data - Raw data received from socket
	 */
	private onData(data: Buffer | string): void {
		this.buffer += data.toString();

		// Buffer overflow protection
		if (this.buffer.length > this.maxBufferSize) {
			console.error("[MCP Bridge] Buffer overflow, disconnecting");
			this.disconnect();
			return;
		}

		// Process complete messages
		let delimiterIndex: number;
		while ((delimiterIndex = this.buffer.indexOf(MESSAGE_DELIMITER)) !== -1) {
			const messageStr = this.buffer.slice(0, delimiterIndex);
			this.buffer = this.buffer.slice(delimiterIndex + 1);

			if (messageStr.trim()) {
				this.processMessage(messageStr);
			}
		}
	}

	/**
	 * Processes a complete JSON message.
	 * @param messageStr - The JSON message string to process
	 */
	private processMessage(messageStr: string): void {
		try {
			const response = JSON.parse(messageStr) as ResponseBase;

			const pending = this.pendingRequests.get(response.id);
			if (pending) {
				clearTimeout(pending.timeout);
				this.pendingRequests.delete(response.id);
				pending.resolve(response);
			} else {
				console.error(
					`[MCP Bridge] Received response for unknown request: ${response.id}`,
				);
			}
		} catch (error) {
			console.error("[MCP Bridge] Failed to parse message:", error);
		}
	}

	/**
	 * Sends a request and waits for the response.
	 * @param request - The request to send
	 * @returns Promise resolving to the response
	 */
	private sendRequest(request: RequestBase): Promise<ResponseBase> {
		return new Promise((resolve, reject) => {
			if (!this.isConnected()) {
				reject(new Error("Not connected to Stream Deck"));
				return;
			}

			const timeout = setTimeout(() => {
				this.pendingRequests.delete(request.id);
				reject(new Error(`Request timeout for method: ${request.method}`));
			}, this.requestTimeout);

			this.pendingRequests.set(request.id, {
				resolve,
				reject,
				timeout,
			});

			const message = JSON.stringify(request) + MESSAGE_DELIMITER;
			this.socket!.write(message);
		});
	}

	/**
	 * Sets up socket event handlers.
	 */
	private setupSocketHandlers(): void {
		if (!this.socket) return;

		this.socket.on("data", (data: Buffer) => this.onData(data));

		this.socket.on("close", () => {
			console.error("[MCP Bridge] Connection to Stream Deck closed");
			this.disconnect();
		});

		this.socket.on("error", (error: Error) => {
			console.error("[MCP Bridge] Socket error:", error.message);
			this.disconnect();
		});
	}
}
