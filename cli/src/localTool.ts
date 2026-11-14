import {handleLocalToolCall} from "@terreno/mcp/local-tools";

import type {CliIo, ToolCallResult} from "./io";
import {printJson} from "./io";
import {callSessionTool, findLiveSession, startSession} from "./session";

interface CallLocalToolOptions {
  args: Record<string, unknown>;
  io: CliIo;
  name: string;
}

/**
 * Stateful tools (a browser view, SyncDB snapshots) only make sense in a process that outlives
 * one command, so they start the project's CLI session when none is running. This is the one
 * place that decides it, for dedicated commands and `terreno tool call` alike.
 */
const toolNeedsSession = (name: string, args: Record<string, unknown>): boolean => {
  if (name === "browser" || name === "syncdb_snapshot") {
    return true;
  }
  // Merging reads the snapshot an earlier `syncdb snapshot capture` left in the session.
  return name === "syncdb_action" && args.action === "mergeSnapshot";
};

/**
 * Runs one terreno-mcp-local tool. A running CLI session handles the call so state carries
 * across commands; without one, stateless tools run in this process.
 */
export const callLocalTool = async ({
  args,
  io,
  name,
}: CallLocalToolOptions): Promise<ToolCallResult> => {
  let session = await findLiveSession(io);
  if (!session && toolNeedsSession(name, args)) {
    const started = await startSession({io});
    session = started.state;
    io.stderr(
      "Started a terreno CLI session to keep state between commands. Stop it with `terreno session stop`."
    );
  }
  if (session) {
    return callSessionTool({args, io, name, state: session});
  }
  return (io.localTools?.call ?? handleLocalToolCall)(name, args);
};

export const toolResultText = (result: ToolCallResult): string => {
  return result.content.map((part) => part.text).join("\n");
};

export const printToolResult = (io: CliIo, json: boolean, result: ToolCallResult): number => {
  const text = toolResultText(result);
  if (json) {
    try {
      printJson(io, JSON.parse(text) as unknown);
    } catch {
      printJson(io, {ok: true, result: text});
    }
  } else {
    io.stdout(text);
  }
  return 0;
};

/** Drops undefined values so tool arguments match the MCP schemas (`additionalProperties: false`). */
export const compactArgs = (args: Record<string, unknown>): Record<string, unknown> => {
  return Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined));
};
