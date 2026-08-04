import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createConnectedBridge } from "../McpBridge.js";
import { log } from "../utils.js";

/**
 * Starts the stdio transport for MCP communication.
 */
export async function startStdioTransport(): Promise<void> {
	const transport = new StdioServerTransport();
	const bridge = await createConnectedBridge(transport);

	log.info("MCP Bridge started with stdio transport");

	const shutdown = (reason: string): void => {
		log.info(`Shutting down: ${reason}`);
		bridge.close();
		process.exit(0);
	};

	process.on("SIGINT", () => shutdown("SIGINT"));
	process.on("SIGTERM", () => shutdown("SIGTERM"));

	// The SDK transport only listens for stdin "data"/"error"; without these
	// handlers an MCP client disconnect (stdin EOF) leaves the process running,
	// because IPC polling timers and the signal server keep the event loop alive.
	process.stdin.on("end", () => shutdown("stdin closed"));
	process.stdin.on("close", () => shutdown("stdin closed"));
}
