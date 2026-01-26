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

			// Use the getter functions to get paths based on current platform
			const { getSocketPath, getSignalSocketPath } = await import("../../constants.js");

			expect(getSocketPath()).toBe("\\\\.\\pipe\\elgato-streamdeck-mcp-bridge");
			expect(getSignalSocketPath()).toBe("\\\\.\\pipe\\elgato-streamdeck-mcp-bridge-ready");
		});

		it("should generate Unix socket path on darwin", async () => {
			// Mock macOS platform
			Object.defineProperty(process, "platform", {
				value: "darwin",
				writable: true,
				configurable: true,
			});

			// Use the getter functions to get paths based on current platform
			const { getSocketPath, getSignalSocketPath } = await import("../../constants.js");

			expect(getSocketPath()).toBe("/tmp/elgato-streamdeck-mcp-bridge.sock");
			expect(getSignalSocketPath()).toBe("/tmp/elgato-streamdeck-mcp-bridge-ready.sock");
		});
	});
});

