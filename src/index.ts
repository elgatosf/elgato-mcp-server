#!/usr/bin/env node
import { startHttpTransport } from "./transports/http.js";
import { startStdioTransport } from "./transports/stdio.js";
import { parseCliArgs, printHelp } from "./utils.js";

/**
 * Main entry point for the MCP Stream Deck bridge.
 */
async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const options = parseCliArgs(args);

	if (options.help) {
		printHelp();
		process.exit(0);
	}

	if (options.transport === "http") {
		await startHttpTransport({
			port: options.port,
			ngrok: options.ngrok,
		});
	} else {
		await startStdioTransport();
	}
}

main().catch((error) => {
	console.error("Fatal error:", error);
	process.exit(1);
});
