import {AsyncLocalStorage} from "node:async_hooks";
import {toNodeHandler} from "@modelcontextprotocol/node";
import {createMcpHandler, McpServer} from "@modelcontextprotocol/server";
import type {Application, NextFunction, Request, Response} from "express";

import type {User, UserModel} from "../auth";
import type {BetterAuthInstance} from "../betterAuthSetup";
import {logger} from "../logger";
import {setRequestContext} from "../requestContext";
import {
  filterEnabledMcpTools,
  type McpToolCallRecord,
  type ResolvedMcpRequestLogOptions,
  recordMcpToolCall,
  syncMcpToolSettings,
} from "./adminTracking";
import {extractAuthFromHeaders, type MCPAuthContext, type MCPAuthResult} from "./auth";
import {type ResolvedMcpOAuthOptions, sendMcpOAuthChallenge} from "./oauthMetadata";
import {getAllMCPTools, type MCPToolDefinition} from "./toolGenerator";

export interface MCPServerOptions {
  userModel: UserModel;
  betterAuth?: BetterAuthInstance;
  mcpServiceTokens?: boolean;
  /**
   * Resolved `mcpOAuth` options. When set, `/mcp` accepts OAuth access tokens and answers a
   * request without valid credentials with a 401 RFC 9728 challenge.
   */
  mcpOAuth?: ResolvedMcpOAuthOptions;
  /** When set, each tool call writes a metadata-only `McpRequestLog` row. */
  requestLog?: ResolvedMcpRequestLogOptions;
  /**
   * When true, tools are registered in `McpToolSetting` on mount and tools an admin turned off
   * are left out of `tools/list` and `tools/call`.
   */
  toolSettings?: boolean;
}

// Auth is resolved once in the Express handler (which may answer 401) and read back by the
// per-request MCP server factory, which only sees the request's headers.
const mcpAuthStorage = new AsyncLocalStorage<{auth?: MCPAuthResult}>();

export const mountMCPServer = (app: Application, options: MCPServerOptions): void => {
  const tools = getAllMCPTools();
  if (tools.length === 0) {
    return;
  }
  const authContext: MCPAuthContext = {
    betterAuth: options.betterAuth,
    mcpOAuth: Boolean(options.mcpOAuth),
    mcpServiceTokens: options.mcpServiceTokens,
    userModel: options.userModel,
  };

  logger.info(`Mounting MCP server with ${tools.length} tools at /mcp`);

  if (options.toolSettings) {
    void syncMcpToolSettings(tools).catch((error: unknown) => {
      logger.warn(`[mcp] Could not register tools in McpToolSetting: ${String(error)}`);
    });
  }

  const buildServer = async (auth: MCPAuthResult | undefined): Promise<McpServer> => {
    const served = options.toolSettings ? await filterEnabledMcpTools(tools) : tools;
    const onToolCall = options.requestLog
      ? (record: Omit<McpToolCallRecord, "auth">): void => {
          recordMcpToolCall({...record, auth}, options.requestLog as ResolvedMcpRequestLogOptions);
        }
      : undefined;
    return createMcpServerInstance(served, auth?.user, onToolCall);
  };

  // The 2026-07-28 handler is stateless: it creates one server per request and also serves
  // 2025-era clients through the SDK's stateless legacy fallback.
  const handler = createMcpHandler(
    async ({requestInfo}) => {
      const stored = mcpAuthStorage.getStore();
      if (stored) {
        return buildServer(stored.auth);
      }
      const headers: Record<string, string> = {};
      requestInfo?.headers.forEach((value, key) => {
        headers[key] = value;
      });
      const auth = await extractAuthFromHeaders(headers, authContext);
      recordMcpAuth(auth);
      return buildServer(auth);
    },
    {
      legacy: "stateless",
      onerror: (error) => logger.catch(error),
      responseMode: "auto",
    }
  );
  const nodeHandler = toNodeHandler(handler);

  app.all("/mcp", async (req: Request, res: Response, next: NextFunction) => {
    let auth: MCPAuthResult | undefined;
    try {
      auth = await extractAuthFromHeaders(req.headers, authContext);
    } catch (error) {
      next(error);
      return;
    }
    if (!auth && options.mcpOAuth) {
      sendMcpOAuthChallenge(res, options.mcpOAuth, {
        invalidToken: Boolean(req.headers.authorization),
      });
      return;
    }
    recordMcpAuth(auth);
    // express.json() consumed the request stream, so pass its parsed body explicitly.
    mcpAuthStorage.run({auth}, () => {
      void nodeHandler(req, res, req.body);
    });
  });
};

/** Permission functions and hooks read the caller's credential type from the request context. */
const recordMcpAuth = (auth: MCPAuthResult | undefined): void => {
  if (!auth?.user.id) {
    setRequestContext({credential: undefined, oauthScopes: undefined});
    return;
  }
  setRequestContext({
    credential: auth.credential,
    oauthScopes: auth.credential === "oauth" ? auth.scopes : undefined,
    userId: auth.user.id,
  });
};

const errorName = (error: unknown): string => {
  if (error instanceof Error) {
    return error.name;
  }
  return typeof error;
};

const createMcpServerInstance = (
  tools: MCPToolDefinition[],
  user?: User,
  onToolCall?: (record: Omit<McpToolCallRecord, "auth">) => void
): McpServer => {
  const server = new McpServer(
    {
      name: "terreno-api-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register each tool with the MCP server
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.zodSchema,
      },
      async (args: unknown) => {
        if (!onToolCall) {
          return tool.handler(args as Record<string, unknown>, user);
        }
        const startedAt = performance.now();
        try {
          const result = await tool.handler(args as Record<string, unknown>, user);
          onToolCall({
            durationMs: performance.now() - startedAt,
            outcome: result.isError ? "tool_error" : "ok",
            toolName: tool.name,
          });
          return result;
        } catch (error) {
          onToolCall({
            durationMs: performance.now() - startedAt,
            errorName: errorName(error),
            outcome: "exception",
            toolName: tool.name,
          });
          throw error;
        }
      }
    );
  }

  return server;
};
