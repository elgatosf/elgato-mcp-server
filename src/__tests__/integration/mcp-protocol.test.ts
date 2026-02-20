import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ClientManager } from "../../ClientManager.js";
import { McpBridge } from "../../McpBridge.js";
import { MockTransport } from "../helpers/MockTransport.js";
import {
	createMockCallToolResponse,
	createMockClientManager,
	createMockErrorResponse,
	createMockResource,
	createMockTool,
	wait,
} from "../helpers/testUtils.js";

describe("MCP Protocol Integration Tests", () => {
	let bridge: McpBridge;
	let mockClientManager: jest.Mocked<ClientManager>;

	beforeEach(() => {
		jest.clearAllMocks();
		mockClientManager = createMockClientManager({ isConnected: true });
	});

	afterEach(() => {
		bridge?.close();
	});

	describe("tools/list endpoint", () => {
		it("should return tools from clientManager when connected", async () => {
			const tools = [createMockTool({ name: "tool1" }), createMockTool({ name: "tool2" })];
			mockClientManager.getTools.mockReturnValue(tools as any);

			bridge = new McpBridge(mockClientManager);

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			transport.simulateIncomingMessage({ jsonrpc: "2.0" as const, id: 1, method: "tools/list", params: {} });
			const response = await transport.waitForOutgoingMessage();

			expect(response).toHaveProperty("result");
			expect((response as any).result.tools).toHaveLength(2);
		});

		it("should return empty tools when disconnected", async () => {
			mockClientManager = createMockClientManager({ isConnected: false });
			bridge = new McpBridge(mockClientManager);

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			transport.simulateIncomingMessage({ jsonrpc: "2.0" as const, id: 1, method: "tools/list", params: {} });
			const response = await transport.waitForOutgoingMessage();

			expect((response as any).result.tools).toEqual([]);
		});

		it("should return empty tools when disconnected even if getTools would return data", async () => {
			const tools = [createMockTool({ name: "cached_tool_1" }), createMockTool({ name: "cached_tool_2" })];
			mockClientManager = createMockClientManager({ isConnected: false });
			mockClientManager.getTools.mockReturnValue(tools as any);

			bridge = new McpBridge(mockClientManager);

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			transport.simulateIncomingMessage({ jsonrpc: "2.0" as const, id: 1, method: "tools/list", params: {} });
			const response = await transport.waitForOutgoingMessage();

			expect((response as any).result.tools).toEqual([]);
			// getTools should NOT be called when disconnected
			expect(mockClientManager.getTools).not.toHaveBeenCalled();
		});

		it("should call clientManager.getTools() on each request when connected", async () => {
			const tools = [createMockTool({ name: "tool1" })];
			mockClientManager.getTools.mockReturnValue(tools as any);

			bridge = new McpBridge(mockClientManager);

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			transport.simulateIncomingMessage({ jsonrpc: "2.0" as const, id: 1, method: "tools/list", params: {} });
			await transport.waitForOutgoingMessage();

			expect(mockClientManager.getTools).toHaveBeenCalled();
		});
	});

	describe("tools/call endpoint", () => {
		beforeEach(async () => {
			bridge = new McpBridge(mockClientManager);
		});

		it("should call tool successfully", async () => {
			const toolResult = { success: true, data: "result" };
			mockClientManager.callTool.mockResolvedValue(createMockCallToolResponse(toolResult) as any);

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
			expect(response).toHaveProperty("result");
			expect((response as any).result.content[0].text).toContain("result");
		});

		it("should handle tool execution errors", async () => {
			mockClientManager.callTool.mockResolvedValue(createMockErrorResponse("Tool execution failed") as any);

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			transport.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 1,
				method: "tools/call",
				params: { name: "streamdeck__failing_tool", arguments: {} },
			});

			const response = await transport.waitForOutgoingMessage();
			expect((response as any).result.isError).toBe(true);
		});

		it("should return error when apps are disconnected", async () => {
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
			expect((response as any).result.content[0].text).toContain("No apps connected");
		});

		it("should call tools/call handler and return success result via MockTransport", async () => {
			const toolResult = { success: true, data: "success result" };
			mockClientManager.callTool.mockResolvedValue(createMockCallToolResponse(toolResult) as any);

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
			expect(response).toHaveProperty("result");
			expect((response as any).result.content[0].text).toContain("success result");
		});

		it("should return error when calling tool while disconnected via MockTransport", async () => {
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
			expect((response as any).result.content[0].text).toContain("No apps connected");
		});

		it("should handle tool returning error response via MockTransport", async () => {
			mockClientManager.callTool.mockResolvedValue(createMockErrorResponse("Tool execution failed") as any);

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
		});

		it("should handle tool result with error property via MockTransport", async () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			mockClientManager.callTool.mockResolvedValue({
				id: "1",
				result: { success: false, error: "Tool-level error message" },
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
			expect((response as any).result.content[0].text).toBe("Tool-level error message");
		});

		it("should handle tool call exception via MockTransport", async () => {
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

	describe("resources/list endpoint", () => {
		beforeEach(async () => {
			bridge = new McpBridge(mockClientManager);
		});

		it("should return empty resources when disconnected via MockTransport", async () => {
			(mockClientManager as any).isConnected = false;

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			transport.simulateIncomingMessage({ jsonrpc: "2.0" as const, id: 1, method: "resources/list", params: {} });
			const response = await transport.waitForOutgoingMessage();

			expect((response as any).result.resources).toEqual([]);
		});

		it("should return resources from clientManager when connected via MockTransport", async () => {
			const resources = [
				createMockResource({ uri: "streamdeck__test://1", name: "resource1" }),
				createMockResource({ uri: "streamdeck__test://2", name: "resource2" }),
			];
			mockClientManager.getResources.mockReturnValue(resources as any);

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			transport.simulateIncomingMessage({ jsonrpc: "2.0" as const, id: 1, method: "resources/list", params: {} });
			const response = await transport.waitForOutgoingMessage();

			expect((response as any).result.resources).toHaveLength(2);
		});

		it("should call clientManager.getResources() on each request when connected", async () => {
			const resources = [createMockResource({ uri: "streamdeck__test://refreshed", name: "resource" })];
			mockClientManager.getResources.mockReturnValue(resources as any);

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			transport.simulateIncomingMessage({ jsonrpc: "2.0" as const, id: 1, method: "resources/list", params: {} });
			const response = await transport.waitForOutgoingMessage();

			expect((response as any).result.resources).toHaveLength(1);
			expect(mockClientManager.getResources).toHaveBeenCalled();
		});
	});

	describe("resources/read endpoint", () => {
		beforeEach(async () => {
			bridge = new McpBridge(mockClientManager);
		});

		it("should read resource successfully via MockTransport", async () => {
			const resourceResult = {
				uri: "streamdeck__test://resource",
				mimeType: "application/json",
				content: { key: "value" },
			};
			mockClientManager.readResource.mockResolvedValue(resourceResult);

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

			expect(response).toHaveProperty("result");
			expect((response as any).result.contents).toHaveLength(1);
			expect((response as any).result.contents[0].uri).toBe("streamdeck__test://resource");
		});

		it("should throw error when reading resource while disconnected via MockTransport", async () => {
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

			expect(response).toHaveProperty("error");
			expect((response as any).error.message).toContain("No apps connected");
		});

		it("should handle read resource exception via MockTransport", async () => {
			mockClientManager.readResource.mockRejectedValue(new Error("Resource read failed"));

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

			expect(response).toHaveProperty("error");
			expect((response as any).error.message).toContain("Resource read failed");
		});
	});

	describe("resources/subscribe endpoint", () => {
		beforeEach(async () => {
			bridge = new McpBridge(mockClientManager);
		});

		it("should subscribe to resource successfully via MockTransport", async () => {
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

			expect(response).toHaveProperty("result");
			expect((response as any).result).toEqual({});
		});

		it("should throw error when subscribing while disconnected via MockTransport", async () => {
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

			expect(response).toHaveProperty("error");
			expect((response as any).error.message).toContain("No apps connected");
		});
	});

	describe("resources/unsubscribe endpoint", () => {
		beforeEach(async () => {
			bridge = new McpBridge(mockClientManager);
		});

		it("should unsubscribe from resource successfully via MockTransport", async () => {
			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			// First subscribe
			transport.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 1,
				method: "resources/subscribe",
				params: { uri: "streamdeck__test://resource" },
			});
			await transport.waitForOutgoingMessage();

			// Then unsubscribe
			transport.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 2,
				method: "resources/unsubscribe",
				params: { uri: "streamdeck__test://resource" },
			});
			const response = await transport.waitForOutgoingMessage();

			expect(response).toHaveProperty("result");
			expect((response as any).result).toEqual({});
		});

		it("should throw error when unsubscribing while disconnected via MockTransport", async () => {
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

			expect(response).toHaveProperty("error");
			expect((response as any).error.message).toContain("No apps connected");
		});
	});

	describe("notifications", () => {
		it("should send tool list changed notification when clientManager fires onToolsChanged", async () => {
			bridge = new McpBridge(mockClientManager);
			const notificationCallback = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
			bridge.onToolsChanged(notificationCallback);

			// Simulate clientManager firing onToolsChanged
			const managerCallback = mockClientManager.onToolsChanged.mock.calls[0]?.[0];
			if (managerCallback) {
				await managerCallback();
			}

			await wait(10);
			expect(notificationCallback).toHaveBeenCalled();
		});

		it("should handle multiple notification callbacks", async () => {
			bridge = new McpBridge(mockClientManager);

			const callback1 = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
			const callback2 = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
			const callback3 = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

			bridge.onToolsChanged(callback1);
			bridge.onToolsChanged(callback2);
			bridge.onToolsChanged(callback3);

			const managerCallback = mockClientManager.onToolsChanged.mock.calls[0]?.[0];
			if (managerCallback) {
				await managerCallback();
			}

			await wait(10);
			expect(callback1).toHaveBeenCalled();
			expect(callback2).toHaveBeenCalled();
			expect(callback3).toHaveBeenCalled();
		});
	});

	describe("error handling", () => {
		beforeEach(async () => {
			bridge = new McpBridge(mockClientManager);
		});

		it("should handle network errors gracefully", async () => {
			mockClientManager.callTool.mockRejectedValue(new Error("Network error"));

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
			expect((response as any).result.content[0].text).toContain("Network error");
		});

		it("should handle timeout errors", async () => {
			mockClientManager.callTool.mockRejectedValue(new Error("Request timeout"));

			const server = bridge.createServer();
			const transport = new MockTransport();
			await server.connect(transport);

			transport.simulateIncomingMessage({
				jsonrpc: "2.0" as const,
				id: 1,
				method: "tools/call",
				params: { name: "streamdeck__slow_tool", arguments: {} },
			});
			const response = await transport.waitForOutgoingMessage();

			expect((response as any).result.isError).toBe(true);
			expect((response as any).result.content[0].text).toContain("Request timeout");
		});
	});

	describe("connection state changes", () => {
		it("should handle transition from connected to disconnected", async () => {
			bridge = new McpBridge(mockClientManager);

			expect(bridge.isConnected).toBe(true);

			(mockClientManager as any).isConnected = false;
			expect(bridge.isConnected).toBe(false);
		});

		it("should update tool list when clientManager fires onToolsChanged", async () => {
			bridge = new McpBridge(mockClientManager);
			const callback = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
			bridge.onToolsChanged(callback);

			const updatedTools = [createMockTool({ name: "tool1" }), createMockTool({ name: "tool2" })];
			mockClientManager.getTools.mockReturnValue(updatedTools as any);

			// Simulate clientManager notifying tools changed
			const managerCallback = mockClientManager.onToolsChanged.mock.calls[0]?.[0];
			if (managerCallback) {
				await managerCallback();
			}

			await wait(10);
			expect(callback).toHaveBeenCalled();
		});
	});
});
