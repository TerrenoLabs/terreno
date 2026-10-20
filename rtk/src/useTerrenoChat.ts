import {useChat} from "@ai-sdk/react";
import type {AuthProvider} from "@terreno/syncdb";
import {DefaultChatTransport} from "ai";

import {baseUrl} from "./constants";
import {jwtTokenSource} from "./emptyApi";
import {getTokenSource} from "./tokenSource";

export interface UseTerrenoChatOptions {
  /** Base URL of the Terreno backend. Defaults to the resolved baseUrl from constants. */
  baseURL?: string;
  /** Override the chat API endpoint path. Defaults to "/api/chat". */
  apiPath?: string;
  /** Chat ID for session management. */
  id?: string;
  /** Callback when an error occurs. */
  onError?: (error: Error) => void;
  /**
   * Token source for the chat requests' `Authorization: Bearer` header. Defaults to the source
   * registered with `setTokenSource`, else the built-in JWT source. The hook reads `getToken()`
   * on every request and sends no `Authorization` header when it returns no token.
   */
  tokenSource?: AuthProvider;
}

/**
 * Hook that wraps @ai-sdk/react's useChat() pre-configured for a Terreno MCP backend.
 * Automatically injects the Bearer token from the token source (see `tokenSource`).
 *
 * The backend needs a chat endpoint (e.g. POST /api/chat) that accepts messages
 * and returns a streaming response. The MCP tools are available server-side via
 * `getMCPTools()` from `@terreno/ai`.
 */
export const useTerrenoChat = (options: UseTerrenoChatOptions = {}) => {
  const {baseURL = baseUrl, apiPath = "/api/chat", id, onError, tokenSource} = options;

  const chatResult = useChat({
    id,
    onError,
    transport: new DefaultChatTransport({
      api: `${baseURL}${apiPath}`,
      headers: async (): Promise<Record<string, string>> => {
        // Resolve the source per request so a source registered after mount is used.
        const source = tokenSource ?? getTokenSource() ?? jwtTokenSource;
        const token = await source.getToken();
        const result: Record<string, string> = {};
        if (token) {
          result.Authorization = `Bearer ${token}`;
        }
        return result;
      },
    }),
  });

  return chatResult;
};
