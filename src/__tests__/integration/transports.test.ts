import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { McpBridge } from "../../McpBridge.js";
import type { StreamDeckClient } from "../../StreamDeckClient.js";
import { MockSocket } from "../helpers/MockSocket.js";
import { createMockClient, createMockResource, createMockServerInfo, createMockTool, wait } from "../helpers/testUtils.js";

describe("Transport Integration Tests", () => {
	let mockClient: jest.Mocked<StreamDeckClient>;
	let mockSocket: MockSocket;

	beforeEach(() => {
		jest.clearAllMocks();

		mockSocket = new MockSocket();
		mockClient = createMockClient();
	});

	describe("stdio transport", () => {
		it("should initialize bridge with stdio transport", async () => {
			mockClient.connect.mockResolvedValue(true);
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			mockClient.getTools.mockResolvedValue([createMockTool()]);

			const bridge = new McpBridge(mockClient);
			await bridge.initialize();

			expect(bridge.isConnected).toBe(false); // Mock client starts disconnected
			expect(mockClient.connect).toHaveBeenCalled();

			bridge.close();
		});

		it("should create server and handle initialization", async () => {
			mockClient.connect.mockResolvedValue(true);
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			mockClient.getTools.mockResolvedValue([]);

			const bridge = new McpBridge(mockClient);
			await bridge.initialize();

			const server = bridge.createServer();
			expect(server).toBeDefined();

			bridge.close();
		});

		it("should handle Stream Deck unavailable at startup", async () => {
			mockClient.connect.mockResolvedValue(false);

			const bridge = new McpBridge(mockClient);
			await bridge.initialize();

			expect(mockClient.getServerInfo).not.toHaveBeenCalled();
			expect(mockClient.getTools).not.toHaveBeenCalled();

			bridge.close();
		});
	});

	describe("HTTP transport", () => {
		it("should handle multiple sessions", async () => {
			mockClient.connect.mockResolvedValue(true);
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			mockClient.getTools.mockResolvedValue([]);

			const bridge = new McpBridge(mockClient);
			await bridge.initialize();

			// Create multiple servers (simulating multiple HTTP sessions)
			const server1 = bridge.createServer();
			const server2 = bridge.createServer();

			expect(server1).toBeDefined();
			expect(server2).toBeDefined();
			expect(server1).not.toBe(server2);

			bridge.close();
		});

		it("should notify all sessions on tools change", async () => {
			mockClient.connect.mockResolvedValue(true);
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			mockClient.getTools.mockResolvedValue([]);

			const bridge = new McpBridge(mockClient);
			await bridge.initialize();

			const callback1 = jest.fn() as any;
			const callback2 = jest.fn() as any;

			bridge.onToolsChanged(callback1);
			bridge.onToolsChanged(callback2);

			// Simulate reconnection
			const onConnectedCallback = mockClient.onConnected.mock.calls[0]?.[0];
			(mockClient as any).isConnected = true;
			if (onConnectedCallback) {
				await onConnectedCallback();
			}

			await wait(10);

			expect(callback1).toHaveBeenCalled();
			expect(callback2).toHaveBeenCalled();

			bridge.close();
		});

		it("should notify all sessions on resources change", async () => {
			mockClient.connect.mockResolvedValue(true);
			(mockClient as any).isConnected = true;
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			mockClient.getTools.mockResolvedValue([]);
			mockClient.getResources.mockResolvedValue([createMockResource()]);

			const bridge = new McpBridge(mockClient);
			await bridge.initialize();

			const callback1 = jest.fn() as any;
			const callback2 = jest.fn() as any;

			bridge.onResourcesChanged(callback1);
			bridge.onResourcesChanged(callback2);

			// Simulate reconnection
			const onConnectedCallback = mockClient.onConnected.mock.calls[0]?.[0];
			if (onConnectedCallback) {
				await onConnectedCallback();
			}

			await wait(10);

			expect(callback1).toHaveBeenCalled();
			expect(callback2).toHaveBeenCalled();

			bridge.close();
		});
	});

	describe("connection scenarios", () => {
		it("should handle Stream Deck running before bridge", async () => {
			mockClient.connect.mockResolvedValue(true);
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			mockClient.getTools.mockResolvedValue([createMockTool()]);

			const bridge = new McpBridge(mockClient);
			await bridge.initialize();

			expect(mockClient.connect).toHaveBeenCalled();
			expect(mockClient.getServerInfo).toHaveBeenCalled();
			expect(mockClient.getTools).toHaveBeenCalled();

			bridge.close();
		});

		it("should handle bridge starting before Stream Deck", async () => {
			mockClient.connect.mockResolvedValue(false);

			const bridge = new McpBridge(mockClient);
			await bridge.initialize();

			expect(mockClient.connect).toHaveBeenCalled();
			expect(mockClient.getServerInfo).not.toHaveBeenCalled();
			expect(mockClient.startSignalListener).toHaveBeenCalled();

			bridge.close();
		});

		it("should handle Stream Deck restart scenario", async () => {
			// Initial connection
			mockClient.connect.mockResolvedValue(true);
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			mockClient.getTools.mockResolvedValue([createMockTool({ name: "tool1" })]);

			const bridge = new McpBridge(mockClient);
			await bridge.initialize();

			expect(mockClient.getTools).toHaveBeenCalledTimes(1);

			// Simulate Stream Deck restart
			const onConnectedCallback = mockClient.onConnected.mock.calls[0]?.[0];
			(mockClient as any).isConnected = true;
			mockClient.getTools.mockResolvedValue([
				createMockTool({ name: "tool1" }),
				createMockTool({ name: "tool2" }),
			]);

			if (onConnectedCallback) {
				await onConnectedCallback();
			}

			// Tools should be refreshed
			expect(mockClient.getTools).toHaveBeenCalledTimes(2);

			bridge.close();
		});

		it("should handle Stream Deck crash mid-session", async () => {
			mockClient.connect.mockResolvedValue(true);
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			mockClient.getTools.mockResolvedValue([]);

			const bridge = new McpBridge(mockClient);
			await bridge.initialize();

			// Simulate crash
			(mockClient as any).isConnected = false;

			expect(bridge.isConnected).toBe(false);

			bridge.close();
		});
	});

	describe("reconnection handling", () => {
		it("should refresh tools on reconnection", async () => {
			mockClient.connect.mockResolvedValue(false);

			const bridge = new McpBridge(mockClient);
			await bridge.initialize();

			// Simulate reconnection
			const onConnectedCallback = mockClient.onConnected.mock.calls[0]?.[0];
			(mockClient as any).isConnected = true;
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			mockClient.getTools.mockResolvedValue([createMockTool()]);

			if (onConnectedCallback) {
				await onConnectedCallback();
			}

			expect(mockClient.getServerInfo).toHaveBeenCalled();
			expect(mockClient.getTools).toHaveBeenCalled();

			bridge.close();
		});

		it("should notify callbacks on reconnection", async () => {
			mockClient.connect.mockResolvedValue(false);

			const bridge = new McpBridge(mockClient);
			const callback = jest.fn() as any;
			bridge.onToolsChanged(callback);

			await bridge.initialize();

			// Simulate reconnection
			const onConnectedCallback = mockClient.onConnected.mock.calls[0]?.[0];
			(mockClient as any).isConnected = true;
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			mockClient.getTools.mockResolvedValue([]);

			if (onConnectedCallback) {
				await onConnectedCallback();
			}

			await wait(10);

			expect(callback).toHaveBeenCalled();

			bridge.close();
		});
	});
});

