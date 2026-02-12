import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as net from "node:net";

import {
	ELICITATION_TIMEOUT_MS,
	LOG_PREFIX,
	MAX_BUFFER_SIZE,
	QUICK_CONNECT_TIMEOUT_MS,
	RECONNECT_POLL_INTERVAL_MS,
	REQUEST_TIMEOUT_MS,
	SIGNAL_SOCKET_PATH,
	SOCKET_PATH,
} from "./constants.js";
import type {
	CallToolRequest,
	CallToolResponse,
	ElicitationCallback,
	ElicitationRequest,
	ElicitationResponse,
	IpcResponse,
	McpResource,
	McpTool,
	Notification,
	NotificationCallback,
	PendingRequest,
	ResourcesListRequest,
	ResourcesListResponse,
	ResourcesReadRequest,
	ResourcesReadResponse,
	ResourcesReadResult,
	ServerInfo,
	ServerInfoRequest,
	ServerInfoResponse,
	ToolsListRequest,
	ToolsListResponse,
} from "./types.js";

/**
 * Factory function type for creating sockets.
 */
export type SocketFactory = (path: string) => net.Socket;

/**
 * Factory function type for creating servers.
 */
export type ServerFactory = (connectionListener?: (socket: net.Socket) => void) => net.Server;

/**
 * Client for communicating with Stream Deck via IPC socket.
 */
export class StreamDeckClient {
	private buffer = "";
	private elicitationCallback: ElicitationCallback | null = null;
	private notificationCallbacks: NotificationCallback[] = [];
	private onConnectedCallback: (() => void) | null = null;
	private onDisconnectedCallback: (() => void) | null = null;
	private pendingRequests = new Map<string, PendingRequest>();
	private pollInterval: NodeJS.Timeout | null = null;
	private readonly serverFactory: ServerFactory;
	private signalServer: net.Server | null = null;
	private socket: net.Socket | null = null;
	private readonly socketFactory: SocketFactory;

	/**
	 * Creates a new StreamDeckClient instance.
	 * @param socketFactory - Optional factory function for creating sockets (for testing).
	 * @param serverFactory - Optional factory function for creating servers (for testing).
	 */
	constructor(
		socketFactory: SocketFactory = (path: string) => net.createConnection(path),
		serverFactory: ServerFactory = (listener) => net.createServer(listener),
	) {
		this.socketFactory = socketFactory;
		this.serverFactory = serverFactory;
	}

	/**
	 * Whether the client is currently connected to Stream Deck.
	 */
	public get isConnected(): boolean {
		return this.socket !== null && !this.socket.destroyed;
	}

	/**
	 * Invokes a tool on Stream Deck.
	 * @param toolName - Name of the tool to invoke.
	 * @param args - Arguments to pass to the tool.
	 * @param requestId - Optional request ID to use for correlation. If provided, must be unique.
	 * @returns The tool call response.
	 */
	public async callTool(
		toolName: string,
		args: Record<string, unknown>,
		requestId?: string,
	): Promise<CallToolResponse> {
		const request: Omit<CallToolRequest, "id"> = {
			method: "call_tool",
			toolName,
			arguments: args,
		};

		return this.sendRequest<CallToolResponse>(request, requestId);
	}

	/**
	 * Attempts to connect to Stream Deck via IPC socket.
	 * @param timeoutMs - Connection timeout in milliseconds.
	 * @returns Whether connection was successful.
	 */
	public async connect(timeoutMs = QUICK_CONNECT_TIMEOUT_MS): Promise<boolean> {
		return new Promise((resolve) => {
			const socket = this.socketFactory(SOCKET_PATH);

			const timeoutId = setTimeout(() => {
				socket.destroy();
				resolve(false);
			}, timeoutMs);

			socket.on("connect", () => {
				clearTimeout(timeoutId);
				this.socket = socket;
				this.setupSocketHandlers();
				resolve(true);
			});

			socket.on("error", () => {
				clearTimeout(timeoutId);
				resolve(false);
			});
		});
	}

	/**
	 * Disconnects from Stream Deck and stops the signal listener.
	 */
	public disconnect(): void {
		this.socket?.destroy();
		this.socket = null;
		this.signalServer?.close();
		this.signalServer = null;

		if (this.pollInterval) {
			clearInterval(this.pollInterval);
			this.pollInterval = null;
		}
	}

	/**
	 * Gets the list of available resources from Stream Deck.
	 * @returns Array of resource definitions.
	 */
	public async getResources(): Promise<McpResource[]> {
		const request: Omit<ResourcesListRequest, "id"> = { method: "resources_list" };
		const response = await this.sendRequest<ResourcesListResponse>(request);

		if (response.error) {
			throw new Error(response.error.message);
		}

		return response.result?.resources ?? [];
	}

	/**
	 * Gets server info from Stream Deck.
	 * @returns Server info or null if unavailable.
	 */
	public async getServerInfo(): Promise<ServerInfo | null> {
		const request: Omit<ServerInfoRequest, "id"> = { method: "server_info" };
		const response = await this.sendRequest<ServerInfoResponse>(request);

		if (response.error) {
			throw new Error(response.error.message);
		}

		return response.result ?? null;
	}

	/**
	 * Gets the list of available tools from Stream Deck.
	 * @returns Array of tool definitions.
	 */
	public async getTools(): Promise<McpTool[]> {
		const request: Omit<ToolsListRequest, "id"> = { method: "tools_list" };
		const response = await this.sendRequest<ToolsListResponse>(request);

		if (response.error) {
			throw new Error(response.error.message);
		}

		return response.result?.tools ?? [];
	}

	/**
	 * Registers a callback to be invoked when Stream Deck connects.
	 * @param callback - Callback function.
	 */
	public onConnected(callback: () => void): void {
		this.onConnectedCallback = callback;
	}

	/**
	 * Registers a callback to be invoked when Stream Deck disconnects.
	 * @param callback - Callback function.
	 */
	public onDisconnected(callback: () => void): void {
		this.onDisconnectedCallback = callback;
	}

	/**
	 * Registers a callback to handle elicitation requests from Stream Deck.
	 * Only one callback can be registered at a time.
	 * The callback receives elicitation params and must return a response.
	 * @param callback - Async callback function that handles elicitation requests.
	 */
	public onElicitation(callback: ElicitationCallback): void {
		this.elicitationCallback = callback;
	}

	/**
	 * Registers a callback to be invoked when a notification is received from Stream Deck.
	 * Multiple callbacks can be registered.
	 * @param callback - Callback function that receives the method name and optional params.
	 */
	public onNotification(callback: NotificationCallback): void {
		this.notificationCallbacks.push(callback);
	}

	/**
	 * Reads a resource by URI from Stream Deck.
	 * @param uri - The resource URI to read.
	 * @returns The resource read result containing contents.
	 */
	public async readResource(uri: string): Promise<ResourcesReadResult> {
		const request: Omit<ResourcesReadRequest, "id"> = { method: "resources_read", uri };
		const response = await this.sendRequest<ResourcesReadResponse>(request);

		if (response.error) {
			throw new Error(response.error.message);
		}

		if (!response.result) {
			throw new Error("No result returned from Stream Deck");
		}

		return response.result;
	}

	/**
	 * Starts listening for ready signals from Stream Deck.
	 * Attempts to create a signal server for instant notifications.
	 * Falls back to polling only if the signal server cannot be created.
	 */
	public startSignalListener(): void {
		// Try to claim the signal socket - polling will start only if this fails
		this.tryStartSignalServer();
	}

	/**
	 * Creates a timeout that rejects a pending request after the specified duration.
	 * @param requestId - The ID of the request to timeout.
	 * @param reject - The reject function from the request's promise.
	 * @param timeoutMs - Timeout duration in milliseconds.
	 * @returns The timeout handle.
	 */
	private createRequestTimeout(requestId: string, reject: (error: Error) => void, timeoutMs: number): NodeJS.Timeout {
		return setTimeout(() => {
			this.pendingRequests.delete(requestId);
			reject(new Error("Request timeout"));
		}, timeoutMs);
	}

	/**
	 * Extends the timeout for a pending request by resetting its timer.
	 * Used when an elicitation request is received to allow time for user input.
	 * @param requestId - The ID of the pending request to extend.
	 * @param timeoutMs - New timeout duration in milliseconds (defaults to ELICITATION_TIMEOUT_MS).
	 * @returns True if the request was found and extended, false otherwise.
	 */
	private extendRequestTimeout(requestId: string, timeoutMs: number = ELICITATION_TIMEOUT_MS): boolean {
		const pending = this.pendingRequests.get(requestId);
		if (!pending) return false;

		clearTimeout(pending.timeout);
		pending.timeout = this.createRequestTimeout(requestId, pending.reject, timeoutMs);
		return true;
	}

	private handleClose(): void {
		this.socket = null;
		this.buffer = "";

		for (const [id, pending] of this.pendingRequests) {
			clearTimeout(pending.timeout);
			pending.reject(new Error("Connection closed"));
			this.pendingRequests.delete(id);
		}

		// Notify that we've disconnected
		if (this.onDisconnectedCallback) {
			this.onDisconnectedCallback();
		}

		// Start polling for reconnection only if we don't own the signal server
		// If we own the signal server, we'll get notified when StreamDeck is ready
		if (!this.signalServer) {
			this.startPolling();
		}
	}

	private handleData(data: Buffer | string): void {
		this.buffer += typeof data === "string" ? data : data.toString();

		if (this.buffer.length > MAX_BUFFER_SIZE) {
			console.error(`${LOG_PREFIX}: Buffer overflow, clearing buffer`);
			this.buffer = "";
			return;
		}

		let newlineIndex: number;
		while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
			const message = this.buffer.slice(0, newlineIndex);
			this.buffer = this.buffer.slice(newlineIndex + 1);

			if (message.trim()) {
				this.processMessage(message);
			}
		}
	}

	/**
	 * Handles an elicitation request from Stream Deck.
	 * Invokes the registered callback and sends the response back to Stream Deck.
	 * @param request - The elicitation request from Stream Deck.
	 */
	private async handleElicitationRequest(request: ElicitationRequest): Promise<void> {
		const { id, params } = request;

		let response: ElicitationResponse;

		console.error(`${LOG_PREFIX}: Elicitation request received: `, params);

		// Extend the timeout for the related tool call while waiting for user input
		if (params.relatedToolCallId) {
			const extended = this.extendRequestTimeout(params.relatedToolCallId, ELICITATION_TIMEOUT_MS);
			if (extended) {
				console.error(`${LOG_PREFIX}: Extended timeout for related tool call: ${params.relatedToolCallId}`);
			}
		}

		if (!this.elicitationCallback) {
			// No callback registered - decline the request
			console.error(`${LOG_PREFIX}: No elicitation callback registered, declining request`);
			response = { action: "decline" };
		} else {
			// Capture timer ID to ensure cleanup after Promise.race() resolves
			let timeoutId: NodeJS.Timeout;
			try {
				// Create a promise that will timeout after ELICITATION_TIMEOUT_MS
				const timeoutPromise = new Promise<ElicitationResponse>((_, reject) => {
					timeoutId = setTimeout(() => {
						reject(new Error("Elicitation timeout"));
					}, ELICITATION_TIMEOUT_MS);
				});

				// Race between the callback and the timeout
				response = await Promise.race([this.elicitationCallback(params), timeoutPromise]);
			} catch (error) {
				const message = error instanceof Error ? error.message : "Unknown error";
				console.error(`${LOG_PREFIX}: Elicitation callback error:`, message);
				response = { action: "decline" };
			} finally {
				// Always clear the timeout to prevent timer accumulation
				clearTimeout(timeoutId!);
			}
		}

		// Send response back to Stream Deck
		this.sendElicitationResponse(id, response);
	}

	private handleError(error: Error): void {
		console.error(`${LOG_PREFIX} Socket error:`, error.message);
	}

	/**
	 * Handles a notification by invoking all registered callbacks.
	 * Each callback is wrapped in try-catch for error isolation.
	 * @param notification - The notification received from Stream Deck.
	 */
	private handleNotification(notification: Notification): void {
		for (const callback of this.notificationCallbacks) {
			try {
				callback(notification.method, notification.params);
			} catch (callbackError) {
				console.error(`${LOG_PREFIX} Notification callback error:`, callbackError);
			}
		}
	}

	private async handleReadySignal(): Promise<void> {
		const connected = await this.connect();
		if (connected && this.onConnectedCallback) {
			this.onConnectedCallback();
		}
	}

	/**
	 * Handles an IPC response by matching it to a pending request.
	 * Clears the timeout, removes from pending requests, and resolves the promise.
	 * @param response - The IPC response to handle.
	 */
	private handleResponse(response: IpcResponse): void {
		const pending = this.pendingRequests.get(response.id);

		if (pending) {
			clearTimeout(pending.timeout);
			this.pendingRequests.delete(response.id);
			pending.resolve(response);
		}
	}

	/**
	 * Handles EADDRINUSE error by checking if the socket is stale.
	 * If stale, removes the socket file and retries binding.
	 * If active, another process owns it - we don't retry.
	 */
	private handleSocketInUse(): void {
		// On Windows, named pipes don't leave stale files
		if (process.platform === "win32") {
			console.error(`${LOG_PREFIX} Signal socket in use by another process`);
			return;
		}

		// Check if the socket file exists and has an active listener
		this.isSocketActive(SIGNAL_SOCKET_PATH).then((isActive) => {
			if (isActive) {
				// Another process is actively listening - don't retry
				console.error(`${LOG_PREFIX} Signal socket in use by another process`);
			} else {
				// Socket file is stale - remove it and retry
				console.error(`${LOG_PREFIX} Removing stale signal socket file`);
				try {
					fs.unlinkSync(SIGNAL_SOCKET_PATH);
				} catch {
					// File doesn't exist or can't be removed
				}
				// Retry binding after removing stale socket
				this.startSignalListener();
			}
		});
	}

	/**
	 * Type guard to check if an object is an elicitation request.
	 * An elicitation request has both `id` and `method: "elicitation/create"`.
	 * @param obj - The object to check.
	 * @returns True if the object is an elicitation request.
	 */
	private isElicitationRequest(obj: object): obj is ElicitationRequest {
		const record = obj as Record<string, unknown>;
		return (
			"id" in obj &&
			typeof record.id === "string" &&
			"method" in obj &&
			record.method === "elicitation/create" &&
			"params" in obj &&
			record.params !== null &&
			typeof record.params === "object"
		);
	}

	/**
	 * Type guard to check if an object is an IPC response.
	 * A response has an `id` field of type string but no `method` field.
	 * @param obj - The object to check.
	 * @returns True if the object is an IPC response.
	 */
	private isIpcResponse(obj: object): obj is IpcResponse {
		const record = obj as Record<string, unknown>;
		return "id" in obj && typeof record.id === "string" && !("method" in obj);
	}

	/**
	 * Type guard to check if an object is a notification.
	 * A notification has a `method` field of type string but no `id` field.
	 * @param obj - The object to check.
	 * @returns True if the object is a notification.
	 */
	private isNotification(obj: object): obj is Notification {
		const record = obj as Record<string, unknown>;
		return "method" in obj && typeof record.method === "string" && !("id" in obj);
	}

	/**
	 * Checks if a socket file exists and has an active listener.
	 * @param socketPath - Path to the socket file.
	 * @returns Promise that resolves to true if socket is active, false if stale or missing.
	 */
	private isSocketActive(socketPath: string): Promise<boolean> {
		return new Promise((resolve) => {
			// Check if file exists first
			if (!fs.existsSync(socketPath)) {
				resolve(false);
				return;
			}

			// Try to connect to see if there's an active listener
			const testSocket = net.createConnection(socketPath);
			const timeout = setTimeout(() => {
				testSocket.destroy(); // Force close on timeout
				resolve(false);
			}, 100);

			testSocket.on("connect", () => {
				clearTimeout(timeout);
				testSocket.end(); // Graceful close - we confirmed it's active
				resolve(true);
			});

			testSocket.on("error", () => {
				clearTimeout(timeout);
				testSocket.destroy(); // Already errored, just clean up
				resolve(false); // Socket file exists but no listener (stale)
			});
		});
	}

	/**
	 * Parses and processes an incoming IPC message.
	 * Delegates to handleElicitationRequest(), handleResponse(), or handleNotification() based on message type.
	 * @param message - The raw IPC message string to parse and process.
	 */
	private processMessage(message: string): void {
		try {
			const parsed = JSON.parse(message) as unknown;

			// Type guard for objects
			if (typeof parsed !== "object" || parsed === null) {
				return;
			}

			// Check elicitation first since it has both id and method
			if (this.isElicitationRequest(parsed)) {
				void this.handleElicitationRequest(parsed);
			} else if (this.isIpcResponse(parsed)) {
				this.handleResponse(parsed);
			} else if (this.isNotification(parsed)) {
				this.handleNotification(parsed);
			}
		} catch (error) {
			console.error(`${LOG_PREFIX} Failed to parse message:`, error);
		}
	}

	/**
	 * Sends an elicitation response back to Stream Deck.
	 * Uses the original request's id for correlation.
	 * @param id - The id from the original elicitation request.
	 * @param response - The elicitation response to send.
	 */
	private sendElicitationResponse(id: string, response: ElicitationResponse): void {
		if (!this.socket || this.socket.destroyed) {
			console.error(`${LOG_PREFIX} Cannot send elicitation response: not connected`);
			return;
		}

		const ipcResponse = {
			id,
			method: "elicitation/response",
			result: response,
		};

		this.socket.write(JSON.stringify(ipcResponse) + "\n");
	}

	private async sendRequest<T extends IpcResponse>(request: object, requestId?: string): Promise<T> {
		if (!this.socket || this.socket.destroyed) {
			throw new Error("Not connected to Stream Deck");
		}

		// Use provided requestId or generate a new one
		let id: string;
		if (requestId !== undefined) {
			// Check for collision with existing pending request
			if (this.pendingRequests.has(requestId)) {
				console.error(`${LOG_PREFIX} Request ID collision: ${requestId} is already pending, cancelling request`);
				throw new Error(`Request ID collision: ${requestId} is already pending`);
			}
			id = requestId;
		} else {
			id = randomUUID();
		}

		const fullRequest = { ...request, id };

		return new Promise<T>((resolve, reject) => {
			const timeout = this.createRequestTimeout(id, reject, REQUEST_TIMEOUT_MS);

			this.pendingRequests.set(id, {
				resolve: resolve as (response: IpcResponse) => void,
				reject,
				timeout,
			});

			this.socket!.write(JSON.stringify(fullRequest) + "\n");
		});
	}

	private setupSocketHandlers(): void {
		if (!this.socket) return;

		this.socket.on("data", (data) => this.handleData(data));
		this.socket.on("close", () => this.handleClose());
		this.socket.on("error", (error) => this.handleError(error));
	}

	/**
	 * Starts polling to periodically check if Stream Deck is available.
	 * Used as a fallback for clients that don't own the signal server.
	 */
	private startPolling(): void {
		if (this.pollInterval) return;

		this.pollInterval = setInterval(() => {
			if (!this.isConnected) {
				void this.handleReadySignal();
			}
		}, RECONNECT_POLL_INTERVAL_MS);
	}

	/**
	 * Attempts to start the signal server in a non-destructive way.
	 * If the socket is already in use by another client, starts polling as a fallback.
	 */
	private tryStartSignalServer(): void {
		if (this.signalServer) return;

		this.signalServer = this.serverFactory((connection) => {
			console.error(`${LOG_PREFIX} Received ready signal from Stream Deck`);
			connection.end();
			void this.handleReadySignal();
		});

		this.signalServer.on("error", (error: NodeJS.ErrnoException) => {
			if (error.code === "EADDRINUSE") {
				// Socket is in use by another process - start polling as fallback
				console.error(`${LOG_PREFIX} Signal socket in use by another process, relying on polling`);
				this.signalServer?.close();
				this.signalServer = null;
				this.handleSocketInUse();
				// Start polling only if handleSocketInUse did not successfully recreate the signal server
				if (!this.signalServer) {
					this.startPolling();
				}
			}
		});

		this.signalServer.listen(SIGNAL_SOCKET_PATH, () => {
			console.error(`${LOG_PREFIX} Listening for ready signals on ${SIGNAL_SOCKET_PATH}`);
		});
	}
}
