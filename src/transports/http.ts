import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import cors from "cors";
import express, { type Request, type Response } from "express";
import type { Server as HttpServer } from "node:http";

import { HTTP_DEFAULT_PORT } from "../constants.js";
import { McpBridge } from "../McpBridge.js";
import { log } from "../utils.js";

interface HttpTransportOptions {
	ngrok?: boolean;
	port?: number;
}

interface SessionData {
	server: McpServer;
	transport: StreamableHTTPServerTransport;
}

/**
 * Starts the HTTP transport server.
 * @param options - HTTP transport options.
 */
export async function startHttpTransport(options: HttpTransportOptions = {}): Promise<void> {
	const port = options.port ?? HTTP_DEFAULT_PORT;
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

	const createSession = (sessionId: string): SessionData => {
		const server = bridge.createServer();
		const transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: () => sessionId,
			onsessioninitialized: (id) => log(`Session initialized: ${id}`),
		});

		const sessionData: SessionData = { server, transport };
		sessions.set(sessionId, sessionData);
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

		let session: SessionData;
		if (sessionId && sessions.has(sessionId)) {
			session = sessions.get(sessionId)!;
		} else {
			const newSessionId = crypto.randomUUID();
			session = createSession(newSessionId);
			await session.server.connect(session.transport as unknown as Transport);
		}

		await session.transport.handleRequest(req, res, req.body as unknown);
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

	let httpServer: HttpServer;

	await new Promise<void>((resolve) => {
		httpServer = app.listen(port, () => {
			log(`HTTP server listening on port ${port}`);
			resolve();
		});
	});

	if (options.ngrok) {
		const ngrok = await import("@ngrok/ngrok");
		await ngrok.forward({
			addr: port,
			authtoken_from_env: true,
		}).then((listener) => {
			log(`ngrok tunnel: ${listener.url()}`);
			return listener;
		}).catch((error) => {
			log("Failed to start ngrok tunnel:", error);
			log("Make sure NGROK_AUTHTOKEN is set");
			return null;
		});
	}

	const cleanup = (): void => {
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
