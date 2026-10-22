import {Client, StreamableHTTPClientTransport} from "@modelcontextprotocol/client";
import {useCallback, useEffect, useRef, useState} from "react";

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
   * `createApiClient`). Works for Better Auth and JWT sessions alike. The transport reads
   * `getToken()` before every MCP request, so a refreshed or rotated token is used without a
   * refetch. When there is no token as a fetch starts, that fetch connects without
   * authentication.
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
  // Held in a ref so an inline authProvider object does not change fetchTools and refetch per render.
  const authProviderRef = useRef(authProvider);
  const [tools, setTools] = useState<MCPToolInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTools = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);

    try {
      const initialToken = await authProviderRef.current.getToken();
      const client = new Client(
        {name: "terreno-syncdb", version: "1.0.0"},
        {versionNegotiation: {mode: "auto"}}
      );
      const transport = new StreamableHTTPClientTransport(new URL(`${baseURL}/mcp`), {
        authProvider: initialToken
          ? {
              token: async (): Promise<string | undefined> =>
                (await authProviderRef.current.getToken()) ?? undefined,
            }
          : undefined,
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
  }, [baseURL]);

  // Keep the ref on the latest authProvider. Declared before the fetch effect so a fetch started
  // in the same commit already reads the new provider.
  useEffect(() => {
    authProviderRef.current = authProvider;
  }, [authProvider]);

  // Load the tool list on mount and whenever the backend changes.
  useEffect(() => {
    void fetchTools();
  }, [fetchTools]);

  return {error, isLoading, refetch: fetchTools, tools};
};
