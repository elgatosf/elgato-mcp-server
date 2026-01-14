import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import cors from "cors";
import express, { type Express, type Request, type Response } from "express";
import type { Server as HttpServer } from "node:http";

import { HTTP_DEFAULT_PORT } from "../constants.js";
import { McpBridge } from "../McpBridge.js";
import { log } from "../utils.js";

/** Default session timeout: 1 hour in milliseconds */
const DEFAULT_SESSION_TIMEOUT_MS = 60 * 60 * 1000;

/** Cleanup interval: check for idle sessions every 5 minutes */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/** Options for configuring the HTTP transport server. */
export interface HttpTransportOptions {
	ngrok?: boolean;
	port?: number;
	/** Session idle timeout in milliseconds. Sessions without activity for this duration will be automatically cleaned up. Default: 1 hour (3600000ms) */
	sessionTimeoutMs?: number;
}

/** Data associated with an active MCP session. */
export interface SessionData {
	server: McpServer;
	transport: StreamableHTTPServerTransport;
	lastActivity: number;
}

/**
 * Creates an Express app with MCP HTTP transport routes.
 * @param bridge - The MCP bridge instance.
 * @param sessions - Map to store active sessions.
 * @returns Configured Express application.
 */
export function createHttpTransportApp(bridge: McpBridge, sessions: Map<string, SessionData>): Express {
	const createSession = (sessionId: string): SessionData => {
		const server = bridge.createServer();
		const sessionData: SessionData = { server, transport: null!, lastActivity: Date.now() };

		const transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: () => sessionId,
			onsessioninitialized: (id) => {
				log(`Session initialized: ${id}`);
				sessions.set(id, sessionData);
			},
		});

		transport.onclose = () => {
			const sid = transport.sessionId;
			if (sid && sessions.has(sid)) {
				log(`Transport closed for session ${sid}, removing from sessions map`);
				sessions.delete(sid);
			}
		};

		sessionData.transport = transport;
		return sessionData;
	};

	const app = express();
	app.use(cors());
	app.use(express.json());

	app.get("/health", (_req: Request, res: Response) => {
		res.json({
			status: "ok",
			streamDeckConnected: bridge.isConnected,
		});
	});

	app.post("/mcp", async (req: Request, res: Response) => {
		const sessionId = req.headers["mcp-session-id"] as string | undefined;

		try {
			let session: SessionData;

			if (sessionId && sessions.has(sessionId)) {
				session = sessions.get(sessionId)!;
				session.lastActivity = Date.now();
			} else if (!sessionId && isInitializeRequest(req.body)) {
				const newSessionId = crypto.randomUUID();
				session = createSession(newSessionId);
				await session.server.connect(session.transport as unknown as Transport);
				log(`New session created: ${newSessionId}`);
			} else {
				res.status(400).json({
					jsonrpc: "2.0",
					error: {
						code: -32000,
						message: "Bad Request: No valid session ID provided.",
					},
					id: null,
				});
				return;
			}

			await session.transport.handleRequest(req, res, req.body as unknown);
		} catch (error) {
			log("Error handling MCP POST request:", error);
			if (!res.headersSent) {
				res.status(500).json({
					jsonrpc: "2.0",
					error: {
						code: -32603,
						message: "Internal server error",
					},
					id: null,
				});
			}
		}
	});

	app.get("/mcp", async (req: Request, res: Response) => {
		const sessionId = req.headers["mcp-session-id"] as string | undefined;

		if (!sessionId) {
			res.status(400).json({ error: "Missing mcp-session-id header" });
			return;
		}

		const session = sessions.get(sessionId);
		if (!session) {
			res.status(404).json({ error: "Session not found" });
			return;
		}

		session.lastActivity = Date.now();
		await session.transport.handleRequest(req, res);
	});

	app.delete("/mcp", (req: Request, res: Response) => {
		const sessionId = req.headers["mcp-session-id"] as string | undefined;

		if (!sessionId) {
			res.status(400).json({ error: "Missing mcp-session-id header" });
			return;
		}

		const session = sessions.get(sessionId);
		if (session) {
			session.transport.close();
			sessions.delete(sessionId);
			log(`Session deleted: ${sessionId}`);
			res.status(204).send();
		} else {
			res.status(404).json({ error: "Session not found" });
		}
	});

	return app;
}

/**
 * Starts the HTTP transport server.
 * @param options - HTTP transport options.
 */
export async function startHttpTransport(options: HttpTransportOptions = {}): Promise<void> {
	const port = options.port ?? HTTP_DEFAULT_PORT;
	const sessionTimeoutMs = options.sessionTimeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;
	const sessions = new Map<string, SessionData>();

	const bridge = new McpBridge();
	await bridge.initialize();

	bridge.onToolsChanged(async () => {
		for (const [sessionId, session] of sessions) {
			try {
				await session.server.sendToolListChanged();
			} catch (error) {
				log(`Failed to notify session ${sessionId}:`, error);
			}
		}
	});

	const app = createHttpTransportApp(bridge, sessions);

	let httpServer: HttpServer;

	await new Promise<void>((resolve) => {
		httpServer = app.listen(port, () => {
			log(`HTTP server listening on port ${port}`);
			resolve();
		});
	});

	if (options.ngrok) {
		const ngrok = await import("@ngrok/ngrok");
		await ngrok
			.forward({
				addr: port,
				authtoken_from_env: true,
			})
			.then((listener) => {
				log(`ngrok tunnel: ${listener.url()}`);
				return listener;
			})
			.catch((error) => {
				log("Failed to start ngrok tunnel:", error);
				log("Make sure NGROK_AUTHTOKEN is set");
				return null;
			});
	}

	const cleanupIdleSessions = (): void => {
		const now = Date.now();
		for (const [sessionId, session] of sessions) {
			const idleTime = now - session.lastActivity;
			if (idleTime > sessionTimeoutMs) {
				session.transport.close();
				sessions.delete(sessionId);
				log(`Session ${sessionId} timed out after ${Math.round(idleTime / 1000)}s of inactivity`);
			}
		}
	};

	const cleanupIntervalId = setInterval(cleanupIdleSessions, CLEANUP_INTERVAL_MS);

	const cleanup = (): void => {
		clearInterval(cleanupIntervalId);
		for (const session of sessions.values()) {
			session.transport.close();
		}
		sessions.clear();
		bridge.close();
		httpServer.close();
		process.exit(0);
	};

	process.on("SIGINT", cleanup);
	process.on("SIGTERM", cleanup);
}
