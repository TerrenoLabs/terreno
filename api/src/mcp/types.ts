import type {HydratedDocument, Model} from "mongoose";

import type {JSONValue, ModelRouterOptions} from "../api";
import type {User} from "../auth";

export type MCPMethod = "create" | "list" | "read" | "update" | "delete";

/** Arguments an MCP client sends for a tool call, validated against the tool's Zod schema. */
export type MCPToolArgs = Record<string, unknown>;

/**
 * The MCP content payload returned by every tool handler. The index signature keeps this
 * structurally compatible with the MCP SDK's CallToolResult, which allows extra fields.
 */
export interface MCPToolResult {
  content: Array<{type: "text"; text: string}>;
  isError?: boolean;
  [key: string]: unknown;
}

/** JSON Schema emitted for a tool's inputs, as sent to MCP clients. */
export interface MCPToolInputSchema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

/**
 * A hydrated document from a consumer's model. The concrete field types are only known
 * at runtime, so handlers work against the Mongoose document API plus an index signature.
 */
export type MCPDocument = HydratedDocument<Record<string, unknown>>;

/**
 * Express-shaped request handed to modelRouter lifecycle hooks, response handlers, and
 * action handlers during an MCP tool call. Built by `createMCPRequest` as a stub: `user` and
 * `body` are populated, and action tools also fill `params.id` (instance actions) and `query`
 * (GET actions). `headers` is always empty — MCP does not forward HTTP request fields.
 */
export interface MCPRequest {
  body: MCPToolArgs;
  /** Always `{}` on MCP paths — not forwarded from HTTP. */
  headers: Record<string, string>;
  /** Lets hooks detect an MCP tool call rather than an HTTP request. */
  isMCPRequest: true;
  method: "MCP";
  params: Record<string, string>;
  query: Record<string, unknown>;
  user?: User;
}

export interface MCPConfig {
  /** Which CRUD methods to expose as MCP tools. Default: ['list', 'read'] */
  methods?: MCPMethod[];
  /** Override auto-generated model description */
  description?: string;
  /**
   * Override the tool name prefix. Tools are named `{prefix}_{method}`, e.g. `todos_list`.
   *
   * Defaults to the lowercase model name run through a simple English pluralizer, which
   * gets common cases right (`Todo` -> `todos`, `Category` -> `categories`, `Status` ->
   * `statuses`) but not irregular nouns. Set this explicitly whenever the default reads
   * wrong, or to namespace tools that would otherwise collide.
   *
   * @example
   * ```typescript
   * mcp: {toolPrefix: "people"} // person_list -> people_list
   * ```
   */
  toolPrefix?: string;
  /**
   * Fields to hide from MCP tool schemas, responses, and create/update persist bodies.
   *
   * A bare field name (`"hash"`) is removed at every depth of the response, including
   * inside arrays and populated refs, so a redacted name cannot leak through a nested
   * document. Use dot notation (`"metadata.secretKey"`) to remove one specific location.
   */
  excludeFields?: string[];
  /** Max items returned by list tool (default: 50) */
  maxLimit?: number;
  /** MCP-specific serialization (separate from REST responseHandler) */
  mcpResponseHandler?: (value: unknown, method: MCPMethod, user?: User) => Promise<JSONValue>;
}

export interface MCPRegistryEntry {
  modelName: string;
  model: Model<unknown>;
  config: MCPConfig;
  options: ModelRouterOptions<unknown>;
}
