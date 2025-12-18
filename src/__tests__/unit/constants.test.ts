import { describe, expect, it, jest } from "@jest/globals";

describe("constants", () => {
	describe("socket path generation", () => {
		const originalPlatform = process.platform;

		afterEach(() => {
			// Restore original platform
			Object.defineProperty(process, "platform", {
				value: originalPlatform,
				writable: true,
				configurable: true,
			});
			// Clear module cache to reload constants with new platform
			jest.resetModules();
		});

		it("should generate Windows pipe path on win32", async () => {
			// Mock Windows platform
			Object.defineProperty(process, "platform", {
				value: "win32",
				writable: true,
				configurable: true,
			});

			// Dynamically import to get fresh constants with mocked platform
			const { SOCKET_PATH, SIGNAL_SOCKET_PATH } = await import("../../constants.js");

			expect(SOCKET_PATH).toBe("\\\\.\\pipe\\elgato-streamdeck-mcp-bridge");
			expect(SIGNAL_SOCKET_PATH).toBe("\\\\.\\pipe\\elgato-streamdeck-mcp-bridge-ready");
		});

		it("should generate Unix socket path on darwin", async () => {
			// Mock macOS platform
			Object.defineProperty(process, "platform", {
				value: "darwin",
				writable: true,
				configurable: true,
			});

			const { SOCKET_PATH, SIGNAL_SOCKET_PATH } = await import("../../constants.js");

			expect(SOCKET_PATH).toBe("/tmp/elgato-streamdeck-mcp-bridge.sock");
			expect(SIGNAL_SOCKET_PATH).toBe("/tmp/elgato-streamdeck-mcp-bridge-ready.sock");
		});

		it("should generate Unix socket path on linux", async () => {
			// Mock Linux platform
			Object.defineProperty(process, "platform", {
				value: "linux",
				writable: true,
				configurable: true,
			});

			const { SOCKET_PATH, SIGNAL_SOCKET_PATH } = await import("../../constants.js");

			expect(SOCKET_PATH).toBe("/tmp/elgato-streamdeck-mcp-bridge.sock");
			expect(SIGNAL_SOCKET_PATH).toBe("/tmp/elgato-streamdeck-mcp-bridge-ready.sock");
		});
	});

	describe("timeout constants", () => {
		it("should have correct timeout values", async () => {
			const { QUICK_CONNECT_TIMEOUT_MS, REQUEST_TIMEOUT_MS } = await import("../../constants.js");

			expect(QUICK_CONNECT_TIMEOUT_MS).toBe(1000);
			expect(REQUEST_TIMEOUT_MS).toBe(30_000);
		});
	});

	describe("buffer size constant", () => {
		it("should have correct max buffer size", async () => {
			const { MAX_BUFFER_SIZE } = await import("../../constants.js");

			expect(MAX_BUFFER_SIZE).toBe(1024 * 1024); // 1 MB
		});
	});

	describe("HTTP default port", () => {
		it("should have correct default port", async () => {
			const { HTTP_DEFAULT_PORT } = await import("../../constants.js");

			expect(HTTP_DEFAULT_PORT).toBe(9090);
		});
	});

	describe("default server info", () => {
		it("should have correct default server info", async () => {
			const { DEFAULT_SERVER_INFO } = await import("../../constants.js");

			expect(DEFAULT_SERVER_INFO).toEqual({
				name: "Stream Deck MCP Server",
				version: "1.0.0",
			});
		});
	});

	describe("log prefix", () => {
		it("should have correct log prefix", async () => {
			const { LOG_PREFIX } = await import("../../constants.js");

			expect(LOG_PREFIX).toBe("[MCP Bridge]");
		});
	});
});

