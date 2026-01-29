/**
 * Stream Deck MCP Bridge - Type Definitions
 *
 * Protocol types for communication between MCP clients and Stream Deck IPC.
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
}

/**
 * Resources subscribe request.
 */
export interface ResourcesSubscribeRequest extends RequestBase {
	method: "resources_subscribe";
	uri: string;
}

/**
 * Resources unsubscribe request.
 */
export interface ResourcesUnsubscribeRequest extends RequestBase {
	method: "resources_unsubscribe";
	uri: string;
}

/**
 * Union type for all IPC requests.
 */
export type IpcRequest =
	| CallToolRequest
	| ResourcesListRequest
	| ResourcesReadRequest
	| ResourcesSubscribeRequest
	| ResourcesUnsubscribeRequest
	| ServerInfoRequest
	| ToolsListRequest;

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
export type Role = 'assistant' | 'user';

/**
 * Resource annotations providing hints about resource behavior.
 */
export interface Annotations {
	audience?: Role[];
	priority?: number;
	lastModified?: string;
}

/**
 * Tool definition from Stream Deck.
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
 * Resource definition from Stream Deck.
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
}

/**
 * Server info from Stream Deck.
 */
export interface ServerInfo {
	name: string;
	version: string;
	title?: string;
	icons?: McpIcon[];
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
 */
export interface CallToolResult {
	data?: unknown;
	error?: string;
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
 * Resources read result from Stream Deck.
 * Note: Stream Deck returns a single resource with `content` (object),
 * which must be converted to MCP's `contents` array format.
 */
export interface ResourcesReadResult {
	uri: string;
	mimeType: string;
	content: unknown;
}

/**
 * Resources read response.
 */
export interface ResourcesReadResponse extends ResponseBase {
	result?: ResourcesReadResult;
}

/**
 * Resources subscribe/unsubscribe response (empty result on success).
 */
export interface ResourcesSubscribeResponse extends ResponseBase {
	result?: Record<string, never>;
}

/**
 * Union type for all IPC responses.
 */
export type IpcResponse =
	| CallToolResponse
	| ResourcesListResponse
	| ResourcesReadResponse
	| ResourcesSubscribeResponse
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
 * Notification from Stream Deck (one-way message without id).
 */
export interface Notification {
	method: string;
	params?: unknown;
}

/**
 * Callback function type for handling notifications from Stream Deck.
 */
export type NotificationCallback = (method: string, params?: unknown) => void;

/**
 * Transport mode for the MCP server.
 */
export type TransportMode = "http" | "stdio";

/**
 * CLI options parsed from command line arguments.
 */
export interface CliOptions {
	transport: TransportMode;
	port: number;
	ngrok: boolean;
	help: boolean;
}
