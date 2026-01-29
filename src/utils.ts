import { parseArgs } from "node:util";
import type { Resource, Tool } from "@modelcontextprotocol/sdk/types.js";

import { LOG_PREFIX } from "./constants.js";
import type { CliOptions, McpResource, McpTool } from "./types.js";

/**
 * Converts Stream Deck tools to MCP tool format.
 * @param tools - Array of McpTool definitions.
 * @returns Array of MCP Tool definitions.
 */
export function convertToMcpTools(tools: McpTool[]): Tool[] {
	return tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		inputSchema: {
			type: "object" as const,
			...tool.inputSchema,
		},
		annotations: tool.annotations,
		icons: tool.icons,
	}));
}

/**
 * Converts Stream Deck resources to MCP resource format.
 * @param resources - Array of McpResource definitions.
 * @returns Array of MCP Resource definitions.
 */
export function convertToMcpResources(resources: McpResource[]): Resource[] {
	return resources.map((resource) => ({
		uri: resource.uri,
		name: resource.name,
		title: resource.title,
		description: resource.description,
		mimeType: resource.mimeType,
		icons: resource.icons,
		annotations: resource.annotations,
		_meta: resource._meta,
	}));
}

/**
 * Logs a message to stderr with the MCP Bridge prefix.
 * @param args - Arguments to log.
 */
export function log(...args: unknown[]): void {
	console.error(LOG_PREFIX, ...args);
}

/**
 * Parses command line arguments into CLI options.
 * @param args - Array of command line arguments.
 * @returns Parsed CLI options.
 */
export function parseCliArgs(args: string[]): CliOptions {
	const { values } = parseArgs({
		args,
		options: {
			transport: {
				type: "string" as const,
				default: "stdio",
			},
			http: {
				type: "boolean" as const,
				default: false,
			},
			port: {
				type: "string" as const,
				default: "9090",
			},
			ngrok: {
				type: "boolean" as const,
				default: false,
			},
			help: {
				type: "boolean" as const,
				short: "h",
				default: false,
			},
		},
		strict: false,
		allowPositionals: true,
	});

	// Handle --http shorthand by setting transport to "http"
	const transport = values.http ? "http" : (values.transport as "http" | "stdio");

	// Parse port string to number and validate range
	const port = parseInt(values.port as string, 10);
	const validPort = !isNaN(port) && port >= 1 && port <= 65535 ? port : 9090;

	return {
		transport,
		port: validPort,
		ngrok: values.ngrok as boolean,
		help: values.help as boolean,
	};
}

/**
 * Prints CLI help message to stdout.
 */
export function printHelp(): void {
	console.log(`
Usage: mcp-server-streamdeck [options]

Options:
  --transport <mode>  Transport mode: 'stdio' (default) or 'http'
  --http              Shorthand for --transport http
  --port <number>     HTTP server port (default: 9090)
  --ngrok             Enable ngrok tunnel (requires NGROK_AUTHTOKEN env var)
  --help, -h          Show help message
`);
}
