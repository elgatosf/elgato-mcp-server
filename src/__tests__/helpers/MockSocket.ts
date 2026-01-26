import { EventEmitter } from "node:events";

/**
 * Mock implementation of net.Socket for testing.
 */
export class MockSocket extends EventEmitter {
	public destroyed = false;
	public writable = true;
	public readable = true;
	public ended = false;
	private writeBuffer: string[] = [];

	/**
	 * Simulates writing data to the socket.
	 */
	public write(data: string): boolean {
		if (this.destroyed) {
			throw new Error("Cannot write to destroyed socket");
		}
		this.writeBuffer.push(data);
		return true;
	}

	/**
	 * Simulates destroying the socket.
	 */
	public destroy(): void {
		this.destroyed = true;
		this.writable = false;
		this.readable = false;
		this.emit("close");
	}

	/**
	 * Simulates ending the socket connection.
	 */
	public end(): void {
		this.ended = true;
		this.writable = false;
		this.emit("end");
	}

	/**
	 * Simulates receiving data on the socket.
	 */
	public simulateData(data: string): void {
		if (!this.destroyed) {
			this.emit("data", Buffer.from(data));
		}
	}

	/**
	 * Simulates a connection event.
	 */
	public simulateConnect(): void {
		this.emit("connect");
	}

	/**
	 * Simulates an error event.
	 */
	public simulateError(error: Error): void {
		this.emit("error", error);
	}

	/**
	 * Simulates a close event (socket closed by remote end).
	 */
	public simulateClose(): void {
		this.destroyed = true;
		this.writable = false;
		this.readable = false;
		this.emit("close");
	}

	/**
	 * Gets all written data.
	 */
	public getWrittenData(): string[] {
		return [...this.writeBuffer];
	}

	/**
	 * Gets the last written data.
	 */
	public getLastWritten(): string | undefined {
		return this.writeBuffer[this.writeBuffer.length - 1];
	}

	/**
	 * Clears the write buffer.
	 */
	public clearWriteBuffer(): void {
		this.writeBuffer = [];
	}
}

