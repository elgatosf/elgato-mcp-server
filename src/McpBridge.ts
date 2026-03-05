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
	SubscribeRequestSchema,
	UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { ClientManager } from "./ClientManager.js";
import { SDK_NOTIFICATIONS } from "./constants.js";
import type { ClientManagerConfig, ElicitationParams } from "./types.js";
import { log } from "./utils.js";

/**
 * Bridge between MCP protocol and IPC-connected apps.
 *
 * This class acts as a proxy between MCP clients and one or more IPC-connected
 * applications (e.g. Stream Deck), dynamically discovering and exposing their
 * tools and resources through the MCP protocol.
 */
export class McpBridge {
	/** Map of correlation IDs to active MCP servers for routing elicitation requests. */
	private activeToolCalls: Map<string, McpServer> = new Map();
	private readonly clientManager: ClientManager;
	private notificationForwardCallbacks: Array<(method: string, params?: unknown) => Promise<void>> = [];
	private notifyResourcesChangedCallbacks: Array<() => Promise<void>> = [];
	private notifyToolsChangedCallbacks: Array<() => Promise<void>> = [];
	private resourceSubscriptions: Map<McpServer, Set<string>> = new Map();

	/**
	 * Creates a new MCP Bridge instance.
	 * @param clientManager - Optional ClientManager instance for testing.
	 */
	public constructor(clientManager?: ClientManager) {
		this.clientManager = clientManager ?? new ClientManager();
		this.setupClientManagerCallbacks();
	}

	/**
	 * Whether any managed client is connected.
	 */
	public get isConnected(): boolean {
		return this.clientManager.isConnected;
	}

	/**
	 * Closes the bridge and disconnects all managed clients.
	 */
	public close(): void {
		this.activeToolCalls.clear();
		this.resourceSubscriptions.clear();
		this.clientManager.close();
	}

	/**
	 * Creates and configures a new MCP Server instance with handlers.
	 * Uses McpServer with access to the low-level Server API for dynamic tool proxying.
	 * @returns Configured MCP Server.
	 */
	public createServer(): McpServer {
		const serverInfo = this.clientManager.getServerInfo();
		const mcpServer = new McpServer(
			{
				name: serverInfo.name,
				version: serverInfo.version,
				title: serverInfo.title,
				icons: serverInfo.icons,
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
	 * Disposes of a server instance, cleaning up all associated state.
	 * Should be called when an HTTP session ends to prevent memory leaks.
	 * @param mcpServer - The MCP server instance to dispose.
	 */
	public disposeServer(mcpServer: McpServer): void {
		// Remove all resource subscriptions for this server
		this.resourceSubscriptions.delete(mcpServer);

		// Remove any active tool calls that reference this server
		for (const [correlationId, server] of this.activeToolCalls) {
			if (server === mcpServer) {
				this.activeToolCalls.delete(correlationId);
			}
		}
	}

	/**
	 * Initializes the bridge by connecting all managed clients.
	 */
	public async initialize(): Promise<void> {
		log.info("Initializing MCP Bridge...");
		await this.clientManager.initialize();
		log.info("MCP Bridge initialized.");
	}

	/**
	 * Registers a callback to be invoked when a notification from a connected app needs to be forwarded.
	 * This allows MCP clients to receive custom notifications from connected apps.
	 * @param callback - Async callback function receiving the method name and optional params.
	 */
	public onClientNotification(callback: (method: string, params?: unknown) => Promise<void>): void {
		this.notificationForwardCallbacks.push(callback);
	}

	/**
	 * Registers a callback to be invoked when resources change.
	 * @param callback - Async callback function.
	 */
	public onResourcesChanged(callback: () => Promise<void>): void {
		this.notifyResourcesChangedCallbacks.push(callback);
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
				log.error("Failed to forward notification:", error);
			}
		}
	}

	/**
	 * Forwards a resource updated notification to each server that has subscribed to that resource.
	 * @param uri - The resource URI that was updated.
	 */
	private async forwardResourceUpdatedIfSubscribed(uri: string): Promise<void> {
		for (const [server, subs] of this.resourceSubscriptions) {
			if (subs.has(uri)) {
				try {
					await server.server.notification({
						method: SDK_NOTIFICATIONS.RESOURCES_UPDATED,
						params: { uri },
					});
				} catch (error) {
					log.error("Failed to send resource update notification:", error);
				}
			}
		}
	}

	private async handleClientNotification(method: string, params?: unknown): Promise<void> {
		log.debug(`Received notification from client: ${method}`, params);

		switch (method) {
			// TOOLS_LIST_CHANGED and RESOURCES_LIST_CHANGED are handled by ClientManager
			// with refresh-then-notify pattern. No action needed here since ClientManager
			// triggers onToolsChanged/onResourcesChanged callbacks after refreshing cache.
			case SDK_NOTIFICATIONS.TOOLS_LIST_CHANGED:
			case SDK_NOTIFICATIONS.RESOURCES_LIST_CHANGED:
				// Handled by ClientManager - no action needed
				break;
			case SDK_NOTIFICATIONS.RESOURCES_UPDATED: {
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
				log.error("Failed to notify resources changed:", error);
			}
		}
	}

	private async notifyToolsChanged(): Promise<void> {
		for (const callback of this.notifyToolsChangedCallbacks) {
			try {
				await callback();
			} catch (error) {
				log.error("Failed to notify tools changed:", error);
			}
		}
	}

	private registerHandlers(mcpServer: McpServer): void {
		// Access the low-level server for custom request handlers
		const server = mcpServer.server;

		server.setRequestHandler(ListToolsRequestSchema, (): ListToolsResult => {
			if (!this.clientManager.isConnected) {
				return { tools: [] };
			}
			return { tools: this.clientManager.getTools() };
		});

		server.setRequestHandler(CallToolRequestSchema, async (request, extra): Promise<CallToolResult> => {
			const { name, arguments: args = {} } = request.params;

			if (!this.clientManager.isConnected) {
				return {
					content: [{ type: "text", text: "No apps connected" }],
					isError: true,
				};
			}

			// Create correlation ID using session ID and request ID
			// For HTTP mode, sessionId is present; for stdio mode, it's undefined
			const correlationId = extra.sessionId ? `${extra.sessionId}:${extra.requestId}` : String(extra.requestId);

			// Store the McpServer reference for use by the elicitation callback
			this.activeToolCalls.set(correlationId, mcpServer);

			try {
				const response = await this.clientManager.callTool(name, args, correlationId);

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
			} finally {
				// Clear the McpServer reference when the tool call completes
				this.activeToolCalls.delete(correlationId);
			}
		});

		// Resource handlers
		server.setRequestHandler(ListResourcesRequestSchema, (): ListResourcesResult => {
			if (!this.clientManager.isConnected) {
				return { resources: [] };
			}
			return { resources: this.clientManager.getResources() };
		});

		server.setRequestHandler(ReadResourceRequestSchema, async (request): Promise<ReadResourceResult> => {
			const { uri } = request.params;

			if (!this.clientManager.isConnected) {
				throw new Error("No apps connected");
			}

			try {
				const result = await this.clientManager.readResource(uri);
				// Convert IPC format (single resource with content object)
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

			if (!this.clientManager.isConnected) {
				throw new Error("No apps connected");
			}

			try {
				let serverSubs = this.resourceSubscriptions.get(mcpServer);
				if (!serverSubs) {
					serverSubs = new Set();
					this.resourceSubscriptions.set(mcpServer, serverSubs);
				}
				serverSubs.add(uri);
				return {};
			} catch (error) {
				const message = error instanceof Error ? error.message : "Unknown error";
				throw new Error(message);
			}
		});

		server.setRequestHandler(UnsubscribeRequestSchema, async (request): Promise<Record<string, never>> => {
			const { uri } = request.params;

			if (!this.clientManager.isConnected) {
				throw new Error("No apps connected");
			}

			try {
				const serverSubs = this.resourceSubscriptions.get(mcpServer);
				if (serverSubs) {
					serverSubs.delete(uri);
					if (serverSubs.size === 0) {
						this.resourceSubscriptions.delete(mcpServer);
					}
				}
				return {};
			} catch (error) {
				const message = error instanceof Error ? error.message : "Unknown error";
				throw new Error(message);
			}
		});
	}

	private setupClientManagerCallbacks(): void {
		this.clientManager.onToolsChanged(async () => {
			await this.notifyToolsChanged();
		});

		this.clientManager.onResourcesChanged(async () => {
			await this.notifyResourcesChanged();
		});

		this.clientManager.onNotification((method, params) => {
			void this.handleClientNotification(method, params);
		});

		// Handle elicitation requests from connected apps
		this.clientManager.onElicitation(async (params: ElicitationParams) => {
			const { relatedToolCallId } = params;

			// Look up the correct MCP server using the correlation ID
			const targetMcpServer = this.activeToolCalls.get(relatedToolCallId);
			if (!targetMcpServer) {
				log.warn(`No active MCP server found for tool call ${relatedToolCallId}, declining`);
				return { action: "decline" };
			}

			try {
				log.debug(`Forwarding elicitation to MCP client: ${params}`);

				// Cast the schema - connected app provides a JSON Schema object that matches MCP's expected format
				const result = await targetMcpServer.server.elicitInput({
					mode: params.mode,
					message: params.message,
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					requestedSchema: params.requestedSchema as any,
				});

				log.debug(`Elicitation result from MCP client: ${result}`);

				return {
					action: result.action,
					content: result.content,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : "Unknown error";
				log.error("Failed to forward elicitation to MCP client:", message);
				return { action: "decline" };
			}
		});
	}
}

/**
 * Creates and initializes an McpBridge instance.
 * Use this when you need to manage transport connections manually (e.g., HTTP with multiple sessions).
 * @param config - Optional configuration for the ClientManager (e.g., custom app definitions for testing).
 * @returns The initialized bridge.
 */
export async function createInitializedBridge(config?: ClientManagerConfig): Promise<McpBridge> {
	const clientManager = config ? new ClientManager(config) : undefined;
	const bridge = new McpBridge(clientManager);
	await bridge.initialize();
	return bridge;
}

/**
 * Creates an initialized McpBridge and connects it to a transport.
 * Use this for single-transport scenarios (e.g., stdio).
 * @param transport - Transport to connect to.
 * @param config - Optional configuration for the ClientManager (e.g., custom app definitions for testing).
 * @returns The connected bridge.
 */
export async function createConnectedBridge(transport: Transport, config?: ClientManagerConfig): Promise<McpBridge> {
	const bridge = await createInitializedBridge(config);

	const mcpServer = bridge.createServer();
	await mcpServer.connect(transport);

	bridge.onToolsChanged(async () => {
		try {
			await mcpServer.sendToolListChanged();
		} catch (error) {
			log.error("Failed to send tools changed notification:", error);
		}
	});

	bridge.onResourcesChanged(async () => {
		try {
			await mcpServer.sendResourceListChanged();
		} catch (error) {
			log.error("Failed to send resources changed notification:", error);
		}
	});

	bridge.onClientNotification(async (method, params) => {
		try {
			await mcpServer.server.notification({
				method,
				// Preserve original params value (undefined, null, or object) per MCP spec
				params: params as Record<string, unknown> | undefined,
			});
		} catch (error) {
			log.error("Failed to forward client notification:", error);
		}
	});

	return bridge;
}
