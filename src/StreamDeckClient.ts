import * as fs from "node:fs";
import * as net from "node:net";

import {
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
	IpcResponse,
	McpTool,
	PendingRequest,
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
	private onConnectedCallback: (() => void) | null = null;
	private onDisconnectedCallback: (() => void) | null = null;
	private pendingRequests = new Map<string, PendingRequest>();
	private pollInterval: NodeJS.Timeout | null = null;
	private requestId = 0;
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
		serverFactory: ServerFactory = (listener) => net.createServer(listener)
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
	 * @returns The tool call response.
	 */
	public async callTool(toolName: string, args: Record<string, unknown>): Promise<CallToolResponse> {
		const request: Omit<CallToolRequest, "id"> = {
			method: "call_tool",
			toolName,
			arguments: args,
		};

		return this.sendRequest<CallToolResponse>(request);
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
	 * Starts listening for ready signals from Stream Deck.
	 * Attempts to create a signal server for instant notifications.
	 * Falls back to polling only if the signal server cannot be created.
	 */
	public startSignalListener(): void {
		// Try to claim the signal socket - polling will start only if this fails
		this.tryStartSignalServer();
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
			console.error(`${LOG_PREFIX} Buffer overflow, clearing buffer`);
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

	private handleError(error: Error): void {
		console.error(`${LOG_PREFIX} Socket error:`, error.message);
	}

	private async handleReadySignal(): Promise<void> {
		const connected = await this.connect();
		if (connected && this.onConnectedCallback) {
			this.onConnectedCallback();
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

	private processMessage(message: string): void {
		try {
			const response = JSON.parse(message) as IpcResponse;
			const pending = this.pendingRequests.get(response.id);

			if (pending) {
				clearTimeout(pending.timeout);
				this.pendingRequests.delete(response.id);
				pending.resolve(response);
			}
		} catch (error) {
			console.error(`${LOG_PREFIX} Failed to parse message:`, error);
		}
	}

	private async sendRequest<T extends IpcResponse>(request: object): Promise<T> {
		if (!this.socket || this.socket.destroyed) {
			throw new Error("Not connected to Stream Deck");
		}

		const id = String(++this.requestId);
		const fullRequest = { ...request, id };

		return new Promise<T>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pendingRequests.delete(id);
				reject(new Error("Request timeout"));
			}, REQUEST_TIMEOUT_MS);

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
