import {Server} from "@modelcontextprotocol/server";
import {serveStdio} from "@modelcontextprotocol/server/stdio";

import {createLocalToolCallHandler, handleLocalToolCall, localMcpTools} from "./localTools.js";
import type {BrowserToolArgs} from "./tools/browser.js";

interface LocalMcpServerOptions {
  browserRunner?: (args: BrowserToolArgs) => Promise<string>;
}

export const createLocalMcpServer = (options: LocalMcpServerOptions = {}): Server => {
  const callTool = options.browserRunner
    ? createLocalToolCallHandler(options.browserRunner)
    : handleLocalToolCall;
  const server = new Server(
    {
      name: "terreno-mcp-local",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler("tools/list", async () => {
    return {tools: localMcpTools};
  });

  server.setRequestHandler("tools/call", async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    return callTool(name, args);
  });

  return server;
};

export const startLocalMcpServer = async (): Promise<void> => {
  serveStdio(() => createLocalMcpServer(), {legacy: "serve"});
};
