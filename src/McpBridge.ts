import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
	CallToolRequestSchema,
	type CallToolResult,
	ListResourcesRequestSchema,
	type ListResourcesResult,
	ListToolsRequestSchema,
	type ListToolsResult,
	ReadResourceRequestSchema,
	type ReadResourceResult,
	type Resource,
	SubscribeRequestSchema,
	type Tool,
	UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { DEFAULT_SERVER_INFO, SDK_NOTIFICATIONS } from "./constants.js";
import { StreamDeckClient } from "./StreamDeckClient.js";
import type { ServerInfo } from "./types.js";
import { convertToMcpResources, convertToMcpTools, log } from "./utils.js";

/**
 * Bridge between MCP protocol and Stream Deck IPC.
 *
 * This class acts as a proxy between MCP clients and the Stream Deck application,
 * dynamically discovering and exposing Stream Deck tools through the MCP protocol.
 */
export class McpBridge {
	private cachedResources: Resource[] = [];
	private cachedTools: Tool[] = [];
	private client: StreamDeckClient;
	private notificationForwardCallbacks: Array<(method: string, params?: unknown) => Promise<void>> = [];
	private notifyResourcesChangedCallbacks: Array<() => Promise<void>> = [];
	private notifyToolsChangedCallbacks: Array<() => Promise<void>> = [];
	private resourceSubscriptions: Set<string> = new Set();
	private serverInfo: ServerInfo = DEFAULT_SERVER_INFO;

	/**
	 * Creates a new MCP Bridge instance.
	 * @param client - Optional StreamDeckClient instance for testing
	 */
	public constructor(client?: StreamDeckClient) {
		this.client = client ?? new StreamDeckClient();
		this.setupClientCallbacks();
	}

	/**
	 * Whether the Stream Deck client is connected.
	 */
	public get isConnected(): boolean {
		return this.client.isConnected;
	}

	/**
	 * Closes the bridge and disconnects from Stream Deck.
	 */
	public close(): void {
		this.client.disconnect();
	}

	/**
	 * Creates and configures a new MCP Server instance with handlers.
	 * Uses McpServer with access to the low-level Server API for dynamic tool proxying.
	 * @returns Configured MCP Server.
	 */
	public createServer(): McpServer {
		const mcpServer = new McpServer(
			{
				name: this.serverInfo.name,
				version: this.serverInfo.version,
				title: this.serverInfo.title,
				icons: this.serverInfo.icons,
			},
			{
				capabilities: {
					tools: { listChanged: true },
					resources: { subscribe: true, listChanged: true },
				},
			},
		);

		this.registerHandlers(mcpServer);
		return mcpServer;
	}

	/**
	 * Initializes the bridge by connecting to Stream Deck.
	 */
	public async initialize(): Promise<void> {
		log("Initializing MCP Bridge...");

		const connected = await this.client.connect();

		if (connected) {
			log("Connected to Stream Deck");
			await this.refreshServerInfo();
			await this.refreshTools();
			await this.refreshResources();
		} else {
			log("Stream Deck not available, starting in disconnected mode");
		}

		this.client.startSignalListener();
	}

	/**
	 * Registers a callback to be invoked when resources change.
	 * @param callback - Async callback function.
	 */
	public onResourcesChanged(callback: () => Promise<void>): void {
		this.notifyResourcesChangedCallbacks.push(callback);
	}

	/**
	 * Registers a callback to be invoked when a notification from Stream Deck needs to be forwarded.
	 * This allows MCP clients to receive custom notifications from Stream Deck.
	 * @param callback - Async callback function receiving the method name and optional params.
	 */
	public onStreamDeckNotification(callback: (method: string, params?: unknown) => Promise<void>): void {
		this.notificationForwardCallbacks.push(callback);
	}

	/**
	 * Registers a callback to be invoked when tools change.
	 * @param callback - Async callback function.
	 */
	public onToolsChanged(callback: () => Promise<void>): void {
		this.notifyToolsChangedCallbacks.push(callback);
	}

	private async forwardNotification(method: string, params?: unknown): Promise<void> {
		for (const callback of this.notificationForwardCallbacks) {
			try {
				await callback(method, params);
			} catch (error) {
				log("Failed to forward notification:", error);
			}
		}
	}

	/**
	 * Forwards a resource updated notification only if the client has subscribed to that resource.
	 * @param uri - The resource URI that was updated.
	 */
	private async forwardResourceUpdatedIfSubscribed(uri: string): Promise<void> {
		if (this.resourceSubscriptions.has(uri)) {
			await this.forwardNotification(SDK_NOTIFICATIONS.RESOURCES_UPDATED, { uri });
		}
	}

	private async handleStreamDeckNotification(method: string, params?: unknown): Promise<void> {
		log(`Received notification from Stream Deck: ${method}`, params);

		switch (method) {
			case SDK_NOTIFICATIONS.TOOLS_LIST_CHANGED:
				// Stream Deck notified that tools have changed, refresh and notify MCP clients
				await this.refreshTools();
				await this.notifyToolsChanged();
				break;
			case SDK_NOTIFICATIONS.RESOURCES_LIST_CHANGED:
				// Stream Deck notified that resources list has changed, refresh and notify MCP clients
				await this.refreshResources();
				await this.notifyResourcesChanged();
				break;
			case SDK_NOTIFICATIONS.RESOURCES_UPDATED: {
				// Stream Deck notified that a specific resource was updated
				// Only forward if client has subscribed to this resource
				await this.refreshResources();
				const resourceParams = params as { uri: string } | undefined;
				if (resourceParams?.uri) {
					await this.forwardResourceUpdatedIfSubscribed(resourceParams.uri);
				}
				break;
			}
			default:
				// Forward all other notifications to MCP clients
				await this.forwardNotification(method, params);
				break;
		}
	}

	private async notifyResourcesChanged(): Promise<void> {
		for (const callback of this.notifyResourcesChangedCallbacks) {
			try {
				await callback();
			} catch (error) {
				log("Failed to notify resources changed:", error);
			}
		}
	}

	private async notifyToolsChanged(): Promise<void> {
		for (const callback of this.notifyToolsChangedCallbacks) {
			try {
				await callback();
			} catch (error) {
				log("Failed to notify tools changed:", error);
			}
		}
	}

	private async refreshResources(): Promise<void> {
		try {
			const resources = await this.client.getResources();
			this.cachedResources = convertToMcpResources(resources);
			log(`Discovered ${this.cachedResources.length} resources`);
		} catch (error) {
			log("Failed to refresh resources:", error);
		}
	}

	private async refreshServerInfo(): Promise<void> {
		try {
			const info = await this.client.getServerInfo();
			if (info) {
				this.serverInfo = info;
				log("Server info updated");
			}
		} catch (error) {
			log("Failed to refresh server info:", error);
		}
	}

	private async refreshTools(): Promise<void> {
		try {
			const tools = await this.client.getTools();
			this.cachedTools = convertToMcpTools(tools);
			log(`Discovered ${this.cachedTools.length} tools`);
		} catch (error) {
			log("Failed to refresh tools:", error);
		}
	}

	private registerHandlers(mcpServer: McpServer): void {

		// Access the low-level server for custom request handlers
		const server = mcpServer.server;

		server.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => {
			if (!this.client.isConnected) {
				return { tools: [] };
			}
			if (this.cachedTools.length === 0) {
				await this.refreshTools();
			}
			return { tools: this.cachedTools };
		});

		server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
			const { name, arguments: args = {} } = request.params;

			if (!this.client.isConnected) {
				return {
					content: [{ type: "text", text: "Stream Deck is not connected" }],
					isError: true,
				};
			}

			try {
				const response = await this.client.callTool(name, args);

				if (response.error) {
					return {
						content: [{ type: "text", text: response.error.message }],
						isError: true,
					};
				}

				const result = response.result;
				if (result?.error) {
					return {
						content: [{ type: "text", text: result.error }],
						isError: true,
					};
				}

				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : "Unknown error";
				return {
					content: [{ type: "text", text: message }],
					isError: true,
				};
			}
		});

		// Resource handlers
		server.setRequestHandler(ListResourcesRequestSchema, async (): Promise<ListResourcesResult> => {
			if (!this.client.isConnected) {
				return { resources: [] };
			}
			if (this.cachedResources.length === 0) {
				await this.refreshResources();
			}
			return { resources: this.cachedResources };
		});

		server.setRequestHandler(ReadResourceRequestSchema, async (request): Promise<ReadResourceResult> => {
			const { uri } = request.params;

			if (!this.client.isConnected) {
				throw new Error("Stream Deck is not connected");
			}

			try {
				const result = await this.client.readResource(uri);
				// Convert Stream Deck format (single resource with content object)
				// to MCP format (contents array with text/blob)
				const contents = [
					{
						uri: result.uri,
						mimeType: result.mimeType,
						text: JSON.stringify(result.content),
					},
				];
				return { contents };
			} catch (error) {
				const message = error instanceof Error ? error.message : "Unknown error";
				throw new Error(message);
			}
		});

		server.setRequestHandler(SubscribeRequestSchema, async (request): Promise<Record<string, never>> => {
			const { uri } = request.params;

			if (!this.client.isConnected) {
				throw new Error("Stream Deck is not connected");
			}

			try {
				this.resourceSubscriptions.add(uri);
				return {};
			} catch (error) {
				const message = error instanceof Error ? error.message : "Unknown error";
				throw new Error(message);
			}
		});

		server.setRequestHandler(UnsubscribeRequestSchema, async (request): Promise<Record<string, never>> => {
			const { uri } = request.params;

			if (!this.client.isConnected) {
				throw new Error("Stream Deck is not connected");
			}

			try {
				this.resourceSubscriptions.delete(uri);
				return {};
			} catch (error) {
				const message = error instanceof Error ? error.message : "Unknown error";
				throw new Error(message);
			}
		});
	}

	private setupClientCallbacks(): void {
		this.client.onConnected(async () => {
			log("Stream Deck connected, refreshing server info and tools...");
			await this.refreshServerInfo();
			await this.refreshTools();
			await this.notifyToolsChanged();
			await this.refreshResources();
			await this.notifyResourcesChanged();
		});

		this.client.onDisconnected(async () => {
			log("Stream Deck disconnected, clearing tools...");
			this.cachedTools = [];
			await this.notifyToolsChanged();
			await this.notifyResourcesChanged();
		});

		this.client.onNotification((method, params) => {
			void this.handleStreamDeckNotification(method, params);
		});
	}
}

/**
 * Creates and initializes an McpBridge instance.
 * Use this when you need to manage transport connections manually (e.g., HTTP with multiple sessions).
 * @returns The initialized bridge.
 */
export async function createInitializedBridge(): Promise<McpBridge> {
	const bridge = new McpBridge();
	await bridge.initialize();
	return bridge;
}

/**
 * Creates an initialized McpBridge and connects it to a transport.
 * Use this for single-transport scenarios (e.g., stdio).
 * @param transport - Transport to connect to.
 * @returns The connected bridge.
 */
export async function createConnectedBridge(transport: Transport): Promise<McpBridge> {
	const bridge = await createInitializedBridge();

	const mcpServer = bridge.createServer();
	await mcpServer.connect(transport);

	bridge.onToolsChanged(async () => {
		try {
			await mcpServer.sendToolListChanged();
		} catch (error) {
			log("Failed to send tools changed notification:", error);
		}
	});

	bridge.onResourcesChanged(async () => {
		try {
			await mcpServer.sendResourceListChanged();
		} catch (error) {
			log("Failed to send resources changed notification:", error);
		}
	});

	bridge.onStreamDeckNotification(async (method, params) => {
		try {
			await mcpServer.server.notification({
				method,
				// Preserve original params value (undefined, null, or object) per MCP spec
				params: params as Record<string, unknown> | undefined,
			});
		} catch (error) {
			log("Failed to forward Stream Deck notification:", error);
		}
	});

	return bridge;
}
