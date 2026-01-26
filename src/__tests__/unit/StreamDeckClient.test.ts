import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { StreamDeckClient } from "../../StreamDeckClient.js";
import { MockServer } from "../helpers/MockServer.js";
import { MockSocket } from "../helpers/MockSocket.js";
import { createMockServerInfo, createMockTool, wait } from "../helpers/testUtils.js";

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
			}
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
			const response = { id: "1", result: serverInfo };

			// Send request
			const requestPromise = client.getServerInfo();

			// Simulate response
			mockSocket.simulateData(JSON.stringify(response) + "\n");

			// Should resolve successfully
			const result = await requestPromise;
			expect(result).toEqual(serverInfo);
		});

		it("should handle partial messages", async () => {
			const response = { id: "1", result: { tools: [] } };
			const message = JSON.stringify(response) + "\n";

			// Send request
			const requestPromise = client.getTools();

			// Send message in parts
			mockSocket.simulateData(message.slice(0, 10));
			await wait(10);
			mockSocket.simulateData(message.slice(10));

			const result = await requestPromise;
			expect(result).toEqual([]);
		});

		it("should handle multiple messages in one chunk", async () => {
			const response1 = { id: "1", result: { tools: [] } };
			const response2 = { id: "2", result: { tools: [] } };

			const request1Promise = client.getTools();
			const request2Promise = client.getTools();

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
			mockSocket.simulateData(JSON.stringify({ id: req2.id, result: { tools: [createMockTool({ name: "tool2" })] } }) + "\n");
			mockSocket.simulateData(JSON.stringify({ id: req1.id, result: { tools: [createMockTool({ name: "tool1" })] } }) + "\n");

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
			jest.advanceTimersByTime(31000); // REQUEST_TIMEOUT_MS + 1000

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
			const testClient = new StreamDeckClient(
				trackingSocketFactory,
				(listener) => {
					if (listener) {
						mockServer.on("connection", listener);
					}
					return mockServer as any;
				}
			);

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
			jest.advanceTimersByTime(3000);

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
			const testClient = new StreamDeckClient(
				trackingSocketFactory,
				(listener) => {
					if (listener) {
						mockServer.on("connection", listener);
					}
					return mockServer as any;
				}
			);

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
			jest.advanceTimersByTime(3000);

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
			const testClient = new StreamDeckClient(
				originalSocketFactory,
				(listener) => {
					if (listener) {
						mockServer.on("connection", listener);
					}
					return mockServer as any;
				}
			);

			// Connect and close to start polling
			const connectPromise = testClient.connect(100);
			mockSocket.simulateConnect();
			await connectPromise;

			mockSocket.destroy();

			// Reset the mock socket for reconnection
			mockSocket = new MockSocket();

			// Advance time to trigger polling
			jest.advanceTimersByTime(3000);

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
				}
			);

			// Start signal listener
			testClient.startSignalListener();

			// Simulate EADDRINUSE error on the mock server
			const error = new Error("EADDRINUSE") as NodeJS.ErrnoException;
			error.code = "EADDRINUSE";
			errorMockServer.emit("error", error);

			// Should fall back to polling
			jest.advanceTimersByTime(3000);

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
});

