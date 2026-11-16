/**
 * Grant enforcement for MCP OAuth tokens: decides which tools a token may see and call from the
 * scopes it was granted and the app's resolved `mcpOAuth.grants`.
 */
import type {RequestCredential} from "../requestContext";
import type {McpOAuthGrant} from "./oauthMetadata";
import type {MCPToolDefinition} from "./toolGenerator";

export interface CanUseMcpToolOptions {
  /** The tool being listed or called. Only its `access` and `scope` are read. */
  tool: Pick<MCPToolDefinition, "access" | "scope">;
  /** How the caller authenticated. Only `oauth` credentials are limited by grants. */
  credential: RequestCredential | undefined;
  /** Scopes on the caller's OAuth access token. */
  tokenScopes: string[] | undefined;
  /** Resolved `mcpOAuth.grants`, or undefined when the app does not enforce grants. */
  grants: McpOAuthGrant[] | undefined;
}

/**
 * True when the caller may see and call `tool`.
 *
 * - Credentials other than an OAuth token, and apps without `grants`, may use every tool.
 * - A tool that declares `scope` requires exactly that scope on the token.
 * - A `read` tool needs a granted scope whose grant has `read` or `write` access (write implies
 *   read); a `write` tool needs a granted scope whose grant has `write` access.
 * - Token scopes that match no grant (for example the legacy `mcp` scope) allow nothing.
 */
export const canUseMcpTool = ({
  tool,
  credential,
  tokenScopes,
  grants,
}: CanUseMcpToolOptions): boolean => {
  if (credential !== "oauth" || !grants) {
    return true;
  }
  const scopes = tokenScopes ?? [];
  if (tool.scope) {
    return scopes.includes(tool.scope);
  }
  const grantedAccess = grants
    .filter((grant) => scopes.includes(grant.scope))
    .map((grant) => grant.access);
  if (tool.access === "read") {
    return grantedAccess.length > 0;
  }
  return grantedAccess.includes("write");
};
