import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import { getAppSocketPaths, KNOWN_APPS, TOOL_PREFIX_SEPARATOR } from "../../constants.js";
import type { AppDefinition } from "../../types.js";

describe("constants", () => {
	describe("KNOWN_APPS", () => {
		it("should contain streamdeck as a known app", () => {
			expect(KNOWN_APPS).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: "streamdeck",
						socketBaseName: "elgato-mcp-streamdeck",
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
		let originalPlatform: NodeJS.Platform;

		beforeEach(() => {
			originalPlatform = process.platform;
		});

		afterEach(() => {
			Object.defineProperty(process, "platform", {
				value: originalPlatform,
				writable: true,
				configurable: true,
			});
		});

		it("should return unix socket paths on darwin", () => {
			Object.defineProperty(process, "platform", {
				value: "darwin",
				writable: true,
				configurable: true,
			});

			const paths = getAppSocketPaths(testApp);

			expect(paths.socketPath).toBe("/tmp/my-test-bridge.sock");
			expect(paths.signalSocketPath).toBe("/tmp/my-test-bridge-ready.sock");
		});

		it("should return unix socket paths on linux", () => {
			Object.defineProperty(process, "platform", {
				value: "linux",
				writable: true,
				configurable: true,
			});

			const paths = getAppSocketPaths(testApp);

			expect(paths.socketPath).toBe("/tmp/my-test-bridge.sock");
			expect(paths.signalSocketPath).toBe("/tmp/my-test-bridge-ready.sock");
		});

		it("should return named pipe paths on windows", () => {
			Object.defineProperty(process, "platform", {
				value: "win32",
				writable: true,
				configurable: true,
			});

			const paths = getAppSocketPaths(testApp);

			expect(paths.socketPath).toBe("\\\\.\\pipe\\my-test-bridge");
			expect(paths.signalSocketPath).toBe("\\\\.\\pipe\\my-test-bridge-ready");
		});
	});
});
