import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { Resource, Tool } from "@modelcontextprotocol/sdk/types.js";

import {
	convertToMcpResources,
	convertToMcpTools,
	log,
	parseCliArgs,
	printHelp,
	setVerbose,
	unprefixName,
} from "../../utils.js";
import { createMockResource, createMockTool } from "../helpers/testUtils.js";

describe("utils", () => {
	describe("convertToMcpTools", () => {
		it("should convert basic tool with required fields", () => {
			const mcpTool = createMockTool({
				name: "test_tool",
				description: "Test description",
				inputSchema: {
					type: "object",
					properties: {
						param1: { type: "string" },
					},
				},
			});

			const result = convertToMcpTools([mcpTool]);

			expect(result).toHaveLength(1);
			expect(result[0]).toEqual({
				name: "test_tool",
				description: "Test description",
				inputSchema: {
					type: "object",
					properties: {
						param1: { type: "string" },
					},
				},
				annotations: undefined,
				icons: undefined,
			});
		});

		it("should preserve annotations and icons", () => {
			const mcpTool = createMockTool({
				name: "annotated_tool",
				annotations: {
					title: "Annotated Tool",
					readOnlyHint: true,
				},
				icons: [
					{
						src: "https://example.com/icon.png",
						mimeType: "image/png",
					},
				],
			});

			const result = convertToMcpTools([mcpTool]);

			expect(result[0]?.annotations).toEqual({
				title: "Annotated Tool",
				readOnlyHint: true,
			});
			expect(result[0]?.icons).toEqual([
				{
					src: "https://example.com/icon.png",
					mimeType: "image/png",
				},
			]);
		});

		it("should handle empty array", () => {
			const result = convertToMcpTools([]);
			expect(result).toEqual([]);
		});

		it("should convert multiple tools", () => {
			const tools = [
				createMockTool({ name: "tool1" }),
				createMockTool({ name: "tool2" }),
				createMockTool({ name: "tool3" }),
			];

			const result = convertToMcpTools(tools);

			expect(result).toHaveLength(3);
			expect(result[0]?.name).toBe("tool1");
			expect(result[1]?.name).toBe("tool2");
			expect(result[2]?.name).toBe("tool3");
		});

		it("should handle tools with complex input schemas", () => {
			const mcpTool = createMockTool({
				inputSchema: {
					type: "object",
					properties: {
						name: { type: "string" },
						age: { type: "number" },
						tags: {
							type: "array",
							items: { type: "string" },
						},
					},
					required: ["name"],
				},
			});

			const result = convertToMcpTools([mcpTool]);

			expect(result[0]?.inputSchema).toEqual({
				type: "object",
				properties: {
					name: { type: "string" },
					age: { type: "number" },
					tags: {
						type: "array",
						items: { type: "string" },
					},
				},
				required: ["name"],
			});
		});
	});

	describe("convertToMcpResources", () => {
		it("should convert basic resource with required fields", () => {
			const mcpResource = createMockResource({
				uri: "streamdeck://test/resource",
				name: "test_resource",
				description: "Test description",
				mimeType: "application/json",
			});

			const result = convertToMcpResources([mcpResource]);

			expect(result).toHaveLength(1);
			expect(result[0]).toEqual({
				uri: "streamdeck://test/resource",
				name: "test_resource",
				title: undefined,
				description: "Test description",
				mimeType: "application/json",
				icons: undefined,
				annotations: undefined,
				_meta: undefined,
			});
		});

		it("should preserve title, annotations and icons", () => {
			const mcpResource = createMockResource({
				uri: "streamdeck://annotated/resource",
				name: "annotated_resource",
				title: "Annotated Resource",
				annotations: {
					audience: ["user"],
					priority: 1,
				},
				icons: [
					{
						src: "https://example.com/icon.png",
						mimeType: "image/png",
					},
				],
			});

			const result = convertToMcpResources([mcpResource]);

			expect(result[0]?.title).toBe("Annotated Resource");
			expect(result[0]?.annotations).toEqual({
				audience: ["user"],
				priority: 1,
			});
			expect(result[0]?.icons).toEqual([
				{
					src: "https://example.com/icon.png",
					mimeType: "image/png",
				},
			]);
		});

		it("should handle empty array", () => {
			const result = convertToMcpResources([]);
			expect(result).toEqual([]);
		});

		it("should convert multiple resources", () => {
			const resources = [
				createMockResource({ uri: "streamdeck://resource1", name: "resource1" }),
				createMockResource({ uri: "streamdeck://resource2", name: "resource2" }),
				createMockResource({ uri: "streamdeck://resource3", name: "resource3" }),
			];

			const result = convertToMcpResources(resources);

			expect(result).toHaveLength(3);
			expect(result[0]?.uri).toBe("streamdeck://resource1");
			expect(result[1]?.uri).toBe("streamdeck://resource2");
			expect(result[2]?.uri).toBe("streamdeck://resource3");
		});

		it("should preserve _meta field", () => {
			const mcpResource = createMockResource({
				uri: "streamdeck://meta/resource",
				name: "meta_resource",
				_meta: { custom: "data", version: 2 },
			});

			const result = convertToMcpResources([mcpResource]);

			expect(result[0]?._meta).toEqual({ custom: "data", version: 2 });
		});
	});

	describe("unprefixName", () => {
		it("should correctly split valid prefixed name", () => {
			const result = unprefixName("app__tool");

			expect(result).toEqual({
				appName: "app",
				itemName: "tool",
			});
		});

		it("should return null for names without separator", () => {
			const result = unprefixName("toolname");

			expect(result).toBeNull();
		});

		it("should split at the FIRST occurrence only with multiple separators", () => {
			const result = unprefixName("app__sub__tool");

			expect(result).toEqual({
				appName: "app",
				itemName: "sub__tool",
			});
		});

		it("should return null for empty string", () => {
			const result = unprefixName("");

			expect(result).toBeNull();
		});

		it("should handle separator at start (empty app name)", () => {
			const result = unprefixName("__tool");

			expect(result).toEqual({
				appName: "",
				itemName: "tool",
			});
		});

		it("should handle separator at end (empty item name)", () => {
			const result = unprefixName("app__");

			expect(result).toEqual({
				appName: "app",
				itemName: "",
			});
		});

		it("should handle only separator (both empty)", () => {
			const result = unprefixName("__");

			expect(result).toEqual({
				appName: "",
				itemName: "",
			});
		});
	});

	describe("log", () => {
		afterEach(() => {
			setVerbose(false);
		});

		describe("log.error", () => {
			it("should always output to stderr with ERROR prefix", () => {
				const spy = jest.spyOn(console, "error").mockImplementation(() => {});
				log.error("something broke");
				expect(spy).toHaveBeenCalledWith("[MCP Bridge]", "ERROR:", "something broke");
				spy.mockRestore();
			});

			it("should output even when verbose is disabled", () => {
				const spy = jest.spyOn(console, "error").mockImplementation(() => {});
				setVerbose(false);
				log.error("critical failure");
				expect(spy).toHaveBeenCalledWith("[MCP Bridge]", "ERROR:", "critical failure");
				spy.mockRestore();
			});

			it("should handle multiple arguments", () => {
				const spy = jest.spyOn(console, "error").mockImplementation(() => {});
				log.error("message", 123, { key: "value" });
				expect(spy).toHaveBeenCalledWith("[MCP Bridge]", "ERROR:", "message", 123, { key: "value" });
				spy.mockRestore();
			});
		});

		describe("log.warn", () => {
			it("should always output to stderr with WARN prefix", () => {
				const spy = jest.spyOn(console, "error").mockImplementation(() => {});
				log.warn("watch out");
				expect(spy).toHaveBeenCalledWith("[MCP Bridge]", "WARN:", "watch out");
				spy.mockRestore();
			});

			it("should output even when verbose is disabled", () => {
				const spy = jest.spyOn(console, "error").mockImplementation(() => {});
				setVerbose(false);
				log.warn("something concerning");
				expect(spy).toHaveBeenCalledWith("[MCP Bridge]", "WARN:", "something concerning");
				spy.mockRestore();
			});
		});

		describe("log.info", () => {
			it("should be silent when verbose is disabled", () => {
				const spy = jest.spyOn(console, "error").mockImplementation(() => {});
				log.info("status update");
				expect(spy).not.toHaveBeenCalled();
				spy.mockRestore();
			});

			it("should output to stderr with INFO prefix when verbose is enabled", () => {
				const spy = jest.spyOn(console, "error").mockImplementation(() => {});
				setVerbose(true);
				log.info("bridge started");
				expect(spy).toHaveBeenCalledWith("[MCP Bridge]", "INFO:", "bridge started");
				spy.mockRestore();
			});

			it("should handle multiple arguments", () => {
				const spy = jest.spyOn(console, "error").mockImplementation(() => {});
				setVerbose(true);
				log.info("message", 123, { key: "value" });
				expect(spy).toHaveBeenCalledWith("[MCP Bridge]", "INFO:", "message", 123, { key: "value" });
				spy.mockRestore();
			});
		});

		describe("log.debug", () => {
			it("should be silent when verbose is disabled", () => {
				const spy = jest.spyOn(console, "error").mockImplementation(() => {});
				log.debug("detailed info");
				expect(spy).not.toHaveBeenCalled();
				spy.mockRestore();
			});

			it("should output to stderr with DEBUG prefix when verbose is enabled", () => {
				const spy = jest.spyOn(console, "error").mockImplementation(() => {});
				setVerbose(true);
				log.debug("session created:", "abc-123");
				expect(spy).toHaveBeenCalledWith("[MCP Bridge]", "DEBUG:", "session created:", "abc-123");
				spy.mockRestore();
			});
		});
	});

	describe("parseCliArgs", () => {
		it("should return default options for empty args", () => {
			const result = parseCliArgs([]);

			expect(result).toEqual({
				transport: "stdio",
				port: 9090,
				ngrok: false,
				help: false,
				verbose: false,
			});
		});

		it("should parse --transport http", () => {
			const result = parseCliArgs(["--transport", "http"]);
			expect(result.transport).toBe("http");
		});

		it("should parse --transport stdio", () => {
			const result = parseCliArgs(["--transport", "stdio"]);
			expect(result.transport).toBe("stdio");
		});

		it("should parse --http shorthand", () => {
			const result = parseCliArgs(["--http"]);
			expect(result.transport).toBe("http");
		});

		it("should parse --port", () => {
			const result = parseCliArgs(["--port", "3000"]);
			expect(result.port).toBe(3000);
		});

		it("should ignore invalid port", () => {
			const result = parseCliArgs(["--port", "invalid"]);
			expect(result.port).toBe(9090); // default
		});

		it("should parse --ngrok", () => {
			const result = parseCliArgs(["--ngrok"]);
			expect(result.ngrok).toBe(true);
		});

		it("should parse --help", () => {
			const result = parseCliArgs(["--help"]);
			expect(result.help).toBe(true);
		});

		it("should parse -h", () => {
			const result = parseCliArgs(["-h"]);
			expect(result.help).toBe(true);
		});

		it("should parse multiple options", () => {
			const result = parseCliArgs(["--http", "--port", "8080", "--ngrok"]);

			expect(result).toEqual({
				transport: "http",
				port: 8080,
				ngrok: true,
				help: false,
				verbose: false,
			});
		});

		it("should parse --verbose", () => {
			const result = parseCliArgs(["--verbose"]);
			expect(result.verbose).toBe(true);
		});

		it("should parse -v", () => {
			const result = parseCliArgs(["-v"]);
			expect(result.verbose).toBe(true);
		});

		it("should handle unknown options gracefully", () => {
			const result = parseCliArgs(["--unknown", "value"]);
			expect(result.transport).toBe("stdio");
		});
	});

	describe("printHelp", () => {
		it("should print help message to stdout", () => {
			const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});

			printHelp();

			expect(consoleLogSpy).toHaveBeenCalledTimes(1);
			const output = consoleLogSpy.mock.calls[0]?.[0] as string;
			expect(output).toContain("Usage: elgato-mcp-server");
			expect(output).toContain("--transport");
			expect(output).toContain("--http");
			expect(output).toContain("--port");
			expect(output).toContain("--ngrok");
			expect(output).toContain("--help");
			expect(output).toContain("--verbose");

			consoleLogSpy.mockRestore();
		});
	});
});
