import { afterEach, describe, expect, it, jest } from "@jest/globals";

import { getAppSocketPaths, KNOWN_APPS, TOOL_PREFIX_SEPARATOR } from "../../constants.js";
import type { AppDefinition } from "../../types.js";

describe("constants", () => {
	describe("KNOWN_APPS", () => {
		it("should contain streamdeck as a known app", () => {
			expect(KNOWN_APPS).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: "streamdeck",
						socketBaseName: "elgato-streamdeck-mcp-bridge",
					}),
				]),
			);
		});

		it("should have unique app names", () => {
			const names = KNOWN_APPS.map((app) => app.name);
			expect(new Set(names).size).toBe(names.length);
		});
	});

	describe("TOOL_PREFIX_SEPARATOR", () => {
		it("should be double underscore", () => {
			expect(TOOL_PREFIX_SEPARATOR).toBe("__");
		});
	});

	describe("getAppSocketPaths", () => {
		const testApp: AppDefinition = { name: "test", socketBaseName: "my-test-bridge" };

		it("should return unix socket paths on non-windows", () => {
			if (process.platform !== "win32") {
				const paths = getAppSocketPaths(testApp);
				expect(paths.socketPath).toBe("/tmp/my-test-bridge.sock");
				expect(paths.signalSocketPath).toBe("/tmp/my-test-bridge-ready.sock");
			}
		});

		it("should return named pipe paths on windows", () => {
			if (process.platform === "win32") {
				const paths = getAppSocketPaths(testApp);
				expect(paths.socketPath).toBe("\\\\.\\pipe\\my-test-bridge");
				expect(paths.signalSocketPath).toBe("\\\\.\\pipe\\my-test-bridge-ready");
			}
		});
	});

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
