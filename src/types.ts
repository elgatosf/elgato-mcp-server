/**
 * Elgato MCP Server - Type Definitions
 *
 * Protocol types for communication between MCP clients and Elgato app IPC.
 */

/**
 * Base interface for all IPC requests.
 */
export interface RequestBase {
	id: string;
	method: string;
}

/**
 * Server info request.
 */
export interface ServerInfoRequest extends RequestBase {
	method: "server_info";
}

/**
 * Tools list request.
 */
export interface ToolsListRequest extends RequestBase {
	method: "tools_list";
}

/**
 * Call tool request.
 */
export interface CallToolRequest extends RequestBase {
	method: "call_tool";
	toolName: string;
	arguments: Record<string, unknown>;
	/** Request metadata forwarded verbatim from the MCP client (e.g. `progressToken`). Omitted when the client sent none. */
	_meta?: Record<string, unknown>;
}

/**
 * Resources list request.
 */
export interface ResourcesListRequest extends RequestBase {
	method: "resources_list";
}

/**
 * Resources read request.
 */
export interface ResourcesReadRequest extends RequestBase {
	method: "resources_read";
	uri: string;
	/** Request metadata forwarded verbatim from the MCP client. Omitted when the client sent none. */
	_meta?: Record<string, unknown>;
}

/**
 * Error structure for MCP responses.
 */
export interface McpError {
	message: string;
	data?: string;
}

/**
 * Icon structure for MCP tools and server info.
 */
export interface McpIcon {
	src: string;
	mimeType?: string;
	sizes?: string[];
	theme?: "dark" | "light";
}

/**
 * Tool annotations providing hints about tool behavior.
 */
export interface ToolAnnotations {
	title?: string;
	readOnlyHint?: boolean;
	destructiveHint?: boolean;
	idempotentHint?: boolean;
	openWorldHint?: boolean;
}

/**
 * The sender or recipient of messages and data in a conversation.
 */
export type Role = "assistant" | "user";

/**
 * Resource annotations providing hints about resource behavior.
 */
export interface Annotations {
	audience?: Role[];
	priority?: number;
	lastModified?: string;
}

/**
 * Tool definition from a connected Elgato app.
 */
export interface McpTool {
	name: string;
	title?: string;
	description?: string;
	inputSchema: Record<string, unknown>;
	outputSchema?: Record<string, unknown>;
	annotations?: ToolAnnotations;
	icons?: McpIcon[];
	_meta?: Record<string, unknown>;
}

/**
 * Resource definition from a connected Elgato app.
 */
export interface McpResource {
	uri: string;
	name: string;
	title?: string;
	description?: string;
	mimeType?: string;
	icons?: McpIcon[];
	annotations?: Annotations;
	_meta?: Record<string, unknown>;
}

/**
 * Base interface for all IPC responses.
 */
export interface ResponseBase {
	id: string;
	result?: unknown;
	error?: McpError;
	/**
	 * Response metadata from the app, a sibling of `result` on the wire; surfaced as
	 * top-level `_meta` on the MCP result.
	 */
	_meta?: Record<string, unknown>;
}

/**
 * Server info from a connected Elgato app.
 */
export interface ServerInfo {
	name: string;
	version: string;
	title?: string;
	icons?: McpIcon[];
	/** LLM-facing usage instructions from the app, surfaced as `InitializeResult.instructions`. */
	instructions?: string;
}

/**
 * Server info response.
 */
export interface ServerInfoResponse extends ResponseBase {
	result?: ServerInfo;
}

/**
 * Tools list result.
 */
export interface ToolsListResult {
	tools: McpTool[];
}

/**
 * Tools list response.
 */
export interface ToolsListResponse extends ResponseBase {
	result?: ToolsListResult;
}

/**
 * Call tool result.
 * Note: The IPC protocol returns the tool's structured payload as the result
 * object itself (there is no `data` wrapper). A non-empty `error` indicates
 * a tool-level failure.
 */
export interface CallToolResult {
	error?: string;
	[key: string]: unknown;
}

/**
 * Call tool response.
 */
export interface CallToolResponse extends ResponseBase {
	result?: CallToolResult;
}

/**
 * Resources list result.
 */
export interface ResourcesListResult {
	resources: McpResource[];
}

/**
 * Resources list response.
 */
export interface ResourcesListResponse extends ResponseBase {
	result?: ResourcesListResult;
}

/**
 * Resources read result from a connected Elgato app.
 * Note: The IPC protocol returns a single resource with `content` (object),
 * which must be converted to MCP's `contents` array format.
 */
export interface ResourcesReadResult {
	uri: string;
	mimeType: string;
	content: unknown;
}

/**
 * A `resources_read` result together with its response-envelope `_meta`.
 * Keeping `_meta` outside `result` mirrors the wire shape and stops it being
 * dropped when callers re-shape the result (e.g. re-prefixing the URI).
 */
export interface ResourcesReadOutcome {
	result: ResourcesReadResult;
	_meta?: Record<string, unknown>;
}

/**
 * Resources read response.
 */
export interface ResourcesReadResponse extends ResponseBase {
	result?: ResourcesReadResult;
}

/**
 * Union type for all IPC responses.
 */
export type IpcResponse =
	| CallToolResponse
	| ResourcesListResponse
	| ResourcesReadResponse
	| ResponseBase
	| ServerInfoResponse
	| ToolsListResponse;

/**
 * Pending request tracker for request/response correlation.
 */
export interface PendingRequest {
	resolve: (response: ResponseBase) => void;
	reject: (error: Error) => void;
	timeout: NodeJS.Timeout;
}

/**
 * Notification from a connected Elgato app (one-way message without id).
 */
export interface Notification {
	method: string;
	params?: unknown;
}

/**
 * Callback function type for handling notifications from a connected Elgato app.
 */
export type NotificationCallback = (method: string, params?: unknown) => void;

/**
 * Parameters for an elicitation request from a connected Elgato app.
 */
export interface ElicitationParams {
	message: string;
	mode: "form";
	requestedSchema: Record<string, unknown>;
	/** The ID of the related tool call, used to route elicitations to the correct MCP session. */
	relatedToolCallId: string;
	/** Request metadata from the app, forwarded to the MCP client on the elicitation request. */
	_meta?: Record<string, unknown>;
}

/**
 * Elicitation request from a connected Elgato app.
 * Unlike regular notifications, elicitation requests have both an id and a method.
 * The id is used to correlate the response back to the originating app.
 */
export interface ElicitationRequest {
	id: string;
	method: "elicitation/create";
	params: ElicitationParams;
}

/**
 * Response to an elicitation request.
 * - "accept": User provided input, content contains the data matching requestedSchema
 * - "cancel": User cancelled the elicitation
 * - "decline": Client doesn't support elicitation or couldn't process the request
 */
export interface ElicitationResponse {
	action: "accept" | "cancel" | "decline";
	content?: Record<string, unknown>;
	/** Response metadata from the MCP client, per the spec's `ElicitResult extends Result`. */
	_meta?: Record<string, unknown>;
}

/**
 * Callback function type for handling elicitation requests from a connected Elgato app.
 * @param params - The elicitation parameters including the relatedToolCallId for routing.
 * Returns a promise that resolves to the user's response.
 */
export type ElicitationCallback = (params: ElicitationParams) => Promise<ElicitationResponse>;

/**
 * Transport mode for the MCP server.
 */
export type TransportMode = "http" | "stdio";

/**
 * Definition of a known app in the predefined registry.
 */
export interface AppDefinition {
	/** Display name used for tool/resource prefixing and logging. */
	name: string;
	/** Base name used to derive platform-specific socket paths. */
	socketBaseName: string;
}

/**
 * CLI options parsed from command line arguments.
 */
export interface CliOptions {
	transport: TransportMode;
	port: number;
	ngrok: boolean;
	help: boolean;
	verbose: boolean;
}

/**
 * Configuration for the ClientManager.
 */
export interface ClientManagerConfig {
	/** List of known apps to connect to. Defaults to KNOWN_APPS from constants. */
	apps?: AppDefinition[];
}

/**
 * Configuration for a single IPC client connection.
 */
export interface IpcClientConfig {
	/** Display name for the app, used for prefixing and logging. */
	name: string;
	/** Signal socket path for reconnection notifications. */
	signalSocketPath: string;
	/** Main IPC socket path. */
	socketPath: string;
}
