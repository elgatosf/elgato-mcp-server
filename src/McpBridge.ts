import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
	CallToolRequestSchema,
	type CallToolResult,
	ListToolsRequestSchema,
	type ListToolsResult,
	type Tool,
} from "@modelcontextprotocol/sdk/types.js";

import { DEFAULT_SERVER_INFO } from "./constants.js";
import { StreamDeckClient } from "./StreamDeckClient.js";
import type { ServerInfo } from "./types.js";
import { convertToMcpTools, log } from "./utils.js";

/**
 * Bridge between MCP protocol and Stream Deck IPC.
 *
 * This class acts as a proxy between MCP clients and the Stream Deck application,
 * dynamically discovering and exposing Stream Deck tools through the MCP protocol.
 */
export class McpBridge {
	private cachedTools: Tool[] = [];
	private client: StreamDeckClient;
	private notifyCallbacks: Array<() => Promise<void>> = [];
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
		} else {
			log("Stream Deck not available, starting in disconnected mode");
		}

		this.client.startSignalListener();
	}

	/**
	 * Registers a callback to be invoked when tools change.
	 * @param callback - Async callback function.
	 */
	public onToolsChanged(callback: () => Promise<void>): void {
		this.notifyCallbacks.push(callback);
	}

	private async notifyToolsChanged(): Promise<void> {
		for (const callback of this.notifyCallbacks) {
			try {
				await callback();
			} catch (error) {
				log("Failed to notify tools changed:", error);
			}
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
	}

	private setupClientCallbacks(): void {
		this.client.onConnected(async () => {
			log("Stream Deck connected, refreshing server info and tools...");
			await this.refreshServerInfo();
			await this.refreshTools();
			await this.notifyToolsChanged();
		});
	}
}

/**
 * Creates an initialized McpBridge and connects it to a transport.
 * @param transport - Transport to connect to.
 * @returns The connected bridge.
 */
export async function createConnectedBridge(transport: Transport): Promise<McpBridge> {
	const bridge = new McpBridge();
	await bridge.initialize();

	const mcpServer = bridge.createServer();
	await mcpServer.connect(transport);

	bridge.onToolsChanged(async () => {
		try {
			await mcpServer.sendToolListChanged();
		} catch (error) {
			log("Failed to send tools changed notification:", error);
		}
	});

	return bridge;
}
