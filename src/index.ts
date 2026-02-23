#!/usr/bin/env node
import { startHttpTransport } from "./transports/http.js";
import { startStdioTransport } from "./transports/stdio.js";
import { log, parseCliArgs, printHelp, setVerbose } from "./utils.js";

/**
 * Main entry point for the Elgato MCP Server.
 */
async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const options = parseCliArgs(args);

	setVerbose(options.verbose);

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
	log.error("Fatal error:", error);
	process.exit(1);
});
