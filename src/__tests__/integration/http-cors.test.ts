import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import type { Server } from "node:http";

import { McpBridge } from "../../McpBridge.js";
import type { StreamDeckClient } from "../../StreamDeckClient.js";
import { createHttpTransportApp, type SessionData } from "../../transports/http.js";
import { createMockServerInfo, createMockTool } from "../helpers/testUtils.js";

describe("HTTP CORS Configuration Tests", () => {
	let server: Server;
	let baseUrl: string;
	let sessions: Map<string, SessionData>;
	let mockClient: jest.Mocked<StreamDeckClient>;
	let bridge: McpBridge;
	let allowedOrigins: string[];

	beforeAll(async () => {
		mockClient = {
			isConnected: true,
			connect: jest.fn(),
			disconnect: jest.fn(),
			getServerInfo: jest.fn(),
			getTools: jest.fn(),
			callTool: jest.fn(),
			onConnected: jest.fn(),
			startSignalListener: jest.fn(),
		} as any;

		mockClient.connect.mockResolvedValue(true);
		mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
		mockClient.getTools.mockResolvedValue([createMockTool()]);

		bridge = new McpBridge(mockClient);
		await bridge.initialize();

		sessions = new Map<string, SessionData>();
		allowedOrigins = [];
		const app = createHttpTransportApp(bridge, sessions, allowedOrigins);

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

	describe("Allowed origins", () => {
		it("should allow requests with no Origin header", async () => {
			const response = await fetch(`${baseUrl}/health`, {
				method: "GET",
			});

			expect(response.status).toBe(200);
		});

		it("should allow requests from localhost", async () => {
			const response = await fetch(`${baseUrl}/health`, {
				method: "GET",
				headers: {
					Origin: "http://localhost:3000",
				},
			});

			expect(response.status).toBe(200);
			expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
		});

		it("should allow requests from localhost without port", async () => {
			const response = await fetch(`${baseUrl}/health`, {
				method: "GET",
				headers: {
					Origin: "http://localhost",
				},
			});

			expect(response.status).toBe(200);
			expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost");
		});

		it("should allow requests from 127.0.0.1", async () => {
			const response = await fetch(`${baseUrl}/health`, {
				method: "GET",
				headers: {
					Origin: "http://127.0.0.1:8080",
				},
			});

			expect(response.status).toBe(200);
			expect(response.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:8080");
		});

		it("should allow requests from https localhost", async () => {
			const response = await fetch(`${baseUrl}/health`, {
				method: "GET",
				headers: {
					Origin: "https://localhost:443",
				},
			});

			expect(response.status).toBe(200);
			expect(response.headers.get("access-control-allow-origin")).toBe("https://localhost:443");
		});

		it("should allow requests from 127.0.0.1 without port", async () => {
			const response = await fetch(`${baseUrl}/health`, {
				method: "GET",
				headers: {
					Origin: "http://127.0.0.1",
				},
			});

			expect(response.status).toBe(200);
			expect(response.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1");
		});
	});

	describe("Disallowed origins", () => {
		it("should reject requests from unknown origins", async () => {
			const response = await fetch(`${baseUrl}/health`, {
				method: "OPTIONS",
				headers: {
					Origin: "https://evil.com",
					"Access-Control-Request-Method": "GET",
				},
			});

			// CORS preflight should fail
			expect(response.headers.get("access-control-allow-origin")).toBeNull();
		});

		it("should reject requests from random ngrok-like domains", async () => {
			const response = await fetch(`${baseUrl}/health`, {
				method: "OPTIONS",
				headers: {
					Origin: "https://abc123.ngrok.app",
					"Access-Control-Request-Method": "GET",
				},
			});

			expect(response.headers.get("access-control-allow-origin")).toBeNull();
		});

		it("should reject requests with invalid origin URL", async () => {
			const response = await fetch(`${baseUrl}/health`, {
				method: "OPTIONS",
				headers: {
					Origin: "not-a-valid-url",
					"Access-Control-Request-Method": "GET",
				},
			});

			expect(response.headers.get("access-control-allow-origin")).toBeNull();
		});
	});

	describe("Dynamic origin allowlist", () => {
		it("should allow dynamically set origin (simulating ngrok URL)", async () => {
			const customOrigin = "https://my-custom-domain.example.com";
			allowedOrigins.push(customOrigin);

			const response = await fetch(`${baseUrl}/health`, {
				method: "GET",
				headers: {
					Origin: customOrigin,
				},
			});

			expect(response.status).toBe(200);
			expect(response.headers.get("access-control-allow-origin")).toBe(customOrigin);
		});

		it("should match origin only, ignoring path in allowedOrigins", async () => {
			const originWithPath = "https://another-domain.example.com/some/path";
			allowedOrigins.push(originWithPath);

			// Request with just the origin (no path) should still be allowed
			const response = await fetch(`${baseUrl}/health`, {
				method: "GET",
				headers: {
					Origin: "https://another-domain.example.com",
				},
			});

			expect(response.status).toBe(200);
			expect(response.headers.get("access-control-allow-origin")).toBe(
				"https://another-domain.example.com",
			);
		});
	});
});

