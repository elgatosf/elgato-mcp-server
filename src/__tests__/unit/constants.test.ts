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
	});
});

