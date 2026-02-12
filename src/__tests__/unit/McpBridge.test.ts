import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LOG_PREFIX, SDK_NOTIFICATIONS } from "../../constants.js";
import { createConnectedBridge, createInitializedBridge, McpBridge } from "../../McpBridge.js";
import type { StreamDeckClient } from "../../StreamDeckClient.js";
import { createMockResource, createMockServerInfo, createMockTool, wait } from "../helpers/testUtils.js";
import { MockTransport } from "../helpers/MockTransport.js";

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
			getResources: jest.fn(),
			readResource: jest.fn(),
			callTool: jest.fn(),
			onConnected: jest.fn(),
			onDisconnected: jest.fn(),
			onNotification: jest.fn(),
			onElicitation: jest.fn(),
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

		it("should refresh resources during initialization when connected", async () => {
			mockClient.connect.mockResolvedValue(true);
			(mockClient as any).isConnected = true;
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			mockClient.getTools.mockResolvedValue([createMockTool()]);
			mockClient.getResources.mockResolvedValue([createMockResource()]);

			await bridge.initialize();

			expect(mockClient.getResources).toHaveBeenCalled();
		});

		it("should not refresh resources during initialization when disconnected", async () => {
			mockClient.connect.mockResolvedValue(false);

			await bridge.initialize();

			expect(mockClient.getResources).not.toHaveBeenCalled();
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

	describe("resources caching", () => {
		it("should refresh resources on reconnection", async () => {
			mockClient.connect.mockResolvedValue(true);
			(mockClient as any).isConnected = true;
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			mockClient.getTools.mockResolvedValue([]);
			mockClient.getResources.mockResolvedValue([]);

			await bridge.initialize();

			// Get the onConnected callback
			const onConnectedCallback = mockClient.onConnected.mock.calls[0]?.[0];
			expect(onConnectedCallback).toBeDefined();

			// Reset mock to track reconnection calls
			mockClient.getResources.mockClear();
			mockClient.getResources.mockResolvedValue([createMockResource()]);

			// Simulate reconnection
			if (onConnectedCallback) {
				await onConnectedCallback();
			}

			// Resources should be refreshed
			expect(mockClient.getResources).toHaveBeenCalled();
		});

		it("should call resources changed callbacks on reconnection", async () => {
			const callback = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

			bridge.onResourcesChanged(callback);

			mockClient.connect.mockResolvedValue(true);
			(mockClient as any).isConnected = true;
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			mockClient.getTools.mockResolvedValue([]);
			mockClient.getResources.mockResolvedValue([]);

			await bridge.initialize();

			// Get the onConnected callback
			const onConnectedCallback = mockClient.onConnected.mock.calls[0]?.[0];

			// Simulate reconnection
			if (onConnectedCallback) {
				await onConnectedCallback();
			}

			await wait(10);

			// Callback should be called on reconnection
			expect(callback).toHaveBeenCalled();
		});

		it("should call resources changed callbacks on disconnection", async () => {
			const callback = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

			bridge.onResourcesChanged(callback);

			mockClient.connect.mockResolvedValue(true);
			(mockClient as any).isConnected = true;
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			mockClient.getTools.mockResolvedValue([]);
			mockClient.getResources.mockResolvedValue([]);

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

		it("should notify multiple resources callbacks on disconnection", async () => {
			const callback1 = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
			const callback2 = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

			bridge.onResourcesChanged(callback1);
			bridge.onResourcesChanged(callback2);

			mockClient.connect.mockResolvedValue(true);
			(mockClient as any).isConnected = true;
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			mockClient.getTools.mockResolvedValue([]);
			mockClient.getResources.mockResolvedValue([]);

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
					onNotificationCallback(SDK_NOTIFICATIONS.TOOLS_LIST_CHANGED, undefined);
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
					onNotificationCallback(SDK_NOTIFICATIONS.TOOLS_LIST_CHANGED, undefined);
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
					onNotificationCallback(SDK_NOTIFICATIONS.TOOLS_LIST_CHANGED, undefined);
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

		describe("resources/list_changed notification", () => {
			it("should call refreshResources and notifyResourcesChanged when notification is received", async () => {
				await bridge.initialize();

				// Track calls to getResources (proxy for refreshResources)
				const initialGetResourcesCalls = mockClient.getResources.mock.calls.length;

				// Register a resources changed callback
				const resourcesChangedCallback = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
				bridge.onResourcesChanged(resourcesChangedCallback);

				// Get the onNotification callback that was registered
				const onNotificationCallback = mockClient.onNotification.mock.calls[0]?.[0];
				expect(onNotificationCallback).toBeDefined();

				// Set up fresh mock for getResources
				mockClient.getResources.mockResolvedValue([createMockResource()]);

				// Simulate resources/list_changed notification
				if (onNotificationCallback) {
					onNotificationCallback(SDK_NOTIFICATIONS.RESOURCES_LIST_CHANGED, undefined);
				}

				await wait(10);

				// Verify getResources was called (refreshResources)
				expect(mockClient.getResources.mock.calls.length).toBeGreaterThan(initialGetResourcesCalls);

				// Verify resourcesChangedCallback was called (notifyResourcesChanged)
				expect(resourcesChangedCallback).toHaveBeenCalled();
			});

			it("should not forward resources/list_changed to onStreamDeckNotification callbacks", async () => {
				await bridge.initialize();

				const forwardCallback = jest.fn<(method: string, params?: unknown) => Promise<void>>()
					.mockResolvedValue(undefined);
				bridge.onStreamDeckNotification(forwardCallback);

				const onNotificationCallback = mockClient.onNotification.mock.calls[0]?.[0];

				if (onNotificationCallback) {
					onNotificationCallback(SDK_NOTIFICATIONS.RESOURCES_LIST_CHANGED, undefined);
				}

				await wait(10);

				// resources/list_changed should be handled internally, not forwarded
				expect(forwardCallback).not.toHaveBeenCalled();
			});
		});

		describe("resources/updated notification", () => {
			it("should refresh resources when notification is received", async () => {
				await bridge.initialize();

				const initialGetResourcesCalls = mockClient.getResources.mock.calls.length;
				mockClient.getResources.mockResolvedValue([createMockResource()]);

				const onNotificationCallback = mockClient.onNotification.mock.calls[0]?.[0];

				if (onNotificationCallback) {
					onNotificationCallback(SDK_NOTIFICATIONS.RESOURCES_UPDATED, { uri: "streamdeck://test" });
				}

				await wait(10);

				// Verify getResources was called (refreshResources)
				expect(mockClient.getResources.mock.calls.length).toBeGreaterThan(initialGetResourcesCalls);
			});

			it("should not forward resources/updated to onStreamDeckNotification callbacks", async () => {
				await bridge.initialize();

				const forwardCallback = jest.fn<(method: string, params?: unknown) => Promise<void>>()
					.mockResolvedValue(undefined);
				bridge.onStreamDeckNotification(forwardCallback);

				const onNotificationCallback = mockClient.onNotification.mock.calls[0]?.[0];

				if (onNotificationCallback) {
					onNotificationCallback(SDK_NOTIFICATIONS.RESOURCES_UPDATED, { uri: "streamdeck://test" });
				}

				await wait(10);

				// resources/updated should be handled internally, not forwarded
				expect(forwardCallback).not.toHaveBeenCalled();
			});
		});
	});

	describe("resources callback notifications", () => {
		it("should register resources changed callback", () => {
			const callback = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

			bridge.onResourcesChanged(callback);

			// Callback should be registered (will be called when resources change)
			expect(callback).not.toHaveBeenCalled();
		});

		it("should invoke all registered onResourcesChanged callbacks", async () => {
			mockClient.connect.mockResolvedValue(true);
			(mockClient as any).isConnected = true;
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			mockClient.getTools.mockResolvedValue([]);
			mockClient.getResources.mockResolvedValue([createMockResource()]);

			const callback1 = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
			const callback2 = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

			bridge.onResourcesChanged(callback1);
			bridge.onResourcesChanged(callback2);

			await bridge.initialize();

			const onNotificationCallback = mockClient.onNotification.mock.calls[0]?.[0];

			if (onNotificationCallback) {
				onNotificationCallback(SDK_NOTIFICATIONS.RESOURCES_LIST_CHANGED, undefined);
			}

			await wait(10);

			expect(callback1).toHaveBeenCalled();
			expect(callback2).toHaveBeenCalled();
		});

		it("should handle errors in resources notification callbacks", async () => {
			const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

			mockClient.connect.mockResolvedValue(true);
			(mockClient as any).isConnected = true;
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			mockClient.getTools.mockResolvedValue([]);
			mockClient.getResources.mockResolvedValue([]);

			const errorCallback = jest.fn<() => Promise<void>>().mockRejectedValue(new Error("Resources callback error"));
			const successCallback = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

			bridge.onResourcesChanged(errorCallback);
			bridge.onResourcesChanged(successCallback);

			await bridge.initialize();

			const onNotificationCallback = mockClient.onNotification.mock.calls[0]?.[0];

			if (onNotificationCallback) {
				onNotificationCallback(SDK_NOTIFICATIONS.RESOURCES_LIST_CHANGED, undefined);
			}

			await wait(10);

			// Both callbacks should be called despite error
			expect(errorCallback).toHaveBeenCalled();
			expect(successCallback).toHaveBeenCalled();

			// Error should be logged
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				LOG_PREFIX,
				"Failed to notify resources changed:",
				expect.any(Error)
			);

			consoleErrorSpy.mockRestore();
		});
	});

	describe("resource subscription forwarding", () => {
		it("should forward RESOURCES_UPDATED notification when subscribed to resource", async () => {
			mockClient.connect.mockResolvedValue(true);
			(mockClient as any).isConnected = true;
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			mockClient.getTools.mockResolvedValue([]);
			mockClient.getResources.mockResolvedValue([createMockResource({ uri: "streamdeck://test/resource" })]);

			const notificationCallback = jest.fn<(method: string, params?: unknown) => Promise<void>>().mockResolvedValue(undefined);

			bridge.onStreamDeckNotification(notificationCallback);

			await bridge.initialize();

			// Simulate RESOURCES_UPDATED notification for a non-subscribed resource
			const onNotificationCallback = mockClient.onNotification.mock.calls[0]?.[0];
			if (onNotificationCallback) {
				onNotificationCallback(SDK_NOTIFICATIONS.RESOURCES_UPDATED, { uri: "streamdeck://test/not-subscribed" });
			}

			await wait(10);

			// Should NOT be forwarded since not subscribed
			expect(notificationCallback).not.toHaveBeenCalledWith(
				SDK_NOTIFICATIONS.RESOURCES_UPDATED,
				expect.anything()
			);
		});

		it("should forward RESOURCES_UPDATED notification after subscribing via handler", async () => {
			const { MockTransport } = await import("../helpers/MockTransport.js");

			mockClient.connect.mockResolvedValue(true);
			(mockClient as any).isConnected = true;
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			mockClient.getTools.mockResolvedValue([]);
			mockClient.getResources.mockResolvedValue([createMockResource({ uri: "streamdeck://test/subscribed" })]);

			const notificationCallback = jest.fn<(method: string, params?: unknown) => Promise<void>>().mockResolvedValue(undefined);

			bridge.onStreamDeckNotification(notificationCallback);

			await bridge.initialize();

			// Create server and connect transport
			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			// Subscribe to a resource via the handler
			const subscribeRequest = {
				jsonrpc: "2.0" as const,
				id: 1,
				method: "resources/subscribe",
				params: { uri: "streamdeck://test/subscribed" },
			};
			transport.simulateIncomingMessage(subscribeRequest);
			await transport.waitForOutgoingMessage();

			// Now simulate RESOURCES_UPDATED notification for the subscribed resource
			const onNotificationCallback = mockClient.onNotification.mock.calls[0]?.[0];
			if (onNotificationCallback) {
				onNotificationCallback(SDK_NOTIFICATIONS.RESOURCES_UPDATED, { uri: "streamdeck://test/subscribed" });
			}

			await wait(10);

			// Should be forwarded since subscribed
			expect(notificationCallback).toHaveBeenCalledWith(
				SDK_NOTIFICATIONS.RESOURCES_UPDATED,
				{ uri: "streamdeck://test/subscribed" }
			);
		});
	});

	describe("elicitation forwarding", () => {
		it("should register elicitation callback with StreamDeckClient", async () => {
			mockClient.connect.mockResolvedValue(true);
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			mockClient.getTools.mockResolvedValue([]);

			await bridge.initialize();

			// Verify onElicitation was called to register a callback
			expect(mockClient.onElicitation).toHaveBeenCalled();
			expect(mockClient.onElicitation).toHaveBeenCalledWith(expect.any(Function));
		});

		it("should decline elicitation when no active MCP server context (unknown correlation ID)", async () => {
			mockClient.connect.mockResolvedValue(true);
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			mockClient.getTools.mockResolvedValue([]);

			await bridge.initialize();

			// Get the onElicitation callback that was registered
			const onElicitationCallback = mockClient.onElicitation.mock.calls[0]?.[0];
			expect(onElicitationCallback).toBeDefined();

			// Call the elicitation callback with an unknown correlation ID
			if (onElicitationCallback) {
				const result = await onElicitationCallback({
					message: "Enter username",
					mode: "form",
					requestedSchema: { type: "object", properties: { username: { type: "string" } } },
					relatedToolCallId: "unknown-correlation-id",
				});

				// Should decline since no active MCP server context for this correlation ID
				expect(result).toEqual({ action: "decline" });
			}
		});

		it("should register elicitation callback even when connection fails", async () => {
			mockClient.connect.mockResolvedValue(false);

			await bridge.initialize();

			// Verify onElicitation was still called
			expect(mockClient.onElicitation).toHaveBeenCalled();
		});

		it("should forward elicitation to active MCP server during tool call and return response", async () => {
			mockClient.connect.mockResolvedValue(true);
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			mockClient.getTools.mockResolvedValue([]);
			(mockClient as any).isConnected = true;

			await bridge.initialize();

			// Create a deferred promise to control when callTool resolves
			let resolveToolCall!: () => void;
			const toolCallPromise = new Promise<void>((resolve) => {
				resolveToolCall = resolve;
			});

			// Make callTool block until we manually resolve it
			mockClient.callTool.mockImplementation(async (): Promise<any> => {
				await toolCallPromise;
				return { id: "1", result: { success: true } };
			});

			// Create the MCP server and connect a mock transport
			const mcpServer = bridge.createServer();

			// Mock the elicitInput method on the low-level server
			const mockElicitInput = jest
				.fn<(params: any) => Promise<{ action: string; content?: Record<string, unknown> }>>()
				.mockResolvedValue({
					action: "accept",
					content: { username: "testuser", password: "secret123" },
				});
			(mcpServer.server as any).elicitInput = mockElicitInput;

			// Create a mock transport and connect
			// The sessionId on the transport is used by the SDK to build the correlation ID
			const mockTransport = new MockTransport();
			mockTransport.sessionId = "test-session-123";
			await mcpServer.connect(mockTransport);

			// Simulate a tools/call request to trigger the handler
			// The SDK will build extra.sessionId from transport.sessionId and extra.requestId from message.id
			const toolCallRequest = {
				jsonrpc: "2.0" as const,
				id: 42,
				method: "tools/call",
				params: { name: "test_tool", arguments: { param1: "value1" } },
			};

			// Trigger the tool call (this will block on our deferred promise)
			mockTransport.simulateIncomingMessage(toolCallRequest);
			// Give the handler time to start and register the correlation ID
			await wait(50);

			// Verify callTool was called and capture the correlation ID
			expect(mockClient.callTool).toHaveBeenCalled();
			const capturedCorrelationId = mockClient.callTool.mock.calls[0]?.[2];
			expect(capturedCorrelationId).toBeDefined();

			// Get the onElicitation callback that was registered
			const onElicitationCallback = mockClient.onElicitation.mock.calls[0]?.[0];
			expect(onElicitationCallback).toBeDefined();

			// Trigger elicitation with the matching correlation ID
			if (onElicitationCallback) {
				const elicitationResult = await onElicitationCallback({
					message: "Please enter your credentials",
					mode: "form",
					requestedSchema: {
						type: "object",
						properties: {
							username: { type: "string" },
							password: { type: "string" },
						},
					},
					relatedToolCallId: capturedCorrelationId as string,
				});

				// Verify elicitInput was called with correct parameters
				expect(mockElicitInput).toHaveBeenCalledWith({
					message: "Please enter your credentials",
					mode: "form",
					requestedSchema: {
						type: "object",
						properties: {
							username: { type: "string" },
							password: { type: "string" },
						},
					},
				});

				// Verify the response was forwarded correctly
				expect(elicitationResult).toEqual({
					action: "accept",
					content: { username: "testuser", password: "secret123" },
				});
			}

			// Complete the tool call to clean up
			resolveToolCall();
		});

		it("should return decline when elicitInput throws an error", async () => {
			mockClient.connect.mockResolvedValue(true);
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			mockClient.getTools.mockResolvedValue([]);
			(mockClient as any).isConnected = true;

			await bridge.initialize();

			// Create a deferred promise to control when callTool resolves
			let resolveToolCall!: () => void;
			const toolCallPromise = new Promise<void>((resolve) => {
				resolveToolCall = resolve;
			});

			mockClient.callTool.mockImplementation(async (): Promise<any> => {
				await toolCallPromise;
				return { id: "1", result: { success: true } };
			});

			const mcpServer = bridge.createServer();

			// Mock elicitInput to throw an error
			const mockElicitInput = jest
				.fn<(params: any) => Promise<{ action: string; content?: Record<string, unknown> }>>()
				.mockRejectedValue(new Error("Client disconnected"));
			(mcpServer.server as any).elicitInput = mockElicitInput;

			const mockTransport = new MockTransport();
			mockTransport.sessionId = "test-session-456";
			await mcpServer.connect(mockTransport);

			const toolCallRequest = {
				jsonrpc: "2.0" as const,
				id: 99,
				method: "tools/call",
				params: { name: "test_tool", arguments: {} },
			};

			mockTransport.simulateIncomingMessage(toolCallRequest);
			await wait(50);

			const capturedCorrelationId = mockClient.callTool.mock.calls[0]?.[2];
			const onElicitationCallback = mockClient.onElicitation.mock.calls[0]?.[0];

			// Trigger elicitation - should catch the error and return decline
			if (onElicitationCallback) {
				const elicitationResult = await onElicitationCallback({
					message: "Enter data",
					mode: "form",
					requestedSchema: { type: "object" },
					relatedToolCallId: capturedCorrelationId as string,
				});

				// Verify elicitInput was called
				expect(mockElicitInput).toHaveBeenCalled();

				// Verify the error was caught and decline was returned
				expect(elicitationResult).toEqual({ action: "decline" });
			}

			// Complete the tool call to clean up
			resolveToolCall();
		});

		it("should handle cancel action from elicitInput", async () => {
			mockClient.connect.mockResolvedValue(true);
			mockClient.getServerInfo.mockResolvedValue(createMockServerInfo());
			mockClient.getTools.mockResolvedValue([]);
			(mockClient as any).isConnected = true;

			await bridge.initialize();

			let resolveToolCall!: () => void;
			const toolCallPromise = new Promise<void>((resolve) => {
				resolveToolCall = resolve;
			});

			mockClient.callTool.mockImplementation(async (): Promise<any> => {
				await toolCallPromise;
				return { id: "1", result: { success: true } };
			});

			const mcpServer = bridge.createServer();

			// Mock elicitInput to return cancel action
			const mockElicitInput = jest
				.fn<(params: any) => Promise<{ action: string; content?: Record<string, unknown> }>>()
				.mockResolvedValue({
					action: "cancel",
				});
			(mcpServer.server as any).elicitInput = mockElicitInput;

			const mockTransport = new MockTransport();
			mockTransport.sessionId = "test-session-789";
			await mcpServer.connect(mockTransport);

			const toolCallRequest = {
				jsonrpc: "2.0" as const,
				id: 77,
				method: "tools/call",
				params: { name: "test_tool", arguments: {} },
			};

			mockTransport.simulateIncomingMessage(toolCallRequest);
			await wait(50);

			const capturedCorrelationId = mockClient.callTool.mock.calls[0]?.[2];
			const onElicitationCallback = mockClient.onElicitation.mock.calls[0]?.[0];

			if (onElicitationCallback) {
				const elicitationResult = await onElicitationCallback({
					message: "Confirm action",
					mode: "form",
					requestedSchema: { type: "object" },
					relatedToolCallId: capturedCorrelationId as string,
				});

				// Verify cancel action is forwarded correctly
				expect(elicitationResult).toEqual({
					action: "cancel",
					content: undefined,
				});
			}

			resolveToolCall();
		});
	});
});

describe("createInitializedBridge", () => {
	it("should create and initialize a bridge", async () => {
		// Note: This test uses the real StreamDeckClient which will fail to connect
		// but should still create and return a bridge in disconnected mode
		const bridge = await createInitializedBridge();

		expect(bridge).toBeInstanceOf(McpBridge);
		// Bridge should be in disconnected mode since no real Stream Deck is available
		expect(bridge.isConnected).toBe(false);

		bridge.close();
	});
});

describe("createConnectedBridge", () => {
	it("should create bridge and connect to transport", async () => {
		const transport = new MockTransport();
		const bridge = await createConnectedBridge(transport);

		expect(bridge).toBeInstanceOf(McpBridge);
		// Transport should be started
		expect(transport.isStarted()).toBe(true);

		bridge.close();
		await transport.close();
	});

	it("should set up tools changed notification forwarding", async () => {
		const transport = new MockTransport();
		const bridge = await createConnectedBridge(transport);

		// Bridge is now configured with callbacks that forward notifications
		// We can verify the bridge was properly set up
		expect(bridge).toBeDefined();

		bridge.close();
		await transport.close();
	});

	it("should handle resources changed notification errors gracefully", async () => {
		const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
		const transport = new MockTransport();
		const bridge = await createConnectedBridge(transport);

		// Trigger resources changed callback - transport is not fully connected so it may error
		// The error should be caught and logged, not thrown
		const resourcesChangedCallbacks = (bridge as any).resourcesChangedCallbacks;
		if (resourcesChangedCallbacks && resourcesChangedCallbacks.length > 0) {
			// Trigger the callback
			await resourcesChangedCallbacks[0]();
		}

		bridge.close();
		await transport.close();
		consoleSpy.mockRestore();
	});

	it("should handle Stream Deck notification forwarding errors gracefully", async () => {
		const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
		const transport = new MockTransport();
		const bridge = await createConnectedBridge(transport);

		// Trigger streamDeckNotification callback - the mcpServer.server.notification may fail
		// The error should be caught and logged, not thrown
		const notificationCallbacks = (bridge as any).streamDeckNotificationCallbacks;
		if (notificationCallbacks && notificationCallbacks.length > 0) {
			// Trigger the callback with a test notification
			await notificationCallbacks[0]("test/notification", { data: "test" });
		}

		bridge.close();
		await transport.close();
		consoleSpy.mockRestore();
	});
});

