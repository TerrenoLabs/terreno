import {readFile} from "node:fs/promises";
import {isAbsolute, join} from "node:path";
import {handleLocalToolCall, localMcpTools} from "@terreno/mcp/local-tools";
import {handleToolCall, tools as hostedMcpTools} from "@terreno/mcp/tools";

import type {CliIo} from "../io";
import {printJson} from "../io";
import {callLocalTool, printToolResult} from "../localTool";
import {flagBoolean, flagString, type ParsedArgs} from "../parseArgs";
import {parseJsonValue} from "../rest/flagValues";
import {findLiveSession, serveSession, startSession, stopSession} from "../session";

interface ToolRow {
  description: string;
  inputSchema: unknown;
  name: string;
  server: "hosted" | "local";
}

const listTools = (io: CliIo): ToolRow[] => {
  const local = (io.localTools?.tools ?? localMcpTools).map(
    (tool): ToolRow => ({
      description: tool.description ?? "",
      inputSchema: tool.inputSchema,
      name: tool.name,
      server: "local",
    })
  );
  const hosted = hostedMcpTools.map(
    (tool): ToolRow => ({
      description: tool.description ?? "",
      inputSchema: tool.inputSchema,
      name: tool.name,
      server: "hosted",
    })
  );
  return [...local, ...hosted];
};

const loadToolArgs = async (parsed: ParsedArgs, io: CliIo): Promise<Record<string, unknown>> => {
  const argsFile = flagString(parsed.flags, "args-file");
  const raw = argsFile
    ? await readFile(isAbsolute(argsFile) ? argsFile : join(io.cwd, argsFile), "utf8")
    : flagString(parsed.flags, "args");
  const value = parseJsonValue(raw) ?? {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("--args must be a JSON object.");
  }
  return value as Record<string, unknown>;
};

/**
 * `terreno tool` reaches every MCP tool by name, so a tool added to the server is usable from a
 * shell before it gets a dedicated command.
 */
export const runToolCommand = async (
  parsed: ParsedArgs,
  io: CliIo,
  json: boolean
): Promise<number> => {
  const action = parsed.positionals[1];
  const rows = listTools(io);

  if (action === "list") {
    const only = flagBoolean(parsed.flags, "local")
      ? "local"
      : flagBoolean(parsed.flags, "hosted")
        ? "hosted"
        : undefined;
    const visible = only ? rows.filter((row) => row.server === only) : rows;
    if (json) {
      printJson(io, visible);
    } else {
      for (const row of visible) {
        const summary = row.description.split(/(?<=\.)\s/)[0] ?? "";
        io.stdout(`${row.name.padEnd(32)} ${row.server.padEnd(7)} ${summary}`);
      }
    }
    return 0;
  }

  if (action === "schema") {
    const row = rows.find((candidate) => candidate.name === parsed.positionals[2]);
    if (!row) {
      io.stderr(`Unknown tool "${parsed.positionals[2] ?? ""}". Run terreno tool list.`);
      return 1;
    }
    printJson(io, row);
    return 0;
  }

  if (action === "call") {
    const name = parsed.positionals[2];
    const row = rows.find((candidate) => candidate.name === name);
    if (!name || !row) {
      io.stderr(`Unknown tool "${name ?? ""}". Run terreno tool list.`);
      return 1;
    }
    const args = await loadToolArgs(parsed, io);
    const result =
      row.server === "hosted"
        ? await handleToolCall(name, args)
        : await callLocalTool({args, io, name});
    return printToolResult(io, json, result);
  }

  io.stderr("Usage: terreno tool <list|schema|call>");
  return 1;
};

export const runSessionCommand = async (
  parsed: ParsedArgs,
  io: CliIo,
  json: boolean
): Promise<number> => {
  const action = parsed.positionals[1];
  const idleRaw = parsed.flags["idle-minutes"];
  const idleMinutes = idleRaw === undefined ? undefined : Number(idleRaw);
  if (
    idleMinutes !== undefined &&
    (typeof idleRaw !== "string" || !Number.isFinite(idleMinutes) || idleMinutes < 0)
  ) {
    io.stderr("--idle-minutes must be zero (never idle out) or a positive number.");
    return 1;
  }

  if (action === "serve") {
    await serveSession({handle: io.localTools?.call ?? handleLocalToolCall, idleMinutes, io});
    return 0;
  }

  if (action === "start") {
    const {isNew, state} = await startSession({idleMinutes, io});
    const output = {isNew, ok: true, pid: state.pid, port: state.port};
    if (json) {
      printJson(io, output);
    } else {
      io.stdout(
        `${isNew ? "Started" : "Already running"}: CLI session pid ${String(state.pid)} on port ${String(state.port)}`
      );
    }
    return 0;
  }

  if (action === "stop") {
    const wasRunning = await stopSession(io);
    if (json) {
      printJson(io, {ok: true, wasRunning});
    } else {
      io.stdout(wasRunning ? "Stopped the CLI session." : "No CLI session was running.");
    }
    return 0;
  }

  if (action === "status") {
    const state = await findLiveSession(io);
    const output = state
      ? {pid: state.pid, port: state.port, running: true, startedAt: state.startedAt}
      : {running: false};
    if (json) {
      printJson(io, output);
    } else {
      io.stdout(
        state
          ? `Running: pid ${String(state.pid)} on port ${String(state.port)}`
          : "No CLI session is running."
      );
    }
    return 0;
  }

  io.stderr("Usage: terreno session <start|stop|status>");
  return 1;
};
