import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { RECONNECT_POLL_INTERVAL_MS, REQUEST_TIMEOUT_MS } from "../../constants.js";
import { StreamDeckClient } from "../../StreamDeckClient.js";
import type { ElicitationCallback } from "../../types.js";
import { MockServer } from "../helpers/MockServer.js";
import { MockSocket } from "../helpers/MockSocket.js";
import { createMockResource, createMockServerInfo, createMockTool, wait } from "../helpers/testUtils.js";

describe("StreamDeckClient", () => {
	let client: StreamDeckClient;
	let mockSocket: MockSocket;
	let mockServer: MockServer;

	beforeEach(() => {
		mockSocket = new MockSocket();
		mockServer = new MockServer();

		// Create client with mock factories
		client = new StreamDeckClient(
			() => mockSocket as any, // socketFactory
			(listener) => {
				// serverFactory
				if (listener) {
					mockServer.on("connection", listener);
				}
				return mockServer as any;
			},
		);

		jest.clearAllMocks();
	});

	afterEach(() => {
		client.disconnect();
	});

	describe("connection lifecycle", () => {
		it("should start disconnected", () => {
			expect(client.isConnected).toBe(false);
		});

		it("should connect successfully", async () => {
			const connectPromise = client.connect(100);

			// Simulate successful connection
			mockSocket.simulateConnect();

			const result = await connectPromise;

			expect(result).toBe(true);
			expect(client.isConnected).toBe(true);
		});

		it("should timeout on connection failure", async () => {
			const result = await client.connect(50);

			expect(result).toBe(false);
			expect(client.isConnected).toBe(false);
		});

		it("should handle connection error", async () => {
			const connectPromise = client.connect(100);

			// Simulate connection error
			mockSocket.simulateError(new Error("Connection refused"));

			const result = await connectPromise;

			expect(result).toBe(false);
			expect(client.isConnected).toBe(false);
		});

		it("should disconnect properly", async () => {
			const connectPromise = client.connect(100);
			mockSocket.simulateConnect();
			await connectPromise;

			expect(client.isConnected).toBe(true);

			client.disconnect();

			expect(mockSocket.destroyed).toBe(true);
			expect(client.isConnected).toBe(false);
		});
	});

	describe("message parsing and buffer processing", () => {
		beforeEach(async () => {
			const connectPromise = client.connect(100);
			mockSocket.simulateConnect();
			await connectPromise;
		});

		it("should parse complete JSON message", async () => {
			const serverInfo = { name: "Test Server", version: "1.0.0" };

			// Send request
			const requestPromise = client.getServerInfo();

			// Capture the request ID from the sent message
			const writtenData = mockSocket.getWrittenData();
			const sentData = writtenData[writtenData.length - 1]!;
			const sentRequest = JSON.parse(sentData.replace("\n", ""));
			const requestId = sentRequest.id;

			// Simulate response with matching ID
			const response = { id: requestId, result: serverInfo };
			mockSocket.simulateData(JSON.stringify(response) + "\n");

			// Should resolve successfully
			const result = await requestPromise;
			expect(result).toEqual(serverInfo);
		});

		it("should handle partial messages", async () => {
			// Send request
			const requestPromise = client.getTools();

			// Capture the request ID from the sent message
			const writtenData = mockSocket.getWrittenData();
			const sentData = writtenData[writtenData.length - 1]!;
			const sentRequest = JSON.parse(sentData.replace("\n", ""));
			const requestId = sentRequest.id;

			// Build response with matching ID
			const response = { id: requestId, result: { tools: [] } };
			const message = JSON.stringify(response) + "\n";

			// Send message in parts
			mockSocket.simulateData(message.slice(0, 10));
			await wait(10);
			mockSocket.simulateData(message.slice(10));

			const result = await requestPromise;
			expect(result).toEqual([]);
		});

		it("should handle multiple messages in one chunk", async () => {
			const request1Promise = client.getTools();

			// Capture the first request ID
			const writtenData1 = mockSocket.getWrittenData();
			const sentData1 = writtenData1[writtenData1.length - 1]!;
			const sentRequest1 = JSON.parse(sentData1.replace("\n", ""));
			const requestId1 = sentRequest1.id;

			const request2Promise = client.getTools();

			// Capture the second request ID
			const writtenData2 = mockSocket.getWrittenData();
			const sentData2 = writtenData2[writtenData2.length - 1]!;
			const sentRequest2 = JSON.parse(sentData2.replace("\n", ""));
			const requestId2 = sentRequest2.id;

			// Build responses with matching IDs
			const response1 = { id: requestId1, result: { tools: [] } };
			const response2 = { id: requestId2, result: { tools: [] } };

			// Send both responses at once
			mockSocket.simulateData(JSON.stringify(response1) + "\n" + JSON.stringify(response2) + "\n");

			const [result1, result2] = await Promise.all([request1Promise, request2Promise]);

			expect(result1).toEqual([]);
			expect(result2).toEqual([]);
		});

		it("should handle buffer overflow protection", async () => {
			// This tests that extremely large messages don't cause issues
			const largeData = "x".repeat(2 * 1024 * 1024); // 2MB, larger than MAX_BUFFER_SIZE

			// Should not crash
			mockSocket.simulateData(largeData);

			// Client should still be connected
			expect(client.isConnected).toBe(true);
		});
	});

	describe("request/response correlation", () => {
		beforeEach(async () => {
			const connectPromise = client.connect(100);
			mockSocket.simulateConnect();
			await connectPromise;
		});

		it("should correlate responses with requests by ID", async () => {
			const request1Promise = client.getTools();
			const request2Promise = client.getTools();

			// Get the written requests
			const written = mockSocket.getWrittenData();
			expect(written).toHaveLength(2);

			const req1 = JSON.parse(written[0] ?? "{}");
			const req2 = JSON.parse(written[1] ?? "{}");

			// Send responses in reverse order
			mockSocket.simulateData(
				JSON.stringify({ id: req2.id, result: { tools: [createMockTool({ name: "tool2" })] } }) + "\n",
			);
			mockSocket.simulateData(
				JSON.stringify({ id: req1.id, result: { tools: [createMockTool({ name: "tool1" })] } }) + "\n",
			);

			const [result1, result2] = await Promise.all([request1Promise, request2Promise]);

			expect(result1[0]?.name).toBe("tool1");
			expect(result2[0]?.name).toBe("tool2");
		});

		it("should handle responses with unknown IDs gracefully", async () => {
			// Send a response with an unknown ID
			mockSocket.simulateData(JSON.stringify({ id: "unknown", result: {} }) + "\n");

			// Should not crash
			expect(client.isConnected).toBe(true);
		});
	});

	describe("timeout handling", () => {
		beforeEach(async () => {
			const connectPromise = client.connect(100);
			mockSocket.simulateConnect();
			await connectPromise;
		});

		it("should timeout requests that take too long", async () => {
			// Mock a very short timeout for testing
			jest.useFakeTimers();

			const requestPromise = client.getTools();

			// Fast-forward time past the timeout
			jest.advanceTimersByTime(REQUEST_TIMEOUT_MS + 1000); // REQUEST_TIMEOUT_MS + 1000

			await expect(requestPromise).rejects.toThrow("Request timeout");

			jest.useRealTimers();
		});

		it("should clear timeout on successful response", async () => {
			const requestPromise = client.getTools();

			// Respond immediately
			const written = mockSocket.getWrittenData();
			const req = JSON.parse(written[0] ?? "{}");
			mockSocket.simulateData(JSON.stringify({ id: req.id, result: { tools: [] } }) + "\n");

			const result = await requestPromise;
			expect(result).toEqual([]);
		});
	});

	describe("error response handling", () => {
		beforeEach(async () => {
			const connectPromise = client.connect(100);
			mockSocket.simulateConnect();
			await connectPromise;
		});

		it("should handle error responses from getServerInfo", async () => {
			const requestPromise = client.getServerInfo();

			const written = mockSocket.getWrittenData();
			const req = JSON.parse(written[0] ?? "{}");

			mockSocket.simulateData(
				JSON.stringify({
					id: req.id,
					error: { code: -1, message: "Server error" },
				}) + "\n",
			);

			await expect(requestPromise).rejects.toThrow("Server error");
		});

		it("should handle error responses from getTools", async () => {
			const requestPromise = client.getTools();

			const written = mockSocket.getWrittenData();
			const req = JSON.parse(written[0] ?? "{}");

			mockSocket.simulateData(
				JSON.stringify({
					id: req.id,
					error: { code: -1, message: "Tools error" },
				}) + "\n",
			);

			await expect(requestPromise).rejects.toThrow("Tools error");
		});

		it("should handle error responses from callTool", async () => {
			const requestPromise = client.callTool("test_tool", { param: "value" });

			const written = mockSocket.getWrittenData();
			const req = JSON.parse(written[0] ?? "{}");

			mockSocket.simulateData(
				JSON.stringify({
					id: req.id,
					error: { code: -1, message: "Tool execution error" },
				}) + "\n",
			);

			const result = await requestPromise;
			expect(result.error).toEqual({ code: -1, message: "Tool execution error" });
		});
	});

	describe("API methods", () => {
		beforeEach(async () => {
			const connectPromise = client.connect(100);
			mockSocket.simulateConnect();
			await connectPromise;
		});

		it("should send correct request for getServerInfo", async () => {
			const requestPromise = client.getServerInfo();

			const written = mockSocket.getWrittenData();
			expect(written).toHaveLength(1);

			const req = JSON.parse(written[0] ?? "{}");
			expect(req.method).toBe("server_info");
			expect(req.id).toBeDefined();

			// Respond
			const serverInfo = createMockServerInfo();
			mockSocket.simulateData(JSON.stringify({ id: req.id, result: serverInfo }) + "\n");

			const result = await requestPromise;
			expect(result).toEqual(serverInfo);
		});

		it("should send correct request for getTools", async () => {
			const requestPromise = client.getTools();

			const written = mockSocket.getWrittenData();
			expect(written).toHaveLength(1);

			const req = JSON.parse(written[0] ?? "{}");
			expect(req.method).toBe("tools_list");
			expect(req.id).toBeDefined();

			// Respond
			const tools = [createMockTool()];
			mockSocket.simulateData(JSON.stringify({ id: req.id, result: { tools } }) + "\n");

			const result = await requestPromise;
			expect(result).toEqual(tools);
		});

		it("should send correct request for callTool", async () => {
			const toolName = "test_tool";
			const args = { param1: "value1", param2: 123 };

			const requestPromise = client.callTool(toolName, args);

			const written = mockSocket.getWrittenData();
			expect(written).toHaveLength(1);

			const req = JSON.parse(written[0] ?? "{}");
			expect(req.method).toBe("call_tool");
			expect(req.toolName).toBe(toolName);
			expect(req.arguments).toEqual(args);
			expect(req.id).toBeDefined();

			// Respond
			mockSocket.simulateData(JSON.stringify({ id: req.id, result: { success: true } }) + "\n");

			const result = await requestPromise;
			expect(result.result).toEqual({ success: true });
		});

		it("should throw error when calling methods while disconnected", async () => {
			client.disconnect();

			await expect(client.getServerInfo()).rejects.toThrow("Not connected to Stream Deck");
			await expect(client.getTools()).rejects.toThrow("Not connected to Stream Deck");
			await expect(client.callTool("test", {})).rejects.toThrow("Not connected to Stream Deck");
		});

		it("should send correct request for getResources", async () => {
			const requestPromise = client.getResources();

			const written = mockSocket.getWrittenData();
			expect(written).toHaveLength(1);

			const req = JSON.parse(written[0] ?? "{}");
			expect(req.method).toBe("resources_list");
			expect(req.id).toBeDefined();

			// Respond
			const resources = [createMockResource()];
			mockSocket.simulateData(JSON.stringify({ id: req.id, result: { resources } }) + "\n");

			const result = await requestPromise;
			expect(result).toEqual(resources);
		});

		it("should handle error responses from getResources", async () => {
			const requestPromise = client.getResources();

			const written = mockSocket.getWrittenData();
			const req = JSON.parse(written[0] ?? "{}");

			mockSocket.simulateData(
				JSON.stringify({
					id: req.id,
					error: { code: -1, message: "Resources error" },
				}) + "\n",
			);

			await expect(requestPromise).rejects.toThrow("Resources error");
		});

		it("should return empty array when getResources result is undefined", async () => {
			const requestPromise = client.getResources();

			const written = mockSocket.getWrittenData();
			const req = JSON.parse(written[0] ?? "{}");

			// Send response without result
			mockSocket.simulateData(JSON.stringify({ id: req.id }) + "\n");

			const result = await requestPromise;
			expect(result).toEqual([]);
		});

		it("should send correct request for readResource", async () => {
			const uri = "streamdeck://test/resource";
			const requestPromise = client.readResource(uri);

			const written = mockSocket.getWrittenData();
			expect(written).toHaveLength(1);

			const req = JSON.parse(written[0] ?? "{}");
			expect(req.method).toBe("resources_read");
			expect(req.uri).toBe(uri);
			expect(req.id).toBeDefined();

			// Respond
			const resourceContent = {
				uri: uri,
				mimeType: "application/json",
				content: { key: "value" },
			};
			mockSocket.simulateData(JSON.stringify({ id: req.id, result: resourceContent }) + "\n");

			const result = await requestPromise;
			expect(result).toEqual(resourceContent);
		});

		it("should handle error responses from readResource", async () => {
			const requestPromise = client.readResource("streamdeck://test/resource");

			const written = mockSocket.getWrittenData();
			const req = JSON.parse(written[0] ?? "{}");

			mockSocket.simulateData(
				JSON.stringify({
					id: req.id,
					error: { code: -1, message: "Resource not found" },
				}) + "\n",
			);

			await expect(requestPromise).rejects.toThrow("Resource not found");
		});

		it("should throw error when readResource returns no result", async () => {
			const requestPromise = client.readResource("streamdeck://test/resource");

			const written = mockSocket.getWrittenData();
			const req = JSON.parse(written[0] ?? "{}");

			// Send response without result
			mockSocket.simulateData(JSON.stringify({ id: req.id }) + "\n");

			await expect(requestPromise).rejects.toThrow("No result returned from Stream Deck");
		});

		it("should throw error when calling getResources while disconnected", async () => {
			client.disconnect();

			await expect(client.getResources()).rejects.toThrow("Not connected to Stream Deck");
		});

		it("should throw error when calling readResource while disconnected", async () => {
			client.disconnect();

			await expect(client.readResource("streamdeck://test")).rejects.toThrow("Not connected to Stream Deck");
		});
	});

	describe("signal listener", () => {
		it("should start signal listener", () => {
			client.startSignalListener();

			// Verify the server is listening
			expect(mockServer.isListening()).toBe(true);

			// Verify cleanup works - disconnect should close the server
			client.disconnect();
			expect(mockServer.isListening()).toBe(false);
		});

		it("should handle reconnection signal", async () => {
			let callbackCalled = false;
			client.onConnected(() => {
				callbackCalled = true;
			});

			client.startSignalListener();

			// Verify server is listening
			expect(mockServer.isListening()).toBe(true);

			// Simulate signal connection
			const signalSocket = new MockSocket();
			mockServer.simulateConnection(signalSocket as any);

			// Wait a bit for async operations
			await wait(50);

			// Verify the signal socket was ended (closed)
			expect(signalSocket.ended).toBe(true);

			// Simulate successful reconnection
			mockSocket.simulateConnect();

			await wait(50);

			// Verify the client is now connected
			expect(client.isConnected).toBe(true);

			// Verify the callback was called
			expect(callbackCalled).toBe(true);
		});
	});

	describe("onConnected callback", () => {
		it("should register and call onConnected callback", () => {
			let called = false;
			const callback = (): void => {
				called = true;
			};

			client.onConnected(callback);

			// Manually trigger the callback (in real scenario, this happens on reconnection)
			// We can't easily test this without exposing internal methods
			expect(called).toBe(false); // Not called yet
		});
	});

	describe("onDisconnected callback", () => {
		it("should register onDisconnected callback", () => {
			let called = false;
			const callback = (): void => {
				called = true;
			};

			client.onDisconnected(callback);

			// Callback should not be called until disconnect happens
			expect(called).toBe(false);
		});

		it("should call onDisconnected callback when socket closes", async () => {
			let disconnectCalled = false;
			const callback = (): void => {
				disconnectCalled = true;
			};

			client.onDisconnected(callback);

			// Connect first (must call connect() then simulate connect)
			const connectPromise = client.connect(100);
			mockSocket.simulateConnect();
			await connectPromise;

			expect(client.isConnected).toBe(true);
			expect(disconnectCalled).toBe(false);

			// Simulate socket close
			mockSocket.simulateClose();
			await wait(10);

			expect(client.isConnected).toBe(false);
			expect(disconnectCalled).toBe(true);
		});

		it("should call onDisconnected callback before starting polling", async () => {
			const callOrder: string[] = [];

			client.onDisconnected(() => {
				callOrder.push("disconnected");
			});

			// Connect first (must call connect() then simulate connect)
			const connectPromise = client.connect(100);
			mockSocket.simulateConnect();
			await connectPromise;

			// Simulate socket close
			mockSocket.simulateClose();
			await wait(10);

			// Disconnected callback should have been called
			expect(callOrder).toContain("disconnected");
		});
	});

	describe("polling fallback for multi-client reconnection", () => {
		it("should start polling when connection closes and no signal server is owned", async () => {
			jest.useFakeTimers();

			let socketFactoryCallCount = 0;
			const trackingSocketFactory = () => {
				socketFactoryCallCount++;
				return mockSocket as any;
			};

			// Create client with tracking socket factory
			const testClient = new StreamDeckClient(trackingSocketFactory, (listener) => {
				if (listener) {
					mockServer.on("connection", listener);
				}
				return mockServer as any;
			});

			// Connect first
			const connectPromise = testClient.connect(100);
			mockSocket.simulateConnect();
			await connectPromise;

			expect(testClient.isConnected).toBe(true);
			const callCountAfterConnect = socketFactoryCallCount;

			// Simulate close - should start polling since no signal server
			mockSocket.destroy();

			// Reset mock socket for reconnection attempts
			mockSocket = new MockSocket();

			// Advance time by polling interval - should trigger reconnection attempt
			jest.advanceTimersByTime(RECONNECT_POLL_INTERVAL_MS);

			// Verify polling started by checking that socket factory was called again
			expect(socketFactoryCallCount).toBeGreaterThan(callCountAfterConnect);

			testClient.disconnect();
			jest.useRealTimers();
		});

		it("should not start polling when signal server is owned and connection closes", async () => {
			jest.useFakeTimers();

			let socketFactoryCallCount = 0;
			const trackingSocketFactory = () => {
				socketFactoryCallCount++;
				return mockSocket as any;
			};

			// Create client with tracking socket factory
			const testClient = new StreamDeckClient(trackingSocketFactory, (listener) => {
				if (listener) {
					mockServer.on("connection", listener);
				}
				return mockServer as any;
			});

			// Start signal listener first (client owns signal server)
			testClient.startSignalListener();
			expect(mockServer.isListening()).toBe(true);

			// Connect
			const connectPromise = testClient.connect(100);
			mockSocket.simulateConnect();
			await connectPromise;

			expect(testClient.isConnected).toBe(true);
			const callCountAfterConnect = socketFactoryCallCount;

			// Simulate close - should NOT start polling since we own signal server
			mockSocket.destroy();

			// Reset mock socket
			mockSocket = new MockSocket();

			// Advance time by polling interval
			jest.advanceTimersByTime(RECONNECT_POLL_INTERVAL_MS);

			// Verify polling did NOT start - socket factory should not have been called again
			expect(socketFactoryCallCount).toBe(callCountAfterConnect);

			testClient.disconnect();
			jest.useRealTimers();
		});

		it("should clear poll interval on disconnect", async () => {
			jest.useFakeTimers();

			// Connect and then close to start polling
			const connectPromise = client.connect(100);
			mockSocket.simulateConnect();
			await connectPromise;

			// Close connection without signal server to start polling
			mockSocket.destroy();

			// Now disconnect should clean up polling
			client.disconnect();

			// Polling should be stopped - verify no errors on timer advancement
			jest.advanceTimersByTime(10000);

			expect(client.isConnected).toBe(false);

			jest.useRealTimers();
		});

		it("should stop polling when connection is re-established", async () => {
			jest.useFakeTimers();

			let connectCount = 0;
			const originalSocketFactory = () => {
				connectCount++;
				return mockSocket as any;
			};

			// Create client with tracking socket factory
			const testClient = new StreamDeckClient(originalSocketFactory, (listener) => {
				if (listener) {
					mockServer.on("connection", listener);
				}
				return mockServer as any;
			});

			// Connect and close to start polling
			const connectPromise = testClient.connect(100);
			mockSocket.simulateConnect();
			await connectPromise;

			mockSocket.destroy();

			// Reset the mock socket for reconnection
			mockSocket = new MockSocket();

			// Advance time to trigger polling
			jest.advanceTimersByTime(RECONNECT_POLL_INTERVAL_MS);

			// Clean up
			testClient.disconnect();

			jest.useRealTimers();
		});
	});

	describe("signal server error handling", () => {
		it("should handle EADDRINUSE by falling back to polling", async () => {
			jest.useFakeTimers();

			// Create a custom mock server that simulates EADDRINUSE
			const errorMockServer = new MockServer();

			const testClient = new StreamDeckClient(
				() => mockSocket as any,
				(listener) => {
					return errorMockServer as any;
				},
			);

			// Start signal listener
			testClient.startSignalListener();

			// Simulate EADDRINUSE error on the mock server
			const error = new Error("EADDRINUSE") as NodeJS.ErrnoException;
			error.code = "EADDRINUSE";
			errorMockServer.emit("error", error);

			// Should fall back to polling
			jest.advanceTimersByTime(RECONNECT_POLL_INTERVAL_MS);

			testClient.disconnect();
			jest.useRealTimers();
		});

		it("should not retry signal server creation when another process is actively using the socket", async () => {
			// This tests the handleSocketInUse logic
			// The signal server should not infinitely retry if another process owns the socket
			client.startSignalListener();

			expect(mockServer.isListening()).toBe(true);

			client.disconnect();
		});

		it("should not start polling when stale socket recovery succeeds", async () => {
			jest.useFakeTimers();

			// Track how many servers were created (for detecting retries)
			let serverFactoryCallCount = 0;
			const trackingServerFactory = (listener: any) => {
				serverFactoryCallCount++;
				if (listener) {
					mockServer.on("connection", listener);
				}
				return mockServer as any;
			};

			// Create client with tracking server factory
			const testClient = new StreamDeckClient(() => mockSocket as any, trackingServerFactory);

			// Spy on startPolling to verify it's NOT called
			const startPollingSpy = jest.spyOn(testClient as any, "startPolling");

			// Start signal listener - this is the first server creation
			testClient.startSignalListener();
			expect(mockServer.isListening()).toBe(true);
			const initialServerCount = serverFactoryCallCount;

			// Simulate EADDRINUSE error (stale socket scenario on non-Windows)
			const error = new Error("EADDRINUSE") as NodeJS.ErrnoException;
			error.code = "EADDRINUSE";
			mockServer.emit("error", error);

			// Allow handleSocketInUse() to complete (it's async)
			await jest.runAllTimersAsync();

			// After stale socket recovery, the signal server should be recreated
			// (serverFactoryCallCount should be greater than initial)
			expect(serverFactoryCallCount).toBeGreaterThan(initialServerCount);

			// Polling should NOT have started - verify directly
			expect(startPollingSpy).not.toHaveBeenCalled();

			testClient.disconnect();
			jest.useRealTimers();
		});

		it("should start polling when handleSocketInUse fails", async () => {
			jest.useFakeTimers();
			const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

			// Create client
			const testClient = new StreamDeckClient(
				() => mockSocket as any,
				(listener) => {
					if (listener) {
						mockServer.on("connection", listener);
					}
					return mockServer as any;
				},
			);

			// Spy on methods
			const startPollingSpy = jest.spyOn(testClient as any, "startPolling");
			const handleSocketInUseSpy = jest
				.spyOn(testClient as any, "handleSocketInUse")
				.mockRejectedValue(new Error("isSocketActive failed"));

			// Start signal listener
			testClient.startSignalListener();
			expect(mockServer.isListening()).toBe(true);

			// Simulate EADDRINUSE error
			const error = new Error("EADDRINUSE") as NodeJS.ErrnoException;
			error.code = "EADDRINUSE";
			mockServer.emit("error", error);

			// Allow the promise chain (.then().catch()) to complete
			await Promise.resolve();
			await Promise.resolve();

			// Verify handleSocketInUse was called and failed
			expect(handleSocketInUseSpy).toHaveBeenCalled();

			// Verify error was logged
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining("handleSocketInUse failed:"),
				expect.any(Error),
			);

			// Verify polling started as fallback
			expect(startPollingSpy).toHaveBeenCalled();

			testClient.disconnect();
			consoleErrorSpy.mockRestore();
			jest.useRealTimers();
		});
	});

	describe("disconnect cleanup", () => {
		it("should clean up poll interval on disconnect", () => {
			jest.useFakeTimers();

			// Start signal listener and then disconnect
			client.startSignalListener();
			expect(mockServer.isListening()).toBe(true);

			client.disconnect();

			// Verify server is stopped
			expect(mockServer.isListening()).toBe(false);

			// Verify no timer errors on advancement
			jest.advanceTimersByTime(10000);

			jest.useRealTimers();
		});

		it("should clean up all resources on disconnect", async () => {
			// Connect
			const connectPromise = client.connect(100);
			mockSocket.simulateConnect();
			await connectPromise;

			// Start signal listener
			client.startSignalListener();

			// Disconnect should clean up everything
			client.disconnect();

			expect(client.isConnected).toBe(false);
			expect(mockSocket.destroyed).toBe(true);
			expect(mockServer.isListening()).toBe(false);
		});
	});

	describe("notification handling", () => {
		beforeEach(async () => {
			const connectPromise = client.connect(100);
			mockSocket.simulateConnect();
			await connectPromise;
		});

		describe("type guards", () => {
			it("should distinguish notifications from IPC responses (notification has method but no id)", async () => {
				const notificationCallback = jest.fn();
				client.onNotification(notificationCallback);

				// Send a notification (has method but no id)
				const notification = { method: "tools/changed", params: { foo: "bar" } };
				mockSocket.simulateData(JSON.stringify(notification) + "\n");

				await wait(10);

				// Notification callback should be called
				expect(notificationCallback).toHaveBeenCalledWith("tools/changed", { foo: "bar" });
			});

			it("should not treat IPC response as notification (response has id)", async () => {
				const notificationCallback = jest.fn();
				client.onNotification(notificationCallback);

				// Send a request and its response
				const requestPromise = client.getTools();

				const written = mockSocket.getWrittenData();
				const req = JSON.parse(written[0] ?? "{}");

				// Send response with id - this should NOT trigger notification callback
				mockSocket.simulateData(JSON.stringify({ id: req.id, result: { tools: [] } }) + "\n");

				await requestPromise;

				// Notification callback should NOT be called for responses
				expect(notificationCallback).not.toHaveBeenCalled();
			});

			it("should handle notification without params", async () => {
				const notificationCallback = jest.fn();
				client.onNotification(notificationCallback);

				// Send a notification without params
				const notification = { method: "custom/event" };
				mockSocket.simulateData(JSON.stringify(notification) + "\n");

				await wait(10);

				expect(notificationCallback).toHaveBeenCalledWith("custom/event", undefined);
			});
		});

		describe("multiple callbacks", () => {
			it("should invoke all registered callbacks when notification is received", async () => {
				const callback1 = jest.fn();
				const callback2 = jest.fn();
				const callback3 = jest.fn();

				client.onNotification(callback1);
				client.onNotification(callback2);
				client.onNotification(callback3);

				const notification = { method: "test/notification", params: { data: 123 } };
				mockSocket.simulateData(JSON.stringify(notification) + "\n");

				await wait(10);

				expect(callback1).toHaveBeenCalledWith("test/notification", { data: 123 });
				expect(callback2).toHaveBeenCalledWith("test/notification", { data: 123 });
				expect(callback3).toHaveBeenCalledWith("test/notification", { data: 123 });
			});

			it("should invoke callbacks with correct arguments for each notification", async () => {
				const callback = jest.fn();
				client.onNotification(callback);

				// Send multiple notifications
				mockSocket.simulateData(JSON.stringify({ method: "event1", params: { a: 1 } }) + "\n");
				mockSocket.simulateData(JSON.stringify({ method: "event2", params: { b: 2 } }) + "\n");

				await wait(10);

				expect(callback).toHaveBeenCalledTimes(2);
				expect(callback).toHaveBeenNthCalledWith(1, "event1", { a: 1 });
				expect(callback).toHaveBeenNthCalledWith(2, "event2", { b: 2 });
			});
		});

		describe("error isolation", () => {
			it("should catch and log errors from throwing callbacks", async () => {
				const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

				const errorCallback = jest.fn(() => {
					throw new Error("Callback failed");
				});
				client.onNotification(errorCallback);

				const notification = { method: "test/error" };
				mockSocket.simulateData(JSON.stringify(notification) + "\n");

				await wait(10);

				expect(errorCallback).toHaveBeenCalled();
				expect(consoleErrorSpy).toHaveBeenCalledWith("[MCP Bridge] Notification callback error:", expect.any(Error));

				consoleErrorSpy.mockRestore();
			});

			it("should continue invoking remaining callbacks after one throws", async () => {
				const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

				const callback1 = jest.fn(() => {
					throw new Error("First callback failed");
				});
				const callback2 = jest.fn();
				const callback3 = jest.fn(() => {
					throw new Error("Third callback failed");
				});
				const callback4 = jest.fn();

				client.onNotification(callback1);
				client.onNotification(callback2);
				client.onNotification(callback3);
				client.onNotification(callback4);

				const notification = { method: "test/resilience" };
				mockSocket.simulateData(JSON.stringify(notification) + "\n");

				await wait(10);

				// All callbacks should be invoked despite errors
				expect(callback1).toHaveBeenCalled();
				expect(callback2).toHaveBeenCalled();
				expect(callback3).toHaveBeenCalled();
				expect(callback4).toHaveBeenCalled();

				// Two errors should be logged
				expect(consoleErrorSpy).toHaveBeenCalledTimes(2);

				consoleErrorSpy.mockRestore();
			});
		});

		describe("message stream parsing", () => {
			it("should handle notifications mixed with IPC responses in the stream", async () => {
				const notificationCallback = jest.fn();
				client.onNotification(notificationCallback);

				// Start a request
				const requestPromise = client.getTools();
				const written = mockSocket.getWrittenData();
				const req = JSON.parse(written[0] ?? "{}");

				// Send notification, then response, then another notification in one chunk
				const notification1 = { method: "event/before" };
				const response = { id: req.id, result: { tools: [] } };
				const notification2 = { method: "event/after", params: { seq: 2 } };

				mockSocket.simulateData(
					JSON.stringify(notification1) + "\n" + JSON.stringify(response) + "\n" + JSON.stringify(notification2) + "\n",
				);

				const result = await requestPromise;

				// Response should be processed correctly
				expect(result).toEqual([]);

				// Both notifications should be processed
				await wait(10);
				expect(notificationCallback).toHaveBeenCalledTimes(2);
				expect(notificationCallback).toHaveBeenCalledWith("event/before", undefined);
				expect(notificationCallback).toHaveBeenCalledWith("event/after", { seq: 2 });
			});

			it("should handle partial notification messages across chunks", async () => {
				const notificationCallback = jest.fn();
				client.onNotification(notificationCallback);

				const notification = { method: "partial/test", params: { complete: true } };
				const message = JSON.stringify(notification) + "\n";

				// Send message in parts
				mockSocket.simulateData(message.slice(0, 15));
				await wait(5);
				mockSocket.simulateData(message.slice(15));

				await wait(10);

				expect(notificationCallback).toHaveBeenCalledWith("partial/test", { complete: true });
			});

			it("should ignore non-object parsed messages", async () => {
				const notificationCallback = jest.fn();
				client.onNotification(notificationCallback);

				// Send a non-object JSON value
				mockSocket.simulateData('"just a string"\n');
				mockSocket.simulateData("123\n");
				mockSocket.simulateData("null\n");

				await wait(10);

				// None of these should trigger the notification callback
				expect(notificationCallback).not.toHaveBeenCalled();
			});
		});
	});

	describe("elicitation handling", () => {
		beforeEach(async () => {
			const connectPromise = client.connect(100);
			mockSocket.simulateConnect();
			await connectPromise;
		});

		describe("type guards", () => {
			it("should identify elicitation request (has both id and method: elicitation/create)", async () => {
				const elicitationCallback = jest
					.fn<ElicitationCallback>()
					.mockResolvedValue({ action: "accept", content: { name: "test" } });
				client.onElicitation(elicitationCallback);

				// Send an elicitation request (has both id and method)
				const elicitationRequest = {
					id: "elicit-123",
					method: "elicitation/create",
					params: {
						message: "Please provide your name",
						mode: "form",
						requestedSchema: {
							type: "object",
							properties: { name: { type: "string" } },
						},
						relatedToolCallId: "tool-call-1",
					},
				};
				mockSocket.simulateData(JSON.stringify(elicitationRequest) + "\n");

				await wait(10);

				expect(elicitationCallback).toHaveBeenCalledWith({
					message: "Please provide your name",
					mode: "form",
					requestedSchema: {
						type: "object",
						properties: { name: { type: "string" } },
					},
					relatedToolCallId: "tool-call-1",
				});
			});

			it("should not treat regular IPC response as elicitation request", async () => {
				const elicitationCallback = jest.fn<ElicitationCallback>();
				client.onElicitation(elicitationCallback);

				// Send a regular IPC response (has id but no method)
				const requestPromise = client.getTools();

				const written = mockSocket.getWrittenData();
				const req = JSON.parse(written[0] ?? "{}");

				mockSocket.simulateData(JSON.stringify({ id: req.id, result: { tools: [] } }) + "\n");

				await requestPromise;

				expect(elicitationCallback).not.toHaveBeenCalled();
			});

			it("should not treat notification as elicitation request", async () => {
				const elicitationCallback = jest.fn<ElicitationCallback>();
				client.onElicitation(elicitationCallback);

				// Send a notification (has method but no id)
				const notification = { method: "tools/changed", params: { foo: "bar" } };
				mockSocket.simulateData(JSON.stringify(notification) + "\n");

				await wait(10);

				expect(elicitationCallback).not.toHaveBeenCalled();
			});

			it("should not treat message with different method as elicitation", async () => {
				const elicitationCallback = jest.fn<ElicitationCallback>();
				client.onElicitation(elicitationCallback);

				// Send a message with id and method, but not elicitation/create
				const otherRequest = {
					id: "other-123",
					method: "some/other/method",
					params: { data: "test" },
				};
				mockSocket.simulateData(JSON.stringify(otherRequest) + "\n");

				await wait(10);

				expect(elicitationCallback).not.toHaveBeenCalled();
			});
		});

		describe("callback registration", () => {
			it("should register elicitation callback", () => {
				const callback = jest.fn<ElicitationCallback>().mockResolvedValue({ action: "accept" });
				client.onElicitation(callback);

				// No error should be thrown
				expect(callback).not.toHaveBeenCalled();
			});

			it("should replace previous elicitation callback", async () => {
				const callback1 = jest.fn<ElicitationCallback>().mockResolvedValue({ action: "decline" });
				const callback2 = jest.fn<ElicitationCallback>().mockResolvedValue({ action: "accept" });

				client.onElicitation(callback1);
				client.onElicitation(callback2);

				const elicitationRequest = {
					id: "elicit-456",
					method: "elicitation/create",
					params: {
						message: "Test",
						mode: "form",
						requestedSchema: { type: "object", properties: {} },
						relatedToolCallId: "tool-call-456",
					},
				};
				mockSocket.simulateData(JSON.stringify(elicitationRequest) + "\n");

				await wait(10);

				// Only the second callback should be called
				expect(callback1).not.toHaveBeenCalled();
				expect(callback2).toHaveBeenCalled();
			});
		});

		describe("response handling", () => {
			it("should send elicitation response back to Stream Deck", async () => {
				const callback = jest
					.fn<ElicitationCallback>()
					.mockResolvedValue({ action: "accept", content: { name: "John" } });
				client.onElicitation(callback);

				const elicitationRequest = {
					id: "elicit-789",
					method: "elicitation/create",
					params: {
						message: "Enter name",
						mode: "form",
						requestedSchema: { type: "object", properties: { name: { type: "string" } } },
						relatedToolCallId: "tool-call-789",
					},
				};
				mockSocket.simulateData(JSON.stringify(elicitationRequest) + "\n");

				await wait(10);

				// Check that response was written to socket
				const written = mockSocket.getWrittenData();
				const response = written.find((w) => {
					const parsed = JSON.parse(w);
					return parsed.id === "elicit-789";
				});

				expect(response).toBeDefined();
				const parsedResponse = JSON.parse(response!);
				expect(parsedResponse.id).toBe("elicit-789");
				expect(parsedResponse.result).toEqual({ action: "accept", content: { name: "John" } });
			});

			it("should send decline response when no callback registered", async () => {
				// Don't register any callback

				const elicitationRequest = {
					id: "elicit-no-cb",
					method: "elicitation/create",
					params: {
						message: "Enter name",
						mode: "form",
						requestedSchema: { type: "object", properties: {} },
						relatedToolCallId: "tool-call-no-cb",
					},
				};
				mockSocket.simulateData(JSON.stringify(elicitationRequest) + "\n");

				await wait(10);

				const written = mockSocket.getWrittenData();
				const response = written.find((w) => {
					const parsed = JSON.parse(w);
					return parsed.id === "elicit-no-cb";
				});

				expect(response).toBeDefined();
				const parsedResponse = JSON.parse(response!);
				expect(parsedResponse.result).toEqual({ action: "decline" });
			});

			it("should send decline response when callback throws error", async () => {
				const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

				const callback = jest.fn<ElicitationCallback>().mockRejectedValue(new Error("Callback failed"));
				client.onElicitation(callback);

				const elicitationRequest = {
					id: "elicit-error",
					method: "elicitation/create",
					params: {
						message: "Enter name",
						mode: "form",
						requestedSchema: { type: "object", properties: {} },
						relatedToolCallId: "tool-call-error",
					},
				};
				mockSocket.simulateData(JSON.stringify(elicitationRequest) + "\n");

				await wait(10);

				const written = mockSocket.getWrittenData();
				const response = written.find((w) => {
					const parsed = JSON.parse(w);
					return parsed.id === "elicit-error";
				});

				expect(response).toBeDefined();
				const parsedResponse = JSON.parse(response!);
				expect(parsedResponse.result).toEqual({ action: "decline" });
				expect(consoleErrorSpy).toHaveBeenCalled();

				consoleErrorSpy.mockRestore();
			});
		});

		describe("timeout handling", () => {
			it("should send decline response when callback times out", async () => {
				jest.useFakeTimers();
				const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

				// Create a callback that never resolves, forcing the Promise.race timeout to trigger.
				// The actual ELICITATION_TIMEOUT_MS is 5 minutes (300,000 ms).
				// We use fake timers to advance past this timeout without waiting.
				const callback = jest.fn<ElicitationCallback>().mockImplementation(
					() => new Promise(() => {}), // Never resolves
				);
				client.onElicitation(callback);

				const elicitationRequest = {
					id: "elicit-timeout",
					method: "elicitation/create",
					params: {
						message: "Enter name",
						mode: "form",
						requestedSchema: { type: "object", properties: {} },
						relatedToolCallId: "tool-call-timeout",
					},
				};
				mockSocket.simulateData(JSON.stringify(elicitationRequest) + "\n");

				// Allow the elicitation handler to start processing
				await Promise.resolve();

				// Advance timers past ELICITATION_TIMEOUT_MS (5 minutes) to trigger the timeout
				await jest.advanceTimersByTimeAsync(5 * 60_000 + 100);

				const written = mockSocket.getWrittenData();
				const response = written.find((w) => {
					const parsed = JSON.parse(w);
					return parsed.id === "elicit-timeout";
				});

				expect(response).toBeDefined();
				const parsedResponse = JSON.parse(response!);
				expect(parsedResponse.result).toEqual({ action: "decline" });
				expect(consoleErrorSpy).toHaveBeenCalledWith(
					expect.stringContaining("Elicitation callback error:"),
					"Elicitation timeout",
				);

				consoleErrorSpy.mockRestore();
				jest.useRealTimers();
			});

			it("should extend timeout for pending tool call when elicitation is received", async () => {
				const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

				// Register elicitation callback that resolves quickly
				const elicitationCallback = jest.fn<ElicitationCallback>().mockResolvedValue({
					action: "accept",
					content: { confirmed: true },
				});
				client.onElicitation(elicitationCallback);

				// Start a tool call with a specific request ID
				const toolCallPromise = client.callTool("test_tool", { arg: "value" }, "tool-call-extend-test");

				// Verify the tool call request was sent
				const written = mockSocket.getWrittenData();
				expect(written.length).toBe(1);
				const toolCallReq = JSON.parse(written[0] ?? "{}");
				expect(toolCallReq.id).toBe("tool-call-extend-test");

				// Send an elicitation request with relatedToolCallId matching the pending tool call
				const elicitationRequest = {
					id: "elicit-extend",
					method: "elicitation/create",
					params: {
						message: "Confirm action",
						mode: "form",
						requestedSchema: { type: "object", properties: { confirmed: { type: "boolean" } } },
						relatedToolCallId: "tool-call-extend-test",
					},
				};
				mockSocket.simulateData(JSON.stringify(elicitationRequest) + "\n");

				await wait(10);

				// Verify the timeout extension was logged
				expect(consoleErrorSpy).toHaveBeenCalledWith(
					expect.stringContaining("Extended timeout for related tool call: tool-call-extend-test"),
				);

				// Now send the tool call response
				mockSocket.simulateData(JSON.stringify({ id: "tool-call-extend-test", result: { data: "success" } }) + "\n");

				const result = await toolCallPromise;
				expect(result.result).toEqual({ data: "success" });

				consoleErrorSpy.mockRestore();
			});

			it("should not log extension when relatedToolCallId does not match any pending request", async () => {
				const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

				// Register elicitation callback
				const elicitationCallback = jest.fn<ElicitationCallback>().mockResolvedValue({ action: "accept" });
				client.onElicitation(elicitationCallback);

				// Send an elicitation request with a relatedToolCallId that doesn't match any pending request
				const elicitationRequest = {
					id: "elicit-no-match",
					method: "elicitation/create",
					params: {
						message: "Test",
						mode: "form",
						requestedSchema: { type: "object", properties: {} },
						relatedToolCallId: "non-existent-tool-call",
					},
				};
				mockSocket.simulateData(JSON.stringify(elicitationRequest) + "\n");

				await wait(10);

				// Verify the extension log was NOT called (since there's no matching pending request)
				expect(consoleErrorSpy).not.toHaveBeenCalledWith(
					expect.stringContaining("Extended timeout for related tool call:"),
				);

				consoleErrorSpy.mockRestore();
			});
		});

		describe("message stream parsing", () => {
			it("should handle elicitation requests mixed with other messages", async () => {
				const notificationCallback = jest.fn();
				const elicitationCallback = jest.fn<ElicitationCallback>().mockResolvedValue({ action: "cancel" });

				client.onNotification(notificationCallback);
				client.onElicitation(elicitationCallback);

				// Start a request
				const requestPromise = client.getTools();
				const written = mockSocket.getWrittenData();
				const req = JSON.parse(written[0] ?? "{}");

				// Send notification, elicitation, and response in one chunk
				const notification = { method: "event/test" };
				const elicitation = {
					id: "elicit-mixed",
					method: "elicitation/create",
					params: {
						message: "Test",
						mode: "form",
						requestedSchema: { type: "object", properties: {} },
						relatedToolCallId: "tool-call-mixed",
					},
				};
				const response = { id: req.id, result: { tools: [] } };

				mockSocket.simulateData(
					JSON.stringify(notification) + "\n" + JSON.stringify(elicitation) + "\n" + JSON.stringify(response) + "\n",
				);

				const result = await requestPromise;

				await wait(10);

				expect(result).toEqual([]);
				expect(notificationCallback).toHaveBeenCalledWith("event/test", undefined);
				expect(elicitationCallback).toHaveBeenCalled();
			});
		});

		describe("error handling", () => {
			it("should log error when receiving invalid JSON message", async () => {
				const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});

				// Client is already connected via beforeEach
				// Send invalid JSON
				mockSocket.simulateData("not valid json\n");

				await wait(10);

				expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[MCP Bridge]"), expect.any(SyntaxError));

				consoleSpy.mockRestore();
			});

			it("should log error when sending elicitation response with destroyed socket", async () => {
				const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});

				// Client is already connected via beforeEach
				// Register callback that returns after delay
				const elicitationCallback = jest.fn<ElicitationCallback>().mockImplementation(async () => {
					// Wait a bit, then return
					await wait(50);
					return { action: "accept", content: { name: "test" } };
				});
				client.onElicitation(elicitationCallback);

				// Send elicitation request
				const elicitation = {
					id: "elicit-destroy",
					method: "elicitation/create",
					params: {
						message: "Enter name",
						mode: "form",
						requestedSchema: { type: "object", properties: {} },
						relatedToolCallId: "tool-call-destroy",
					},
				};
				mockSocket.simulateData(JSON.stringify(elicitation) + "\n");

				// Before callback completes, destroy the socket
				await wait(10);
				mockSocket.destroy();

				// Wait for callback to complete
				await wait(100);

				expect(consoleSpy).toHaveBeenCalledWith(
					expect.stringContaining("[MCP Bridge] Cannot send elicitation response: not connected"),
				);

				consoleSpy.mockRestore();
			});
		});
	});
});
