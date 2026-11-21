import {describe, expect, it} from "bun:test";

import {canUseMcpTool} from "./grantAccess";
import {MCP_OAUTH_GRANT_PRESETS, type McpOAuthGrant} from "./oauthMetadata";
import type {MCPToolDefinition} from "./toolGenerator";

const readTool = {access: "read"} as unknown as MCPToolDefinition;
const writeTool = {access: "write"} as unknown as MCPToolDefinition;
const scopedWriteTool = {access: "write", scope: "todos:admin"} as unknown as MCPToolDefinition;
const scopedReadTool = {access: "read", scope: "todos:admin"} as unknown as MCPToolDefinition;

const readWrite: McpOAuthGrant[] = [...MCP_OAUTH_GRANT_PRESETS.readWrite];
const readOnly: McpOAuthGrant[] = [...MCP_OAUTH_GRANT_PRESETS.readOnly];
const custom: McpOAuthGrant[] = [
  ...readWrite,
  {access: "write", label: "Todo admin", scope: "todos:admin"},
  {access: "read", label: "Todo viewer", scope: "todos:view"},
];

const allowed = (
  tool: MCPToolDefinition,
  tokenScopes: string[],
  grants: McpOAuthGrant[] | undefined = readWrite,
  credential = "oauth"
): boolean => canUseMcpTool({credential, grants, tokenScopes, tool} as never);

describe("canUseMcpTool", () => {
  describe("credentials and apps outside grant enforcement", () => {
    it.each(["jwt", "better-auth-session", "mcp-service-token"])(
      "allows a %s credential every tool even with no scopes",
      (credential) => {
        expect(allowed(writeTool, [], readWrite, credential)).toBe(true);
        expect(allowed(scopedWriteTool, [], readWrite, credential)).toBe(true);
      }
    );

    it("allows an oauth token every tool when grants is undefined", () => {
      // Call directly: passing undefined to allowed() would apply its readWrite default
      const call = (tool: MCPToolDefinition, tokenScopes: string[]): boolean =>
        canUseMcpTool({credential: "oauth", grants: undefined, tokenScopes, tool});
      expect(call(writeTool, ["mcp"])).toBe(true);
      expect(call(scopedWriteTool, [])).toBe(true);
    });
  });

  describe("untagged tools", () => {
    it("lets mcp:read use a read tool but not a write tool", () => {
      expect(allowed(readTool, ["mcp:read"])).toBe(true);
      expect(allowed(writeTool, ["mcp:read"])).toBe(false);
    });

    it("lets mcp:write use read and write tools (write implies read)", () => {
      expect(allowed(readTool, ["mcp:write"])).toBe(true);
      expect(allowed(writeTool, ["mcp:write"])).toBe(true);
    });

    it("lets mcp:read mcp:write use a write tool", () => {
      expect(allowed(writeTool, ["mcp:read", "mcp:write"])).toBe(true);
    });

    it("allows nothing for a token with no scopes", () => {
      expect(allowed(readTool, [])).toBe(false);
      expect(allowed(writeTool, [])).toBe(false);
    });

    it("allows nothing for a legacy mcp scope that maps to no grant", () => {
      expect(allowed(readTool, ["mcp"])).toBe(false);
      expect(allowed(writeTool, ["mcp"])).toBe(false);
    });

    it("ignores a scope the grants do not define", () => {
      expect(allowed(readTool, ["unknown"])).toBe(false);
      expect(allowed(readTool, ["unknown", "mcp:read"])).toBe(true);
    });

    it("does not let a token claim write under a readOnly preset", () => {
      expect(allowed(writeTool, ["mcp:write"], readOnly)).toBe(false);
      expect(allowed(readTool, ["mcp:read"], readOnly)).toBe(true);
    });

    it("applies a custom write grant's access level to untagged tools", () => {
      expect(allowed(writeTool, ["todos:admin"], custom)).toBe(true);
      expect(allowed(readTool, ["todos:admin"], custom)).toBe(true);
    });

    it("applies a custom read grant's access level to untagged tools", () => {
      expect(allowed(readTool, ["todos:view"], custom)).toBe(true);
      expect(allowed(writeTool, ["todos:view"], custom)).toBe(false);
    });
  });

  describe("tools that declare a scope", () => {
    it("requires exactly that scope", () => {
      expect(allowed(scopedWriteTool, ["todos:admin"], custom)).toBe(true);
      expect(allowed(scopedReadTool, ["todos:admin"], custom)).toBe(true);
    });

    it("refuses a token that only has a broader access grant", () => {
      expect(allowed(scopedWriteTool, ["mcp:read", "mcp:write"], custom)).toBe(false);
      expect(allowed(scopedReadTool, ["mcp:read", "mcp:write"], custom)).toBe(false);
    });

    it("refuses a token with no scopes", () => {
      expect(allowed(scopedReadTool, [], custom)).toBe(false);
    });
  });
});
