import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClientManager } from "../../ClientManager.js";
import type { IpcClientFactory } from "../../ClientManager.js";
import { DEFAULT_SERVER_INFO, SDK_NOTIFICATIONS } from "../../constants.js";
import type {
	CallToolResponse,
	ClientManagerConfig,
	IpcClientConfig,
	ResourcesReadOutcome,
	ServerInfo,
} from "../../types.js";
import { createMockClient, createMockResource, createMockServerInfo, createMockTool, wait } from "../helpers/testUtils.js";

/**
 * Creates a ClientManager wired to two deterministic mock clients for testing.
 * Returns both the manager and the mocks so tests can control client behaviour.
 */
function createTestManager(overrides?: { app1Connected?: boolean; app2Connected?: boolean }): {
	manager: ClientManager;
	mockClient1: ReturnType<typeof createMockClient>;
	mockClient2: ReturnType<typeof createMockClient>;
} {
	const mockClient1 = createMockClient({ isConnected: overrides?.app1Connected ?? false });
	const mockClient2 = createMockClient({ isConnected: overrides?.app2Connected ?? false });

	const config: ClientManagerConfig = {
		apps: [
			{ name: "app1", socketBaseName: "test-app1" },
			{ name: "app2", socketBaseName: "test-app2" },
		],
	};

	let callCount = 0;
	const clientFactory: IpcClientFactory = (_cfg: IpcClientConfig) => {
		callCount++;
		return callCount === 1 ? (mockClient1 as any) : (mockClient2 as any);
	};

	const manager = new ClientManager(config, clientFactory);
	return { manager, mockClient1, mockClient2 };
}

describe("ClientManager", () => {
	let manager: ClientManager;

	afterEach(() => {
		manager?.close();
	});

	// -------------------------------------------------------------------------
	// Construction & lifecycle
	// -------------------------------------------------------------------------

	describe("construction", () => {
		it("should create IpcClient instances for each configured app", () => {
			let factoryCalls = 0;
			const factory: IpcClientFactory = (_cfg) => {
				factoryCalls++;
				return createMockClient() as any;
			};

			const config: ClientManagerConfig = {
				apps: [
					{ name: "a", socketBaseName: "sock-a" },
					{ name: "b", socketBaseName: "sock-b" },
					{ name: "c", socketBaseName: "sock-c" },
				],
			};

			manager = new ClientManager(config, factory);
			expect(factoryCalls).toBe(3);
		});

		it("should use KNOWN_APPS when no config supplied", () => {
			let factoryCalls = 0;
			const factory: IpcClientFactory = (_cfg) => {
				factoryCalls++;
				return createMockClient() as any;
			};
			manager = new ClientManager(undefined, factory);
			expect(factoryCalls).toBeGreaterThan(0);
		});

		it("should pass correct unix socket paths to factory on non-windows", () => {
			const originalPlatform = process.platform;
			Object.defineProperty(process, "platform", { value: "darwin" });

			try {
				const receivedConfigs: IpcClientConfig[] = [];
				const factory: IpcClientFactory = (cfg) => {
					receivedConfigs.push(cfg);
					return createMockClient() as any;
				};

				const config: ClientManagerConfig = {
					apps: [{ name: "myapp", socketBaseName: "my-bridge" }],
				};

				manager = new ClientManager(config, factory);

				expect(receivedConfigs).toHaveLength(1);
				expect(receivedConfigs[0]!.name).toBe("myapp");
				expect(receivedConfigs[0]!.socketPath).toBe("/tmp/my-bridge.sock");
				expect(receivedConfigs[0]!.signalSocketPath).toBe("/tmp/my-bridge-ready.sock");
			} finally {
				Object.defineProperty(process, "platform", { value: originalPlatform });
			}
		});

		it("should pass correct named pipe paths to factory on windows", () => {
			const originalPlatform = process.platform;
			Object.defineProperty(process, "platform", { value: "win32" });

			try {
				const receivedConfigs: IpcClientConfig[] = [];
				const factory: IpcClientFactory = (cfg) => {
					receivedConfigs.push(cfg);
					return createMockClient() as any;
				};

				const config: ClientManagerConfig = {
					apps: [{ name: "myapp", socketBaseName: "my-bridge" }],
				};

				manager = new ClientManager(config, factory);

				expect(receivedConfigs).toHaveLength(1);
				expect(receivedConfigs[0]!.name).toBe("myapp");
				expect(receivedConfigs[0]!.socketPath).toBe("\\\\.\\pipe\\my-bridge");
				expect(receivedConfigs[0]!.signalSocketPath).toBe("\\\\.\\pipe\\my-bridge-ready");
			} finally {
				Object.defineProperty(process, "platform", { value: originalPlatform });
			}
		});
	});

	describe("initialize", () => {
		it("should call connect and startSignalListener on all clients", async () => {
			const { manager: m, mockClient1, mockClient2 } = createTestManager();
			manager = m;
			mockClient1.connect.mockResolvedValue(false);
			mockClient2.connect.mockResolvedValue(false);
			mockClient1.getTools.mockResolvedValue([]);
			mockClient1.getResources.mockResolvedValue([]);
			mockClient2.getTools.mockResolvedValue([]);
			mockClient2.getResources.mockResolvedValue([]);

			await manager.initialize();

			expect(mockClient1.connect).toHaveBeenCalledTimes(1);
			expect(mockClient2.connect).toHaveBeenCalledTimes(1);
			expect(mockClient1.startSignalListener).toHaveBeenCalledTimes(1);
			expect(mockClient2.startSignalListener).toHaveBeenCalledTimes(1);
		});
	});

	describe("close", () => {
		it("should disconnect all clients", () => {
			const { manager: m, mockClient1, mockClient2 } = createTestManager();
			manager = m;
			manager.close();
			expect(mockClient1.disconnect).toHaveBeenCalledTimes(1);
			expect(mockClient2.disconnect).toHaveBeenCalledTimes(1);
		});
	});

	// -------------------------------------------------------------------------
	// isConnected & connectedClients
	// -------------------------------------------------------------------------

	describe("isConnected", () => {
		it("should be false when no clients are connected", () => {
			const { manager: m } = createTestManager({ app1Connected: false, app2Connected: false });
			manager = m;
			expect(manager.isConnected).toBe(false);
		});

		it("should be true when any client is connected", () => {
			const { manager: m } = createTestManager({ app1Connected: true, app2Connected: false });
			manager = m;
			expect(manager.isConnected).toBe(true);
		});

		it("should be true when all clients are connected", () => {
			const { manager: m } = createTestManager({ app1Connected: true, app2Connected: true });
			manager = m;
			expect(manager.isConnected).toBe(true);
		});
	});

	describe("connectedClients", () => {
		it("should return empty array when no clients connected", () => {
			const { manager: m } = createTestManager({ app1Connected: false, app2Connected: false });
			manager = m;
			expect(manager.connectedClients).toEqual([]);
		});

		it("should return names of connected clients", () => {
			const { manager: m } = createTestManager({ app1Connected: true, app2Connected: false });
			manager = m;
			expect(manager.connectedClients).toEqual(["app1"]);
		});

		it("should return all names when all connected", () => {
			const { manager: m } = createTestManager({ app1Connected: true, app2Connected: true });
			manager = m;
			expect(manager.connectedClients).toEqual(["app1", "app2"]);
		});
	});

	// -------------------------------------------------------------------------
	// Tool aggregation
	// -------------------------------------------------------------------------

	describe("getTools", () => {
		it("should return empty array before initialization", () => {
			const { manager: m } = createTestManager();
			manager = m;
			expect(manager.getTools()).toEqual([]);
		});

		it("should return prefixed tools from connected clients after refresh", async () => {
			const {
				manager: m,
				mockClient1,
				mockClient2,
			} = createTestManager({
				app1Connected: true,
				app2Connected: true,
			});
			manager = m;

			mockClient1.connect.mockResolvedValue(true);
			mockClient2.connect.mockResolvedValue(false);
			mockClient1.getTools.mockResolvedValue([createMockTool({ name: "toggle_light" })]);
			mockClient1.getResources.mockResolvedValue([]);
			mockClient2.getTools.mockResolvedValue([]);
			mockClient2.getResources.mockResolvedValue([]);

			await manager.initialize();

			const tools = manager.getTools();
			expect(tools).toHaveLength(1);
			expect(tools[0]!.name).toBe("app1__toggle_light");
		});

		it("should aggregate tools from multiple connected clients with different prefixes", async () => {
			const {
				manager: m,
				mockClient1,
				mockClient2,
			} = createTestManager({
				app1Connected: true,
				app2Connected: true,
			});
			manager = m;

			mockClient1.connect.mockResolvedValue(true);
			mockClient2.connect.mockResolvedValue(true);
			mockClient1.getTools.mockResolvedValue([createMockTool({ name: "toggle_light" })]);
			mockClient2.getTools.mockResolvedValue([createMockTool({ name: "dim_light" })]);
			mockClient1.getResources.mockResolvedValue([]);
			mockClient2.getResources.mockResolvedValue([]);

			await manager.initialize();

			const tools = manager.getTools();
			expect(tools).toHaveLength(2);
			const names = tools.map((t) => t.name).sort();
			expect(names).toEqual(["app1__toggle_light", "app2__dim_light"]);
		});

		it("should only include tools from connected clients", async () => {
			const {
				manager: m,
				mockClient1,
				mockClient2,
			} = createTestManager({
				app1Connected: true,
				app2Connected: false,
			});
			manager = m;

			mockClient1.connect.mockResolvedValue(true);
			mockClient2.connect.mockResolvedValue(false);
			mockClient1.getTools.mockResolvedValue([createMockTool({ name: "tool_a" })]);
			mockClient2.getTools.mockResolvedValue([createMockTool({ name: "tool_b" })]);
			mockClient1.getResources.mockResolvedValue([]);
			mockClient2.getResources.mockResolvedValue([]);

			await manager.initialize();

			const tools = manager.getTools();
			expect(tools).toHaveLength(1);
			expect(tools[0]!.name).toBe("app1__tool_a");
		});
	});

	// -------------------------------------------------------------------------
	// Resource aggregation
	// -------------------------------------------------------------------------

	describe("getResources", () => {
		it("should return empty array before initialization", () => {
			const { manager: m } = createTestManager();
			manager = m;
			expect(manager.getResources()).toEqual([]);
		});

		it("should prefix resource URIs with app name", async () => {
			const {
				manager: m,
				mockClient1,
				mockClient2,
			} = createTestManager({
				app1Connected: true,
				app2Connected: false,
			});
			manager = m;

			mockClient1.connect.mockResolvedValue(true);
			mockClient2.connect.mockResolvedValue(false);
			mockClient1.getTools.mockResolvedValue([]);
			mockClient1.getResources.mockResolvedValue([createMockResource({ uri: "device://status", name: "status" })]);
			mockClient2.getTools.mockResolvedValue([]);
			mockClient2.getResources.mockResolvedValue([]);

			await manager.initialize();

			const resources = manager.getResources();
			expect(resources).toHaveLength(1);
			expect(resources[0]!.uri).toBe("app1__device://status");
		});

		it("should aggregate resources from multiple connected clients", async () => {
			const {
				manager: m,
				mockClient1,
				mockClient2,
			} = createTestManager({
				app1Connected: true,
				app2Connected: true,
			});
			manager = m;

			mockClient1.connect.mockResolvedValue(true);
			mockClient2.connect.mockResolvedValue(true);
			mockClient1.getTools.mockResolvedValue([]);
			mockClient2.getTools.mockResolvedValue([]);
			mockClient1.getResources.mockResolvedValue([createMockResource({ uri: "device://a", name: "a" })]);
			mockClient2.getResources.mockResolvedValue([createMockResource({ uri: "device://b", name: "b" })]);

			await manager.initialize();

			const resources = manager.getResources();
			expect(resources).toHaveLength(2);
			const uris = resources.map((r) => r.uri).sort();
			expect(uris).toEqual(["app1__device://a", "app2__device://b"]);
		});
	});

	// -------------------------------------------------------------------------
	// getServerInfo
	// -------------------------------------------------------------------------

	describe("getServerInfo", () => {
		/**
		 * Wires a manager whose connected clients return the given server infos, then initializes it.
		 * @param infos - Server info (or thrown error) per app slot; `null` means the app returns none.
		 * @returns The initialized manager.
		 */
		const managerWithServerInfo = async (infos: {
			app1?: ServerInfo | Error | null;
			app2?: ServerInfo | Error | null;
		}): Promise<ClientManager> => {
			const { manager: m, mockClient1, mockClient2 } = createTestManager({
				app1Connected: infos.app1 !== undefined,
				app2Connected: infos.app2 !== undefined,
			});
			for (const [client, info] of [
				[mockClient1, infos.app1],
				[mockClient2, infos.app2],
			] as const) {
				client.connect.mockResolvedValue(info !== undefined);
				client.getTools.mockResolvedValue([]);
				client.getResources.mockResolvedValue([]);
				if (info instanceof Error) {
					client.getServerInfo.mockRejectedValue(info);
				} else {
					client.getServerInfo.mockResolvedValue(info ?? null);
				}
			}
			await m.initialize();
			return m;
		};

		it("should return the default Elgato MCP Server info before initialize", () => {
			const { manager: m } = createTestManager();
			manager = m;
			const info = manager.getServerInfo();
			expect(info.name).toBe("Elgato MCP Server");
			expect(info.version).toBeTruthy();
		});

		it("should keep the default info when no app is connected", async () => {
			manager = await managerWithServerInfo({});
			expect(manager.getServerInfo().name).toBe("Elgato MCP Server");
			expect(manager.getServerInfo().instructions).toBeUndefined();
		});

		it("should surface a connected app's name, version and instructions", async () => {
			manager = await managerWithServerInfo({
				app1: createMockServerInfo({
					name: "Stream Deck MCP Server",
					version: "7.3.0",
					instructions: "Controls the Elgato Stream Deck desktop application.",
				}),
			});

			const info = manager.getServerInfo();
			expect(info.name).toBe("Stream Deck MCP Server");
			expect(info.version).toBe("7.3.0");
			// A single app's text is used exactly as written, with no added heading.
			expect(info.instructions).toBe("Controls the Elgato Stream Deck desktop application.");
		});

		it("should fall back per-field to the default title and icons", async () => {
			manager = await managerWithServerInfo({
				// The app supplies neither title nor icons; the bridge's own branding must survive.
				app1: createMockServerInfo({ name: "Stream Deck MCP Server", version: "7.3.0" }),
			});

			const info = manager.getServerInfo();
			expect(info.icons).toEqual(DEFAULT_SERVER_INFO.icons);
			expect(info.title).toBe(DEFAULT_SERVER_INFO.title);
		});

		it("should label and concatenate instructions from several connected apps", async () => {
			manager = await managerWithServerInfo({
				app1: createMockServerInfo({ name: "First", version: "1.0.0", instructions: "Drives app1." }),
				app2: createMockServerInfo({ name: "Second", version: "2.0.0", instructions: "Drives app2." }),
			});

			const info = manager.getServerInfo();
			// Scalars come from the first app in registry order...
			expect(info.name).toBe("First");
			expect(info.version).toBe("1.0.0");
			// ...but no app's guidance is discarded.
			expect(info.instructions).toContain("## app1");
			expect(info.instructions).toContain("Drives app1.");
			expect(info.instructions).toContain("## app2");
			expect(info.instructions).toContain("Drives app2.");
		});

		it("should omit instructions when connected apps supply none", async () => {
			manager = await managerWithServerInfo({
				app1: createMockServerInfo({ name: "First", version: "1.0.0" }),
			});
			expect(manager.getServerInfo().instructions).toBeUndefined();
		});

		it("should skip an app whose server_info fails without losing the other app's info", async () => {
			manager = await managerWithServerInfo({
				app1: new Error("socket closed"),
				app2: createMockServerInfo({ name: "Second", version: "2.0.0", instructions: "Drives app2." }),
			});

			const info = manager.getServerInfo();
			expect(info.name).toBe("Second");
			// Only one app contributed, so its text stays verbatim rather than being labelled.
			expect(info.instructions).toBe("Drives app2.");
		});

		it("should refresh the cached info when a client reconnects", async () => {
			const { manager: m, mockClient1 } = createTestManager({ app1Connected: true });
			manager = m;
			mockClient1.connect.mockResolvedValue(true);
			mockClient1.getTools.mockResolvedValue([]);
			mockClient1.getResources.mockResolvedValue([]);
			mockClient1.getServerInfo.mockResolvedValue(createMockServerInfo({ name: "Before", version: "1.0.0" }));
			await manager.initialize();
			expect(manager.getServerInfo().name).toBe("Before");

			// The app restarts and now reports different info.
			mockClient1.getServerInfo.mockResolvedValue(
				createMockServerInfo({ name: "After", version: "2.0.0", instructions: "Now with guidance." }),
			);
			const onConnected = mockClient1.onConnected.mock.calls[0]?.[0] as () => void;
			onConnected();
			await wait(10);

			expect(manager.getServerInfo().name).toBe("After");
			expect(manager.getServerInfo().instructions).toBe("Now with guidance.");
		});
	});

	// -------------------------------------------------------------------------
	// callTool routing
	// -------------------------------------------------------------------------

	describe("callTool", () => {
		let callToolMockClient1: ReturnType<typeof createMockClient>;
		let callToolMockClient2: ReturnType<typeof createMockClient>;

		beforeEach(async () => {
			const {
				manager: m,
				mockClient1,
				mockClient2,
			} = createTestManager({
				app1Connected: true,
				app2Connected: true,
			});
			manager = m;
			callToolMockClient1 = mockClient1;
			callToolMockClient2 = mockClient2;

			mockClient1.connect.mockResolvedValue(true);
			mockClient2.connect.mockResolvedValue(true);
			mockClient1.getTools.mockResolvedValue([createMockTool({ name: "toggle_light" })]);
			mockClient2.getTools.mockResolvedValue([createMockTool({ name: "play_sound" })]);
			mockClient1.getResources.mockResolvedValue([]);
			mockClient2.getResources.mockResolvedValue([]);

			await manager.initialize();
		});

		it("should route prefixed tool call to the correct client", async () => {
			const expectedResponse: CallToolResponse = { id: "1", result: { data: "ok" } };
			callToolMockClient1.callTool.mockResolvedValue(expectedResponse);

			const result = await manager.callTool("app1__toggle_light", { brightness: 100 }, "req-123");

			// Verify correct client was called with stripped prefix
			expect(callToolMockClient1.callTool).toHaveBeenCalledWith("toggle_light", { brightness: 100 }, "req-123", undefined);
			expect(result).toBe(expectedResponse);

			// Verify the other client was NOT called (multi-client routing discrimination)
			expect(callToolMockClient2.callTool).not.toHaveBeenCalled();
		});

		it("should strip the prefix before calling the underlying client", async () => {
			// Inline test: create a manager where we have a reference to the mock
			const mockClient = createMockClient({ isConnected: true });
			const response: CallToolResponse = { id: "x", result: { data: "success" } };
			mockClient.callTool.mockResolvedValue(response);
			mockClient.connect.mockResolvedValue(true);
			mockClient.getTools.mockResolvedValue([createMockTool({ name: "my_tool" })]);
			mockClient.getResources.mockResolvedValue([]);

			const config: ClientManagerConfig = { apps: [{ name: "myapp", socketBaseName: "my" }] };
			const mgr = new ClientManager(config, () => mockClient as any);
			await mgr.initialize();

			const result = await mgr.callTool("myapp__my_tool", { key: "val" }, "req-1");

			expect(mockClient.callTool).toHaveBeenCalledWith("my_tool", { key: "val" }, "req-1", undefined);
			expect(result).toBe(response);

			mgr.close();
		});

		it("should forward request _meta to the owning client unmodified", async () => {
			const meta = { progressToken: 42 };
			callToolMockClient1.callTool.mockResolvedValue({ id: "1", result: {} } satisfies CallToolResponse);

			await manager.callTool("app1__toggle_light", { brightness: 100 }, "req-123", meta);

			expect(callToolMockClient1.callTool).toHaveBeenCalledWith(
				"toggle_light",
				{ brightness: 100 },
				"req-123",
				meta,
			);
			// The metadata object is passed through by reference, not copied or rewritten.
			expect(callToolMockClient1.callTool.mock.calls[0]?.[3]).toBe(meta);
		});

		it("should throw for an unknown tool name", async () => {
			const { manager: m } = createTestManager();
			manager = m;
			await expect(manager.callTool("unknown__tool", {})).rejects.toThrow("Unknown tool: unknown__tool");
		});

		it("should throw when the owning client is not connected", async () => {
			const mockClient = createMockClient({ isConnected: false });
			mockClient.connect.mockResolvedValue(false);
			mockClient.getTools.mockResolvedValue([]);
			mockClient.getResources.mockResolvedValue([]);

			const config: ClientManagerConfig = { apps: [{ name: "offline", socketBaseName: "offline" }] };
			const mgr = new ClientManager(config, () => mockClient as any);
			await mgr.initialize();

			// Manually inject tool ownership to simulate a tool that was known but client disconnected
			(mgr as any).toolOwnership.set("offline__tool", "offline");

			await expect(mgr.callTool("offline__tool", {})).rejects.toThrow("App 'offline' is not connected");
			mgr.close();
		});
	});

	// -------------------------------------------------------------------------
	// readResource routing
	// -------------------------------------------------------------------------

	describe("readResource", () => {
		it("should route prefixed URI to the correct client and re-prefix result", async () => {
			const mockClient = createMockClient({ isConnected: true });
			const rawResult: ResourcesReadOutcome = {
				result: { uri: "device://status", mimeType: "application/json", content: {} },
			};
			mockClient.readResource.mockResolvedValue(rawResult);
			mockClient.connect.mockResolvedValue(true);
			mockClient.getTools.mockResolvedValue([]);
			mockClient.getResources.mockResolvedValue([createMockResource({ uri: "device://status", name: "status" })]);

			const config: ClientManagerConfig = { apps: [{ name: "myapp", socketBaseName: "my" }] };
			const mgr = new ClientManager(config, () => mockClient as any);
			await mgr.initialize();

			const { result } = await mgr.readResource("myapp__device://status");

			expect(mockClient.readResource).toHaveBeenCalledWith("device://status", undefined);
			expect(result.uri).toBe("myapp__device://status");

			mgr.close();
		});

		it("should forward request _meta to the owning client and surface result _meta", async () => {
			const meta = { progressToken: "p-9" };
			const mockClient = createMockClient({ isConnected: true });
			// `_meta` rides the envelope, as a sibling of `result`.
			const rawResult: ResourcesReadOutcome = {
				result: { uri: "device://status", mimeType: "application/json", content: {} },
				_meta: { cachedAt: "2026-09-02" },
			};
			mockClient.readResource.mockResolvedValue(rawResult);
			mockClient.connect.mockResolvedValue(true);
			mockClient.getTools.mockResolvedValue([]);
			mockClient.getResources.mockResolvedValue([createMockResource({ uri: "device://status", name: "status" })]);

			const config: ClientManagerConfig = { apps: [{ name: "myapp", socketBaseName: "my" }] };
			const mgr = new ClientManager(config, () => mockClient as any);
			await mgr.initialize();

			const outcome = await mgr.readResource("myapp__device://status", meta);

			expect(mockClient.readResource).toHaveBeenCalledWith("device://status", meta);
			// Re-prefixing the URI must not drop the app's response metadata.
			expect(outcome._meta).toEqual({ cachedAt: "2026-09-02" });
			expect(outcome.result.uri).toBe("myapp__device://status");

			mgr.close();
		});

		it("should throw for an unknown resource URI", async () => {
			const { manager: m } = createTestManager();
			manager = m;
			await expect(manager.readResource("unknown__res")).rejects.toThrow("Unknown resource: unknown__res");
		});

		it("should throw when the owning client is not connected", async () => {
			const mockClient = createMockClient({ isConnected: false });
			mockClient.connect.mockResolvedValue(false);
			mockClient.getTools.mockResolvedValue([]);
			mockClient.getResources.mockResolvedValue([]);

			const config: ClientManagerConfig = { apps: [{ name: "offline", socketBaseName: "offline" }] };
			const mgr = new ClientManager(config, () => mockClient as any);
			await mgr.initialize();

			(mgr as any).resourceOwnership.set("offline__res://x", "offline");

			await expect(mgr.readResource("offline__res://x")).rejects.toThrow("App 'offline' is not connected");
			mgr.close();
		});
	});

	// -------------------------------------------------------------------------
	// Event forwarding
	// -------------------------------------------------------------------------

	describe("event callbacks", () => {
		it("should invoke onToolsChanged when a client connects", async () => {
			const mockClient = createMockClient({ isConnected: false });
			let connectedCallback: ((...args: unknown[]) => unknown) | null = null;
			mockClient.onConnected.mockImplementation((cb: any) => {
				connectedCallback = cb;
			});
			mockClient.connect.mockResolvedValue(false);
			mockClient.getTools.mockResolvedValue([createMockTool({ name: "t" })]);
			mockClient.getResources.mockResolvedValue([]);

			const config: ClientManagerConfig = { apps: [{ name: "app", socketBaseName: "app" }] };
			const mgr = new ClientManager(config, () => mockClient as any);
			await mgr.initialize();

			const toolsChangedCb = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
			mgr.onToolsChanged(toolsChangedCb);

			// Simulate client connecting
			Object.defineProperty(mockClient, "isConnected", { get: () => true });
			(connectedCallback as any)?.();
			// Allow async callbacks to settle
			await new Promise((r) => setTimeout(r, 10));

			expect(toolsChangedCb).toHaveBeenCalled();
			mgr.close();
		});

		it("should invoke onResourcesChanged when a client disconnects", async () => {
			const mockClient = createMockClient({ isConnected: true });
			let disconnectedCallback: ((...args: unknown[]) => unknown) | null = null;
			mockClient.onDisconnected.mockImplementation((cb: any) => {
				disconnectedCallback = cb;
			});
			mockClient.connect.mockResolvedValue(true);
			mockClient.getTools.mockResolvedValue([]);
			mockClient.getResources.mockResolvedValue([]);

			const config: ClientManagerConfig = { apps: [{ name: "app", socketBaseName: "app" }] };
			const mgr = new ClientManager(config, () => mockClient as any);
			await mgr.initialize();

			const resourcesChangedCb = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
			mgr.onResourcesChanged(resourcesChangedCb);

			// Simulate client disconnecting
			(disconnectedCallback as any)?.();
			await new Promise((r) => setTimeout(r, 10));

			expect(resourcesChangedCb).toHaveBeenCalled();
			mgr.close();
		});

		it("should forward notifications from clients to registered callbacks", () => {
			const mockClient = createMockClient();
			let notificationCallback: ((...args: unknown[]) => unknown) | null = null;
			mockClient.onNotification.mockImplementation((cb: any) => {
				notificationCallback = cb;
			});
			mockClient.connect.mockResolvedValue(false);

			const config: ClientManagerConfig = { apps: [{ name: "app", socketBaseName: "app" }] };
			const mgr = new ClientManager(config, () => mockClient as any);

			const notifyCb = vi.fn();
			mgr.onNotification(notifyCb);

			(notificationCallback as any)?.("some/notification", { data: 42 });

			expect(notifyCb).toHaveBeenCalledWith("some/notification", { data: 42 });
			mgr.close();
		});

		it("should NOT forward TOOLS_LIST_CHANGED notifications to onNotification callbacks", async () => {
			const mockClient = createMockClient();
			let notificationCallback: ((...args: unknown[]) => unknown) | null = null;
			mockClient.onNotification.mockImplementation((cb: any) => {
				notificationCallback = cb;
			});
			mockClient.connect.mockResolvedValue(false);
			mockClient.getTools.mockResolvedValue([]);
			mockClient.getResources.mockResolvedValue([]);

			const config: ClientManagerConfig = { apps: [{ name: "app", socketBaseName: "app" }] };
			const mgr = new ClientManager(config, () => mockClient as any);

			const notifyCb = vi.fn();
			mgr.onNotification(notifyCb);

			await (notificationCallback as any)?.(SDK_NOTIFICATIONS.TOOLS_LIST_CHANGED, undefined);

			expect(notifyCb).not.toHaveBeenCalled();
			mgr.close();
		});

		it("should NOT forward RESOURCES_LIST_CHANGED notifications to onNotification callbacks", async () => {
			const mockClient = createMockClient();
			let notificationCallback: ((...args: unknown[]) => unknown) | null = null;
			mockClient.onNotification.mockImplementation((cb: any) => {
				notificationCallback = cb;
			});
			mockClient.connect.mockResolvedValue(false);
			mockClient.getTools.mockResolvedValue([]);
			mockClient.getResources.mockResolvedValue([]);

			const config: ClientManagerConfig = { apps: [{ name: "app", socketBaseName: "app" }] };
			const mgr = new ClientManager(config, () => mockClient as any);

			const notifyCb = vi.fn();
			mgr.onNotification(notifyCb);

			await (notificationCallback as any)?.(SDK_NOTIFICATIONS.RESOURCES_LIST_CHANGED, undefined);

			expect(notifyCb).not.toHaveBeenCalled();
			mgr.close();
		});

		it("should refresh cache and trigger onToolsChanged when TOOLS_LIST_CHANGED is received", async () => {
			const mockClient = createMockClient({ isConnected: true });
			let notificationCallback: ((...args: unknown[]) => unknown) | null = null;
			mockClient.onNotification.mockImplementation((cb: any) => {
				notificationCallback = cb;
			});
			mockClient.connect.mockResolvedValue(true);
			mockClient.getTools.mockResolvedValue([{ name: "tool1", description: "A tool", inputSchema: {} }]);
			mockClient.getResources.mockResolvedValue([]);

			const config: ClientManagerConfig = { apps: [{ name: "app", socketBaseName: "app" }] };
			const mgr = new ClientManager(config, () => mockClient as any);
			await mgr.initialize();

			// Clear call count from initialize
			mockClient.getTools.mockClear();

			const toolsChangedCb = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
			mgr.onToolsChanged(toolsChangedCb);

			// Simulate SDK sending TOOLS_LIST_CHANGED
			// Note: callback is sync but delegates to async handler, so we need to wait
			(notificationCallback as any)?.(SDK_NOTIFICATIONS.TOOLS_LIST_CHANGED, undefined);
			await new Promise((r) => setTimeout(r, 10));

			// Should have refreshed the cache (called getTools again)
			expect(mockClient.getTools).toHaveBeenCalled();
			// Should have triggered onToolsChanged callback
			expect(toolsChangedCb).toHaveBeenCalled();
			mgr.close();
		});

		it("should refresh cache and trigger onResourcesChanged when RESOURCES_LIST_CHANGED is received", async () => {
			const mockClient = createMockClient({ isConnected: true });
			let notificationCallback: ((...args: unknown[]) => unknown) | null = null;
			mockClient.onNotification.mockImplementation((cb: any) => {
				notificationCallback = cb;
			});
			mockClient.connect.mockResolvedValue(true);
			mockClient.getTools.mockResolvedValue([]);
			mockClient.getResources.mockResolvedValue([{ uri: "file://test", name: "test" }]);

			const config: ClientManagerConfig = { apps: [{ name: "app", socketBaseName: "app" }] };
			const mgr = new ClientManager(config, () => mockClient as any);
			await mgr.initialize();

			// Clear call count from initialize
			mockClient.getResources.mockClear();

			const resourcesChangedCb = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
			mgr.onResourcesChanged(resourcesChangedCb);

			// Simulate SDK sending RESOURCES_LIST_CHANGED
			// Note: callback is sync but delegates to async handler, so we need to wait
			(notificationCallback as any)?.(SDK_NOTIFICATIONS.RESOURCES_LIST_CHANGED, undefined);
			await new Promise((r) => setTimeout(r, 10));

			// Should have refreshed the cache (called getResources again)
			expect(mockClient.getResources).toHaveBeenCalled();
			// Should have triggered onResourcesChanged callback
			expect(resourcesChangedCb).toHaveBeenCalled();
			mgr.close();
		});

		it("should prefix URI in RESOURCES_UPDATED notifications before forwarding", async () => {
			const mockClient = createMockClient();
			let notificationCallback: ((...args: unknown[]) => unknown) | null = null;
			mockClient.onNotification.mockImplementation((cb: any) => {
				notificationCallback = cb;
			});
			mockClient.connect.mockResolvedValue(false);

			const config: ClientManagerConfig = { apps: [{ name: "myapp", socketBaseName: "myapp" }] };
			const mgr = new ClientManager(config, () => mockClient as any);

			const notifyCb = vi.fn();
			mgr.onNotification(notifyCb);

			// Simulate SDK sending RESOURCES_UPDATED with an unprefixed URI
			await (notificationCallback as any)?.(SDK_NOTIFICATIONS.RESOURCES_UPDATED, { uri: "device://status" });

			// Should forward with prefixed URI
			expect(notifyCb).toHaveBeenCalledWith(SDK_NOTIFICATIONS.RESOURCES_UPDATED, {
				uri: "myapp__device://status",
			});
			mgr.close();
		});

		it("should preserve other properties when prefixing URI in RESOURCES_UPDATED notifications", async () => {
			const mockClient = createMockClient();
			let notificationCallback: ((...args: unknown[]) => unknown) | null = null;
			mockClient.onNotification.mockImplementation((cb: any) => {
				notificationCallback = cb;
			});
			mockClient.connect.mockResolvedValue(false);

			const config: ClientManagerConfig = { apps: [{ name: "app1", socketBaseName: "app1" }] };
			const mgr = new ClientManager(config, () => mockClient as any);

			const notifyCb = vi.fn();
			mgr.onNotification(notifyCb);

			// Simulate SDK sending RESOURCES_UPDATED with additional properties
			await (notificationCallback as any)?.(SDK_NOTIFICATIONS.RESOURCES_UPDATED, {
				uri: "file://config.json",
				extra: "data",
				timestamp: 12345,
			});

			// Should forward with prefixed URI and preserve other properties
			expect(notifyCb).toHaveBeenCalledWith(SDK_NOTIFICATIONS.RESOURCES_UPDATED, {
				uri: "app1__file://config.json",
				extra: "data",
				timestamp: 12345,
			});
			mgr.close();
		});

		it("should forward RESOURCES_UPDATED notifications unchanged when params is undefined", async () => {
			const mockClient = createMockClient();
			let notificationCallback: ((...args: unknown[]) => unknown) | null = null;
			mockClient.onNotification.mockImplementation((cb: any) => {
				notificationCallback = cb;
			});
			mockClient.connect.mockResolvedValue(false);

			const config: ClientManagerConfig = { apps: [{ name: "app", socketBaseName: "app" }] };
			const mgr = new ClientManager(config, () => mockClient as any);

			const notifyCb = vi.fn();
			mgr.onNotification(notifyCb);

			// Simulate SDK sending RESOURCES_UPDATED without params
			await (notificationCallback as any)?.(SDK_NOTIFICATIONS.RESOURCES_UPDATED, undefined);

			// Should forward with undefined params
			expect(notifyCb).toHaveBeenCalledWith(SDK_NOTIFICATIONS.RESOURCES_UPDATED, undefined);
			mgr.close();
		});

		it("should forward RESOURCES_UPDATED notifications unchanged when params has no uri property", async () => {
			const mockClient = createMockClient();
			let notificationCallback: ((...args: unknown[]) => unknown) | null = null;
			mockClient.onNotification.mockImplementation((cb: any) => {
				notificationCallback = cb;
			});
			mockClient.connect.mockResolvedValue(false);

			const config: ClientManagerConfig = { apps: [{ name: "app", socketBaseName: "app" }] };
			const mgr = new ClientManager(config, () => mockClient as any);

			const notifyCb = vi.fn();
			mgr.onNotification(notifyCb);

			// Simulate SDK sending RESOURCES_UPDATED with params but no uri
			await (notificationCallback as any)?.(SDK_NOTIFICATIONS.RESOURCES_UPDATED, { other: "data" });

			// Should forward unchanged
			expect(notifyCb).toHaveBeenCalledWith(SDK_NOTIFICATIONS.RESOURCES_UPDATED, { other: "data" });
			mgr.close();
		});

		it("should forward RESOURCES_UPDATED notifications unchanged when uri is empty string", async () => {
			const mockClient = createMockClient();
			let notificationCallback: ((...args: unknown[]) => unknown) | null = null;
			mockClient.onNotification.mockImplementation((cb: any) => {
				notificationCallback = cb;
			});
			mockClient.connect.mockResolvedValue(false);

			const config: ClientManagerConfig = { apps: [{ name: "app", socketBaseName: "app" }] };
			const mgr = new ClientManager(config, () => mockClient as any);

			const notifyCb = vi.fn();
			mgr.onNotification(notifyCb);

			// Simulate SDK sending RESOURCES_UPDATED with empty uri
			await (notificationCallback as any)?.(SDK_NOTIFICATIONS.RESOURCES_UPDATED, { uri: "" });

			// Should forward unchanged (empty string is falsy)
			expect(notifyCb).toHaveBeenCalledWith(SDK_NOTIFICATIONS.RESOURCES_UPDATED, { uri: "" });
			mgr.close();
		});

		it("should forward elicitation requests to the registered callback", async () => {
			const mockClient = createMockClient();
			let elicitationCallback: ((...args: unknown[]) => unknown) | null = null;
			mockClient.onElicitation.mockImplementation((cb: any) => {
				elicitationCallback = cb;
			});
			mockClient.connect.mockResolvedValue(false);

			const config: ClientManagerConfig = { apps: [{ name: "app", socketBaseName: "app" }] };
			const mgr = new ClientManager(config, () => mockClient as any);

			const elicitCb = vi.fn<ElicitationCallback>().mockResolvedValue({ action: "accept", content: { x: 1 } });
			mgr.onElicitation(elicitCb);

			const params = {
				message: "test",
				mode: "form" as const,
				requestedSchema: {},
				relatedToolCallId: "call-1",
			};
			const result = await (elicitationCallback as any)?.(params);

			expect(elicitCb).toHaveBeenCalledWith(params);
			expect(result).toEqual({ action: "accept", content: { x: 1 } });
			mgr.close();
		});

		it("should decline elicitation when no callback is registered", async () => {
			const mockClient = createMockClient();
			let elicitationCallback: ((...args: unknown[]) => unknown) | null = null;
			mockClient.onElicitation.mockImplementation((cb: any) => {
				elicitationCallback = cb;
			});
			mockClient.connect.mockResolvedValue(false);

			const config: ClientManagerConfig = { apps: [{ name: "app", socketBaseName: "app" }] };
			const mgr = new ClientManager(config, () => mockClient as any);
			// No onElicitation registered

			const params = {
				message: "test",
				mode: "form" as const,
				requestedSchema: {},
				relatedToolCallId: "call-1",
			};
			const result = await (elicitationCallback as any)?.(params);

			expect(result).toEqual({ action: "decline" });
			mgr.close();
		});

		it("should invoke onClientConnected callback when a client connects", async () => {
			const mockClient = createMockClient({ isConnected: false });
			let connectedCallback: ((...args: unknown[]) => unknown) | null = null;
			mockClient.onConnected.mockImplementation((cb: any) => {
				connectedCallback = cb;
			});
			mockClient.connect.mockResolvedValue(false);
			mockClient.getTools.mockResolvedValue([]);
			mockClient.getResources.mockResolvedValue([]);

			const config: ClientManagerConfig = { apps: [{ name: "myapp", socketBaseName: "myapp" }] };
			const mgr = new ClientManager(config, () => mockClient as any);
			await mgr.initialize();

			const clientConnectedCb = vi.fn();
			mgr.onClientConnected(clientConnectedCb);

			Object.defineProperty(mockClient, "isConnected", { get: () => true });
			(connectedCallback as any)?.();
			await new Promise((r) => setTimeout(r, 10));

			expect(clientConnectedCb).toHaveBeenCalledWith("myapp");
			mgr.close();
		});

		it("should invoke onClientDisconnected callback when a client disconnects", async () => {
			const mockClient = createMockClient({ isConnected: true });
			let disconnectedCallback: ((...args: unknown[]) => unknown) | null = null;
			mockClient.onDisconnected.mockImplementation((cb: any) => {
				disconnectedCallback = cb;
			});
			mockClient.connect.mockResolvedValue(true);
			mockClient.getTools.mockResolvedValue([]);
			mockClient.getResources.mockResolvedValue([]);

			const config: ClientManagerConfig = { apps: [{ name: "myapp", socketBaseName: "myapp" }] };
			const mgr = new ClientManager(config, () => mockClient as any);
			await mgr.initialize();

			const clientDisconnectedCb = vi.fn();
			mgr.onClientDisconnected(clientDisconnectedCb);

			(disconnectedCallback as any)?.();
			await new Promise((r) => setTimeout(r, 10));

			expect(clientDisconnectedCb).toHaveBeenCalledWith("myapp");
			mgr.close();
		});
	});
});

// Re-export type for use in testUtils
type ElicitationCallback = Parameters<ClientManager["onElicitation"]>[0];
