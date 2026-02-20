import type { Resource, Tool } from "@modelcontextprotocol/sdk/types.js";
import { parseArgs } from "node:util";

import { LOG_PREFIX, TOOL_PREFIX_SEPARATOR } from "./constants.js";
import type { CliOptions, McpResource, McpTool } from "./types.js";

let verbose = false;

/**
 * Enables or disables verbose logging.
 * @param enabled - Whether to enable verbose logging.
 */
export function setVerbose(enabled: boolean): void {
	verbose = enabled;
}

/**
 * Prefixes a tool or resource name with an app name using the standard separator.
 * @param appName - The app name to use as prefix (e.g. `"streamdeck"`).
 * @param itemName - The tool or resource name/URI to prefix.
 * @returns The prefixed name in the format `appName__itemName`.
 */
export function prefixName(appName: string, itemName: string): string {
	return `${appName}${TOOL_PREFIX_SEPARATOR}${itemName}`;
}

/**
 * Splits a prefixed name into app name and item name at the first separator occurrence.
 * @param prefixedName - The prefixed name in the format `appName__itemName`.
 * @returns Object with `appName` and `itemName`, or `null` if no prefix separator found.
 */
export function unprefixName(prefixedName: string): { appName: string; itemName: string } | null {
	const idx = prefixedName.indexOf(TOOL_PREFIX_SEPARATOR);
	if (idx === -1) return null;
	return {
		appName: prefixedName.slice(0, idx),
		itemName: prefixedName.slice(idx + TOOL_PREFIX_SEPARATOR.length),
	};
}

/**
 * Converts IPC wire-format tools to MCP SDK tool format.
 * @param tools - Array of McpTool definitions from the IPC protocol.
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
 * Converts IPC wire-format resources to MCP SDK resource format.
 * @param resources - Array of McpResource definitions from the IPC protocol.
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
 * Structured logger with severity levels.
 * - `error` and `warn` always output to stderr regardless of verbose mode.
 * - `info` and `debug` only output when verbose mode is enabled via --verbose/-v flag.
 * All messages are prefixed with the MCP Bridge prefix and severity label.
 */
export const log = {
	/**
	 * Logs an error message to stderr. Always outputs regardless of verbose mode.
	 * @param args - Arguments to log.
	 */
	error: (...args: unknown[]): void => {
		console.error(LOG_PREFIX, "ERROR:", ...args);
	},
	/**
	 * Logs a warning message to stderr. Always outputs regardless of verbose mode.
	 * @param args - Arguments to log.
	 */
	warn: (...args: unknown[]): void => {
		console.error(LOG_PREFIX, "WARN:", ...args);
	},
	/**
	 * Logs an informational message to stderr. Only outputs when verbose mode is enabled.
	 * @param args - Arguments to log.
	 */
	info: (...args: unknown[]): void => {
		if (verbose) console.error(LOG_PREFIX, "INFO:", ...args);
	},
	/**
	 * Logs a debug message to stderr. Only outputs when verbose mode is enabled.
	 * @param args - Arguments to log.
	 */
	debug: (...args: unknown[]): void => {
		if (verbose) console.error(LOG_PREFIX, "DEBUG:", ...args);
	},
};

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
			verbose: {
				type: "boolean" as const,
				short: "v",
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
		verbose: values.verbose as boolean,
	};
}

/**
 * Prints CLI help message to stdout.
 */
export function printHelp(): void {
	console.log(`
Usage: elgato-mcp-server [options]

Options:
  --transport <mode>  Transport mode: 'stdio' (default) or 'http'
  --http              Shorthand for --transport http
  --port <number>     HTTP server port (default: 9090)
  --ngrok             Enable ngrok tunnel (requires NGROK_AUTHTOKEN env var)
  --help, -h          Show help message
  --verbose, -v       Enable verbose logging (default: silent)
`);
}
