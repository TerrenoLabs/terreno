import type {User} from "../auth";
import {createScopedLogger} from "../logger";
import {setRequestContext} from "../requestContext";
import {getMCPErrorCause} from "./handlers";
import type {MCPToolResult} from "./types";

const getToolErrorMessage = (result: MCPToolResult): string => {
  const text = result.content[0]?.text;
  if (!text) {
    return "Unknown MCP tool error";
  }
  try {
    const parsed = JSON.parse(text) as {error?: unknown};
    return typeof parsed.error === "string" ? parsed.error : text;
  } catch {
    return text;
  }
};

/**
 * Run one tool call with the caller in the request context and an audit log line. Refusals
 * (permission, not-found, input errors) log as warnings; results carrying a cause and thrown
 * errors are captured as exceptions.
 */
export const executeTool = async ({
  labels,
  run,
  user,
}: {
  labels: Record<string, string>;
  run: () => Promise<MCPToolResult>;
  user?: User;
}): Promise<MCPToolResult> => {
  const userId = user?.id ?? (user?._id ? String(user._id) : undefined);
  if (userId) {
    setRequestContext({userId});
  }
  const log = createScopedLogger({labels, prefix: "[MCPTool]"});
  const startedAt = performance.now();

  try {
    const result = await run();
    const durationMs = Math.round(performance.now() - startedAt);
    if (!result.isError) {
      log.info("MCP tool call succeeded", {durationMs});
      return result;
    }

    const cause = getMCPErrorCause(result);
    const message = getToolErrorMessage(result);
    if (cause !== undefined) {
      // ScopedLogger.catch records the original exception and captures it in Sentry when enabled.
      log.catch(cause);
      log.error("MCP tool call failed", {durationMs, message});
    } else {
      // Permission, not-found, and input errors are expected failures: retain an audit trail
      // and Sentry log without reporting them as exceptions.
      log.warn("MCP tool call refused", {durationMs, message});
    }
    return result;
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    log.catch(error);
    log.error("MCP tool call crashed", {durationMs});
    throw error;
  }
};
