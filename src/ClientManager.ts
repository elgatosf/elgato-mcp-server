import type { Resource, Tool } from "@modelcontextprotocol/sdk/types.js";

import { DEFAULT_SERVER_INFO, getAppSocketPaths, KNOWN_APPS, SDK_NOTIFICATIONS } from "./constants.js";
import { IpcClient } from "./IpcClient.js";
import type {
	AppDefinition,
	CallToolResponse,
	ClientManagerConfig,
	ElicitationCallback,
	IpcClientConfig,
	NotificationCallback,
	ResourcesReadResult,
	ServerInfo,
} from "./types.js";
import { convertToMcpResources, convertToMcpTools, log, prefixName, unprefixName } from "./utils.js";

/**
 * Factory function type for creating IpcClient instances.
 * Used for dependency injection in tests.
 */
export type IpcClientFactory = (config: IpcClientConfig) => IpcClient;

/**
 * Manages multiple IpcClient instances, aggregating their tools and resources
 * into a unified MCP interface with automatic app-name prefixing.
 *
 * Tools and resources are always prefixed with the app name using the `appname__`
 * convention (e.g. `streamdeck__toggle_light`), regardless of how many clients
 * are connected. This keeps tool names stable as clients connect and disconnect.
 */
export class ClientManager {
	private readonly apps: AppDefinition[];
	private cachedResources: Resource[] = [];
	private cachedTools: Tool[] = [];
	private readonly clientFactory: IpcClientFactory;
	private readonly clients: Map<string, IpcClient> = new Map();
	private elicitationCallback: ElicitationCallback | null = null;
	private notificationCallbacks: NotificationCallback[] = [];
	private notifyResourcesChangedCallbacks: Array<() => Promise<void>> = [];
	private notifyToolsChangedCallbacks: Array<() => Promise<void>> = [];
	private readonly onClientConnectedCallbacks: Array<(name: string) => void> = [];
	private readonly onClientDisconnectedCallbacks: Array<(name: string) => void> = [];
	private resourceOwnership: Map<string, string> = new Map();
	private toolOwnership: Map<string, string> = new Map();

	/**
	 * Creates a new ClientManager instance.
	 * @param config - Optional configuration overriding the default app registry.
	 * @param clientFactory - Optional factory for creating IpcClient instances (for testing).
	 */
	public constructor(config?: ClientManagerConfig, clientFactory?: IpcClientFactory) {
		this.apps = config?.apps ?? KNOWN_APPS;
		this.clientFactory = clientFactory ?? ((cfg) => new IpcClient(cfg));
		this.createClients();
	}

	/**
	 * Names of all currently connected apps.
	 */
	public get connectedClients(): string[] {
		const names: string[] = [];
		for (const [name, client] of this.clients) {
			if (client.isConnected) names.push(name);
		}
		return names;
	}

	/**
	 * Whether any managed client is currently connected.
	 */
	public get isConnected(): boolean {
		for (const client of this.clients.values()) {
			if (client.isConnected) return true;
		}
		return false;
	}

	/**
	 * Invokes a tool on the owning app client. The tool name must be prefixed
	 * (e.g. `streamdeck__toggle_light`).
	 * @param name - Prefixed tool name.
	 * @param args - Arguments to pass to the tool.
	 * @param requestId - Optional correlation request ID.
	 * @returns The tool call response.
	 */
	public async callTool(name: string, args: Record<string, unknown>, requestId?: string): Promise<CallToolResponse> {
		const appName = this.toolOwnership.get(name);
		if (!appName) {
			throw new Error(`Unknown tool: ${name}`);
		}

		const client = this.clients.get(appName);
		if (!client?.isConnected) {
			throw new Error(`App '${appName}' is not connected`);
		}

		const unprefixed = unprefixName(name);
		const bareName = unprefixed?.itemName ?? name;
		return client.callTool(bareName, args, requestId);
	}

	/**
	 * Closes all managed client connections and stops signal listeners.
	 */
	public close(): void {
		for (const client of this.clients.values()) {
			client.disconnect();
		}
	}

	/**
	 * Returns the aggregated list of prefixed MCP-format resources from all connected clients.
	 * @returns Array of prefixed Resource definitions.
	 */
	public getResources(): Resource[] {
		return this.cachedResources;
	}

	/**
	 * Returns the static server info for the MCP bridge.
	 * @returns The default server info.
	 */
	public getServerInfo(): ServerInfo {
		return DEFAULT_SERVER_INFO;
	}

	/**
	 * Returns the aggregated list of prefixed MCP-format tools from all connected clients.
	 * @returns Array of prefixed Tool definitions.
	 */
	public getTools(): Tool[] {
		return this.cachedTools;
	}

	/**
	 * Initializes all managed clients by connecting them and starting their signal listeners.
	 */
	public async initialize(): Promise<void> {
		log.info("ClientManager initializing...");
		const connectPromises = Array.from(this.clients.entries()).map(async ([name, client]) => {
			const connected = await client.connect();
			if (connected) {
				log.info(`Connected to ${name}`);
			} else {
				log.info(`${name} not available, starting in disconnected mode`);
			}
			client.startSignalListener();
		});

		await Promise.all(connectPromises);
		await this.refreshAll();
		log.info(`ClientManager initialized. Connected: [${this.connectedClients.join(", ") || "none"}]`);
	}

	/**
	 * Registers a callback to be invoked when a client app connects or disconnects.
	 * @param callback - Callback receiving the app name.
	 */
	public onClientConnected(callback: (name: string) => void): void {
		this.onClientConnectedCallbacks.push(callback);
	}

	/**
	 * Registers a callback to be invoked when a client app disconnects.
	 * @param callback - Callback receiving the app name.
	 */
	public onClientDisconnected(callback: (name: string) => void): void {
		this.onClientDisconnectedCallbacks.push(callback);
	}

	/**
	 * Registers a callback to handle elicitation requests forwarded from any connected app.
	 * Only one callback can be registered at a time; subsequent calls replace the previous.
	 * @param callback - Async callback that handles the elicitation and returns a response.
	 */
	public onElicitation(callback: ElicitationCallback): void {
		this.elicitationCallback = callback;
	}

	/**
	 * Registers a callback to be invoked when a notification is received from any connected app.
	 * Multiple callbacks can be registered.
	 * @param callback - Callback receiving the method name and optional params.
	 */
	public onNotification(callback: NotificationCallback): void {
		this.notificationCallbacks.push(callback);
	}

	/**
	 * Registers a callback to be invoked when the aggregated resource list changes.
	 * @param callback - Async callback function.
	 */
	public onResourcesChanged(callback: () => Promise<void>): void {
		this.notifyResourcesChangedCallbacks.push(callback);
	}

	/**
	 * Registers a callback to be invoked when the aggregated tool list changes.
	 * @param callback - Async callback function.
	 */
	public onToolsChanged(callback: () => Promise<void>): void {
		this.notifyToolsChangedCallbacks.push(callback);
	}

	/**
	 * Reads a resource by prefixed URI from the owning app client.
	 * @param uri - Prefixed resource URI (e.g. `streamdeck__device://status`).
	 * @returns The resource read result.
	 */
	public async readResource(uri: string): Promise<ResourcesReadResult> {
		const appName = this.resourceOwnership.get(uri);
		if (!appName) {
			throw new Error(`Unknown resource: ${uri}`);
		}

		const client = this.clients.get(appName);
		if (!client?.isConnected) {
			throw new Error(`App '${appName}' is not connected`);
		}

		const unprefixed = unprefixName(uri);
		const bareUri = unprefixed?.itemName ?? uri;
		const result = await client.readResource(bareUri);

		// Re-prefix the returned URI so MCP clients see consistent prefixed URIs
		return { ...result, uri: prefixName(appName, result.uri) };
	}

	/**
	 * Creates IpcClient instances for each configured app and sets up their callbacks.
	 */
	private createClients(): void {
		for (const app of this.apps) {
			const paths = getAppSocketPaths(app);
			const config: IpcClientConfig = {
				name: app.name,
				signalSocketPath: paths.signalSocketPath,
				socketPath: paths.socketPath,
			};
			const client = this.clientFactory(config);
			this.clients.set(app.name, client);
			this.setupClientCallbacks(app.name, client);
		}
	}

	/**
	 * Handles client connection events asynchronously.
	 * Refreshes cached data and notifies all registered callbacks.
	 * @param name - The app name that connected.
	 */
	private async handleClientConnected(name: string): Promise<void> {
		log.info(`${name} connected`);
		await this.refreshAll();
		await this.notifyToolsChanged();
		await this.notifyResourcesChanged();
		for (const cb of this.onClientConnectedCallbacks) {
			cb(name);
		}
	}

	/**
	 * Handles client disconnection events asynchronously.
	 * Refreshes cached data and notifies all registered callbacks.
	 * @param name - The app name that disconnected.
	 */
	private async handleClientDisconnected(name: string): Promise<void> {
		log.info(`${name} disconnected`);
		await this.refreshAll();
		await this.notifyToolsChanged();
		await this.notifyResourcesChanged();
		for (const cb of this.onClientDisconnectedCallbacks) {
			cb(name);
		}
	}

	/**
	 * Handles notifications from a client asynchronously.
	 * Processes list-changed notifications with refresh-then-notify pattern,
	 * and forwards other notifications to registered callbacks.
	 * @param name - The app name that sent the notification.
	 * @param method - The notification method name.
	 * @param params - Optional notification parameters.
	 */
	private async handleClientNotification(name: string, method: string, params?: unknown): Promise<void> {
		// Handle list-changed notifications with refresh-then-notify pattern
		// This ensures cached data is fresh before MCP clients are notified
		if (method === SDK_NOTIFICATIONS.TOOLS_LIST_CHANGED) {
			await this.refreshAll();
			await this.notifyToolsChanged();
			return;
		}
		if (method === SDK_NOTIFICATIONS.RESOURCES_LIST_CHANGED) {
			await this.refreshAll();
			await this.notifyResourcesChanged();
			return;
		}

		// Prefix URI for resource updated notifications so subscriptions can match
		let forwardedParams = params;
		if (method === SDK_NOTIFICATIONS.RESOURCES_UPDATED && params && typeof params === "object") {
			const resourceParams = params as { uri?: string };
			if (resourceParams.uri) {
				forwardedParams = { ...resourceParams, uri: prefixName(name, resourceParams.uri) };
			}
		}

		for (const cb of this.notificationCallbacks) {
			try {
				cb(method, forwardedParams);
			} catch (error) {
				log.error(`Notification callback error for ${name}:`, error);
			}
		}
	}

	/**
	 * Dispatches resource-changed notifications to all registered callbacks.
	 */
	private async notifyResourcesChanged(): Promise<void> {
		for (const callback of this.notifyResourcesChangedCallbacks) {
			try {
				await callback();
			} catch (error) {
				log.error("Failed to notify resources changed:", error);
			}
		}
	}

	/**
	 * Dispatches tool-changed notifications to all registered callbacks.
	 */
	private async notifyToolsChanged(): Promise<void> {
		for (const callback of this.notifyToolsChangedCallbacks) {
			try {
				await callback();
			} catch (error) {
				log.error("Failed to notify tools changed:", error);
			}
		}
	}

	/**
	 * Re-fetches tools and resources from all connected clients and updates the
	 * internal cache and ownership maps.
	 */
	private async refreshAll(): Promise<void> {
		const newTools: Tool[] = [];
		const newResources: Resource[] = [];
		const newToolOwnership = new Map<string, string>();
		const newResourceOwnership = new Map<string, string>();

		for (const [appName, client] of this.clients) {
			if (!client.isConnected) continue;

			try {
				const rawTools = await client.getTools();
				const mcpTools = convertToMcpTools(rawTools);
				for (const tool of mcpTools) {
					const prefixed = prefixName(appName, tool.name);
					newTools.push({ ...tool, name: prefixed });
					newToolOwnership.set(prefixed, appName);
				}
			} catch (error) {
				log.error(`Failed to get tools from ${appName}:`, error);
			}

			try {
				const rawResources = await client.getResources();
				const mcpResources = convertToMcpResources(rawResources);
				for (const resource of mcpResources) {
					const prefixedUri = prefixName(appName, resource.uri);
					newResources.push({ ...resource, uri: prefixedUri });
					newResourceOwnership.set(prefixedUri, appName);
				}
			} catch (error) {
				log.error(`Failed to get resources from ${appName}:`, error);
			}
		}

		// Sort for deterministic ordering to reduce unnecessary change notifications
		this.cachedTools = newTools.sort((a, b) => a.name.localeCompare(b.name));
		this.cachedResources = newResources.sort((a, b) => a.uri.localeCompare(b.uri));
		this.toolOwnership = newToolOwnership;
		this.resourceOwnership = newResourceOwnership;
	}

	/**
	 * Registers lifecycle callbacks on a single IpcClient, wiring its connect/disconnect/
	 * notification/elicitation events into the ClientManager's unified event system.
	 *
	 * Two different callback patterns are used based on how IpcClient invokes them:
	 *
	 * **Fire-and-forget callbacks** (`onConnected`, `onDisconnected`, `onNotification`):
	 * IpcClient invokes these synchronously without awaiting, and ignores return values.
	 * We register sync wrappers that delegate to async handlers with explicit `.catch()`
	 * to prevent unhandled promise rejections.
	 *
	 * **Request/response callback** (`onElicitation`):
	 * IpcClient awaits this callback and needs the returned `ElicitationResponse`.
	 * It's wrapped in try/catch with timeout handling. We register an async callback
	 * directly since IpcClient properly handles the Promise.
	 * @param name - The app name for this client.
	 * @param client - The IpcClient instance to wire up.
	 */
	private setupClientCallbacks(name: string, client: IpcClient): void {
		// Fire-and-forget: IpcClient calls these synchronously, ignores return values
		client.onConnected(() => {
			void this.handleClientConnected(name).catch((error) => {
				log.error(`Error handling client connection for ${name}:`, error);
			});
		});

		client.onDisconnected(() => {
			void this.handleClientDisconnected(name).catch((error) => {
				log.error(`Error handling client disconnection for ${name}:`, error);
			});
		});

		client.onNotification((method, params) => {
			void this.handleClientNotification(name, method, params).catch((error) => {
				log.error(`Error handling notification for ${name}:`, error);
			});
		});

		// Request/response: IpcClient awaits this and needs the returned ElicitationResponse
		client.onElicitation(async (params) => {
			if (!this.elicitationCallback) {
				return { action: "decline" };
			}
			return this.elicitationCallback(params);
		});
	}
}
