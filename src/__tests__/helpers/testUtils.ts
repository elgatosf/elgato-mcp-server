import { vi } from "vitest";
import type { Mock, Mocked } from "vitest";

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
		initialize: Mock;
		close: Mock;
		getTools: Mock;
		getResources: Mock;
		getServerInfo: Mock;
		callTool: Mock;
		readResource: Mock;
		onToolsChanged: Mock;
		onResourcesChanged: Mock;
		onNotification: Mock;
		onElicitation: Mock;
		onClientConnected: Mock;
		onClientDisconnected: Mock;
	}> = {},
): Mocked<ClientManager> {
	return {
		isConnected: false,
		connectedClients: [],
		initialize: vi.fn(),
		close: vi.fn(),
		getTools: vi.fn().mockReturnValue([]),
		getResources: vi.fn().mockReturnValue([]),
		getServerInfo: vi.fn().mockReturnValue({ name: "Elgato MCP Server", version: "1.0.0" }),
		callTool: vi.fn(),
		readResource: vi.fn(),
		onToolsChanged: vi.fn(),
		onResourcesChanged: vi.fn(),
		onNotification: vi.fn(),
		onElicitation: vi.fn(),
		onClientConnected: vi.fn(),
		onClientDisconnected: vi.fn(),
		...overrides,
	} as unknown as Mocked<ClientManager>;
}

/**
 * Creates a mock IpcClient for testing.
 * Provides a consistent mock implementation that can be customized via overrides.
 */
export function createMockClient(
	overrides: Partial<{
		isConnected: boolean;
		connect: Mock;
		disconnect: Mock;
		getServerInfo: Mock;
		getTools: Mock;
		getResources: Mock;
		readResource: Mock;
		callTool: Mock;
		onConnected: Mock;
		onDisconnected: Mock;
		onNotification: Mock;
		onElicitation: Mock;
		startSignalListener: Mock;
	}> = {},
): Mocked<IpcClient> {
	return {
		isConnected: false,
		connect: vi.fn(),
		disconnect: vi.fn(),
		getServerInfo: vi.fn(),
		getTools: vi.fn(),
		getResources: vi.fn(),
		readResource: vi.fn(),
		callTool: vi.fn(),
		onConnected: vi.fn(),
		onDisconnected: vi.fn(),
		onNotification: vi.fn(),
		onElicitation: vi.fn(),
		startSignalListener: vi.fn(),
		...overrides,
	} as unknown as Mocked<IpcClient>;
}

/**
 * Creates a mock McpBridge for testing.
 * Provides a consistent mock implementation that can be customized via overrides.
 */
export function createMockBridge(
	overrides: Partial<{
		isConnected: boolean;
		initialize: Mock;
		close: Mock;
		createServer: Mock;
		disposeServer: Mock;
		onToolsChanged: Mock;
		onResourcesChanged: Mock;
		onClientNotification: Mock;
	}> = {},
): Mocked<McpBridge> {
	return {
		isConnected: false,
		initialize: vi.fn(),
		close: vi.fn(),
		createServer: vi.fn(),
		disposeServer: vi.fn(),
		onToolsChanged: vi.fn(),
		onResourcesChanged: vi.fn(),
		onClientNotification: vi.fn(),
		...overrides,
	} as unknown as Mocked<McpBridge>;
}
