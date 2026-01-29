import { jest } from "@jest/globals";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Mock implementation of McpBridge for testing.
 *
 * IMPORTANT: This mock must be kept in sync with the real McpBridge class interface.
 * When adding new public methods to McpBridge, ensure they are also added here.
 *
 * Public methods from McpBridge that must be mocked:
 * - constructor(client?: StreamDeckClient)
 * - get isConnected(): boolean
 * - close(): void
 * - createServer(): McpServer
 * - initialize(): Promise<void>
 * - onResourcesChanged(callback: () => Promise<void>): void
 * - onStreamDeckNotification(callback: (method: string, params?: unknown) => Promise<void>): void
 * - onToolsChanged(callback: () => Promise<void>): void
 *
 * @see src/McpBridge.ts for the real implementation
 */
export class MockMcpBridge {
	private _isConnected = false;

	public get isConnected(): boolean {
		return this._isConnected;
	}

	public set isConnected(value: boolean) {
		this._isConnected = value;
	}

	public initialize = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
	public close = jest.fn<() => void>();
	public createServer = jest.fn<() => McpServer>();
	public onToolsChanged = jest.fn<(callback: () => Promise<void>) => void>();
	public onResourcesChanged = jest.fn<(callback: () => Promise<void>) => void>();
	public onStreamDeckNotification = jest.fn<
		(callback: (method: string, params?: unknown) => Promise<void>) => void
	>();
}

/**
 * Creates a new MockMcpBridge instance with optional customizations.
 *
 * @param overrides - Optional partial overrides for mock methods
 * @returns A new MockMcpBridge instance
 *
 * @example
 * ```typescript
 * const mockBridge = createMockMcpBridge({
 *   isConnected: true,
 *   initialize: jest.fn().mockRejectedValue(new Error("Connection failed")),
 * });
 * ```
 */
export function createMockMcpBridge(
	overrides: Partial<{
		isConnected: boolean;
		initialize: jest.Mock<() => Promise<void>>;
		close: jest.Mock<() => void>;
		createServer: jest.Mock<() => McpServer>;
		onToolsChanged: jest.Mock<(callback: () => Promise<void>) => void>;
		onResourcesChanged: jest.Mock<(callback: () => Promise<void>) => void>;
		onStreamDeckNotification: jest.Mock<
			(callback: (method: string, params?: unknown) => Promise<void>) => void
		>;
	}> = {},
): MockMcpBridge {
	const mock = new MockMcpBridge();

	if (overrides.isConnected !== undefined) {
		mock.isConnected = overrides.isConnected;
	}
	if (overrides.initialize) {
		mock.initialize = overrides.initialize;
	}
	if (overrides.close) {
		mock.close = overrides.close;
	}
	if (overrides.createServer) {
		mock.createServer = overrides.createServer;
	}
	if (overrides.onToolsChanged) {
		mock.onToolsChanged = overrides.onToolsChanged;
	}
	if (overrides.onResourcesChanged) {
		mock.onResourcesChanged = overrides.onResourcesChanged;
	}
	if (overrides.onStreamDeckNotification) {
		mock.onStreamDeckNotification = overrides.onStreamDeckNotification;
	}

	return mock;
}

