import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Server } from "node:http";

import { McpBridge } from "../../McpBridge.js";
import type { StreamDeckClient } from "../../StreamDeckClient.js";
import { createHttpTransportApp, type SessionData } from "../../transports/http.js";
import { createMockClient, createMockServerInfo, createMockTool } from "../helpers/testUtils.js";
import { MCP_ERROR_CODES } from "../../constants.js";

interface JsonRpcResponse {
	jsonrpc: string;
	result?: Record<string, unknown>;
	error?: { code: number; message: string };
	id: number | null;
}

describe("HTTP Session Lifecycle Integration Tests", () => {
	let server: Server;
	let baseUrl: string;
	let sessions: Map<string, SessionData>;
	let mockClient: jest.Mocked<StreamDeckClient>;
	let bridge: McpBridge;

	beforeAll(async () => {
		mockClient = createMockClient({ isConnected: true });
		mockClient.connect.mockResolvedValue(true);
		mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
		mockClient.getTools.mockResolvedValue([createMockTool()]);

		bridge = new McpBridge(mockClient);
		await bridge.initialize();

		sessions = new Map<string, SessionData>();
		const app = createHttpTransportApp(bridge, sessions);

		await new Promise<void>((resolve) => {
			server = app.listen(0, () => {
				const address = server.address();
				if (address && typeof address === "object") {
					baseUrl = `http://localhost:${address.port}`;
				}
				resolve();
			});
		});
	});

	afterAll(async () => {
		bridge.close();
		await new Promise<void>((resolve) => {
			server.close(() => resolve());
		});
	});

	beforeEach(() => {
		sessions.clear();
	});

	describe("POST /mcp with valid session ID", () => {
		it("should return 200 and update lastActivity for existing session", async () => {
			const sessionId = "test-session-123";
			const mockTransport = {
				handleRequest: jest.fn((_req: unknown, res: any) => {
					res.json({ jsonrpc: "2.0", result: {}, id: 1 });
				}),
				close: jest.fn(),
			};
			sessions.set(sessionId, {
				server: bridge.createServer(),
				transport: mockTransport as any,
				lastActivity: Date.now() - 10000,
			});

			const initialActivity = sessions.get(sessionId)!.lastActivity;

			const response = await fetch(`${baseUrl}/mcp`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"mcp-session-id": sessionId,
				},
				body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
			});

			expect(response.status).toBe(200);
			expect(sessions.get(sessionId)!.lastActivity).toBeGreaterThan(initialActivity);
			expect(mockTransport.handleRequest).toHaveBeenCalled();
		});
	});

	describe("POST /mcp with invalid/expired session ID", () => {
		it("should return 404 for non-existent session ID", async () => {
			const response = await fetch(`${baseUrl}/mcp`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"mcp-session-id": "non-existent-session",
				},
				body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
			});

			expect(response.status).toBe(400);
			const body = (await response.json()) as JsonRpcResponse;
			expect(body.error?.code).toBe(MCP_ERROR_CODES.SERVER_ERROR);
			expect(body.error?.message).toContain("No valid session ID provided.");
		});

		it("should return JSON-RPC formatted error for invalid session", async () => {
			const response = await fetch(`${baseUrl}/mcp`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"mcp-session-id": "invalid-session-id",
				},
				body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
			});

			const body = (await response.json()) as JsonRpcResponse;
			expect(body.jsonrpc).toBe("2.0");
			expect(body.error).toBeDefined();
			expect(body.id).toBeNull();
		});
	});

	describe("POST /mcp with no session ID and initialize request", () => {
		it("should create new session for valid initialize request", async () => {
			const initialSessionCount = sessions.size;

			const response = await fetch(`${baseUrl}/mcp`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json, text/event-stream",
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					method: "initialize",
					params: {
						protocolVersion: "2024-11-05",
						capabilities: {},
						clientInfo: { name: "test-client", version: "1.0.0" },
					},
					id: 1,
				}),
			});

			expect(response.status).toBe(200);
			expect(sessions.size).toBe(initialSessionCount + 1);
		});

		it("should return session ID in response header for new session", async () => {
			const response = await fetch(`${baseUrl}/mcp`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json, text/event-stream",
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					method: "initialize",
					params: {
						protocolVersion: "2024-11-05",
						capabilities: {},
						clientInfo: { name: "test-client", version: "1.0.0" },
					},
					id: 1,
				}),
			});

			const sessionId = response.headers.get("mcp-session-id");
			expect(sessionId).toBeDefined();
			expect(sessionId).not.toBe("");
			expect(sessions.has(sessionId!)).toBe(true);
		});
	});

	describe("POST /mcp with no session ID and non-initialize request", () => {
		it("should return 400 for tools/list without session ID", async () => {
			const response = await fetch(`${baseUrl}/mcp`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
			});

			expect(response.status).toBe(400);
			const body = (await response.json()) as JsonRpcResponse;
			expect(body.error?.code).toBe(MCP_ERROR_CODES.SERVER_ERROR);
			expect(body.error?.message).toContain("No valid session ID provided.");
		});

		it("should return 400 for tools/call without session ID", async () => {
			const response = await fetch(`${baseUrl}/mcp`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					jsonrpc: "2.0",
					method: "tools/call",
					params: { name: "test_tool", arguments: {} },
					id: 1,
				}),
			});

			expect(response.status).toBe(400);
		});

		it("should return 400 for empty body without session ID", async () => {
			const response = await fetch(`${baseUrl}/mcp`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});

			expect(response.status).toBe(400);
		});
	});

	describe("GET /mcp session validation", () => {
		it("should return 400 when no session ID header provided", async () => {
			const response = await fetch(`${baseUrl}/mcp`, {
				method: "GET",
				headers: { Accept: "text/event-stream" },
			});

			expect(response.status).toBe(400);
		});

		it("should return 404 for non-existent session ID", async () => {
			const response = await fetch(`${baseUrl}/mcp`, {
				method: "GET",
				headers: {
					Accept: "text/event-stream",
					"mcp-session-id": "non-existent-session",
				},
			});

			expect(response.status).toBe(404);
		});
	});

	describe("DELETE /mcp session termination", () => {
		it("should return 400 when no session ID header provided", async () => {
			const response = await fetch(`${baseUrl}/mcp`, {
				method: "DELETE",
			});

			expect(response.status).toBe(400);
		});

		it("should return 404 for non-existent session ID", async () => {
			const response = await fetch(`${baseUrl}/mcp`, {
				method: "DELETE",
				headers: { "mcp-session-id": "non-existent-session" },
			});

			expect(response.status).toBe(404);
		});

		it("should return 204 and remove session for valid session ID", async () => {
			const sessionId = "session-to-delete";
			const mockTransport = { close: jest.fn() };
			sessions.set(sessionId, {
				server: bridge.createServer(),
				transport: mockTransport as any,
				lastActivity: Date.now(),
			});

			const response = await fetch(`${baseUrl}/mcp`, {
				method: "DELETE",
				headers: { "mcp-session-id": sessionId },
			});

			expect(response.status).toBe(204);
			expect(sessions.has(sessionId)).toBe(false);
			expect(mockTransport.close).toHaveBeenCalled();
		});
	});
});
