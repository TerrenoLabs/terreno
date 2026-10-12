import {createMcpExpressApp} from "@modelcontextprotocol/express";
import {toNodeHandler} from "@modelcontextprotocol/node";
import {createMcpHandler, McpServer} from "@modelcontextprotocol/server";
import * as Sentry from "@sentry/bun";
import {logger} from "@terreno/api";
import type {Express, RequestHandler} from "express";
import {handlePromptRequest, prompts} from "./prompts.js";
import {createMcpRateLimitMiddleware, type McpRateLimitConfig} from "./rateLimit.js";
import {resources} from "./resources.js";
import {handleToolCall, tools} from "./tools.js";

const createServer = (): McpServer => {
  const server = Sentry.wrapMcpServerWithSentry(
    new McpServer(
      {
        name: "terreno-mcp",
        version: "1.0.0",
      },
      {
        capabilities: {
          prompts: {},
          resources: {},
          tools: {},
        },
      }
    )
  );

  server.server.setRequestHandler("resources/list", async () => {
    return {
      resources: resources.map((r) => ({
        description: r.description,
        mimeType: r.mimeType,
        name: r.name,
        uri: r.uri,
      })),
    };
  });

  server.server.setRequestHandler("resources/read", async (request) => {
    logger.info("MCP ReadResource", {uri: request.params.uri});
    const resource = resources.find((r) => r.uri === request.params.uri);
    if (!resource) {
      throw new Error(`Resource not found: ${request.params.uri}`);
    }
    return {
      contents: [
        {
          mimeType: resource.mimeType,
          text: resource.content,
          uri: resource.uri,
        },
      ],
    };
  });

  server.server.setRequestHandler("tools/list", async () => {
    return {tools};
  });

  server.server.setRequestHandler("tools/call", async (request) => {
    logger.info("MCP CallTool", {arguments: request.params.arguments, name: request.params.name});
    return await handleToolCall(request.params.name, request.params.arguments ?? {});
  });

  server.server.setRequestHandler("prompts/list", async () => {
    return {
      prompts: prompts.map((p) => ({
        arguments: p.arguments,
        description: p.description,
        name: p.name,
      })),
    };
  });

  server.server.setRequestHandler("prompts/get", async (request) => {
    logger.info("MCP GetPrompt", {arguments: request.params.arguments, name: request.params.name});
    return handlePromptRequest(request.params.name, request.params.arguments ?? {});
  });

  return server;
};

const handleMcpError = (error: Error): void => {
  Sentry.captureException(error);
  logger.error("Error handling MCP request", {error});
};

export interface McpHttpAppOptions {
  host: string;
  /** Per-IP limit on the JSON-RPC routes (`/mcp` and `POST /`). */
  rateLimit: McpRateLimitConfig;
  /** Reverse-proxy hops to trust for `req.ip`; see `resolveTrustProxyHops`. Default 0. */
  trustProxyHops?: number;
  /** Test-only clock for the rate limiter. */
  now?: () => number;
}

/** Builds the hosted MCP Express app (JSON-RPC routes plus the `GET /` health check). */
export const createMcpHttpApp = ({
  host,
  now,
  rateLimit,
  trustProxyHops = 0,
}: McpHttpAppOptions): Express => {
  const app = createMcpExpressApp({host});
  app.set("trust proxy", trustProxyHops > 0 ? trustProxyHops : false);

  const handler = createMcpHandler(createServer, {
    legacy: "stateless",
    onerror: handleMcpError,
    responseMode: "auto",
  });
  const nodeHandler = toNodeHandler(handler);
  // One limiter instance so `/mcp` and `POST /` count against the same per-IP bucket.
  const rateLimitMiddleware = createMcpRateLimitMiddleware({...rateLimit, now});

  const handleJsonRpc: RequestHandler = (req, res) => {
    void nodeHandler(req, res, req.body);
  };

  app.all("/mcp", ...rateLimitMiddleware, handleJsonRpc);
  app.post("/", ...rateLimitMiddleware, handleJsonRpc);
  app.get("/", (_req, res) => {
    res.status(200).json({
      mcpEndpoint: "/mcp",
      service: "terreno-mcp",
      status: "ok",
    });
  });

  return app;
};
