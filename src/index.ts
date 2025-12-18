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
				if (!cachedServerInfo) {
					res.status(500).json({
						jsonrpc: "2.0",
						error: { code: -32000, message: "Server info not available" },
						id: null,
					});
					return;
				}

				transport = new StreamableHTTPServerTransport({
					sessionIdGenerator: () => randomUUID(),
					onsessioninitialized: (id) => {
						transports[id] = transport;
						console.error(`[MCP Bridge] HTTP session initialized: ${id}`);
					},
					onsessionclosed: (id) => {
						delete transports[id];
						console.error(`[MCP Bridge] HTTP session closed: ${id}`);
					},
				});

				transport.onclose = () => {
					if (transport.sessionId) {
						delete transports[transport.sessionId];
					}
				};

				// Create a new MCP server for this session
				const server = createServer(cachedServerInfo);
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
 * Connects to Stream Deck, discovers tools, and starts the appropriate transport.
 */
async function main(): Promise<void> {
	const config = parseArgs();

	console.error("[MCP Bridge] Starting Stream Deck MCP Bridge...");
	console.error(`[MCP Bridge] Transport mode: ${config.transport}`);
	console.error(`[MCP Bridge] Connecting to ${getSocketDescription()}`);

	try {
		// Connect to Stream Deck's local socket server
		await streamDeckClient.connect();

		// Discover server info and available tools from Stream Deck
		await discoverServerAndTools();

		if (!cachedServerInfo) {
			throw new Error("Failed to get server info");
		}

		// Initialize transport based on configuration
		if (config.transport === "stdio") {
			// Create MCP server with discovered server info
			const server = createServer(cachedServerInfo);
			await startStdioTransport(server);
		} else {
			// HTTP transport - servers are created per-session
			await startHttpTransport(config.port);

			// Get your endpoint online
			ngrok
				.connect({ addr: config.port, authtoken_from_env: true })
				.then((listener) => console.error(`Ingress established at: ${listener.url()}`))
				.catch((error) => console.error(`Failed to establish ingress: ${error}`));
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
