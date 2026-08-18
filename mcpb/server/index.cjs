#!/usr/bin/env node
// Fallback entry point. Claude Desktop launches the server via mcp_config
// (npx) directly; this file exists so entry_point references a real file and
// behaves identically if a host launches the bundle with its own Node runtime.
const { spawn } = require("node:child_process");

const isWindows = process.platform === "win32";
const child = spawn(isWindows ? "npx.cmd" : "npx", ["-y", "@elgato/mcp-server@latest"], {
	stdio: "inherit",
	shell: isWindows,
});

child.on("error", (err) => {
	console.error(`Failed to launch @elgato/mcp-server via npx: ${err.message}`);
	process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 1));
