import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mocked } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ClientManager } from "../../ClientManager.js";
import { LOG_PREFIX, SDK_NOTIFICATIONS } from "../../constants.js";
import { createConnectedBridge, createInitializedBridge, McpBridge } from "../../McpBridge.js";
import { setVerbose } from "../../utils.js";
import { MockTransport } from "../helpers/MockTransport.js";
import { createMockClientManager, createMockResource, createMockTool, wait } from "../helpers/testUtils.js";

describe("McpBridge", () => {
	let bridge: McpBridge;
	let mockClientManager: Mocked<ClientManager>;

	beforeEach(() => {
		vi.clearAllMocks();

		mockClientManager = createMockClientManager();
		bridge = new McpBridge(mockClientManager);
	});

	afterEach(() => {
		bridge.close();
		setVerbose(false);
	});

	describe("initialization", () => {
		it("should start disconnected", () => {
			expect(bridge.isConnected).toBe(false);
		});

		it("should initialize by calling clientManager.initialize()", async () => {
			mockClientManager.initialize.mockResolvedValue(undefined);

			await bridge.initialize();

			expect(mockClientManager.initialize).toHaveBeenCalled();
		});

		it("should handle errors from clientManager.initialize()", async () => {
			mockClientManager.initialize.mockRejectedValue(new Error("Init error"));

			await expect(bridge.initialize()).rejects.toThrow("Init error");
		});
	});

	describe("server creation", () => {
		it("should create MCP server using server info from clientManager", () => {
			const server = bridge.createServer();
			expect(server).toBeDefined();
			expect(mockClientManager.getServerInfo).toHaveBeenCalled();
		});

		it("should create independent server instances each time", () => {
			const server1 = bridge.createServer();
			const server2 = bridge.createServer();
			expect(server1).not.toBe(server2);
		});
	});

	describe("isConnected property", () => {
		it("should reflect clientManager connection state", () => {
			(mockClientManager as any).isConnected = false;
			expect(bridge.isConnected).toBe(false);

			(mockClientManager as any).isConnected = true;
			expect(bridge.isConnected).toBe(true);
		});
	});

	describe("close", () => {
		it("should call clientManager.close()", () => {
			bridge.close();
			expect(mockClientManager.close).toHaveBeenCalled();
		});

		it("should clear activeToolCalls on close", async () => {
			(mockClientManager as any).isConnected = true;
			mockClientManager.getTools.mockReturnValue([createMockTool()] as any);

			// Create a deferred promise to control when callTool resolves
			let resolveToolCall!: () => void;
			const toolCallPromise = new Promise<void>((resolve) => {
				resolveToolCall = resolve;
			});

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			mockClientManager.callTool.mockImplementation(async (): Promise<any> => {
				await toolCallPromise;
				return { id: "1", result: { success: true } };
			});

			const mcpServer = bridge.createServer();
			const mockTransport = new MockTransport();
			mockTransport.sessionId = "test-session-456";
			await mcpServer.connect(mockTransport);

			// Simulate a tools/call request to populate activeToolCalls
			const toolCallRequest = {
				jsonrpc: "2.0" as const,
				id: 99,
				method: "tools/call",
				params: { name: "test_tool", arguments: {} },
			};

			mockTransport.simulateIncomingMessage(toolCallRequest);
			await wait(50);

			expect(mockClientManager.callTool).toHaveBeenCalled();
			const capturedCorrelationId = mockClientManager.callTool.mock.calls[0]?.[2];
			expect(capturedCorrelationId).toBeDefined();

			// Get the onElicitation callback that was registered on the clientManager
			const onElicitationCallback = mockClientManager.onElicitation.mock.calls[0]?.[0];
			expect(onElicitationCallback).toBeDefined();

			// Verify elicitation works before close
			if (onElicitationCallback) {
				const mockElicitInput = vi
					.fn<(params: any) => Promise<{ action: string; content?: Record<string, unknown> }>>()
					.mockResolvedValue({ action: "accept", content: { test: "data" } });
				(mcpServer.server as any).elicitInput = mockElicitInput;

				const resultBefore = await onElicitationCallback({
					message: "Test before close",
					mode: "form",
					requestedSchema: { type: "object" },
					relatedToolCallId: capturedCorrelationId as string,
				});

				expect(mockElicitInput).toHaveBeenCalled();
				expect(resultBefore.action).toBe("accept");
			}

			bridge.close();

			// After close, elicitation should decline since activeToolCalls was cleared
			if (onElicitationCallback) {
				const resultAfter = await onElicitationCallback({
					message: "Test after close",
					mode: "form",
					requestedSchema: { type: "object" },
					relatedToolCallId: capturedCorrelationId as string,
				});

				expect(resultAfter).toEqual({ action: "decline" });
			}

			resolveToolCall();
		});
	});

	describe("disposeServer", () => {
		it("should remove all resource subscriptions for a server", async () => {
			(mockClientManager as any).isConnected = true;

			const serverA = bridge.createServer();
			const transportA = new MockTransport();
			await serverA.connect(transportA);

			const serverB = bridge.createServer();
			const transportB = new MockTransport();
			await serverB.connect(transportB);

			// Subscribe both servers to resources
			transportA.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 1,
				method: "resources/subscribe",
				params: { uri: "streamdeck://test/resource1" },
			});
			await transportA.waitForOutgoingMessage();

			transportA.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 2,
				method: "resources/subscribe",
				params: { uri: "streamdeck://test/resource2" },
			});
			await transportA.waitForOutgoingMessage();

			transportB.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 3,
				method: "resources/subscribe",
				params: { uri: "streamdeck://test/resource1" },
			});
			await transportB.waitForOutgoingMessage();

			transportA.clearOutgoingMessages();
			transportB.clearOutgoingMessages();

			// Dispose serverA
			bridge.disposeServer(serverA);

			// Trigger a resource update notification
			const onNotificationCallback = mockClientManager.onNotification.mock.calls[0]?.[0];
			if (onNotificationCallback) {
				onNotificationCallback("notifications/resources/updated", { uri: "streamdeck://test/resource1" });
			}

			await wait(10);

			// ServerA should NOT receive notification (it was disposed)
			const notificationsA = transportA
				.getOutgoingMessages()
				.filter((msg) => "method" in msg && msg.method === "notifications/resources/updated");
			expect(notificationsA).toHaveLength(0);

			// ServerB should still receive notification
			const notificationsB = transportB
				.getOutgoingMessages()
				.filter((msg) => "method" in msg && msg.method === "notifications/resources/updated");
			expect(notificationsB).toHaveLength(1);
		});

		it("should remove activeToolCalls entries for a disposed server", async () => {
			(mockClientManager as any).isConnected = true;
			mockClientManager.getTools.mockReturnValue([createMockTool()] as any);

			// Create a deferred promise to control when callTool resolves
			let resolveToolCall!: () => void;
			const toolCallPromise = new Promise<void>((resolve) => {
				resolveToolCall = resolve;
			});

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			mockClientManager.callTool.mockImplementation(async (): Promise<any> => {
				await toolCallPromise;
				return { id: "1", result: { success: true } };
			});

			const mcpServer = bridge.createServer();
			const mockTransport = new MockTransport();
			mockTransport.sessionId = "test-session-dispose";
			await mcpServer.connect(mockTransport);

			// Simulate a tools/call request to populate activeToolCalls
			const toolCallRequest = {
				jsonrpc: "2.0" as const,
				id: 99,
				method: "tools/call",
				params: { name: "test_tool", arguments: {} },
			};

			mockTransport.simulateIncomingMessage(toolCallRequest);
			await wait(50);

			expect(mockClientManager.callTool).toHaveBeenCalled();
			const capturedCorrelationId = mockClientManager.callTool.mock.calls[0]?.[2];
			expect(capturedCorrelationId).toBeDefined();

			// Get the onElicitation callback
			const onElicitationCallback = mockClientManager.onElicitation.mock.calls[0]?.[0];
			expect(onElicitationCallback).toBeDefined();

			// Dispose the server while tool call is in progress
			bridge.disposeServer(mcpServer);

			// After dispose, elicitation should decline since activeToolCalls was cleared
			if (onElicitationCallback) {
				const resultAfter = await onElicitationCallback({
					message: "Test after dispose",
					mode: "form",
					requestedSchema: { type: "object" },
					relatedToolCallId: capturedCorrelationId as string,
				});

				expect(resultAfter).toEqual({ action: "decline" });
			}

			resolveToolCall();
		});

		it("should handle disposing a server with no subscriptions", () => {
			const server = bridge.createServer();

			// Should not throw when disposing a server with no subscriptions
			expect(() => bridge.disposeServer(server)).not.toThrow();
		});

		it("should handle disposing the same server multiple times", async () => {
			(mockClientManager as any).isConnected = true;

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			// Subscribe to a resource
			transport.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 1,
				method: "resources/subscribe",
				params: { uri: "streamdeck://test/resource" },
			});
			await transport.waitForOutgoingMessage();

			// Dispose twice - should not throw
			expect(() => bridge.disposeServer(server)).not.toThrow();
			expect(() => bridge.disposeServer(server)).not.toThrow();
		});
	});

	describe("callback notifications", () => {
		it("should register tools changed callback", () => {
			const callback = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
			bridge.onToolsChanged(callback);
			expect(callback).not.toHaveBeenCalled();
		});

		it("should notify onToolsChanged callbacks when clientManager fires onToolsChanged", async () => {
			const callback1 = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
			const callback2 = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
			bridge.onToolsChanged(callback1);
			bridge.onToolsChanged(callback2);

			// Get the onToolsChanged callback registered with clientManager
			const managerCallback = mockClientManager.onToolsChanged.mock.calls[0]?.[0];
			expect(managerCallback).toBeDefined();

			if (managerCallback) {
				await managerCallback();
			}

			await wait(10);
			expect(callback1).toHaveBeenCalled();
			expect(callback2).toHaveBeenCalled();
		});

		it("should handle errors in onToolsChanged callbacks", async () => {
			const errorCallback = vi.fn<() => Promise<void>>().mockRejectedValue(new Error("Callback error"));
			const successCallback = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

			bridge.onToolsChanged(errorCallback);
			bridge.onToolsChanged(successCallback);

			const managerCallback = mockClientManager.onToolsChanged.mock.calls[0]?.[0];
			if (managerCallback) {
				await managerCallback();
			}

			await wait(10);
			expect(errorCallback).toHaveBeenCalled();
			expect(successCallback).toHaveBeenCalled();
		});

		it("should notify onResourcesChanged callbacks when clientManager fires onResourcesChanged", async () => {
			const callback = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
			bridge.onResourcesChanged(callback);

			const managerCallback = mockClientManager.onResourcesChanged.mock.calls[0]?.[0];
			if (managerCallback) {
				await managerCallback();
			}

			await wait(10);
			expect(callback).toHaveBeenCalled();
		});

		it("should notify multiple onResourcesChanged callbacks", async () => {
			const callback1 = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
			const callback2 = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
			bridge.onResourcesChanged(callback1);
			bridge.onResourcesChanged(callback2);

			const managerCallback = mockClientManager.onResourcesChanged.mock.calls[0]?.[0];
			if (managerCallback) {
				await managerCallback();
			}

			await wait(10);
			expect(callback1).toHaveBeenCalled();
			expect(callback2).toHaveBeenCalled();
		});

		it("should handle errors in onResourcesChanged callbacks", async () => {
			const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
			const errorCallback = vi.fn<() => Promise<void>>().mockRejectedValue(new Error("Resources error"));
			const successCallback = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
			bridge.onResourcesChanged(errorCallback);
			bridge.onResourcesChanged(successCallback);

			const managerCallback = mockClientManager.onResourcesChanged.mock.calls[0]?.[0];
			if (managerCallback) {
				await managerCallback();
			}

			await wait(10);
			expect(errorCallback).toHaveBeenCalled();
			expect(successCallback).toHaveBeenCalled();
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				LOG_PREFIX,
				"ERROR:",
				"Failed to notify resources changed:",
				expect.any(Error),
			);
			consoleErrorSpy.mockRestore();
		});
	});

	describe("client notification handling", () => {
		let onNotificationCallback: ((method: string, params?: unknown) => void) | undefined;

		beforeEach(() => {
			onNotificationCallback = mockClientManager.onNotification.mock.calls[0]?.[0];
			expect(onNotificationCallback).toBeDefined();
		});

		describe("tools/list_changed notification", () => {
			// Note: TOOLS_LIST_CHANGED is now handled by ClientManager which calls refreshAll()
			// before triggering onToolsChanged. McpBridge receives onToolsChanged callback
			// from ClientManager and forwards to its own callbacks. If this notification
			// reaches McpBridge via onNotification, it should be a no-op (not forwarded).

			it("should not forward tools/list_changed to onClientNotification callbacks", async () => {
				const forwardCallback = vi
					.fn<(method: string, params?: unknown) => Promise<void>>()
					.mockResolvedValue(undefined);
				bridge.onClientNotification(forwardCallback);

				if (onNotificationCallback) {
					onNotificationCallback(SDK_NOTIFICATIONS.TOOLS_LIST_CHANGED, undefined);
				}

				await wait(10);
				expect(forwardCallback).not.toHaveBeenCalled();
			});
		});

		describe("resources/list_changed notification", () => {
			// Note: RESOURCES_LIST_CHANGED is now handled by ClientManager which calls refreshAll()
			// before triggering onResourcesChanged. McpBridge receives onResourcesChanged callback
			// from ClientManager and forwards to its own callbacks. If this notification
			// reaches McpBridge via onNotification, it should be a no-op (not forwarded).

			it("should not forward resources/list_changed to onClientNotification callbacks", async () => {
				const forwardCallback = vi
					.fn<(method: string, params?: unknown) => Promise<void>>()
					.mockResolvedValue(undefined);
				bridge.onClientNotification(forwardCallback);

				if (onNotificationCallback) {
					onNotificationCallback(SDK_NOTIFICATIONS.RESOURCES_LIST_CHANGED, undefined);
				}

				await wait(10);
				expect(forwardCallback).not.toHaveBeenCalled();
			});
		});

		describe("resources/updated notification", () => {
			it("should not forward resources/updated to onClientNotification callbacks", async () => {
				const forwardCallback = vi
					.fn<(method: string, params?: unknown) => Promise<void>>()
					.mockResolvedValue(undefined);
				bridge.onClientNotification(forwardCallback);

				if (onNotificationCallback) {
					onNotificationCallback(SDK_NOTIFICATIONS.RESOURCES_UPDATED, { uri: "streamdeck://test" });
				}

				await wait(10);
				expect(forwardCallback).not.toHaveBeenCalled();
			});
		});

		describe("custom notification forwarding", () => {
			it("should forward non-SDK notifications to onClientNotification callbacks", async () => {
				const forwardCallback = vi
					.fn<(method: string, params?: unknown) => Promise<void>>()
					.mockResolvedValue(undefined);
				bridge.onClientNotification(forwardCallback);

				if (onNotificationCallback) {
					onNotificationCallback("custom/event", { data: "test" });
				}

				await wait(10);
				expect(forwardCallback).toHaveBeenCalledWith("custom/event", { data: "test" });
			});

			it("should forward multiple custom notifications correctly", async () => {
				const forwardCallback = vi
					.fn<(method: string, params?: unknown) => Promise<void>>()
					.mockResolvedValue(undefined);
				bridge.onClientNotification(forwardCallback);

				if (onNotificationCallback) {
					onNotificationCallback("event/one", { seq: 1 });
					onNotificationCallback("event/two", { seq: 2 });
				}

				await wait(10);
				expect(forwardCallback).toHaveBeenCalledTimes(2);
				expect(forwardCallback).toHaveBeenCalledWith("event/one", { seq: 1 });
				expect(forwardCallback).toHaveBeenCalledWith("event/two", { seq: 2 });
			});

			it("should invoke all registered onClientNotification callbacks", async () => {
				const callback1 = vi.fn<(method: string, params?: unknown) => Promise<void>>().mockResolvedValue(undefined);
				const callback2 = vi.fn<(method: string, params?: unknown) => Promise<void>>().mockResolvedValue(undefined);
				const callback3 = vi.fn<(method: string, params?: unknown) => Promise<void>>().mockResolvedValue(undefined);

				bridge.onClientNotification(callback1);
				bridge.onClientNotification(callback2);
				bridge.onClientNotification(callback3);

				if (onNotificationCallback) {
					onNotificationCallback("test/multicast", { value: 42 });
				}

				await wait(10);
				expect(callback1).toHaveBeenCalledWith("test/multicast", { value: 42 });
				expect(callback2).toHaveBeenCalledWith("test/multicast", { value: 42 });
				expect(callback3).toHaveBeenCalledWith("test/multicast", { value: 42 });
			});

			it("should catch and log errors from forward callbacks", async () => {
				const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

				const errorCallback = vi
					.fn<(method: string, params?: unknown) => Promise<void>>()
					.mockRejectedValue(new Error("Forward failed"));
				bridge.onClientNotification(errorCallback);

				if (onNotificationCallback) {
					onNotificationCallback("custom/error", undefined);
				}

				await wait(10);

				expect(errorCallback).toHaveBeenCalled();
				expect(consoleErrorSpy).toHaveBeenCalledWith(
					LOG_PREFIX,
					"ERROR:",
					"Failed to forward notification:",
					expect.any(Error),
				);
				consoleErrorSpy.mockRestore();
			});

			it("should continue invoking remaining forward callbacks after one throws", async () => {
				const errorCallback = vi
					.fn<(method: string, params?: unknown) => Promise<void>>()
					.mockRejectedValue(new Error("First forward failed"));
				const successCallback = vi
					.fn<(method: string, params?: unknown) => Promise<void>>()
					.mockResolvedValue(undefined);

				bridge.onClientNotification(errorCallback);
				bridge.onClientNotification(successCallback);

				if (onNotificationCallback) {
					onNotificationCallback("custom/resilience", { test: true });
				}

				await wait(10);
				expect(errorCallback).toHaveBeenCalledWith("custom/resilience", { test: true });
				expect(successCallback).toHaveBeenCalledWith("custom/resilience", { test: true });
			});
		});
	});

	describe("resource subscription forwarding", () => {
		it("should not send notification when no server has subscribed to resource", async () => {
			(mockClientManager as any).isConnected = true;

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			transport.clearOutgoingMessages();

			const onNotificationCallback = mockClientManager.onNotification.mock.calls[0]?.[0];
			if (onNotificationCallback) {
				onNotificationCallback(SDK_NOTIFICATIONS.RESOURCES_UPDATED, { uri: "streamdeck://test/not-subscribed" });
			}

			await wait(10);

			const notifications = transport
				.getOutgoingMessages()
				.filter((msg) => "method" in msg && msg.method === SDK_NOTIFICATIONS.RESOURCES_UPDATED);
			expect(notifications).toHaveLength(0);
		});

		it("should send notification only to subscribed server", async () => {
			(mockClientManager as any).isConnected = true;

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			// Subscribe to a resource
			const subscribeRequest = {
				jsonrpc: "2.0" as const,
				id: 1,
				method: "resources/subscribe",
				params: { uri: "streamdeck://test/subscribed" },
			};
			transport.simulateIncomingMessage(subscribeRequest);
			await transport.waitForOutgoingMessage();

			transport.clearOutgoingMessages();

			const onNotificationCallback = mockClientManager.onNotification.mock.calls[0]?.[0];
			if (onNotificationCallback) {
				onNotificationCallback(SDK_NOTIFICATIONS.RESOURCES_UPDATED, { uri: "streamdeck://test/subscribed" });
			}

			await wait(10);

			const notifications = transport
				.getOutgoingMessages()
				.filter((msg) => "method" in msg && msg.method === SDK_NOTIFICATIONS.RESOURCES_UPDATED);
			expect(notifications).toHaveLength(1);
			expect(notifications[0]).toMatchObject({
				method: SDK_NOTIFICATIONS.RESOURCES_UPDATED,
				params: { uri: "streamdeck://test/subscribed" },
			});
		});

		it("should send notification only to subscribed server, not to unsubscribed servers", async () => {
			(mockClientManager as any).isConnected = true;

			const serverA = bridge.createServer();
			const transportA = new MockTransport();
			await serverA.connect(transportA);

			const serverB = bridge.createServer();
			const transportB = new MockTransport();
			await serverB.connect(transportB);

			// Session A subscribes
			const subscribeRequest = {
				jsonrpc: "2.0" as const,
				id: 1,
				method: "resources/subscribe",
				params: { uri: "streamdeck://test/resource" },
			};
			transportA.simulateIncomingMessage(subscribeRequest);
			await transportA.waitForOutgoingMessage();

			transportA.clearOutgoingMessages();
			transportB.clearOutgoingMessages();

			const onNotificationCallback = mockClientManager.onNotification.mock.calls[0]?.[0];
			if (onNotificationCallback) {
				onNotificationCallback(SDK_NOTIFICATIONS.RESOURCES_UPDATED, { uri: "streamdeck://test/resource" });
			}

			await wait(10);

			const notificationsA = transportA
				.getOutgoingMessages()
				.filter((msg) => "method" in msg && msg.method === SDK_NOTIFICATIONS.RESOURCES_UPDATED);
			expect(notificationsA).toHaveLength(1);

			const notificationsB = transportB
				.getOutgoingMessages()
				.filter((msg) => "method" in msg && msg.method === SDK_NOTIFICATIONS.RESOURCES_UPDATED);
			expect(notificationsB).toHaveLength(0);
		});

		it("should send notification to both servers when both subscribe to same URI", async () => {
			(mockClientManager as any).isConnected = true;

			const serverA = bridge.createServer();
			const transportA = new MockTransport();
			await serverA.connect(transportA);

			const serverB = bridge.createServer();
			const transportB = new MockTransport();
			await serverB.connect(transportB);

			const subscribeRequest = {
				jsonrpc: "2.0" as const,
				id: 1,
				method: "resources/subscribe",
				params: { uri: "streamdeck://test/shared" },
			};
			transportA.simulateIncomingMessage(subscribeRequest);
			await transportA.waitForOutgoingMessage();

			transportB.simulateIncomingMessage({ ...subscribeRequest, id: 2 });
			await transportB.waitForOutgoingMessage();

			transportA.clearOutgoingMessages();
			transportB.clearOutgoingMessages();

			const onNotificationCallback = mockClientManager.onNotification.mock.calls[0]?.[0];
			if (onNotificationCallback) {
				onNotificationCallback(SDK_NOTIFICATIONS.RESOURCES_UPDATED, { uri: "streamdeck://test/shared" });
			}

			await wait(10);

			const notificationsA = transportA
				.getOutgoingMessages()
				.filter((msg) => "method" in msg && msg.method === SDK_NOTIFICATIONS.RESOURCES_UPDATED);
			expect(notificationsA).toHaveLength(1);

			const notificationsB = transportB
				.getOutgoingMessages()
				.filter((msg) => "method" in msg && msg.method === SDK_NOTIFICATIONS.RESOURCES_UPDATED);
			expect(notificationsB).toHaveLength(1);
		});

		it("should maintain session A subscription after session B unsubscribes from same URI", async () => {
			(mockClientManager as any).isConnected = true;

			const serverA = bridge.createServer();
			const transportA = new MockTransport();
			await serverA.connect(transportA);

			const serverB = bridge.createServer();
			const transportB = new MockTransport();
			await serverB.connect(transportB);

			const subscribeRequest = {
				jsonrpc: "2.0" as const,
				id: 1,
				method: "resources/subscribe",
				params: { uri: "streamdeck://test/shared" },
			};
			transportA.simulateIncomingMessage(subscribeRequest);
			await transportA.waitForOutgoingMessage();

			transportB.simulateIncomingMessage({ ...subscribeRequest, id: 2 });
			await transportB.waitForOutgoingMessage();

			// Session B unsubscribes
			const unsubscribeRequest = {
				jsonrpc: "2.0" as const,
				id: 3,
				method: "resources/unsubscribe",
				params: { uri: "streamdeck://test/shared" },
			};
			transportB.simulateIncomingMessage(unsubscribeRequest);
			await transportB.waitForOutgoingMessage();

			transportA.clearOutgoingMessages();
			transportB.clearOutgoingMessages();

			const onNotificationCallback = mockClientManager.onNotification.mock.calls[0]?.[0];
			if (onNotificationCallback) {
				onNotificationCallback(SDK_NOTIFICATIONS.RESOURCES_UPDATED, { uri: "streamdeck://test/shared" });
			}

			await wait(10);

			// ServerA should still receive notification
			const notificationsA = transportA
				.getOutgoingMessages()
				.filter((msg) => "method" in msg && msg.method === SDK_NOTIFICATIONS.RESOURCES_UPDATED);
			expect(notificationsA).toHaveLength(1);

			// ServerB should NOT receive notification
			const notificationsB = transportB
				.getOutgoingMessages()
				.filter((msg) => "method" in msg && msg.method === SDK_NOTIFICATIONS.RESOURCES_UPDATED);
			expect(notificationsB).toHaveLength(0);
		});
	});

	describe("MCP handler registration", () => {
		it("should handle tools/list request when connected — returns tools from clientManager", async () => {
			(mockClientManager as any).isConnected = true;
			const tools = [createMockTool({ name: "tool1" }), createMockTool({ name: "tool2" })];
			mockClientManager.getTools.mockReturnValue(tools as any);

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			transport.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 1,
				method: "tools/list",
				params: {},
			});

			const response = await transport.waitForOutgoingMessage();
			// bridge_status is always listed first, followed by app tools
			expect((response as any).result.tools).toHaveLength(3);
			expect((response as any).result.tools[0].name).toBe("bridge_status");
			expect((response as any).result.tools[1].name).toBe("tool1");
		});

		it("should handle tools/list request when disconnected — returns only bridge_status", async () => {
			(mockClientManager as any).isConnected = false;

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			transport.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 1,
				method: "tools/list",
				params: {},
			});

			const response = await transport.waitForOutgoingMessage();
			expect((response as any).result.tools).toHaveLength(1);
			expect((response as any).result.tools[0].name).toBe("bridge_status");
		});

		it("should handle tools/call when connected", async () => {
			(mockClientManager as any).isConnected = true;
			const toolResult = { success: true, data: "result" };
			mockClientManager.callTool.mockResolvedValue({ id: "1", result: toolResult });

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			transport.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 1,
				method: "tools/call",
				params: { name: "streamdeck__test_tool", arguments: { param1: "value1" } },
			});

			const response = await transport.waitForOutgoingMessage();
			expect((response as any).result.content[0].text).toContain("result");
		});

		it("should return structuredContent when tool declares outputSchema and data is an object", async () => {
			(mockClientManager as any).isConnected = true;
			// Tool list contains the (prefixed) tool with an outputSchema declared
			mockClientManager.getTools.mockReturnValue([
				createMockTool({
					name: "streamdeck__structured_tool",
					outputSchema: {
						type: "object",
						properties: { status: { type: "string" }, count: { type: "number" } },
					},
				}),
			] as any);
			// The IPC result object itself is the structured payload (no `data` wrapper)
			const payload = { status: "ok", count: 3 };
			mockClientManager.callTool.mockResolvedValue({ id: "1", result: payload } as any);

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			transport.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 1,
				method: "tools/call",
				params: { name: "streamdeck__structured_tool", arguments: {} },
			});

			const response = await transport.waitForOutgoingMessage();
			// structuredContent must be the raw payload object
			expect((response as any).result.structuredContent).toEqual(payload);
			// content must be the backward-compatible JSON-serialized payload (not the IPC wrapper)
			expect((response as any).result.content[0].text).toBe(JSON.stringify(payload, null, 2));
		});

		it("should omit structuredContent when tool has no outputSchema", async () => {
			(mockClientManager as any).isConnected = true;
			// Tool exists in the list but declares no outputSchema
			mockClientManager.getTools.mockReturnValue([createMockTool({ name: "streamdeck__plain_tool" })] as any);
			mockClientManager.callTool.mockResolvedValue({ id: "1", result: { status: "ok" } } as any);

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			transport.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 1,
				method: "tools/call",
				params: { name: "streamdeck__plain_tool", arguments: {} },
			});

			const response = await transport.waitForOutgoingMessage();
			// Without an outputSchema, legacy behavior applies: no structuredContent,
			// and the whole IPC result object is serialized into the text block
			expect((response as any).result.structuredContent).toBeUndefined();
			expect((response as any).result.content[0].text).toContain("status");
		});

		it("should return isError when tool declares outputSchema but result is not a plain object", async () => {
			(mockClientManager as any).isConnected = true;
			// Tool declares an outputSchema, but the app returns a non-object result
			mockClientManager.getTools.mockReturnValue([
				createMockTool({
					name: "streamdeck__structured_tool",
					outputSchema: { type: "object", properties: {} },
				}),
			] as any);
			mockClientManager.callTool.mockResolvedValue({ id: "1", result: "just a string" } as any);

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			transport.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 1,
				method: "tools/call",
				params: { name: "streamdeck__structured_tool", arguments: {} },
			});

			const response = await transport.waitForOutgoingMessage();
			// structuredContent must be a JSON object per MCP spec. Returning a success result
			// without it would make strict clients fail with an opaque protocol error, so the
			// bridge surfaces the misbehaving app as a diagnosable tool error instead.
			expect((response as any).result.structuredContent).toBeUndefined();
			expect((response as any).result.isError).toBe(true);
			expect((response as any).result.content[0].text).toContain("outputSchema");
		});

		it("should forward request _meta from tools/call to the client manager", async () => {
			(mockClientManager as any).isConnected = true;
			mockClientManager.callTool.mockResolvedValue({ id: "1", result: { ok: true } } as any);

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			const requestMeta = { progressToken: 5, "vendor/trace": "t-1" };
			transport.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 1,
				method: "tools/call",
				params: { name: "streamdeck__test_tool", arguments: { a: 1 }, _meta: requestMeta },
			});

			await transport.waitForOutgoingMessage();
			// The correlation ID is generated per call, so match on the surrounding arguments.
			expect(mockClientManager.callTool).toHaveBeenCalledWith(
				"streamdeck__test_tool",
				{ a: 1 },
				expect.any(String),
				expect.objectContaining(requestMeta),
			);
		});

		it("should pass undefined _meta to the client manager when the client sent none", async () => {
			(mockClientManager as any).isConnected = true;
			mockClientManager.callTool.mockResolvedValue({ id: "1", result: { ok: true } } as any);

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			transport.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 1,
				method: "tools/call",
				params: { name: "streamdeck__test_tool", arguments: {} },
			});

			await transport.waitForOutgoingMessage();
			expect(mockClientManager.callTool.mock.calls[0]?.[3]).toBeUndefined();
		});

		it("should surface envelope _meta on the MCP result and keep structuredContent clean", async () => {
			(mockClientManager as any).isConnected = true;
			mockClientManager.getTools.mockReturnValue([
				createMockTool({
					name: "streamdeck__structured_tool",
					outputSchema: { type: "object", properties: { status: { type: "string" } } },
				}),
			] as any);
			// `_meta` is a sibling of `result` on the envelope, never inside the payload.
			mockClientManager.callTool.mockResolvedValue({
				id: "1",
				result: { status: "ok" },
				_meta: { durationMs: 12 },
			} as any);

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			transport.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 1,
				method: "tools/call",
				params: { name: "streamdeck__structured_tool", arguments: {} },
			});

			const response = await transport.waitForOutgoingMessage();
			// Envelope metadata surfaces top-level; structuredContent must validate against the
			// tool's outputSchema, so it must never gain a `_meta` key.
			expect((response as any).result._meta).toEqual({ durationMs: 12 });
			expect((response as any).result.structuredContent).toEqual({ status: "ok" });
			expect("_meta" in (response as any).result.structuredContent).toBe(false);
			expect((response as any).result.content[0].text).toBe(JSON.stringify({ status: "ok" }, null, 2));
		});

		it("should surface envelope _meta on the legacy path for tools without an outputSchema", async () => {
			(mockClientManager as any).isConnected = true;
			mockClientManager.getTools.mockReturnValue([createMockTool({ name: "streamdeck__plain_tool" })] as any);
			mockClientManager.callTool.mockResolvedValue({
				id: "1",
				result: { status: "ok" },
				_meta: { durationMs: 7 },
			} as any);

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			transport.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 1,
				method: "tools/call",
				params: { name: "streamdeck__plain_tool", arguments: {} },
			});

			const response = await transport.waitForOutgoingMessage();
			expect((response as any).result._meta).toEqual({ durationMs: 7 });
			expect((response as any).result.content[0].text).toBe(JSON.stringify({ status: "ok" }, null, 2));
		});

		it("should omit _meta from the MCP result when the app returned none", async () => {
			(mockClientManager as any).isConnected = true;
			mockClientManager.getTools.mockReturnValue([createMockTool({ name: "streamdeck__plain_tool" })] as any);
			mockClientManager.callTool.mockResolvedValue({ id: "1", result: { status: "ok" } } as any);

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			transport.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 1,
				method: "tools/call",
				params: { name: "streamdeck__plain_tool", arguments: {} },
			});

			const response = await transport.waitForOutgoingMessage();
			expect("_meta" in (response as any).result).toBe(false);
		});

		it("should surface envelope _meta alongside a tool-level error", async () => {
			(mockClientManager as any).isConnected = true;
			mockClientManager.callTool.mockResolvedValue({
				id: "1",
				result: { error: "device offline" },
				_meta: { retryAfterMs: 500 },
			} as any);

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			transport.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 1,
				method: "tools/call",
				params: { name: "streamdeck__test_tool", arguments: {} },
			});

			const response = await transport.waitForOutgoingMessage();
			expect((response as any).result.isError).toBe(true);
			expect((response as any).result._meta).toEqual({ retryAfterMs: 500 });
		});

		it.each([
			["a string", "nope"],
			["an array", [1, 2]],
			["a number", 42],
		])("should not forward envelope _meta when it is %s", async (_label, badMeta) => {
			(mockClientManager as any).isConnected = true;
			mockClientManager.getTools.mockReturnValue([createMockTool({ name: "streamdeck__plain_tool" })] as any);
			mockClientManager.callTool.mockResolvedValue({ id: "1", result: { status: "ok" }, _meta: badMeta } as any);

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			transport.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 1,
				method: "tools/call",
				params: { name: "streamdeck__plain_tool", arguments: {} },
			});

			const response = await transport.waitForOutgoingMessage();
			// The spec types Result._meta as an object; forwarding a non-object would make
			// strict clients reject the entire result, so it is dropped instead.
			expect("_meta" in (response as any).result).toBe(false);
			expect((response as any).result.content[0].text).toBe(JSON.stringify({ status: "ok" }, null, 2));
		});

		it("should pass a tool payload's own _meta key through into structuredContent", async () => {
			(mockClientManager as any).isConnected = true;
			mockClientManager.getTools.mockReturnValue([
				createMockTool({
					name: "streamdeck__structured_tool",
					outputSchema: { type: "object", properties: { _meta: { type: "object" } } },
				}),
			] as any);
			// A tool whose outputSchema legitimately declares `_meta`: the bridge no longer
			// reaches into the payload, so the key must survive intact.
			const payload = { status: "ok", _meta: { thisIsPayload: true } };
			mockClientManager.callTool.mockResolvedValue({
				id: "1",
				result: payload,
				_meta: { durationMs: 3 },
			} as any);

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			transport.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 1,
				method: "tools/call",
				params: { name: "streamdeck__structured_tool", arguments: {} },
			});

			const response = await transport.waitForOutgoingMessage();
			expect((response as any).result.structuredContent).toEqual(payload);
			// The envelope's metadata is a separate thing from the payload's own key.
			expect((response as any).result._meta).toEqual({ durationMs: 3 });
		});

		it("should return error on tools/call when disconnected", async () => {
			(mockClientManager as any).isConnected = false;

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			transport.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 1,
				method: "tools/call",
				params: { name: "streamdeck__test_tool", arguments: {} },
			});

			const response = await transport.waitForOutgoingMessage();
			expect((response as any).result.isError).toBe(true);
			expect((response as any).result.content[0].text).toContain("No Elgato apps connected");
		});

		it("should handle resources/list when connected", async () => {
			(mockClientManager as any).isConnected = true;
			const resources = [
				createMockResource({ uri: "streamdeck__test://r1", name: "r1" }),
				createMockResource({ uri: "streamdeck__test://r2", name: "r2" }),
			];
			mockClientManager.getResources.mockReturnValue(resources as any);

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			transport.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 1,
				method: "resources/list",
				params: {},
			});

			const response = await transport.waitForOutgoingMessage();
			expect((response as any).result.resources).toHaveLength(2);
		});

		it("should handle resources/list when disconnected — returns empty list", async () => {
			(mockClientManager as any).isConnected = false;

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			transport.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 1,
				method: "resources/list",
				params: {},
			});

			const response = await transport.waitForOutgoingMessage();
			expect((response as any).result.resources).toEqual([]);
		});

		it("should handle resources/read when connected", async () => {
			(mockClientManager as any).isConnected = true;
			mockClientManager.readResource.mockResolvedValue({
				result: {
					uri: "streamdeck__test://resource",
					mimeType: "application/json",
					content: { key: "value" },
				},
			});

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			transport.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 1,
				method: "resources/read",
				params: { uri: "streamdeck__test://resource" },
			});

			const response = await transport.waitForOutgoingMessage();
			expect((response as any).result.contents).toHaveLength(1);
			expect((response as any).result.contents[0].uri).toBe("streamdeck__test://resource");
		});

		it("should forward request _meta on resources/read and surface result _meta", async () => {
			(mockClientManager as any).isConnected = true;
			mockClientManager.readResource.mockResolvedValue({
				result: {
					uri: "streamdeck__test://resource",
					mimeType: "application/json",
					content: { key: "value" },
				},
				_meta: { cachedAt: "2026-09-02" },
			});

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			const requestMeta = { progressToken: "p-2" };
			transport.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 1,
				method: "resources/read",
				params: { uri: "streamdeck__test://resource", _meta: requestMeta },
			});

			const response = await transport.waitForOutgoingMessage();
			expect(mockClientManager.readResource).toHaveBeenCalledWith(
				"streamdeck__test://resource",
				expect.objectContaining(requestMeta),
			);
			expect((response as any).result._meta).toEqual({ cachedAt: "2026-09-02" });
			// Metadata belongs on the result, never inside the contents items.
			expect("_meta" in (response as any).result.contents[0]).toBe(false);
		});

		it("should throw error on resources/read when disconnected", async () => {
			(mockClientManager as any).isConnected = false;

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			transport.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 1,
				method: "resources/read",
				params: { uri: "streamdeck__test://resource" },
			});

			const response = await transport.waitForOutgoingMessage();
			expect((response as any).error).toBeDefined();
			expect((response as any).error.message).toContain("No Elgato apps connected");
		});

		it("should throw error on resources/subscribe when disconnected", async () => {
			(mockClientManager as any).isConnected = false;

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			transport.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 1,
				method: "resources/subscribe",
				params: { uri: "streamdeck__test://resource" },
			});

			const response = await transport.waitForOutgoingMessage();
			expect((response as any).error).toBeDefined();
			expect((response as any).error.message).toContain("No Elgato apps connected");
		});

		it("should throw error on resources/unsubscribe when disconnected", async () => {
			(mockClientManager as any).isConnected = false;

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			transport.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 1,
				method: "resources/unsubscribe",
				params: { uri: "streamdeck__test://resource" },
			});

			const response = await transport.waitForOutgoingMessage();
			expect((response as any).error).toBeDefined();
			expect((response as any).error.message).toContain("No Elgato apps connected");
		});

		it("should return error response when callTool returns error", async () => {
			(mockClientManager as any).isConnected = true;
			mockClientManager.callTool.mockResolvedValue({
				id: "1",
				error: { message: "Tool execution failed" },
			});

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			transport.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 1,
				method: "tools/call",
				params: { name: "streamdeck__test_tool", arguments: {} },
			});

			const response = await transport.waitForOutgoingMessage();
			expect((response as any).result.isError).toBe(true);
			expect((response as any).result.content[0].text).toBe("Tool execution failed");
		});

		it("should return error response when callTool result has error property", async () => {
			(mockClientManager as any).isConnected = true;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			mockClientManager.callTool.mockResolvedValue({
				id: "1",
				result: { success: false, error: "Tool-level error" },
			} as any);

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			transport.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 1,
				method: "tools/call",
				params: { name: "streamdeck__test_tool", arguments: {} },
			});

			const response = await transport.waitForOutgoingMessage();
			expect((response as any).result.isError).toBe(true);
			expect((response as any).result.content[0].text).toBe("Tool-level error");
		});

		it("should return error response when callTool throws", async () => {
			(mockClientManager as any).isConnected = true;
			mockClientManager.callTool.mockRejectedValue(new Error("Network failure"));

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			transport.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 1,
				method: "tools/call",
				params: { name: "streamdeck__test_tool", arguments: {} },
			});

			const response = await transport.waitForOutgoingMessage();
			expect((response as any).result.isError).toBe(true);
			expect((response as any).result.content[0].text).toContain("Network failure");
		});
	});

	describe("elicitation forwarding", () => {
		it("should register elicitation callback with clientManager", () => {
			expect(mockClientManager.onElicitation).toHaveBeenCalledWith(expect.any(Function));
		});

		it("should decline elicitation when no active MCP server context (unknown correlation ID)", async () => {
			const onElicitationCallback = mockClientManager.onElicitation.mock.calls[0]?.[0];
			expect(onElicitationCallback).toBeDefined();

			if (onElicitationCallback) {
				const result = await onElicitationCallback({
					message: "Enter username",
					mode: "form",
					requestedSchema: { type: "object", properties: { username: { type: "string" } } },
					relatedToolCallId: "unknown-correlation-id",
				});

				expect(result).toEqual({ action: "decline" });
			}
		});

		it("should carry _meta both ways across an elicitation round-trip", async () => {
			(mockClientManager as any).isConnected = true;
			mockClientManager.getTools.mockReturnValue([createMockTool()] as any);

			let resolveToolCall!: () => void;
			const toolCallPromise = new Promise<void>((resolve) => {
				resolveToolCall = resolve;
			});
			mockClientManager.callTool.mockImplementation(async (): Promise<any> => {
				await toolCallPromise;
				return { id: "1", result: { success: true } };
			});

			const mcpServer = bridge.createServer();
			// Per the spec's `ElicitResult extends Result`, the client may attach its own `_meta`.
			const mockElicitInput = vi.fn<(params: any) => Promise<any>>().mockResolvedValue({
				action: "accept",
				content: { username: "testuser" },
				_meta: { "vendor/client": "claude" },
			});
			(mcpServer.server as any).elicitInput = mockElicitInput;

			const mockTransport = new MockTransport();
			mockTransport.sessionId = "test-session-meta";
			await mcpServer.connect(mockTransport);

			mockTransport.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 42,
				method: "tools/call",
				params: { name: "streamdeck__test_tool", arguments: {} },
			});
			await wait(50);

			const capturedCorrelationId = mockClientManager.callTool.mock.calls[0]?.[2];
			const onElicitationCallback = mockClientManager.onElicitation.mock.calls[0]?.[0];
			expect(onElicitationCallback).toBeDefined();

			if (onElicitationCallback) {
				const appMeta = { progressToken: 3, "vendor/trace": "e-1" };
				const elicitationResult = await onElicitationCallback({
					message: "Enter credentials",
					mode: "form",
					requestedSchema: { type: "object", properties: { username: { type: "string" } } },
					relatedToolCallId: capturedCorrelationId as string,
					_meta: appMeta,
				});

				// Outbound: the app's params._meta reaches the MCP client.
				expect(mockElicitInput).toHaveBeenCalledWith(expect.objectContaining({ _meta: appMeta }));
				// Inbound: the client's ElicitResult._meta comes back on the IPC response.
				expect(elicitationResult).toEqual({
					action: "accept",
					content: { username: "testuser" },
					_meta: { "vendor/client": "claude" },
				});
			}

			resolveToolCall();
		});

		it("should omit _meta from the elicitation request when the app sent none", async () => {
			(mockClientManager as any).isConnected = true;
			mockClientManager.getTools.mockReturnValue([createMockTool()] as any);

			let resolveToolCall!: () => void;
			const toolCallPromise = new Promise<void>((resolve) => {
				resolveToolCall = resolve;
			});
			mockClientManager.callTool.mockImplementation(async (): Promise<any> => {
				await toolCallPromise;
				return { id: "1", result: { success: true } };
			});

			const mcpServer = bridge.createServer();
			const mockElicitInput = vi.fn<(params: any) => Promise<any>>().mockResolvedValue({ action: "cancel" });
			(mcpServer.server as any).elicitInput = mockElicitInput;

			const mockTransport = new MockTransport();
			mockTransport.sessionId = "test-session-nometa";
			await mcpServer.connect(mockTransport);

			mockTransport.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 43,
				method: "tools/call",
				params: { name: "streamdeck__test_tool", arguments: {} },
			});
			await wait(50);

			const capturedCorrelationId = mockClientManager.callTool.mock.calls[0]?.[2];
			const onElicitationCallback = mockClientManager.onElicitation.mock.calls[0]?.[0];

			if (onElicitationCallback) {
				const elicitationResult = await onElicitationCallback({
					message: "Enter credentials",
					mode: "form",
					requestedSchema: { type: "object", properties: {} },
					relatedToolCallId: capturedCorrelationId as string,
				});

				expect("_meta" in mockElicitInput.mock.calls[0]![0]).toBe(false);
				// A client result without _meta must not gain an explicit undefined key.
				expect("_meta" in elicitationResult).toBe(false);
			}

			resolveToolCall();
		});

		it("should forward elicitation to active MCP server during tool call and return response", async () => {
			(mockClientManager as any).isConnected = true;
			mockClientManager.getTools.mockReturnValue([createMockTool()] as any);

			let resolveToolCall!: () => void;
			const toolCallPromise = new Promise<void>((resolve) => {
				resolveToolCall = resolve;
			});

			mockClientManager.callTool.mockImplementation(async (): Promise<any> => {
				await toolCallPromise;
				return { id: "1", result: { success: true } };
			});

			const mcpServer = bridge.createServer();
			const mockElicitInput = vi
				.fn<(params: any) => Promise<{ action: string; content?: Record<string, unknown> }>>()
				.mockResolvedValue({
					action: "accept",
					content: { username: "testuser" },
				});
			(mcpServer.server as any).elicitInput = mockElicitInput;

			const mockTransport = new MockTransport();
			mockTransport.sessionId = "test-session-123";
			await mcpServer.connect(mockTransport);

			const toolCallRequest = {
				jsonrpc: "2.0" as const,
				id: 42,
				method: "tools/call",
				params: { name: "streamdeck__test_tool", arguments: { param1: "value1" } },
			};

			mockTransport.simulateIncomingMessage(toolCallRequest);
			await wait(50);

			expect(mockClientManager.callTool).toHaveBeenCalled();
			const capturedCorrelationId = mockClientManager.callTool.mock.calls[0]?.[2];
			expect(capturedCorrelationId).toBeDefined();

			const onElicitationCallback = mockClientManager.onElicitation.mock.calls[0]?.[0];
			expect(onElicitationCallback).toBeDefined();

			if (onElicitationCallback) {
				const elicitationResult = await onElicitationCallback({
					message: "Please enter your credentials",
					mode: "form",
					requestedSchema: { type: "object", properties: { username: { type: "string" } } },
					relatedToolCallId: capturedCorrelationId as string,
				});

				expect(mockElicitInput).toHaveBeenCalledWith({
					message: "Please enter your credentials",
					mode: "form",
					requestedSchema: { type: "object", properties: { username: { type: "string" } } },
				});

				expect(elicitationResult).toEqual({
					action: "accept",
					content: { username: "testuser" },
				});
			}

			resolveToolCall();
		});

		it("should return decline when elicitInput throws an error", async () => {
			(mockClientManager as any).isConnected = true;
			mockClientManager.getTools.mockReturnValue([] as any);

			let resolveToolCall!: () => void;
			const toolCallPromise = new Promise<void>((resolve) => {
				resolveToolCall = resolve;
			});

			mockClientManager.callTool.mockImplementation(async (): Promise<any> => {
				await toolCallPromise;
				return { id: "1", result: { success: true } };
			});

			const mcpServer = bridge.createServer();
			const mockElicitInput = vi
				.fn<(params: any) => Promise<{ action: string; content?: Record<string, unknown> }>>()
				.mockRejectedValue(new Error("Client disconnected"));
			(mcpServer.server as any).elicitInput = mockElicitInput;

			const mockTransport = new MockTransport();
			mockTransport.sessionId = "test-session-456";
			await mcpServer.connect(mockTransport);

			mockTransport.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 99,
				method: "tools/call",
				params: { name: "streamdeck__test_tool", arguments: {} },
			});
			await wait(50);

			const capturedCorrelationId = mockClientManager.callTool.mock.calls[0]?.[2];
			const onElicitationCallback = mockClientManager.onElicitation.mock.calls[0]?.[0];

			if (onElicitationCallback) {
				const elicitationResult = await onElicitationCallback({
					message: "Enter data",
					mode: "form",
					requestedSchema: { type: "object" },
					relatedToolCallId: capturedCorrelationId as string,
				});

				expect(mockElicitInput).toHaveBeenCalled();
				expect(elicitationResult).toEqual({ action: "decline" });
			}

			resolveToolCall();
		});

		it("should handle cancel action from elicitInput", async () => {
			(mockClientManager as any).isConnected = true;
			mockClientManager.getTools.mockReturnValue([] as any);

			let resolveToolCall!: () => void;
			const toolCallPromise = new Promise<void>((resolve) => {
				resolveToolCall = resolve;
			});

			mockClientManager.callTool.mockImplementation(async (): Promise<any> => {
				await toolCallPromise;
				return { id: "1", result: { success: true } };
			});

			const mcpServer = bridge.createServer();
			const mockElicitInput = vi
				.fn<(params: any) => Promise<{ action: string; content?: Record<string, unknown> }>>()
				.mockResolvedValue({ action: "cancel" });
			(mcpServer.server as any).elicitInput = mockElicitInput;

			const mockTransport = new MockTransport();
			mockTransport.sessionId = "test-session-789";
			await mcpServer.connect(mockTransport);

			mockTransport.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 77,
				method: "tools/call",
				params: { name: "streamdeck__test_tool", arguments: {} },
			});
			await wait(50);

			const capturedCorrelationId = mockClientManager.callTool.mock.calls[0]?.[2];
			const onElicitationCallback = mockClientManager.onElicitation.mock.calls[0]?.[0];

			if (onElicitationCallback) {
				const elicitationResult = await onElicitationCallback({
					message: "Confirm action",
					mode: "form",
					requestedSchema: { type: "object" },
					relatedToolCallId: capturedCorrelationId as string,
				});

				expect(elicitationResult).toEqual({ action: "cancel", content: undefined });
			}

			resolveToolCall();
		});
	});
});

describe("createInitializedBridge", () => {
	// Use test-specific socket names to avoid conflicts with real Elgato apps
	const testConfig = {
		apps: [{ name: "test-app", socketBaseName: "test-mcp-bridge" }],
	};

	it("should create and initialize a bridge", async () => {
		// Note: This test uses the real ClientManager which will fail to connect
		// but should still create and return a bridge in disconnected mode
		const bridge = await createInitializedBridge(testConfig);

		expect(bridge).toBeInstanceOf(McpBridge);
		expect(bridge.isConnected).toBe(false);

		bridge.close();
	});
});

describe("createConnectedBridge", () => {
	// Use test-specific socket names to avoid conflicts with real Elgato apps
	const testConfig = {
		apps: [{ name: "test-app", socketBaseName: "test-mcp-bridge" }],
	};

	it("should create bridge and connect to transport", async () => {
		const transport = new MockTransport();
		const bridge = await createConnectedBridge(transport, testConfig);

		expect(bridge).toBeInstanceOf(McpBridge);
		expect(transport.isStarted()).toBe(true);

		bridge.close();
		await transport.close();
	});

	it("should set up tools changed notification forwarding", async () => {
		const transport = new MockTransport();
		const bridge = await createConnectedBridge(transport, testConfig);

		expect(bridge).toBeDefined();

		bridge.close();
		await transport.close();
	});

	it("should handle notification forwarding errors gracefully", async () => {
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const transport = new MockTransport();
		const bridge = await createConnectedBridge(transport, testConfig);

		// Trigger the onClientNotification callbacks
		const notificationCallbacks = (bridge as any).notificationForwardCallbacks;
		if (notificationCallbacks && notificationCallbacks.length > 0) {
			await notificationCallbacks[0]("test/notification", { data: "test" });
		}

		bridge.close();
		await transport.close();
		consoleSpy.mockRestore();
	});
});
