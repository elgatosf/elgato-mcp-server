import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock, MockInstance } from "vitest";
import type { Express } from "express";
import type { Server as HttpServer } from "node:http";

import { MockMcpBridge } from "../helpers/MockMcpBridge.js";
import { createDeferred } from "../helpers/testUtils.js";

const logMock = vi.fn();

// Generous enough to absorb Vitest's cold transform of the dynamically imported module
// on slow CI runners, while still failing if the startup promise never settles.
const TEST_TIMEOUT_MS = 5000;

interface StartupHarness {
	mockApp: Express;
	mockServer: HttpServer & { emitError: (error: NodeJS.ErrnoException) => void };
	serverReady: ReturnType<typeof createDeferred<void>>;
}

let mockExpressApp: Express;

const createStartupHarness = (): StartupHarness => {
	const serverReady = createDeferred<void>();
	let errorHandler: ((error: NodeJS.ErrnoException) => void) | undefined;

	const mockServer = {
		on: vi.fn((event: string, handler: (error: NodeJS.ErrnoException) => void) => {
			if (event === "error") {
				errorHandler = handler;
				serverReady.resolve();
			}
			return mockServer;
		}),
		close: vi.fn(),
		emitError: (error: NodeJS.ErrnoException) => {
			errorHandler?.(error);
		},
	} as unknown as HttpServer & { emitError: (error: NodeJS.ErrnoException) => void };

	const mockApp = {
		use: vi.fn().mockReturnThis(),
		get: vi.fn().mockReturnThis(),
		post: vi.fn().mockReturnThis(),
		delete: vi.fn().mockReturnThis(),
		listen: vi.fn((_port: number, _callback?: () => void) => mockServer),
	} as unknown as Express;

	mockExpressApp = mockApp;

	return { mockApp, mockServer, serverReady };
};

describe("HTTP server startup error handling", () => {
	let processOnSpy: MockInstance<typeof process.on>;

	beforeEach(() => {
		vi.clearAllMocks();
		processOnSpy = vi.spyOn(process, "on").mockImplementation(() => process);
	});

	afterEach(() => {
		processOnSpy.mockRestore();
	});

	const setupModule = async (options?: {
		ngrokModuleError?: Error;
	}): Promise<typeof import("../../transports/http.js")> => {
		vi.resetModules();
		logMock.mockClear();

		if (options?.ngrokModuleError) {
			vi.doMock("@ngrok/ngrok", () => {
				throw options.ngrokModuleError;
			});
		}

		vi.doMock("../../utils.js", () => ({
			log: {
				error: logMock,
				warn: logMock,
				info: logMock,
				debug: logMock,
			},
		}));
		vi.doMock("../../McpBridge.js", () => ({
			McpBridge: MockMcpBridge,
			createInitializedBridge: vi.fn<() => Promise<MockMcpBridge>>().mockResolvedValue(new MockMcpBridge()),
		}));
		vi.doMock("express", () => ({
			default: Object.assign(
				vi.fn(() => mockExpressApp),
				{
					json: vi.fn(() => "json-middleware"),
				},
			),
		}));

		return await import("../../transports/http.js");
	};

	const expectStartupError = async (code: string, expectedMessage: string): Promise<void> => {
		const { mockApp, mockServer, serverReady } = createStartupHarness();
		const httpModule = await setupModule();
		const startPromise = httpModule.startHttpTransport({ port: 4567 });
		await serverReady.promise;

		mockServer.emitError({ code, message: "Bind failed" } as NodeJS.ErrnoException);

		await expect(startPromise).rejects.toThrow(expectedMessage);
		expect(expectedMessage).toContain("4567");
		expect(logMock).toHaveBeenCalledWith(`HTTP server error: ${expectedMessage}`);
		expect((mockApp as any).listen).toHaveBeenCalledWith(4567, expect.any(Function));
		expect(mockServer.on).toHaveBeenCalledWith("error", expect.any(Function));
		expect(typeof mockServer.close).toBe("function");
		expect(mockServer.close).not.toHaveBeenCalled();
	};

	it(
		"should reject with descriptive message for EADDRINUSE",
		async () => {
			await expectStartupError(
				"EADDRINUSE",
				"Port 4567 is already in use. Please choose a different port or stop the process using port 4567.",
			);
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"should reject with descriptive message for EACCES",
		async () => {
			await expectStartupError(
				"EACCES",
				"Permission denied to bind to port 4567. Try using a port number above 1024 or run with elevated privileges.",
			);
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"should reject with descriptive message for EADDRNOTAVAIL",
		async () => {
			await expectStartupError(
				"EADDRNOTAVAIL",
				"Address not available for port 4567. The requested address is not valid for this machine.",
			);
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"should reject with descriptive message for generic errors",
		async () => {
			const { mockApp, mockServer, serverReady } = createStartupHarness();
			const httpModule = await setupModule();
			const startPromise = httpModule.startHttpTransport({ port: 7890 });
			await serverReady.promise;

			mockServer.emitError({ code: "EOTHER", message: "Unexpected error" } as NodeJS.ErrnoException);

			const expectedMessage = "Failed to start HTTP server on port 7890: Unexpected error";
			await expect(startPromise).rejects.toThrow(expectedMessage);
			expect(expectedMessage).toContain("7890");
			expect(logMock).toHaveBeenCalledWith(`HTTP server error: ${expectedMessage}`);
			expect((mockApp as any).listen).toHaveBeenCalledWith(7890, expect.any(Function));
			expect(mockServer.on).toHaveBeenCalledWith("error", expect.any(Function));
			expect(typeof mockServer.close).toBe("function");
			expect(mockServer.close).not.toHaveBeenCalled();
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"should start the server when --ngrok is set but @ngrok/ngrok cannot be loaded",
		async () => {
			const { mockApp, mockServer } = createStartupHarness();
			(mockApp.listen as unknown as Mock).mockImplementation((...args: unknown[]) => {
				const callback = args[1] as (() => void) | undefined;
				callback?.();
				return mockServer;
			});
			// Successful startup schedules the idle-session cleanup interval; stub it so Jest can exit.
			const setIntervalSpy = vi
				.spyOn(global, "setInterval")
				.mockReturnValue(0 as unknown as ReturnType<typeof setInterval>);

			try {
				const httpModule = await setupModule({ ngrokModuleError: new Error("Cannot find module '@ngrok/ngrok'") });
				const startPromise = httpModule.startHttpTransport({ port: 4567, ngrok: true });

				await expect(startPromise).resolves.toBeUndefined();
				expect(logMock).toHaveBeenCalledWith("Failed to start ngrok tunnel:", expect.any(Error));
				expect((mockApp as unknown as { listen: Mock }).listen).toHaveBeenCalledWith(4567, expect.any(Function));
			} finally {
				setIntervalSpy.mockRestore();
			}
		},
		TEST_TIMEOUT_MS,
	);
});
