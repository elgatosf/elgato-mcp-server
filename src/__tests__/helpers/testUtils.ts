import type { CallToolResponse, McpTool, ServerInfo, ToolsListResponse } from "../../types.js";

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
export async function waitFor(
	condition: () => boolean,
	timeout = 1000,
	interval = 10,
): Promise<void> {
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

