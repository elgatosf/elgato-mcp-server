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
 * Union type for all IPC requests.
 */
export type IpcRequest = CallToolRequest | ServerInfoRequest | ToolsListRequest;

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
 * Union type for all IPC responses.
 */
export type IpcResponse = CallToolResponse | ResponseBase | ServerInfoResponse | ToolsListResponse;

/**
 * Pending request tracker for request/response correlation.
 */
export interface PendingRequest {
	resolve: (response: ResponseBase) => void;
	reject: (error: Error) => void;
	timeout: NodeJS.Timeout;
}

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
