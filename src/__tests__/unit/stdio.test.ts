import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { MockMcpBridge } from "../helpers/MockMcpBridge.js";

const logMock = jest.fn();

describe("stdio transport", () => {
	let processOnSpy: jest.SpiedFunction<typeof process.on>;
	let processExitSpy: jest.SpiedFunction<typeof process.exit>;
	let mockBridge: MockMcpBridge;
	let signalHandlers: Map<string, (() => void)[]>;

	beforeEach(() => {
		jest.clearAllMocks();
		signalHandlers = new Map();
		mockBridge = new MockMcpBridge();

		// Spy on process.on to capture signal handlers
		processOnSpy = jest.spyOn(process, "on").mockImplementation((event: string | symbol, handler: () => void) => {
			const eventKey = String(event);
			if (!signalHandlers.has(eventKey)) {
				signalHandlers.set(eventKey, []);
			}
			signalHandlers.get(eventKey)!.push(handler);
			return process;
		});

		// Spy on process.exit to prevent actual exit
		processExitSpy = jest.spyOn(process, "exit").mockImplementation((() => {
			// Do nothing
		}) as any);
	});

	afterEach(() => {
		processOnSpy.mockRestore();
		processExitSpy.mockRestore();
	});

	const setupModule = async (): Promise<typeof import("../../transports/stdio.js")> => {
		jest.resetModules();
		logMock.mockClear();

		jest.unstable_mockModule("../../utils.js", () => ({
			log: {
				error: logMock,
				warn: logMock,
				info: logMock,
				debug: logMock,
			},
		}));

		jest.unstable_mockModule("@modelcontextprotocol/sdk/server/stdio.js", () => ({
			StdioServerTransport: jest.fn().mockImplementation(() => ({
				// Mock transport
			})),
		}));

		jest.unstable_mockModule("../../McpBridge.js", () => ({
			createConnectedBridge: jest.fn<() => Promise<MockMcpBridge>>().mockResolvedValue(mockBridge),
		}));

		return await import("../../transports/stdio.js");
	};

	it("should create StdioServerTransport", async () => {
		const stdioModule = await setupModule();
		await stdioModule.startStdioTransport();

		const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
		expect(StdioServerTransport).toHaveBeenCalledTimes(1);
	});

	it("should register SIGINT signal handler", async () => {
		const stdioModule = await setupModule();
		await stdioModule.startStdioTransport();

		expect(processOnSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
		expect(signalHandlers.has("SIGINT")).toBe(true);
	});

	it("should register SIGTERM signal handler", async () => {
		const stdioModule = await setupModule();
		await stdioModule.startStdioTransport();

		expect(processOnSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
		expect(signalHandlers.has("SIGTERM")).toBe(true);
	});

	it("should call bridge.close() and process.exit(0) on SIGINT", async () => {
		const stdioModule = await setupModule();
		await stdioModule.startStdioTransport();

		// Simulate SIGINT
		const sigintHandlers = signalHandlers.get("SIGINT");
		expect(sigintHandlers).toBeDefined();
		if (!sigintHandlers) {
			throw new Error("SIGINT handler not registered");
		}
		expect(sigintHandlers.length).toBeGreaterThan(0);

		const handler = sigintHandlers[0];
		if (!handler) {
			throw new Error("SIGINT handler is undefined");
		}
		handler();

		expect(mockBridge.close).toHaveBeenCalledTimes(1);
		expect(processExitSpy).toHaveBeenCalledWith(0);
	});

	it("should call bridge.close() and process.exit(0) on SIGTERM", async () => {
		const stdioModule = await setupModule();
		await stdioModule.startStdioTransport();

		// Simulate SIGTERM
		const sigtermHandlers = signalHandlers.get("SIGTERM");
		expect(sigtermHandlers).toBeDefined();
		if (!sigtermHandlers) {
			throw new Error("SIGTERM handler not registered");
		}
		expect(sigtermHandlers.length).toBeGreaterThan(0);

		const handler = sigtermHandlers[0];
		if (!handler) {
			throw new Error("SIGTERM handler is undefined");
		}
		handler();

		expect(mockBridge.close).toHaveBeenCalledTimes(1);
		expect(processExitSpy).toHaveBeenCalledWith(0);
	});

	it("should log success message after starting", async () => {
		const stdioModule = await setupModule();
		await stdioModule.startStdioTransport();

		expect(logMock).toHaveBeenCalledWith("MCP Bridge started with stdio transport");
	});
});
