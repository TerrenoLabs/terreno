import type express from "express";

import type {User} from "../auth";
import type {MCPRequest, MCPToolArgs} from "./types";

/**
 * Build the Express-shaped request handed to lifecycle hooks and response handlers.
 *
 * An MCP tool call is JSON-RPC, not HTTP, so there is no real request to forward. The
 * authenticated user is the only field with a genuine equivalent — everything else is
 * filled in with empty defaults so hooks that read `req.body`, `req.query`, `req.params`,
 * or `req.headers` get the shape they expect instead of a TypeError. `isMCPRequest` lets
 * a hook detect the MCP path when it needs to behave differently from HTTP.
 */
export const createMCPRequest = ({
  body = {},
  params = {},
  query = {},
  user,
}: {
  body?: MCPToolArgs;
  /** Route params an action tool fills in, such as the instance action's `id`. */
  params?: Record<string, string>;
  /** Tool arguments of a GET action, which REST would read from the query string. */
  query?: Record<string, unknown>;
  user?: User;
}): express.Request => {
  const request: MCPRequest = {
    body,
    headers: {},
    isMCPRequest: true,
    method: "MCP",
    params,
    query,
    user,
  };
  return request as unknown as express.Request;
};
