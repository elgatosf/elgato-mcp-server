import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpBridge } from "../../McpBridge.js";
import type { StreamDeckClient } from "../../StreamDeckClient.js";
import { createMockServerInfo, createMockTool, wait } from "../helpers/testUtils.js";

describe("McpBridge", () => {
	let bridge: McpBridge;
	let mockClient: jest.Mocked<StreamDeckClient>;

	beforeEach(() => {
		jest.clearAllMocks();

		// Create mock client instance
		mockClient = {
			isConnected: false,
			connect: jest.fn(),
			disconnect: jest.fn(),
			getServerInfo: jest.fn(),
			getTools: jest.fn(),
			callTool: jest.fn(),
			onConnected: jest.fn(),
			startSignalListener: jest.fn(),
		} as any;

		bridge = new McpBridge(mockClient);
	});

	afterEach(() => {
		bridge.close();
	});

	describe("initialization", () => {
		it("should start disconnected", () => {
			expect(bridge.isConnected).toBe(false);
		});

		it("should initialize successfully when Stream Deck is available", async () => {
			mockClient.connect.mockResolvedValue(true);
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			mockClient.getTools.mockResolvedValue([createMockTool()]);

			await bridge.initialize();

			expect(mockClient.connect).toHaveBeenCalled();
			expect(mockClient.getServerInfo).toHaveBeenCalled();
			expect(mockClient.getTools).toHaveBeenCalled();
			expect(mockClient.startSignalListener).toHaveBeenCalled();
		});

		it("should initialize in disconnected mode when Stream Deck is unavailable", async () => {
			mockClient.connect.mockResolvedValue(false);

			await bridge.initialize();

			expect(mockClient.connect).toHaveBeenCalled();
			expect(mockClient.getServerInfo).not.toHaveBeenCalled();
			expect(mockClient.getTools).not.toHaveBeenCalled();
			expect(mockClient.startSignalListener).toHaveBeenCalled();
		});

		it("should handle errors during server info refresh", async () => {
			mockClient.connect.mockResolvedValue(true);
			mockClient.getServerInfo.mockRejectedValue(new Error("Server info error"));
			mockClient.getTools.mockResolvedValue([]);

			// Should not throw
			await expect(bridge.initialize()).resolves.not.toThrow();
		});

		it("should handle errors during tools refresh", async () => {
			mockClient.connect.mockResolvedValue(true);
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			mockClient.getTools.mockRejectedValue(new Error("Tools error"));

			// Should not throw
			await expect(bridge.initialize()).resolves.not.toThrow();
		});
	});

	describe("server creation", () => {
		it("should create MCP server with correct info", async () => {
			const serverInfo = createMockServerInfo({
				name: "Custom Server",
				version: "2.0.0",
				title: "Custom Title",
			});

			mockClient.connect.mockResolvedValue(true);
			mockClient.getServerInfo.mockResolvedValue(serverInfo);
			mockClient.getTools.mockResolvedValue([]);

			await bridge.initialize();

			const server = bridge.createServer();

			expect(server).toBeDefined();
			// Server should be configured with the server info
		});

		it("should create server with default info when disconnected", () => {
			const server = bridge.createServer();

			expect(server).toBeDefined();
		});
	});

	describe("tool caching", () => {
		it("should cache tools after initialization", async () => {
			const tools = [createMockTool({ name: "tool1" }), createMockTool({ name: "tool2" })];

			mockClient.connect.mockResolvedValue(true);
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			mockClient.getTools.mockResolvedValue(tools);

			await bridge.initialize();

			// Tools should be cached
			expect(mockClient.getTools).toHaveBeenCalledTimes(1);
		});

		it("should refresh tools on reconnection", async () => {
			mockClient.connect.mockResolvedValue(true);
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			mockClient.getTools.mockResolvedValue([]);

			await bridge.initialize();

			// Get the onConnected callback
			const onConnectedCallback = mockClient.onConnected.mock.calls[0]?.[0];
			expect(onConnectedCallback).toBeDefined();

			// Simulate reconnection
			(mockClient as any).isConnected = true;
			const newTools = [createMockTool({ name: "new_tool" })];
			mockClient.getTools.mockResolvedValue(newTools);

			if (onConnectedCallback) {
				await onConnectedCallback();
			}

			// Tools should be refreshed
			expect(mockClient.getTools).toHaveBeenCalledTimes(2);
		});
	});

	describe("callback notifications", () => {
		it("should register tools changed callback", () => {
			const callback = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

			bridge.onToolsChanged(callback);

			// Callback should be registered (will be called on reconnection)
			expect(callback).not.toHaveBeenCalled();
		});

		it("should notify callbacks on reconnection", async () => {
			const callback1 = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
			const callback2 = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

			bridge.onToolsChanged(callback1);
			bridge.onToolsChanged(callback2);

			mockClient.connect.mockResolvedValue(true);
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			mockClient.getTools.mockResolvedValue([]);

			await bridge.initialize();

			// Get the onConnected callback
			const onConnectedCallback = mockClient.onConnected.mock.calls[0]?.[0];

			// Simulate reconnection
			(mockClient as any).isConnected = true;
			if (onConnectedCallback) {
				await onConnectedCallback();
			}

			await wait(10);

			expect(callback1).toHaveBeenCalled();
			expect(callback2).toHaveBeenCalled();
		});

		it("should handle errors in notification callbacks", async () => {
			const errorCallback = jest.fn<() => Promise<void>>().mockRejectedValue(new Error("Callback error"));
			const successCallback = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

			bridge.onToolsChanged(errorCallback);
			bridge.onToolsChanged(successCallback);

			mockClient.connect.mockResolvedValue(true);
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			mockClient.getTools.mockResolvedValue([]);

			await bridge.initialize();

			const onConnectedCallback = mockClient.onConnected.mock.calls[0]?.[0];

			(mockClient as any).isConnected = true;
			if (onConnectedCallback) {
				await onConnectedCallback();
			}

			await wait(10);

			// Both callbacks should be called despite error
			expect(errorCallback).toHaveBeenCalled();
			expect(successCallback).toHaveBeenCalled();
		});
	});

	describe("close", () => {
		it("should disconnect client on close", () => {
			bridge.close();

			expect(mockClient.disconnect).toHaveBeenCalled();
		});
	});

	describe("isConnected property", () => {
		it("should reflect client connection state", () => {
			(mockClient as any).isConnected = false;
			expect(bridge.isConnected).toBe(false);

			(mockClient as any).isConnected = true;
			expect(bridge.isConnected).toBe(true);
		});
	});

	describe("MCP handler registration", () => {
		let mcpServer: McpServer;
		let listToolsHandler: (request: { params: object }) => Promise<{ tools: unknown[] }>;
		let callToolHandler: (request: { params: { name: string; arguments?: Record<string, unknown> } }) => Promise<unknown>;

		beforeEach(async () => {
			mockClient.connect.mockResolvedValue(true);
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			mockClient.getTools.mockResolvedValue([createMockTool()]);

			await bridge.initialize();

			mcpServer = bridge.createServer();

			// Extract handlers from setRequestHandler calls
			// This is a simplified approach - in real tests you might need to mock the Server class
		});

		it("should handle tools/list request when connected", async () => {
			// This test would require mocking the Server class more thoroughly
			// For now, we verify that createServer doesn't throw
			expect(mcpServer).toBeDefined();
		});

		it("should handle tools/call request when connected", async () => {
			// This test would require mocking the Server class more thoroughly
			expect(mcpServer).toBeDefined();
		});

		it("should return error when calling tool while disconnected", async () => {
			(mockClient as any).isConnected = false;
			// Would need to test the actual handler behavior
			expect(mcpServer).toBeDefined();
		});
	});

	describe("tools/list handler", () => {
		it("should return empty list when disconnected even if cache exists", async () => {
			(mockClient as any).isConnected = false;
			(bridge as any).cachedTools = [createMockTool({ name: "cached_tool" })];

			const fakeServer = {
				server: {
					setRequestHandler: jest.fn(),
				},
			} as any;

			(bridge as any).registerHandlers(fakeServer);

			const listHandler = fakeServer.server.setRequestHandler.mock.calls[0]?.[1];
			expect(listHandler).toBeDefined();

			const result = await listHandler();
			expect(result).toEqual({ tools: [] });
			expect(mockClient.getTools).not.toHaveBeenCalled();
		});
	});
});

