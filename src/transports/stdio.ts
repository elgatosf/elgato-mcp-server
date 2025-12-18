import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createConnectedBridge } from "../McpBridge.js";
import { log } from "../utils.js";

/**
 * Starts the stdio transport for MCP communication.
 */
export async function startStdioTransport(): Promise<void> {
	const transport = new StdioServerTransport();
	const bridge = await createConnectedBridge(transport);

	log("MCP Bridge started with stdio transport");

	process.on("SIGINT", () => {
		bridge.close();
		process.exit(0);
	});

	process.on("SIGTERM", () => {
		bridge.close();
		process.exit(0);
	});
}
