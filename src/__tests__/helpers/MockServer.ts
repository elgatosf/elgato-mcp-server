import { EventEmitter } from "node:events";
import type { Socket } from "node:net";

/**
 * Mock implementation of net.Server for testing.
 */
export class MockServer extends EventEmitter {
	private listening = false;
	private connections: Socket[] = [];

	/**
	 * Simulates starting to listen.
	 */
	public listen(path: string, callback?: () => void): this {
		this.listening = true;
		if (callback) {
			setImmediate(callback);
		}
		return this;
	}

	/**
	 * Simulates closing the server.
	 */
	public close(callback?: (err?: Error) => void): this {
		this.listening = false;
		this.connections.forEach((conn) => {
			if ("destroy" in conn && typeof conn.destroy === "function") {
				conn.destroy();
			}
		});
		this.connections = [];
		if (callback) {
			setImmediate(callback);
		}
		return this;
	}

	/**
	 * Simulates a new connection.
	 */
	public simulateConnection(socket: Socket): void {
		if (this.listening) {
			this.connections.push(socket);
			this.emit("connection", socket);
		}
	}

	/**
	 * Gets whether the server is listening.
	 */
	public isListening(): boolean {
		return this.listening;
	}

	/**
	 * Gets all active connections.
	 */
	public getConnections(): Socket[] {
		return [...this.connections];
	}
}

