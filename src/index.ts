#!/usr/bin/env node
/**
 * Stream Deck MCP Bridge
 *
 * This bridge connects Claude Desktop to Stream Deck via the MCP protocol.
 *
 * Architecture:
 *   Claude Desktop <--MCP Transport--> This Bridge <--Unix Socket--> Stream Deck
 *
 * The bridge:
 * 1. Connects to Stream Deck's local socket server (MCPLocalServer)
 * 2. Dynamically discovers available tools from Stream Deck
 * 3. Exposes Stream Deck's tools via the MCP protocol
 * 4. Communicates with Claude Desktop via stdio or HTTP transport
 *
 * Transport Modes:
 *   - stdio (default): Standard input/output for Claude Desktop integration
 *   - http: Streamable HTTP transport for web-based clients
 *
 * Tool Discovery:
 *   Tools are NOT hardcoded in this bridge. Instead, when the bridge starts,
 *   it calls `server_info` and `tools_list` methods on Stream Deck to get the
 *   server metadata and list of available tools. This ensures the single source
 *   of truth for tool definitions is the C++ code (register_tools.cpp).
 *
 * Protocol (matches mcp_dom.h):
 *   - server_info: Returns server name, version, title, icons
 *   - tools_list:  Returns array of Tool objects
 *   - call_tool:   Invokes a tool by name with arguments
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
	CallToolRequestSchema,
	type CallToolResult,
	isInitializeRequest,
	ListToolsRequestSchema,
	type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import ngrok from "@ngrok/ngrok";
import cors from "cors";
import express from "express";
import { randomUUID } from "node:crypto";
import { parseArgs as utilParseArgs } from "node:util";

import { getSocketDescription } from "./socket-path.js";
import { type McpTool, type ServerInfoResponse, StreamDeckClient } from "./stream-deck-client.js";

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration for the MCP bridge.
 */
interface Config {
	/** Transport mode: stdio or http */
	transport: "http" | "stdio";
	/** Port number for HTTP transport */
	port: number;
}

/**
 * Default server info to use when StreamDeck is not available or not yet connected.
 */
const DEFAULT_SERVER_INFO: ServerInfoResponse = {
	id: "0",
	name: "Stream Deck MCP Server",
	version: "1.0.0",
};

/**
 * Parse command-line arguments to determine transport mode and configuration.
 * Uses Node.js built-in util.parseArgs() for robust argument parsing.
 * @returns Parsed configuration object
 */
function parseArgs(): Config {
	const options = {
		transport: {
			type: "string" as const,
		},
		http: {
			type: "boolean" as const,
		},
		port: {
			type: "string" as const,
		},
		help: {
			type: "boolean" as const,
			short: "h",
		},
	};

	let parsed;
	try {
		parsed = utilParseArgs({
			options,
			strict: true,
			allowPositionals: false,
		});
	} catch (error) {
		console.error(`[MCP Bridge] Error parsing arguments: ${error instanceof Error ? error.message : error}`);
		console.error(`[MCP Bridge] Use --help for usage information.`);
		process.exit(1);
	}

	// Handle help flag
	if (parsed.values.help) {
		console.error(`
Stream Deck MCP Bridge

Usage: streamdeck-mcp-bridge [options]

Options:
  --transport <mode>  Transport mode: 'stdio' (default) or 'http'
  --http              Shorthand for --transport http
  --port <number>     HTTP server port (default: 9090), enables HTTP transport mode if other not provided
  --help, -h          Show this help message

Examples:
  streamdeck-mcp-bridge                    # Use stdio transport (default)
  streamdeck-mcp-bridge --http             # Use HTTP transport on port 9090
  streamdeck-mcp-bridge --transport http --port 3000
      `);
		process.exit(0);
	}

	// Initialize config with defaults
	const config: Config = {
		transport: "stdio",
		port: 9090,
	};

	// Handle --http flag (shorthand for --transport http)
	if (parsed.values.http) {
		config.transport = "http";
	}

	// Handle --port option
	if (parsed.values.port !== undefined) {
		const port = parseInt(parsed.values.port, 10);
		if (isNaN(port) || port < 1 || port > 65535) {
			console.error(`[MCP Bridge] Invalid port: ${parsed.values.port}. Must be between 1 and 65535.`);
			process.exit(1);
		}
		config.port = port;
		config.transport = "http";
	}

	// Handle --transport option (overrides --http if both are provided)
	if (parsed.values.transport !== undefined) {
		const transport = parsed.values.transport;
		if (transport === "stdio" || transport === "http") {
			config.transport = transport;
		} else {
			console.error(`[MCP Bridge] Invalid transport: ${transport}. Use 'stdio' or 'http'.`);
			process.exit(1);
		}
	}

	return config;
}

// ============================================================================
// Global State
// ============================================================================

// Stream Deck client for IPC communication
const streamDeckClient = new StreamDeckClient();

// Cached server info and tool definitions from Stream Deck
let cachedServerInfo: ServerInfoResponse | null = null;
let cachedTools: McpTool[] = [];

// MCP server instance (for sending notifications when tools change)
// For stdio transport: single server instance
let mcpServer: McpServer | null = null;

// For HTTP transport: map of session ID to MCP server instance
const httpMcpServers: Map<string, McpServer> = new Map();

// ============================================================================
// Tool Discovery
// ============================================================================

/**
 * Fetch server info and available tools from Stream Deck.
 * This is called once on startup to populate the caches.
 */
async function discoverServerAndTools(): Promise<void> {
	console.error("[MCP Bridge] Discovering server info from Stream Deck...");

	// Get server info
	cachedServerInfo = await streamDeckClient.getServerInfo();
	console.error(
		`[MCP Bridge] Server: ${cachedServerInfo.name} v${cachedServerInfo.version}` +
			(cachedServerInfo.title ? ` (${cachedServerInfo.title})` : ""),
	);

	// Get tools list
	console.error("[MCP Bridge] Discovering tools from Stream Deck...");
	const toolsResponse = await streamDeckClient.getToolsList();

	if (toolsResponse.error) {
		throw new Error(`Failed to get tools: ${toolsResponse.error.message}`);
	}

	cachedTools = toolsResponse.result.tools;
	console.error(`[MCP Bridge] Discovered ${cachedTools.length} tools:`);

	for (const tool of cachedTools) {
		console.error(`[MCP Bridge]   - ${tool.name}: ${tool.description ?? "(no description)"}`);
	}
}

/**
 * Handle StreamDeck connection - discover tools and notify clients.
 * This is called both on initial connection and on reconnection.
 */
async function onStreamDeckConnected(): Promise<void> {
	try {

		// Discover server info and tools
		await discoverServerAndTools();

		// Notify MCP clients that tools have changed
		// For stdio transport
		if (mcpServer) {
			console.error("[MCP Bridge] Notifying stdio client that tools list has changed");
			await mcpServer.sendToolListChanged();
		}

		// For HTTP transport - notify all active sessions
		if (httpMcpServers.size > 0) {
			console.error(`[MCP Bridge] Notifying ${httpMcpServers.size} HTTP session(s) that tools list has changed`);
			const notifications = Array.from(httpMcpServers.values()).map((server) => server.sendToolListChanged());
			await Promise.all(notifications);
		}
	} catch (error) {
		console.error(`[MCP Bridge] Error discovering tools: ${error}`);
	}
}

/**
 * Connect to StreamDeck in the background and discover tools when connected.
 * This function does not block - it returns immediately and handles connection asynchronously.
 */
async function connectToStreamDeckInBackground(): Promise<void> {
	try {
		console.error("[MCP Bridge] Attempting to connect to Stream Deck in background...");

		// Set up callback for when connection is established (or re-established)
		streamDeckClient.onConnected(onStreamDeckConnected);

		// Start connection attempt (this will wait for StreamDeck if not available)
		await streamDeckClient.connect();
	} catch (error) {
		console.error(`[MCP Bridge] Background connection error: ${error}`);
		// Don't crash - just log the error and continue without StreamDeck
	}
}

/**
 * Convert Stream Deck tool descriptors to MCP Tool format.
 * @param tools - Array of Stream Deck tool descriptors
 * @returns Array of MCP Tool objects
 */
function convertToMcpTools(tools: McpTool[]): Tool[] {
	return tools.map((tool) => ({
		name: tool.name,
		description: tool.description ?? tool.title ?? tool.name,
		icons: tool.icons,
		inputSchema: {
			type: "object" as const,
			...tool.inputSchema,
		},
	}));
}

// ============================================================================
// MCP Server Setup
// ============================================================================

/**
 * Create and configure the MCP server with dynamic tool handling.
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
 * @param serverInfo - Server information from Stream Deck
 * @returns Configured MCP server instance
 */
function createServer(serverInfo: ServerInfoResponse): McpServer {
	const server = new McpServer(
		{ name: serverInfo.name, version: serverInfo.version, title: serverInfo.title, icons: serverInfo.icons },
		{ capabilities: { tools: { listChanged: true } } },
	);

	// Use low-level Server API for dynamic tool handling
	// McpServer exposes the underlying Server instance via the 'server' property
	// for advanced operations like setting custom request handlers

	// Handle tools/list request - return dynamically discovered tools from Stream Deck
	server.server.setRequestHandler(ListToolsRequestSchema, async () => {
		return {
			tools: convertToMcpTools(cachedTools),
		};
	});

	// Handle tools/call request - forward to Stream Deck
	server.server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
		const { name, arguments: args } = request.params;

		// Check if StreamDeck is connected
		if (!streamDeckClient.isConnected()) {
			return {
				content: [
					{
						type: "text",
						text: `Stream Deck is not connected. Please start Stream Deck and try again.`,
					},
				],
				isError: true,
			};
		}

		// Find the tool in our cache to validate it exists
		const tool = cachedTools.find((t) => t.name === name);
		if (!tool) {
			return {
				content: [{ type: "text", text: `Unknown tool: ${name}` }],
				isError: true,
			};
		}

		try {
			// Forward the tool call to Stream Deck
			const result = await streamDeckClient.callTool(name, (args as Record<string, unknown>) ?? {});

			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		} catch (error) {
			return {
				content: [{ type: "text", text: `Error: ${error}` }],
				isError: true,
			};
		}
	});

	return server;
}

// ============================================================================
// Transport Initialization
// ============================================================================

/**
 * Start the MCP server with stdio transport.
 * @param server - The MCP server instance to connect
 */
async function startStdioTransport(server: McpServer): Promise<void> {
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error("[MCP Bridge] MCP server running on stdio transport");
}

/**
 * Start the MCP server with HTTP transport.
 * @param port - Port number for the HTTP server
 */
async function startHttpTransport(port: number): Promise<void> {
	const app = express();
	app.use(cors());
	app.use(express.json());

	// Store active transports by session ID
	const transports: Record<string, StreamableHTTPServerTransport> = {};

	// POST /mcp - Handle MCP requests
	app.post("/mcp", async (req, res) => {
		try {
			const sessionId = req.headers["mcp-session-id"] as string | undefined;
			let transport: StreamableHTTPServerTransport;

			if (sessionId && transports[sessionId]) {
				// Reuse existing session
				transport = transports[sessionId];
			} else if (!sessionId && isInitializeRequest(req.body)) {
				// New session initialization
				// Use cached server info if available, otherwise use default
				const serverInfo = cachedServerInfo ?? DEFAULT_SERVER_INFO;

				// Create a new MCP server for this session
				const server = createServer(serverInfo);

				transport = new StreamableHTTPServerTransport({
					sessionIdGenerator: () => randomUUID(),
					onsessioninitialized: (id) => {
						transports[id] = transport;
						httpMcpServers.set(id, server);
						console.error(`[MCP Bridge] HTTP session initialized: ${id}`);
					},
					onsessionclosed: (id) => {
						delete transports[id];
						httpMcpServers.delete(id);
						console.error(`[MCP Bridge] HTTP session closed: ${id}`);
					},
				});

				transport.onclose = () => {
					if (transport.sessionId) {
						delete transports[transport.sessionId];
						httpMcpServers.delete(transport.sessionId);
					}
				};

				await server.connect(transport);
			} else {
				res.status(400).json({
					jsonrpc: "2.0",
					error: { code: -32000, message: "Invalid session" },
					id: null,
				});
				return;
			}

			await transport.handleRequest(req, res, req.body);
		} catch (error) {
			console.error(`[MCP Bridge] Error handling POST request: ${error}`);
			res.status(500).json({
				jsonrpc: "2.0",
				error: { code: -32000, message: `Internal error: ${error}` },
				id: null,
			});
		}
	});

	// GET /mcp - Handle SSE streams for notifications
	app.get("/mcp", async (req, res) => {
		try {
			const sessionId = req.headers["mcp-session-id"] as string;
			const transport = transports[sessionId];

			if (transport) {
				await transport.handleRequest(req, res);
			} else {
				res.status(400).send("Invalid session");
			}
		} catch (error) {
			console.error(`[MCP Bridge] Error handling GET request: ${error}`);
			res.status(500).send(`Internal error: ${error}`);
		}
	});

	// DELETE /mcp - Handle session cleanup
	app.delete("/mcp", async (req, res) => {
		try {
			const sessionId = req.headers["mcp-session-id"] as string;
			const transport = transports[sessionId];

			if (transport) {
				await transport.handleRequest(req, res);
			} else {
				res.status(400).send("Invalid session");
			}
		} catch (error) {
			console.error(`[MCP Bridge] Error handling DELETE request: ${error}`);
			res.status(500).send(`Internal error: ${error}`);
		}
	});

	// Health check endpoint
	app.get("/health", (_req, res) => {
		res.json({
			status: "ok",
			transport: "http",
			streamDeckConnected: streamDeckClient.isConnected(),
			activeSessions: Object.keys(transports).length,
		});
	});

	// Start HTTP server
	return new Promise((resolve, reject) => {
		const server = app.listen(port, () => {
			console.error(`[MCP Bridge] HTTP server listening on http://localhost:${port}/mcp`);
			console.error(`[MCP Bridge] Health check available at http://localhost:${port}/health`);
			resolve();
		});

		server.on("error", (error: NodeJS.ErrnoException) => {
			if (error.code === "EADDRINUSE") {
				console.error(`[MCP Bridge] Port ${port} is already in use`);
				reject(new Error(`Port ${port} is already in use. Try a different port with --port <number>`));
			} else {
				console.error(`[MCP Bridge] HTTP server error: ${error.message}`);
				reject(error);
			}
		});
	});
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Main entry point for the MCP bridge.
 * Tries to connect to Stream Deck first to get actual server info.
 * If not available, starts with default info and connects in background.
 */
async function main(): Promise<void> {
	const config = parseArgs();

	console.error("[MCP Bridge] Starting Stream Deck MCP Bridge...");
	console.error(`[MCP Bridge] Transport mode: ${config.transport}`);

	try {
		// Try to connect to StreamDeck immediately to get actual server info
		let serverInfo = DEFAULT_SERVER_INFO;
		console.error(`[MCP Bridge] Attempting quick connection to ${getSocketDescription()}...`);

		try {
			// Try a quick connection with short timeout
			await streamDeckClient.connectWithTimeout(2000);

			// If successful, discover server info and tools
			await discoverServerAndTools();

			if (cachedServerInfo) {
				serverInfo = cachedServerInfo;
				console.error("[MCP Bridge] Using actual Stream Deck server info");
			}
		} catch (error) {
			console.error(`[MCP Bridge] Quick connection failed: ${error}`);
			console.error("[MCP Bridge] Will use default server info and connect in background");
		}

		// Initialize transport based on configuration
		if (config.transport === "stdio") {
			// Create MCP server with discovered or default server info
			mcpServer = createServer(serverInfo);
			await startStdioTransport(mcpServer);
		} else {
			// HTTP transport - servers are created per-session
			await startHttpTransport(config.port);

			// Get your endpoint online
			ngrok
				.connect({ addr: config.port, authtoken_from_env: true })
				.then((listener) => console.error(`Ingress established at: ${listener.url()}`))
				.catch((error) => console.error(`Failed to establish ingress: ${error}`));
		}

		// If we didn't connect successfully, connect in the background
		if (!streamDeckClient.isConnected()) {
			console.error(`[MCP Bridge] Will connect to ${getSocketDescription()} in background...`);
			connectToStreamDeckInBackground().catch((error) => {
				console.error(`[MCP Bridge] Background connection failed: ${error}`);
			});
		}

		// Handle graceful shutdown
		const shutdown = async () => {
			console.error("[MCP Bridge] Shutting down...");
			streamDeckClient.disconnect();
			process.exit(0);
		};

		process.on("SIGINT", shutdown);
		process.on("SIGTERM", shutdown);
	} catch (error) {
		console.error(`[MCP Bridge] Fatal error: ${error}`);
		process.exit(1);
	}
}

// Run the bridge
main().catch((error) => {
	console.error(`[MCP Bridge] Unhandled error: ${error}`);
	process.exit(1);
});
