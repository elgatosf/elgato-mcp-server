import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import type { ClientManager } from "../../ClientManager.js";
import { McpBridge } from "../../McpBridge.js";
import { createMockClientManager, createMockResource, createMockTool, wait } from "../helpers/testUtils.js";

describe("Transport Integration Tests", () => {
	let mockClientManager: jest.Mocked<ClientManager>;

	beforeEach(() => {
		jest.clearAllMocks();
		mockClientManager = createMockClientManager();
	});

	describe("stdio transport", () => {
		it("should initialize bridge with clientManager", async () => {
			mockClientManager.initialize.mockResolvedValue(undefined);

			const bridge = new McpBridge(mockClientManager);
			await bridge.initialize();

			expect(bridge.isConnected).toBe(false);
			expect(mockClientManager.initialize).toHaveBeenCalled();

			bridge.close();
		});

		it("should create server and handle initialization", async () => {
			const bridge = new McpBridge(mockClientManager);
			await bridge.initialize();

			const server = bridge.createServer();
			expect(server).toBeDefined();

			bridge.close();
		});

		it("should handle apps unavailable at startup", async () => {
			// ClientManager.initialize handles unavailable apps internally
			mockClientManager.initialize.mockResolvedValue(undefined);

			const bridge = new McpBridge(mockClientManager);
			await bridge.initialize();

			expect(mockClientManager.initialize).toHaveBeenCalled();
			expect(bridge.isConnected).toBe(false);

			bridge.close();
		});
	});

	describe("HTTP transport", () => {
		it("should handle multiple sessions", async () => {
			const bridge = new McpBridge(mockClientManager);
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
			const bridge = new McpBridge(mockClientManager);
			await bridge.initialize();

			const callback1 = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
			const callback2 = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

			bridge.onToolsChanged(callback1);
			bridge.onToolsChanged(callback2);

			// Simulate clientManager firing onToolsChanged
			const managerCallback = mockClientManager.onToolsChanged.mock.calls[0]?.[0];
			if (managerCallback) {
				await managerCallback();
			}

			await wait(10);

			expect(callback1).toHaveBeenCalled();
			expect(callback2).toHaveBeenCalled();

			bridge.close();
		});

		it("should notify all sessions on resources change", async () => {
			const bridge = new McpBridge(mockClientManager);
			await bridge.initialize();

			const callback1 = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
			const callback2 = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

			bridge.onResourcesChanged(callback1);
			bridge.onResourcesChanged(callback2);

			// Simulate clientManager firing onResourcesChanged
			const managerCallback = mockClientManager.onResourcesChanged.mock.calls[0]?.[0];
			if (managerCallback) {
				await managerCallback();
			}

			await wait(10);

			expect(callback1).toHaveBeenCalled();
			expect(callback2).toHaveBeenCalled();

			bridge.close();
		});
	});

	describe("connection scenarios", () => {
		it("should handle apps running before bridge", async () => {
			mockClientManager = createMockClientManager({ isConnected: true });

			const bridge = new McpBridge(mockClientManager);
			await bridge.initialize();

			expect(mockClientManager.initialize).toHaveBeenCalled();
			expect(bridge.isConnected).toBe(true);

			bridge.close();
		});

		it("should handle bridge starting before apps", async () => {
			mockClientManager = createMockClientManager({ isConnected: false });

			const bridge = new McpBridge(mockClientManager);
			await bridge.initialize();

			expect(mockClientManager.initialize).toHaveBeenCalled();
			expect(bridge.isConnected).toBe(false);

			bridge.close();
		});

		it("should handle app restart scenario", async () => {
			mockClientManager = createMockClientManager({ isConnected: true });
			const updatedTools = [createMockTool({ name: "tool1" }), createMockTool({ name: "tool2" })];

			const bridge = new McpBridge(mockClientManager);
			await bridge.initialize();

			// Simulate app reconnect (clientManager fires onToolsChanged)
			mockClientManager.getTools.mockReturnValue(updatedTools as any);
			const toolsChangedCallback = mockClientManager.onToolsChanged.mock.calls[0]?.[0];
			if (toolsChangedCallback) {
				await toolsChangedCallback();
			}

			expect(mockClientManager.getTools).toBeDefined();

			bridge.close();
		});

		it("should handle app crash mid-session", async () => {
			mockClientManager = createMockClientManager({ isConnected: true });

			const bridge = new McpBridge(mockClientManager);
			await bridge.initialize();

			// Simulate crash
			(mockClientManager as any).isConnected = false;

			expect(bridge.isConnected).toBe(false);

			bridge.close();
		});
	});

	describe("reconnection handling", () => {
		it("should refresh tools on reconnection via onToolsChanged", async () => {
			mockClientManager = createMockClientManager({ isConnected: false });

			const bridge = new McpBridge(mockClientManager);
			await bridge.initialize();

			// Simulate reconnection: clientManager fires onToolsChanged
			(mockClientManager as any).isConnected = true;
			const updatedTools = [createMockTool()];
			mockClientManager.getTools.mockReturnValue(updatedTools as any);

			const toolsChangedCallback = mockClientManager.onToolsChanged.mock.calls[0]?.[0];
			if (toolsChangedCallback) {
				await toolsChangedCallback();
			}

			expect(bridge.isConnected).toBe(true);

			bridge.close();
		});

		it("should notify callbacks on reconnection", async () => {
			mockClientManager = createMockClientManager({ isConnected: false });

			const bridge = new McpBridge(mockClientManager);
			const callback = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
			bridge.onToolsChanged(callback);

			await bridge.initialize();

			// Simulate reconnection
			const toolsChangedCallback = mockClientManager.onToolsChanged.mock.calls[0]?.[0];
			if (toolsChangedCallback) {
				await toolsChangedCallback();
			}

			await wait(10);
			expect(callback).toHaveBeenCalled();

			bridge.close();
		});
	});
});
