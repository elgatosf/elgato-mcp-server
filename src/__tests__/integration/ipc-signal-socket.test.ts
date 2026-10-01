import * as fs from "node:fs";
import * as net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { IpcClient } from "../../IpcClient.js";
import type { IpcClientConfig } from "../../types.js";
import { MockSocket } from "../helpers/MockSocket.js";
import { wait, waitFor } from "../helpers/testUtils.js";

/**
 * Exercises the ready-signal socket with real Unix sockets: one bridge owns the signal socket,
 * and a second bridge probes it on startup. Named pipes on Windows never take the probe path.
 */
describe.skipIf(process.platform === "win32")("IPC signal socket", () => {
	let dir: string;
	let config: IpcClientConfig;
	let clients: IpcClient[];
	let openedSockets: number;

	/**
	 * Creates a client whose app sockets are mocks, so the test can count connection attempts.
	 * The signal server is a real one.
	 */
	function createClient(): IpcClient {
		const client = new IpcClient(config, () => {
			openedSockets++;
			return new MockSocket() as any;
		});
		clients.push(client);
		return client;
	}

	beforeEach(() => {
		dir = fs.mkdtempSync(join(tmpdir(), "ipc-signal-"));
		config = {
			name: "test-app",
			signalSocketPath: join(dir, "ready.sock"),
			socketPath: join(dir, "app.sock"),
		};
		clients = [];
		openedSockets = 0;
	});

	afterEach(() => {
		for (const client of clients) {
			client.disconnect();
		}
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("should not treat a second bridge's probe as a ready signal", async () => {
		const owner = createClient();
		owner.startSignalListener();
		await waitFor(() => fs.existsSync(config.signalSocketPath));

		// The second bridge gets EADDRINUSE and probes the owner's signal socket.
		const second = new IpcClient(config, () => new MockSocket() as any);
		clients.push(second);
		second.startSignalListener();
		await wait(400);

		expect(openedSockets).toBe(0);
	});

	it("should connect when the app opens and closes the signal socket", async () => {
		const owner = createClient();
		owner.startSignalListener();
		await waitFor(() => fs.existsSync(config.signalSocketPath));

		const signal = net.createConnection(config.signalSocketPath);
		signal.on("connect", () => signal.end());
		await waitFor(() => openedSockets > 0);

		expect(openedSockets).toBe(1);
	});
});
