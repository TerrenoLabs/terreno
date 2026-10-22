import {Client, StreamableHTTPClientTransport} from "@modelcontextprotocol/client";
import {useCallback, useEffect, useState} from "react";

import {baseUrl as defaultBaseUrl} from "../config/baseUrl";
import type {AuthProvider} from "../types";

export interface MCPToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface UseMCPToolsOptions {
  /**
   * The app's shared auth provider (the one passed to `createSyncDb` and
   * `createApiClient`). Works for Better Auth and JWT sessions alike.
   */
  authProvider: Pick<AuthProvider, "getToken">;
  /** Backend origin. Defaults to `@terreno/syncdb/config` `baseUrl`. */
  baseURL?: string;
}

export interface UseMCPToolsResult {
  tools: MCPToolInfo[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Lists the MCP tools the backend's `/mcp` endpoint exposes to the signed-in user.
 * Uses the official MCP client so protocol negotiation, the per-request metadata
 * envelope, routing headers, and response parsing follow the specification.
 * Requires `@modelcontextprotocol/client` (optional peer dependency).
 */
export const useMCPTools = ({
  authProvider,
  baseURL = defaultBaseUrl,
}: UseMCPToolsOptions): UseMCPToolsResult => {
  const [tools, setTools] = useState<MCPToolInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTools = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);

    try {
      const token = await authProvider.getToken();
      const client = new Client(
        {name: "terreno-syncdb", version: "1.0.0"},
        {versionNegotiation: {mode: "auto"}}
      );
      const transport = new StreamableHTTPClientTransport(new URL(`${baseURL}/mcp`), {
        authProvider: token ? {token: async (): Promise<string> => token} : undefined,
      });

      try {
        await client.connect(transport);
        const {tools: availableTools} = await client.listTools();
        setTools(
          availableTools.map((tool) => ({
            description: tool.description,
            inputSchema: tool.inputSchema as Record<string, unknown>,
            name: tool.name,
          }))
        );
      } finally {
        await client.close();
      }
    } catch (fetchError: unknown) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to fetch MCP tools");
      console.error("useMCPTools error:", fetchError);
    } finally {
      setIsLoading(false);
    }
  }, [authProvider, baseURL]);

  // Load the tool list on mount and whenever the auth provider or backend changes.
  useEffect(() => {
    void fetchTools();
  }, [fetchTools]);

  return {error, isLoading, refetch: fetchTools, tools};
};
