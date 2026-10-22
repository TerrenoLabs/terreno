import {Client, StreamableHTTPClientTransport} from "@modelcontextprotocol/client";
import type {AuthProvider} from "@terreno/syncdb";
import {useCallback, useEffect, useRef, useState} from "react";

import {baseUrl} from "./constants";
import {jwtTokenSource} from "./emptyApi";
import {getTokenSource} from "./tokenSource";

export interface MCPToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface UseMCPToolsOptions {
  /** Base URL of the Terreno backend. Defaults to the resolved baseUrl from constants. */
  baseURL?: string;
  /**
   * Token source for the MCP transport's `Authorization: Bearer` header. Defaults to the source
   * registered with `setTokenSource`, else the built-in JWT source. The transport reads
   * `getToken()` before every MCP request, so a refreshed or rotated token is used without a
   * refetch. When the source has no token as a fetch starts, that fetch connects without
   * authentication.
   */
  tokenSource?: AuthProvider;
}

export interface UseMCPToolsResult {
  tools: MCPToolInfo[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Hook that discovers available MCP tools from the backend.
 * Uses the official MCP client so protocol negotiation, the per-request 2026-07-28
 * metadata envelope, required routing headers, response parsing, and list caching stay
 * aligned with the specification.
 */
export const useMCPTools = (options: UseMCPToolsOptions = {}): UseMCPToolsResult => {
  const {baseURL = baseUrl, tokenSource} = options;
  // Held in a ref so an inline tokenSource object does not change fetchTools and refetch per render.
  const tokenSourceRef = useRef<AuthProvider | undefined>(tokenSource);
  const [tools, setTools] = useState<MCPToolInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTools = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Resolve the source per read so a source registered after mount is used.
      const resolveSource = (): AuthProvider =>
        tokenSourceRef.current ?? getTokenSource() ?? jwtTokenSource;
      const initialToken = await resolveSource().getToken();
      const client = new Client(
        {name: "terreno-rtk", version: "1.0.0"},
        {
          versionNegotiation: {mode: "auto"},
        }
      );
      const transport = new StreamableHTTPClientTransport(new URL(`${baseURL}/mcp`), {
        authProvider: initialToken
          ? {
              token: async (): Promise<string | undefined> =>
                (await resolveSource().getToken()) ?? undefined,
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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to fetch MCP tools";
      setError(message);
      console.error("useMCPTools error:", err);
    } finally {
      setIsLoading(false);
    }
  }, [baseURL]);

  // Keep the ref on the latest tokenSource. Declared before the fetch effect so a fetch started
  // in the same commit already reads the new source.
  useEffect(() => {
    tokenSourceRef.current = tokenSource;
  }, [tokenSource]);

  // Fetch tools on mount
  useEffect(() => {
    void fetchTools();
  }, [fetchTools]);

  return {error, isLoading, refetch: fetchTools, tools};
};
