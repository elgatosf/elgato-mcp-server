import type { JSONRPCMessage, MessageExtraInfo } from "@modelcontextprotocol/sdk/types.js";
import type { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";

/**
 * Mock implementation of Transport for testing MCP protocol handlers.
 * Based on the pattern from MockSocket.ts but implementing the MCP Transport interface.
 */
export class MockTransport implements Transport {
	private outgoingMessages: JSONRPCMessage[] = [];
	private started = false;
	private closed = false;

	// Transport interface callbacks
	public onclose?: () => void;
	public onerror?: (error: Error) => void;
	public onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void;
	public sessionId?: string;

	/**
	 * Starts the transport (required by Transport interface).
	 */
	async start(): Promise<void> {
		this.started = true;
	}

	/**
	 * Sends a JSON-RPC message (captures outgoing messages from the server).
	 */
	async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
		if (this.closed) {
			throw new Error("Cannot send on closed transport");
		}
		this.outgoingMessages.push(message);
	}

	/**
	 * Closes the transport.
	 */
	async close(): Promise<void> {
		this.closed = true;
		this.onclose?.();
	}

	/**
	 * Sets the protocol version (optional Transport method).
	 */
	setProtocolVersion?(version: string): void {
		// No-op for mock
	}

	// Test helper methods below

	/**
	 * Simulates receiving an incoming JSON-RPC message from a client.
	 * This triggers the server's handler.
	 */
	simulateIncomingMessage<T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo): void {
		if (this.closed) {
			throw new Error("Cannot receive on closed transport");
		}
		this.onmessage?.(message, extra);
	}

	/**
	 * Gets all outgoing messages sent by the server.
	 */
	getOutgoingMessages(): JSONRPCMessage[] {
		return [...this.outgoingMessages];
	}

	/**
	 * Gets the last outgoing message.
	 */
	getLastOutgoingMessage(): JSONRPCMessage | undefined {
		return this.outgoingMessages[this.outgoingMessages.length - 1];
	}

	/**
	 * Waits for the next outgoing message with timeout.
	 */
	async waitForOutgoingMessage(timeoutMs = 1000): Promise<JSONRPCMessage> {
		const startTime = Date.now();
		const initialCount = this.outgoingMessages.length;

		return new Promise((resolve, reject) => {
			const check = () => {
				if (this.outgoingMessages.length > initialCount) {
					resolve(this.outgoingMessages[this.outgoingMessages.length - 1]!);
				} else if (Date.now() - startTime > timeoutMs) {
					reject(new Error("Timeout waiting for outgoing message"));
				} else {
					setTimeout(check, 10);
				}
			};
			check();
		});
	}

	/**
	 * Clears all captured outgoing messages.
	 */
	clearOutgoingMessages(): void {
		this.outgoingMessages = [];
	}

	/**
	 * Simulates an error on the transport.
	 */
	simulateError(error: Error): void {
		this.onerror?.(error);
	}

	/**
	 * Simulates closing the transport.
	 */
	simulateClose(): void {
		this.closed = true;
		this.onclose?.();
	}

	/**
	 * Checks if transport has started.
	 */
	isStarted(): boolean {
		return this.started;
	}

	/**
	 * Checks if transport is closed.
	 */
	isClosed(): boolean {
		return this.closed;
	}
}
