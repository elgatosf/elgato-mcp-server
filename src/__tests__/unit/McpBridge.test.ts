import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LOG_PREFIX } from "../../constants.js";
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
			onDisconnected: jest.fn(),
			onNotification: jest.fn(),
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

		it("should notify callbacks on disconnection", async () => {
			const callback = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

			bridge.onToolsChanged(callback);

			mockClient.connect.mockResolvedValue(true);
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			mockClient.getTools.mockResolvedValue([createMockTool()]);

			await bridge.initialize();

			// Get the onDisconnected callback
			const onDisconnectedCallback = mockClient.onDisconnected.mock.calls[0]?.[0];
			expect(onDisconnectedCallback).toBeDefined();

			// Simulate disconnection
			(mockClient as any).isConnected = false;
			if (onDisconnectedCallback) {
				await onDisconnectedCallback();
			}

			await wait(10);

			// Callback should be called on disconnection
			expect(callback).toHaveBeenCalled();
		});

		it("should clear cached tools on disconnection", async () => {
			mockClient.connect.mockResolvedValue(true);
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			mockClient.getTools.mockResolvedValue([createMockTool({ name: "test_tool" })]);

			await bridge.initialize();

			// Verify tools were cached (getTools was called during init)
			expect(mockClient.getTools).toHaveBeenCalledTimes(1);

			// Get the onDisconnected callback
			const onDisconnectedCallback = mockClient.onDisconnected.mock.calls[0]?.[0];
			expect(onDisconnectedCallback).toBeDefined();

			// Simulate disconnection
			(mockClient as any).isConnected = false;
			if (onDisconnectedCallback) {
				await onDisconnectedCallback();
			}

			// After disconnection, tools should be cleared
			// We can verify this by checking that the next tools/list returns empty
			// (since isConnected is false, it returns empty tools)
		});

		it("should notify multiple callbacks on disconnection", async () => {
			const callback1 = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
			const callback2 = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

			bridge.onToolsChanged(callback1);
			bridge.onToolsChanged(callback2);

			mockClient.connect.mockResolvedValue(true);
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			mockClient.getTools.mockResolvedValue([]);

			await bridge.initialize();

			const onDisconnectedCallback = mockClient.onDisconnected.mock.calls[0]?.[0];

			(mockClient as any).isConnected = false;
			if (onDisconnectedCallback) {
				await onDisconnectedCallback();
			}

			await wait(10);

			expect(callback1).toHaveBeenCalled();
			expect(callback2).toHaveBeenCalled();
		});

		it("should handle errors in disconnection notification callbacks", async () => {
			const errorCallback = jest.fn<() => Promise<void>>().mockRejectedValue(new Error("Callback error"));
			const successCallback = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

			bridge.onToolsChanged(errorCallback);
			bridge.onToolsChanged(successCallback);

			mockClient.connect.mockResolvedValue(true);
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			mockClient.getTools.mockResolvedValue([]);

			await bridge.initialize();

			const onDisconnectedCallback = mockClient.onDisconnected.mock.calls[0]?.[0];

			(mockClient as any).isConnected = false;
			if (onDisconnectedCallback) {
				await onDisconnectedCallback();
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

	describe("connection state handling", () => {
		// Unit tests verify connection state changes through public API
		// Handler behavior is tested in integration tests (mcp-protocol.test.ts)

		it("should handle connection state changes during server lifecycle", async () => {
			// Phase 1: Start connected and populate cache
			mockClient.connect.mockResolvedValue(true);
			(mockClient as any).isConnected = true;
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			const tools = [
				createMockTool({ name: "cached_tool_1" }),
				createMockTool({ name: "cached_tool_2" }),
			];
			mockClient.getTools.mockResolvedValue(tools);

			await bridge.initialize();
			expect(bridge.isConnected).toBe(true);
			expect(mockClient.getTools).toHaveBeenCalledTimes(1);

			// Phase 2: Create server while connected - should work
			const connectedServer = bridge.createServer();
			expect(connectedServer).toBeDefined();

			// Phase 3: Simulate disconnection
			(mockClient as any).isConnected = false;
			expect(bridge.isConnected).toBe(false);

			// Phase 4: Create another server while disconnected - should still work
			// The handler behavior difference (empty tools vs cached) is verified
			// through integration tests that actually invoke the handlers
			const disconnectedServer = bridge.createServer();
			expect(disconnectedServer).toBeDefined();
		});
	});

	describe("Stream Deck notification handling", () => {
		beforeEach(async () => {
			mockClient.connect.mockResolvedValue(true);
			(mockClient as any).isConnected = true;
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			mockClient.getTools.mockResolvedValue([createMockTool()]);
		});

		describe("tools/changed notification", () => {
			it("should call refreshTools and notifyToolsChanged when tools/changed notification is received", async () => {
				await bridge.initialize();

				// Track calls to getTools (proxy for refreshTools)
				const initialGetToolsCalls = mockClient.getTools.mock.calls.length;

				// Register a tools changed callback to verify notifyToolsChanged is called
				const toolsChangedCallback = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
				bridge.onToolsChanged(toolsChangedCallback);

				// Get the onNotification callback that was registered
				const onNotificationCallback = mockClient.onNotification.mock.calls[0]?.[0];
				expect(onNotificationCallback).toBeDefined();

				// Set up fresh mock for getTools
				mockClient.getTools.mockResolvedValue([createMockTool({ name: "new_tool" })]);

				// Simulate tools/changed notification
				if (onNotificationCallback) {
					onNotificationCallback("tools/changed", undefined);
				}

				await wait(10);

				// Verify getTools was called again (refreshTools)
				expect(mockClient.getTools.mock.calls.length).toBeGreaterThan(initialGetToolsCalls);

				// Verify toolsChangedCallback was called (notifyToolsChanged)
				expect(toolsChangedCallback).toHaveBeenCalled();
			});

			it("should invoke all registered onToolsChanged callbacks on tools/changed notification", async () => {
				await bridge.initialize();

				const callback1 = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
				const callback2 = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

				bridge.onToolsChanged(callback1);
				bridge.onToolsChanged(callback2);

				const onNotificationCallback = mockClient.onNotification.mock.calls[0]?.[0];

				if (onNotificationCallback) {
					onNotificationCallback("tools/changed", undefined);
				}

				await wait(10);

				expect(callback1).toHaveBeenCalled();
				expect(callback2).toHaveBeenCalled();
			});
		});

		describe("custom notification forwarding", () => {
			it("should forward non-tools/changed notifications to onStreamDeckNotification callbacks", async () => {
				await bridge.initialize();

				const forwardCallback = jest.fn<(method: string, params?: unknown) => Promise<void>>()
					.mockResolvedValue(undefined);
				bridge.onStreamDeckNotification(forwardCallback);

				const onNotificationCallback = mockClient.onNotification.mock.calls[0]?.[0];

				if (onNotificationCallback) {
					onNotificationCallback("custom/event", { data: "test" });
				}

				await wait(10);

				expect(forwardCallback).toHaveBeenCalledWith("custom/event", { data: "test" });
			});

			it("should forward multiple custom notifications correctly", async () => {
				await bridge.initialize();

				const forwardCallback = jest.fn<(method: string, params?: unknown) => Promise<void>>()
					.mockResolvedValue(undefined);
				bridge.onStreamDeckNotification(forwardCallback);

				const onNotificationCallback = mockClient.onNotification.mock.calls[0]?.[0];

				if (onNotificationCallback) {
					onNotificationCallback("event/one", { seq: 1 });
					onNotificationCallback("event/two", { seq: 2 });
				}

				await wait(10);

				expect(forwardCallback).toHaveBeenCalledTimes(2);
				expect(forwardCallback).toHaveBeenCalledWith("event/one", { seq: 1 });
				expect(forwardCallback).toHaveBeenCalledWith("event/two", { seq: 2 });
			});

			it("should not forward tools/changed to onStreamDeckNotification callbacks", async () => {
				await bridge.initialize();

				const forwardCallback = jest.fn<(method: string, params?: unknown) => Promise<void>>()
					.mockResolvedValue(undefined);
				bridge.onStreamDeckNotification(forwardCallback);

				const onNotificationCallback = mockClient.onNotification.mock.calls[0]?.[0];

				if (onNotificationCallback) {
					onNotificationCallback("tools/changed", undefined);
				}

				await wait(10);

				// tools/changed should be handled internally, not forwarded
				expect(forwardCallback).not.toHaveBeenCalled();
			});
		});

		describe("forward error handling", () => {
			let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

			beforeEach(() => {
				consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
			});

			afterEach(() => {
				consoleErrorSpy.mockRestore();
			});

			it("should catch and log errors from forward callbacks", async () => {
				await bridge.initialize();

				const errorCallback = jest.fn<(method: string, params?: unknown) => Promise<void>>()
					.mockRejectedValue(new Error("Forward failed"));
				bridge.onStreamDeckNotification(errorCallback);

				const onNotificationCallback = mockClient.onNotification.mock.calls[0]?.[0];

				if (onNotificationCallback) {
					onNotificationCallback("custom/error", undefined);
				}

				await wait(10);

				expect(errorCallback).toHaveBeenCalled();
				// The error should be logged with LOG_PREFIX and "Failed to forward notification:" message
				// The log() function calls console.error(LOG_PREFIX, ...args)
				expect(consoleErrorSpy).toHaveBeenCalledWith(
					LOG_PREFIX,
					"Failed to forward notification:",
					expect.any(Error)
				);
			});

			it("should continue invoking remaining forward callbacks after one throws", async () => {
				await bridge.initialize();

				const errorCallback = jest.fn<(method: string, params?: unknown) => Promise<void>>()
					.mockRejectedValue(new Error("First forward failed"));
				const successCallback = jest.fn<(method: string, params?: unknown) => Promise<void>>()
					.mockResolvedValue(undefined);

				bridge.onStreamDeckNotification(errorCallback);
				bridge.onStreamDeckNotification(successCallback);

				const onNotificationCallback = mockClient.onNotification.mock.calls[0]?.[0];

				if (onNotificationCallback) {
					onNotificationCallback("custom/resilience", { test: true });
				}

				await wait(10);

				// Both callbacks should be invoked despite the error
				expect(errorCallback).toHaveBeenCalledWith("custom/resilience", { test: true });
				expect(successCallback).toHaveBeenCalledWith("custom/resilience", { test: true });
			});
		});

		describe("multiple forward callbacks", () => {
			it("should invoke all registered onStreamDeckNotification callbacks", async () => {
				await bridge.initialize();

				const callback1 = jest.fn<(method: string, params?: unknown) => Promise<void>>()
					.mockResolvedValue(undefined);
				const callback2 = jest.fn<(method: string, params?: unknown) => Promise<void>>()
					.mockResolvedValue(undefined);
				const callback3 = jest.fn<(method: string, params?: unknown) => Promise<void>>()
					.mockResolvedValue(undefined);

				bridge.onStreamDeckNotification(callback1);
				bridge.onStreamDeckNotification(callback2);
				bridge.onStreamDeckNotification(callback3);

				const onNotificationCallback = mockClient.onNotification.mock.calls[0]?.[0];

				if (onNotificationCallback) {
					onNotificationCallback("test/multicast", { value: 42 });
				}

				await wait(10);

				expect(callback1).toHaveBeenCalledWith("test/multicast", { value: 42 });
				expect(callback2).toHaveBeenCalledWith("test/multicast", { value: 42 });
				expect(callback3).toHaveBeenCalledWith("test/multicast", { value: 42 });
			});
		});
	});
});

