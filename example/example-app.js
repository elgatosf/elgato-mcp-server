/**
 * Example IPC app for manual testing of the Elgato MCP Server.
 *
 * Simulates the app (e.g. Stream Deck) side of the IPC connection.
 * The bridge connects to this app as a client.
 *
 * Usage: node example/example-app.js
 */
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as https from "node:https";
import * as net from "node:net";

// ---------------------------------------------------------------------------
// Socket paths (must match socketBaseName "elgato-mcp-example" in constants.ts)
// ---------------------------------------------------------------------------

const SOCKET_PATH = "/tmp/elgato-mcp-example.sock";
const SIGNAL_SOCKET_PATH = "/tmp/elgato-mcp-example-ready.sock";

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
	{
		name: "echo",
		description: "Echoes back the provided text. Useful for basic connectivity testing.",
		inputSchema: {
			type: "object",
			properties: {
				text: { type: "string", description: "Text to echo back" },
			},
			required: ["text"],
		},
	},
	{
		name: "get_weather",
		description: "Fetches current or forecast weather from wttr.in. Uses elicitation to ask for city and time range.",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "notes",
		description: "Simple note-taking tool. Add, list, or delete notes.",
		inputSchema: {
			type: "object",
			properties: {
				action: { type: "string", enum: ["add", "list", "delete"] },
				title: { type: "string" },
				content: { type: "string" },
			},
			required: ["action"],
		},
	},
	{
		name: "slow_operation",
		description: "Waits for N seconds then returns. Use to test timeout behavior.",
		inputSchema: {
			type: "object",
			properties: {
				seconds: { type: "number", minimum: 1, maximum: 60 },
			},
			required: ["seconds"],
		},
	},
	{
		name: "failing_tool",
		description: "Always returns an error. Use to test error handling.",
		inputSchema: {
			type: "object",
			properties: {
				message: { type: "string" },
			},
		},
	},
];

// ---------------------------------------------------------------------------
// Resource definitions
// ---------------------------------------------------------------------------

const RESOURCES = [
	{
		uri: "status://app",
		name: "app_status",
		title: "App Status",
		description: "Current status: uptime, connections, notes count.",
		mimeType: "application/json",
	},
	{
		uri: "docs://readme",
		name: "readme",
		title: "Readme",
		description: "Description of the example app and its tools.",
		mimeType: "text/plain",
	},
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const startTime = Date.now();
const notes = new Map(); // title -> content
let connectedClients = 0;

/** Pending elicitation resolvers: elicitationId -> { resolve, timeout } */
const pendingElicitations = new Map();

/** 5 minutes — matches ELICITATION_TIMEOUT_MS in the bridge */
const ELICITATION_TIMEOUT_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Send a JSON response to a socket (newline-delimited).
 * @param {net.Socket} socket
 * @param {string} id
 * @param {unknown} result
 */
function sendResult(socket, id, result) {
	const msg = JSON.stringify({ id, result }) + "\n";
	socket.write(msg);
}

/**
 * Send a JSON error response to a socket.
 * @param {net.Socket} socket
 * @param {string} id
 * @param {string} message
 */
function sendError(socket, id, message) {
	const msg = JSON.stringify({ id, error: { message } }) + "\n";
	socket.write(msg);
}

/**
 * Send a JSON message to a socket (for elicitation requests).
 * @param {net.Socket} socket
 * @param {object} payload
 */
function sendMessage(socket, payload) {
	const msg = JSON.stringify(payload) + "\n";
	socket.write(msg);
}

// ---------------------------------------------------------------------------
// Weather fetch (no external deps — uses node:https)
// ---------------------------------------------------------------------------

/**
 * Fetch JSON from a URL using node:https.
 * @param {string} url
 * @returns {Promise<unknown>}
 */
function fetchJson(url) {
	return new Promise((resolve, reject) => {
		const options = {
			headers: { "User-Agent": "curl/8.0" },
		};
		https
			.get(url, options, (res) => {
				if (res.statusCode < 200 || res.statusCode >= 300) {
					res.resume(); // drain the response to free resources
					reject(new Error(`HTTP ${res.statusCode} from wttr.in`));
					return;
				}
				let raw = "";
				res.on("data", (chunk) => (raw += chunk));
				res.on("end", () => {
					try {
						resolve(JSON.parse(raw));
					} catch (e) {
						reject(new Error(`Failed to parse JSON from ${url}: ${e.message}`));
					}
				});
			})
			.on("error", reject);
	});
}

/**
 * Format weather data from wttr.in JSON response.
 * @param {unknown} data
 * @param {string} when - "now" | "today" | "tomorrow"
 * @returns {string}
 */
function formatWeather(data, when) {
	const location = `${data.nearest_area[0].areaName[0].value}, ` + `${data.nearest_area[0].country[0].value}`;

	if (when === "now" || !when) {
		const c = data.current_condition[0];
		return [
			`Weather in ${location} (now):`,
			`  Condition : ${c.weatherDesc[0].value}`,
			`  Temp      : ${c.temp_C}°C`,
			`  Feels like: ${c.FeelsLikeC}°C`,
			`  Humidity  : ${c.humidity}%`,
			`  Wind      : ${c.windspeedKmph} km/h ${c.winddir16Point}`,
		].join("\n");
	}

	const dayIndex = when === "tomorrow" ? 1 : 0;
	const w = data.weather[dayIndex];
	const condition = w.hourly[4]?.weatherDesc[0]?.value ?? "N/A";
	const label = when === "tomorrow" ? "tomorrow" : "today";

	return [
		`Weather in ${location} (${label}):`,
		`  Condition : ${condition}`,
		`  Avg temp  : ${w.avgtempC}°C`,
		`  Min / Max : ${w.mintempC}°C / ${w.maxtempC}°C`,
		`  Sunrise   : ${w.astronomy[0].sunrise}`,
		`  Sunset    : ${w.astronomy[0].sunset}`,
	].join("\n");
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

/**
 * Handle the "echo" tool.
 * @param {net.Socket} socket
 * @param {string} id
 * @param {object} args
 */
function handleEcho(socket, id, args) {
	sendResult(socket, id, { data: `Echo: ${args.text}` });
}

/**
 * Handle the "notes" tool.
 * @param {net.Socket} socket
 * @param {string} id
 * @param {object} args
 */
function handleNotes(socket, id, args) {
	const { action, title, content } = args;

	switch (action) {
		case "list": {
			if (notes.size === 0) {
				sendResult(socket, id, { data: "No notes yet." });
			} else {
				const lines = [];
				for (const [t, c] of notes) {
					lines.push(`[${t}]: ${c}`);
				}
				sendResult(socket, id, { data: lines.join("\n") });
			}
			break;
		}
		case "add": {
			if (!title || !content) {
				sendError(socket, id, "add requires 'title' and 'content'");
				return;
			}
			notes.set(title, content);
			sendResult(socket, id, { data: `Note "${title}" saved.` });
			break;
		}
		case "delete": {
			if (!title) {
				sendError(socket, id, "delete requires 'title'");
				return;
			}
			if (!notes.has(title)) {
				sendError(socket, id, `Note "${title}" not found.`);
				return;
			}
			notes.delete(title);
			sendResult(socket, id, { data: `Note "${title}" deleted.` });
			break;
		}
		default:
			sendError(socket, id, `Unknown notes action: ${action}`);
	}
}

/**
 * Handle the "slow_operation" tool.
 * @param {net.Socket} socket
 * @param {string} id
 * @param {object} args
 */
function handleSlowOperation(socket, id, args) {
	const seconds = Math.min(60, Math.max(1, Number(args.seconds) || 1));
	console.error(`[example-app] slow_operation: waiting ${seconds}s...`);
	setTimeout(() => {
		sendResult(socket, id, { data: `Completed after ${seconds} second(s).` });
	}, seconds * 1000);
}

/**
 * Handle the "failing_tool" tool.
 * @param {net.Socket} socket
 * @param {string} id
 * @param {object} args
 */
function handleFailingTool(socket, id, args) {
	sendResult(socket, id, { error: args.message || "This tool always fails." });
}

/**
 * Handle the "get_weather" tool — uses elicitation to collect city + when.
 * @param {net.Socket} socket
 * @param {string} toolCallId - The original call_tool request id
 */
function handleGetWeather(socket, toolCallId) {
	const elicitId = randomUUID();

	// Store resolver keyed by elicitation id; auto-cancel after timeout
	const elicitPromise = new Promise((resolve) => {
		const timeout = setTimeout(() => {
			if (pendingElicitations.delete(elicitId)) {
				console.error(`[example-app] Elicitation ${elicitId} timed out.`);
				sendResult(socket, toolCallId, { error: "Weather lookup timed out." });
				// Resolve with sentinel so the .then() below is a no-op
				resolve(null);
			}
		}, ELICITATION_TIMEOUT_MS);
		pendingElicitations.set(elicitId, { resolve, timeout });
	});

	// Send elicitation request to the bridge
	sendMessage(socket, {
		id: elicitId,
		method: "elicitation/create",
		params: {
			message: "What weather would you like to see?",
			mode: "form",
			requestedSchema: {
				type: "object",
				properties: {
					city: {
						type: "string",
						title: "City",
						description: "City name (leave blank for current location)",
					},
					when: {
						type: "string",
						title: "When",
						description: "Time range",
						enum: ["now", "today", "tomorrow"],
						default: "now",
					},
				},
			},
			relatedToolCallId: toolCallId,
		},
	});

	console.error(`[example-app] get_weather: sent elicitation ${elicitId}, waiting for response...`);

	// Wait for the elicitation response
	elicitPromise.then(async (response) => {
		if (!response) return; // null sentinel: timeout fired or socket closed
		const { action, content } = response;
		if (action === "cancel" || action === "decline") {
			sendResult(socket, toolCallId, { error: "Weather lookup cancelled." });
			return;
		}

		const city = content?.city ?? "";
		const when = content?.when ?? "now";
		const url = city ? `https://wttr.in/${encodeURIComponent(city)}?format=j1` : "https://wttr.in/?format=j1";

		console.error(`[example-app] get_weather: fetching ${url}`);

		try {
			const data = await fetchJson(url);
			const summary = formatWeather(data, when);
			sendResult(socket, toolCallId, { data: summary });
		} catch (err) {
			sendError(socket, toolCallId, `Weather fetch failed: ${err.message}`);
		}
	});
}

// ---------------------------------------------------------------------------
// Resource handlers
// ---------------------------------------------------------------------------

/**
 * Handle a resources_read request.
 * @param {net.Socket} socket
 * @param {string} id
 * @param {string} uri
 */
function handleResourceRead(socket, id, uri) {
	switch (uri) {
		case "status://app": {
			const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
			sendResult(socket, id, {
				uri,
				mimeType: "application/json",
				content: {
					uptime_seconds: uptimeSeconds,
					connected_clients: connectedClients,
					notes_count: notes.size,
				},
			});
			break;
		}
		case "docs://readme": {
			sendResult(socket, id, {
				uri,
				mimeType: "text/plain",
				content: [
					"Example App — Elgato MCP Server manual testing tool",
					"",
					"Tools:",
					"  echo            - Echoes back text",
					"  get_weather     - Fetches weather via wttr.in (uses elicitation for city/when)",
					"  notes           - In-memory note-taking (add/list/delete)",
					"  slow_operation  - Sleeps N seconds (1-60) to test timeouts",
					"  failing_tool    - Always returns an error result",
					"",
					"Resources:",
					"  status://app    - Live JSON status (uptime, connections, notes count)",
					"  docs://readme   - This text",
				].join("\n"),
			});
			break;
		}
		default:
			sendError(socket, id, `Unknown resource URI: ${uri}`);
	}
}

// ---------------------------------------------------------------------------
// Message dispatcher
// ---------------------------------------------------------------------------

/**
 * Process a single parsed IPC message from the bridge.
 * @param {net.Socket} socket
 * @param {object} msg
 */
function processMessage(socket, msg) {
	const { id, method } = msg;

	// Elicitation response (has id + method = "elicitation/response")
	if (method === "elicitation/response") {
		const pending = pendingElicitations.get(id);
		if (pending) {
			clearTimeout(pending.timeout);
			pendingElicitations.delete(id);
			const { action, content } = msg.result ?? {};
			pending.resolve({ action, content });
		} else {
			console.error(`[example-app] No pending elicitation for id ${id}`);
		}
		return;
	}

	// All other messages must have an id (requests)
	if (id === undefined) {
		// Notification — ignore
		return;
	}

	switch (method) {
		case "server_info":
			sendResult(socket, id, { name: "Example App", version: "1.0.0" });
			break;

		case "tools_list":
			sendResult(socket, id, { tools: TOOLS });
			break;

		case "resources_list":
			sendResult(socket, id, { resources: RESOURCES });
			break;

		case "resources_read":
			handleResourceRead(socket, id, msg.uri);
			break;

		case "call_tool": {
			const { toolName, arguments: args = {} } = msg;
			console.error(`[example-app] call_tool: ${toolName}`, args);

			switch (toolName) {
				case "echo":
					handleEcho(socket, id, args);
					break;
				case "notes":
					handleNotes(socket, id, args);
					break;
				case "slow_operation":
					handleSlowOperation(socket, id, args);
					break;
				case "failing_tool":
					handleFailingTool(socket, id, args);
					break;
				case "get_weather":
					handleGetWeather(socket, id);
					break;
				default:
					sendError(socket, id, `Unknown tool: ${toolName}`);
			}
			break;
		}

		default:
			sendError(socket, id, `Unknown method: ${method}`);
	}
}

// ---------------------------------------------------------------------------
// Socket connection handler
// ---------------------------------------------------------------------------

/**
 * Attach data/close handlers to a newly connected client socket.
 * @param {net.Socket} socket
 */
function handleConnection(socket) {
	connectedClients++;
	console.error(`[example-app] Client connected (total: ${connectedClients})`);

	let buffer = "";

	socket.on("data", (chunk) => {
		buffer += chunk.toString();
		let newlineIndex;
		while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
			const line = buffer.slice(0, newlineIndex).trim();
			buffer = buffer.slice(newlineIndex + 1);
			if (!line) continue;
			try {
				const msg = JSON.parse(line);
				processMessage(socket, msg);
			} catch (e) {
				console.error(`[example-app] Failed to parse message: ${e.message}`);
			}
		}
	});

	socket.on("close", () => {
		connectedClients--;
		console.error(`[example-app] Client disconnected (remaining: ${connectedClients})`);
		// Cancel any pending elicitations for this socket
		for (const [elicitId, pending] of pendingElicitations) {
			clearTimeout(pending.timeout);
			pendingElicitations.delete(elicitId);
			pending.resolve(null); // sentinel — result ignored since socket is gone
		}
	});

	socket.on("error", (err) => {
		console.error(`[example-app] Socket error: ${err.message}`);
	});
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

function cleanupSockets() {
	// Only remove the socket file this app owns. The signal socket is
	// owned by the bridge — we connect to it as a client, never create it.
	try {
		fs.unlinkSync(SOCKET_PATH);
	} catch (_) {
		// ignore — file may not exist
	}
}

function shutdown() {
	console.error("\n[example-app] Shutting down...");
	server.close();
	cleanupSockets();
	process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ---------------------------------------------------------------------------
// Signal the bridge that we are ready
// ---------------------------------------------------------------------------

function notifyBridgeReady() {
	const sig = net.createConnection(SIGNAL_SOCKET_PATH);
	sig.on("connect", () => {
		sig.destroy();
		console.error("[example-app] Notified bridge via signal socket.");
	});
	sig.on("error", () => {
		// Bridge may not be running — this is fine
	});
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

cleanupSockets();

const server = net.createServer(handleConnection);

server.listen(SOCKET_PATH, () => {
	console.error(`[example-app] IPC server listening at ${SOCKET_PATH}`);
	console.error("[example-app] Ready. Press Ctrl+C to exit.");
	notifyBridgeReady();
});

server.on("error", (err) => {
	console.error(`[example-app] Server error: ${err.message}`);
	process.exit(1);
});
