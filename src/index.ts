#!/usr/bin/env node
/**
 * Stream Deck MCP Bridge - Main Entry Point
 *
 * Provides a protocol bridge between MCP clients and Stream Deck automation.
 * Supports both stdio (for desktop integration) and HTTP (for web clients) transports.
 *
 * Architecture:
 *   MCP Client <--MCP Transport--> This Bridge <--Unix Socket--> Stream Deck
 *
 * The bridge:
 * 1. Connects to Stream Deck's local socket server
 * 2. Dynamically discovers available tools from Stream Deck
 * 3. Exposes Stream Deck's tools via the MCP protocol
 * 4. Communicates with MCP Clients via stdio or HTTP transport
 *
 * Transport Modes:
 *   - stdio (default): Standard input/output e.g. for Claude Desktop integration
 *   - http: Streamable HTTP transport for web-based clients
 *
 * Tool Discovery:
 *   Tools are NOT hardcoded in this bridge. Instead, when the bridge starts,
 *   it calls `server_info` and `tools_list` methods on Stream Deck to get the
 *   server metadata and list of available tools. This ensures the single source
 *   of truth for tool definitions is the C++ code (register_tools.cpp).
 */

import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
	ListToolsRequestSchema,
	CallToolRequestSchema,
	isInitializeRequest,
	type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import express, { type Request, type Response } from "express";
import cors from "cors";
import ngrok from "@ngrok/ngrok";

import {
	StreamDeckClient,
	type McpTool,
	type ServerInfoResponse,
} from "./stream-deck-client.js";
import { getSocketDescription } from "./socket-path.js";

// =============================================================================
// Configuration Types
// =============================================================================

/** Application configuration */
interface Config {
	/** Transport mode - stdio or http */
	transport: "http" | "stdio";
	/** HTTP server port number */
	port: number;
	/** Whether to enable ngrok tunnel */
	enableNgrok: boolean;
}

// =============================================================================
// Default Values
// =============================================================================

const DEFAULT_SERVER_INFO: ServerInfoResponse = {
	id: "0",
	result: {
		name: "Stream Deck MCP Server",
		version: "1.0.0",
	},
};

const DEFAULT_PORT = 9090;

// =============================================================================
// Global State
// =============================================================================

let cachedTools: McpTool[] = [];
let serverInfo: ServerInfoResponse = DEFAULT_SERVER_INFO;
const streamDeckClient = new StreamDeckClient();

// Track active MCP server sessions for HTTP mode
const activeTransports = new Map<string, StreamableHTTPServerTransport>();
const serversByTransport = new Map<StreamableHTTPServerTransport, McpServer>();

// HTTP server instance for cleanup
let httpServerInstance: ReturnType<typeof express.application.listen> | null =
	null;

// =============================================================================
// Command-Line Argument Parsing
// =============================================================================

/**
 * Parses command-line arguments using node:util parseArgs.
 * @returns Parsed configuration object
 */
function parseCommandLineArgs(): Config {
	const { values } = parseArgs({
		options: {
			transport: {
				type: "string",
				short: "t",
			},
			http: {
				type: "boolean",
			},
			port: {
				type: "string",
				short: "p",
			},
			ngrok: {
				type: "boolean",
			},
			help: {
				type: "boolean",
				short: "h",
			},
		},
		strict: true,
	});

	if (values.help) {
		printHelp();
		process.exit(0);
	}

	const config: Config = {
		transport: "stdio",
		port: DEFAULT_PORT,
		enableNgrok: false,
	};

	// Handle --http shorthand
	if (values.http) {
		config.transport = "http";
	}

	// Handle --transport (overrides --http if both provided)
	if (values.transport) {
		if (values.transport !== "http" && values.transport !== "stdio") {
			console.error(`Invalid transport mode: ${values.transport}`);
			process.exit(1);
		}
		config.transport = values.transport;
	}

	// Handle --port
	if (values.port) {
		const port = parseInt(values.port, 10);
		if (isNaN(port) || port < 1 || port > 65535) {
			console.error(`Invalid port: ${values.port}`);
			process.exit(1);
		}
		config.port = port;
	}

	// Handle --ngrok
	if (values.ngrok) {
		config.enableNgrok = true;
	}

	return config;
}

/**
 * Prints the help message to stdout.
 */
function printHelp(): void {
	console.log(`
Usage: mcp-server-streamdeck [options]

Options:
  --transport <mode>  Transport mode: 'stdio' (default) or 'http'
  --http              Shorthand for --transport http
  --port <number>     HTTP server port (default: ${DEFAULT_PORT})
  --ngrok             Enable ngrok tunnel (requires NGROK_AUTHTOKEN env var)
  --help, -h          Show help message

Examples:
  mcp-server-streamdeck                    # Start with stdio transport
  mcp-server-streamdeck --http             # Start HTTP server on port ${DEFAULT_PORT}
  mcp-server-streamdeck --http --port 3000 # Start HTTP server on port 3000
  mcp-server-streamdeck --http --ngrok     # Start HTTP server with ngrok tunnel
`);
}

// =============================================================================
// Tool Conversion
// =============================================================================

/**
 * Converts Stream Deck tools to MCP Tool format.
 * @param tools - Array of Stream Deck tools
 * @returns Array of MCP-formatted tools
 */
function convertToMcpTools(tools: McpTool[]): Tool[] {
	return tools.map((tool) => {
		// Ensure inputSchema has the required 'type: "object"' field
		// MCP protocol requires inputSchema.type to be exactly "object"
		const inputSchema = {
			type: "object" as const,
			...tool.inputSchema,
		};

		return {
			name: tool.name,
			description: tool.description ?? tool.title ?? tool.name,
			icons: tool.icons,
			inputSchema,
			annotations: tool.annotations,
		};
	});
}

// =============================================================================
// Server and Tool Discovery
// =============================================================================

/**
 * Discovers server info and tools from Stream Deck.
 */
async function discoverServerAndTools(): Promise<void> {
	if (!streamDeckClient.isConnected()) {
		console.error("[MCP Bridge] Cannot discover tools - not connected");
		return;
	}

	try {
		// Get server info
		const info = await streamDeckClient.getServerInfo();
		serverInfo = info;
		console.error(
			`[MCP Bridge] Server: ${info.result.name} v${info.result.version}${info.result.title ? ` (${info.result.title})` : ""}`,
		);

		// Get tools list
		const toolsResponse = await streamDeckClient.getToolsList();
		if (toolsResponse.result?.tools) {
			cachedTools = toolsResponse.result.tools;
			console.error(
				`[MCP Bridge] Discovered ${cachedTools.length} tool(s) from Stream Deck`,
			);
		}
	} catch (error) {
		console.error("[MCP Bridge] Failed to discover tools:", error);
	}
}

/**
 * Notifies all active MCP sessions that tools have changed.
 */
async function notifyToolsChanged(): Promise<void> {
	for (const mcpServer of serversByTransport.values()) {
		try {
			await mcpServer.server.sendToolListChanged();
		} catch {
			// Session may have been closed
		}
	}
}

// =============================================================================
// MCP Server Factory
// =============================================================================

/**
 * Creates and configures an MCP server instance.
 *
 * IMPORTANT: This bridge uses the low-level Server API (via server.server.setRequestHandler)
 * instead of the high-level McpServer.registerTool() API. Here's why:
 *
 * 1. Dynamic Tool Discovery Pattern:
 *    - Tools are discovered from Stream Deck at runtime, not statically defined
 *    - The bridge acts as a proxy between Claude and Stream Deck
 *    - Stream Deck's C++ code is the single source of truth for tool definitions
 *
 * 2. McpServer.registerTool() Limitations:
 *    - Requires registering each tool individually at startup
 *    - Automatically creates a ListToolsRequestSchema handler that returns registered tools
 *    - Cannot dynamically fetch tools from an external source at request time
 *    - Would require duplicating tool definitions from Stream Deck into the bridge
 *
 * 3. Low-Level API Benefits:
 *    - Allows custom ListToolsRequestSchema handler that returns tools from cachedTools
 *    - Enables true proxy behavior: tools flow through without re-registration
 *    - Maintains Stream Deck as the single source of truth
 *    - Supports runtime tool updates via the listChanged capability
 *
 * For more details on McpServer vs Server APIs, see:
 * https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md
 * @returns Configured McpServer instance
 */
function createMcpServer(): McpServer {
	const mcpServer = new McpServer(
		{
			name: serverInfo.result.name,
			version: serverInfo.result.version,
			icons: serverInfo.result.icons,
			title: serverInfo.result.title,
		},
		{
			capabilities: {
				tools: { listChanged: true },
			},
		},
	);

	// Access the low-level server for custom request handlers
	const server = mcpServer.server;

	// Custom ListTools handler - returns cached tools from Stream Deck
	server.setRequestHandler(ListToolsRequestSchema, async () => {
		console.error("[MCP Bridge] ListTools request received");
		return { tools: convertToMcpTools(cachedTools) };
	});

	// Custom CallTool handler - forwards to Stream Deck
	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const { name, arguments: args } = request.params;

		if (!streamDeckClient.isConnected()) {
			return {
				content: [
					{
						type: "text" as const,
						text: "Stream Deck is not connected. Please start Stream Deck and try again.",
					},
				],
				isError: true,
			};
		}

		try {
			const result = await streamDeckClient.callTool(
				name,
				args as Record<string, unknown>,
			);

			if (result.error) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								error: result.error.message,
								details: result.error.data,
							}),
						},
					],
					isError: true,
				};
			}

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(result.result ?? { success: true }),
					},
				],
			};
		} catch (error) {
			return {
				content: [
					{
						type: "text" as const,
						text: error instanceof Error ? error.message : "Unknown error",
					},
				],
				isError: true,
			};
		}
	});

	return mcpServer;
}

// =============================================================================
// Transport Layer Implementations
// =============================================================================

/**
 * Starts the MCP server with stdio transport.
 */
async function startStdioTransport(): Promise<void> {
	console.error("[MCP Bridge] Starting with stdio transport");

	const server = createMcpServer();
	const transport = new StdioServerTransport();

	// Track for tool change notifications
	serversByTransport.set(transport as unknown as StreamableHTTPServerTransport, server);

	await server.connect(transport);
	console.error("[MCP Bridge] MCP server connected via stdio");
}

/**
 * Starts the MCP server with HTTP transport.
 * @param config - Application configuration
 */
async function startHttpTransport(config: Config): Promise<void> {
	console.error(`[MCP Bridge] Starting HTTP server on port ${config.port}`);

	const app = express();
	app.use(express.json());
	app.use(cors());

	// Health check endpoint
	app.get("/health", (_req: Request, res: Response) => {
		res.json({
			status: "ok",
			connected: streamDeckClient.isConnected(),
			toolCount: cachedTools.length,
		});
	});

	// MCP POST endpoint - handles requests
	app.post("/mcp", async (req: Request, res: Response) => {
		const sessionId = req.headers["mcp-session-id"] as string | undefined;
		let transport: StreamableHTTPServerTransport | undefined;

		if (sessionId && activeTransports.has(sessionId)) {
			// Reuse existing session
			transport = activeTransports.get(sessionId);
		} else if (!sessionId && isInitializeRequest(req.body)) {
			// New session initialization
			transport = new StreamableHTTPServerTransport({
				sessionIdGenerator: () => randomUUID(),
				onsessioninitialized: (id) => {
					activeTransports.set(id, transport!);
					console.error(`[MCP Bridge] Session initialized: ${id}`);
				},
				onsessionclosed: (id) => {
					activeTransports.delete(id);
					serversByTransport.delete(transport!);
					console.error(`[MCP Bridge] Session closed: ${id}`);
				},
			});

			transport.onclose = () => {
				if (transport?.sessionId) {
					activeTransports.delete(transport.sessionId);
					serversByTransport.delete(transport);
				}
			};

			const server = createMcpServer();
			serversByTransport.set(transport, server);
			await server.connect(transport);
		} else {
			res.status(400).json({
				jsonrpc: "2.0",
				error: { code: -32000, message: "Invalid session" },
				id: null,
			});
			return;
		}

		if (transport) {
			await transport.handleRequest(req, res, req.body);
		}
	});

	// MCP GET endpoint - SSE stream
	app.get("/mcp", async (req: Request, res: Response) => {
		const sessionId = req.headers["mcp-session-id"] as string;
		const transport = activeTransports.get(sessionId);

		if (transport) {
			await transport.handleRequest(req, res);
		} else {
			res.status(400).send("Invalid session");
		}
	});

	// MCP DELETE endpoint - session cleanup
	app.delete("/mcp", async (req: Request, res: Response) => {
		const sessionId = req.headers["mcp-session-id"] as string;
		const transport = activeTransports.get(sessionId);

		if (transport) {
			await transport.handleRequest(req, res);
		} else {
			res.status(400).send("Invalid session");
		}
	});

	// Start HTTP server
	httpServerInstance = app.listen(config.port, () => {
		console.error(`[MCP Bridge] HTTP server listening on port ${config.port}`);
	});

	// Set up ngrok tunnel if enabled
	if (config.enableNgrok) {
		if (!process.env["NGROK_AUTHTOKEN"]) {
			console.error(
				"[MCP Bridge] Warning: NGROK_AUTHTOKEN not set, ngrok tunnel disabled",
			);
		} else {
			await ngrok.forward({
				addr: config.port,
				authtoken_from_env: true,
			}).then((listener) => {
				console.error(`[MCP Bridge] ngrok tunnel: ${listener.url()}`);
				return listener;
			}).catch((error) => {
				console.error("[MCP Bridge] Failed to start ngrok tunnel:", error);
				return null;
			});
		}
	}
}

// =============================================================================
// Graceful Shutdown
// =============================================================================

/**
 * Handles graceful shutdown of all components.
 */
function shutdown(): void {
	console.error("[MCP Bridge] Shutting down...");

	// Disconnect from Stream Deck
	streamDeckClient.disconnect();
	streamDeckClient.stopSignalServer();

	// Close HTTP server if running
	if (httpServerInstance) {
		httpServerInstance.close();
	}

	// Close all active transports
	for (const transport of activeTransports.values()) {
		try {
			transport.close();
		} catch {
			// Ignore errors during shutdown
		}
	}

	process.exit(0);
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Main entry point for the MCP Bridge.
 */
async function main(): Promise<void> {
	const config = parseCommandLineArgs();

	console.error("[MCP Bridge] Stream Deck MCP Bridge starting...");
	console.error(`[MCP Bridge] ${getSocketDescription()}`);

	// Register shutdown handlers
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	// Register callback for when Stream Deck connects/reconnects
	streamDeckClient.onConnected(async () => {
		console.error("[MCP Bridge] Stream Deck connection established");

		// Try to connect (signal received means Stream Deck is ready)
		const connected = await streamDeckClient.connect();
		if (connected) {
			await discoverServerAndTools();
			await notifyToolsChanged();
		}
	});

	// Start listening for ready signals
	streamDeckClient.startSignalServer();

	// Attempt initial quick connection (1-second timeout)
	console.error("[MCP Bridge] Attempting initial connection to Stream Deck...");
	const initiallyConnected = await streamDeckClient.connect(1000);

	if (initiallyConnected) {
		console.error("[MCP Bridge] Initial connection successful");
		await discoverServerAndTools();
	} else {
		console.error(
			"[MCP Bridge] Stream Deck not available, will connect when ready",
		);
	}

	// Start the appropriate transport
	if (config.transport === "http") {
		await startHttpTransport(config);
	} else {
		await startStdioTransport();
	}
}

// Run main
main().catch((error) => {
	console.error("[MCP Bridge] Fatal error:", error);
	process.exit(1);
});
