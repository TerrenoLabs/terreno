import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import type {Server} from "node:http";
import type {AddressInfo} from "node:net";

import {createMcpHttpApp} from "../httpApp.js";
import {resources} from "../resources.js";

interface JsonRpcResponse {
  error?: {code: number; message: string};
  id: number | string | null;
  result?: Record<string, unknown>;
}

let server: Server;
let baseUrl: string;
let nextId = 1;

const parseRpcBody = (text: string): JsonRpcResponse => {
  const dataLine = text.split("\n").find((line) => line.startsWith("data: "));
  return JSON.parse(dataLine ? dataLine.slice("data: ".length) : text) as JsonRpcResponse;
};

const rpc = async (
  method: string,
  params: Record<string, unknown> = {}
): Promise<JsonRpcResponse> => {
  const response = await fetch(`${baseUrl}/mcp`, {
    body: JSON.stringify({id: nextId++, jsonrpc: "2.0", method, params}),
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-06-18",
    },
    method: "POST",
  });
  expect(response.status).toBe(200);
  return parseRpcBody(await response.text());
};

beforeAll(async () => {
  const app = createMcpHttpApp({host: "127.0.0.1", rateLimit: {max: 0, windowMs: 60_000}});
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

describe("hosted MCP HTTP app", () => {
  test("serves initialize, tools, resources, and prompts over JSON-RPC", async () => {
    const init = await rpc("initialize", {
      capabilities: {},
      clientInfo: {name: "http-app-test", version: "1.0.0"},
      protocolVersion: "2025-06-18",
    });
    expect(init.result?.serverInfo).toMatchObject({name: "terreno-mcp"});

    const toolList = await rpc("tools/list");
    const listedTools = (toolList.result?.tools ?? []) as Array<{name: string}>;
    const toolNames = listedTools.map((tool) => tool.name);
    expect(toolNames).toContain("terreno_generate_model");

    const toolCall = await rpc("tools/call", {
      arguments: {fields: [{name: "title", type: "String"}], name: "Widget"},
      name: "terreno_generate_model",
    });
    expect(JSON.stringify(toolCall)).toContain("backend/src/models/widget.ts");

    const resourceList = await rpc("resources/list");
    const listedResources = (resourceList.result?.resources ?? []) as unknown[];
    expect(listedResources.length).toBe(resources.length);

    const firstResource = resources[0];
    const read = await rpc("resources/read", {uri: firstResource.uri});
    expect(read.result?.contents).toEqual([
      {mimeType: firstResource.mimeType, text: firstResource.content, uri: firstResource.uri},
    ]);

    const missing = await rpc("resources/read", {uri: "terreno://does-not-exist"});
    expect(missing.error?.message).toContain("Resource not found");

    const promptList = await rpc("prompts/list");
    const listedPrompts = (promptList.result?.prompts ?? []) as Array<{name: string}>;
    const promptNames = listedPrompts.map((p) => p.name);
    expect(promptNames).toContain("terreno_style_guide");

    const prompt = await rpc("prompts/get", {arguments: {}, name: "terreno_style_guide"});
    expect(Array.isArray(prompt.result?.messages)).toBe(true);
  });

  test("GET / is a health check", async () => {
    const response = await fetch(`${baseUrl}/`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      mcpEndpoint: "/mcp",
      service: "terreno-mcp",
      status: "ok",
    });
  });
});
