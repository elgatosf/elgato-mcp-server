import { jest } from "@jest/globals";

import type { ClientManager } from "../../ClientManager.js";
import type { IpcClient } from "../../IpcClient.js";
import type { McpBridge } from "../../McpBridge.js";
import type { CallToolResponse, McpResource, McpTool, ServerInfo, ToolsListResponse } from "../../types.js";

/**
 * Creates a mock McpTool for testing.
 */
export function createMockTool(overrides: Partial<McpTool> = {}): McpTool {
	return {
		name: "test_tool",
		description: "A test tool",
		inputSchema: {
			type: "object",
			properties: {
				param1: { type: "string" },
			},
		},
		...overrides,
	};
}

/**
 * Creates a mock McpResource for testing.
 */
export function createMockResource(overrides: Partial<McpResource> = {}): McpResource {
	return {
		uri: "streamdeck://test/resource",
		name: "test_resource",
		description: "A test resource",
		mimeType: "application/json",
		...overrides,
	};
}

/**
 * Creates a mock ServerInfo for testing.
 */
export function createMockServerInfo(overrides: Partial<ServerInfo> = {}): ServerInfo {
	return {
		name: "Test Server",
		version: "1.0.0",
		...overrides,
	};
}

/**
 * Creates a mock ToolsListResponse for testing.
 */
export function createMockToolsListResponse(tools: McpTool[] = []): ToolsListResponse {
	return {
		id: "1",
		result: { tools },
	};
}

/**
 * Creates a mock CallToolResponse for testing.
 */
export function createMockCallToolResponse(
	result: { success: boolean; data?: unknown; error?: string } = { success: true },
	error?: { message: string; data?: string },
): CallToolResponse {
	return {
		id: "1",
		result,
		error,
	};
}

/**
 * Creates a mock error response.
 */
export function createMockErrorResponse(message: string, data?: string): CallToolResponse {
	return {
		id: "1",
		error: {
			message,
			data,
		},
	};
}

/**
 * Waits for a specified amount of time.
 */
export function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Waits for a condition to be true.
 */
export async function waitFor(condition: () => boolean, timeout = 1000, interval = 10): Promise<void> {
	const startTime = Date.now();
	while (!condition()) {
		if (Date.now() - startTime > timeout) {
			throw new Error("Timeout waiting for condition");
		}
		await wait(interval);
	}
}

/**
 * Creates a deferred promise that can be resolved externally.
 */
export function createDeferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: Error) => void;
} {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/**
 * Creates a mock ClientManager for testing.
 * Provides a consistent mock implementation that can be customized via overrides.
 */
export function createMockClientManager(
	overrides: Partial<{
		isConnected: boolean;
		connectedClients: string[];
		initialize: jest.Mock;
		close: jest.Mock;
		getTools: jest.Mock;
		getResources: jest.Mock;
		getServerInfo: jest.Mock;
		callTool: jest.Mock;
		readResource: jest.Mock;
		onToolsChanged: jest.Mock;
		onResourcesChanged: jest.Mock;
		onNotification: jest.Mock;
		onElicitation: jest.Mock;
		onClientConnected: jest.Mock;
		onClientDisconnected: jest.Mock;
	}> = {},
): jest.Mocked<ClientManager> {
	return {
		isConnected: false,
		connectedClients: [],
		initialize: jest.fn(),
		close: jest.fn(),
		getTools: jest.fn().mockReturnValue([]),
		getResources: jest.fn().mockReturnValue([]),
		getServerInfo: jest.fn().mockReturnValue({ name: "Elgato MCP Server", version: "1.0.0" }),
		callTool: jest.fn(),
		readResource: jest.fn(),
		onToolsChanged: jest.fn(),
		onResourcesChanged: jest.fn(),
		onNotification: jest.fn(),
		onElicitation: jest.fn(),
		onClientConnected: jest.fn(),
		onClientDisconnected: jest.fn(),
		...overrides,
	} as unknown as jest.Mocked<ClientManager>;
}

/**
 * Creates a mock IpcClient for testing.
 * Provides a consistent mock implementation that can be customized via overrides.
 */
export function createMockClient(
	overrides: Partial<{
		isConnected: boolean;
		connect: jest.Mock;
		disconnect: jest.Mock;
		getServerInfo: jest.Mock;
		getTools: jest.Mock;
		getResources: jest.Mock;
		readResource: jest.Mock;
		callTool: jest.Mock;
		onConnected: jest.Mock;
		onDisconnected: jest.Mock;
		onNotification: jest.Mock;
		onElicitation: jest.Mock;
		startSignalListener: jest.Mock;
	}> = {},
): jest.Mocked<IpcClient> {
	return {
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
		...overrides,
	} as unknown as jest.Mocked<IpcClient>;
}

/**
 * Creates a mock McpBridge for testing.
 * Provides a consistent mock implementation that can be customized via overrides.
 */
export function createMockBridge(
	overrides: Partial<{
		isConnected: boolean;
		initialize: jest.Mock;
		close: jest.Mock;
		createServer: jest.Mock;
		disposeServer: jest.Mock;
		onToolsChanged: jest.Mock;
		onResourcesChanged: jest.Mock;
		onClientNotification: jest.Mock;
	}> = {},
): jest.Mocked<McpBridge> {
	return {
		isConnected: false,
		initialize: jest.fn(),
		close: jest.fn(),
		createServer: jest.fn(),
		disposeServer: jest.fn(),
		onToolsChanged: jest.fn(),
		onResourcesChanged: jest.fn(),
		onClientNotification: jest.fn(),
		...overrides,
	} as unknown as jest.Mocked<McpBridge>;
}
