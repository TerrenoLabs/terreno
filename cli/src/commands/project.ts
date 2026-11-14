import type {CliIo} from "../io";
import {callLocalTool, compactArgs, printToolResult} from "../localTool";
import {flagBoolean, flagList, flagString, type ParsedArgs} from "../parseArgs";
import {parseJsonValue} from "../rest/flagValues";

const parseSources = (parsed: ParsedArgs): string[] => {
  return flagList(parsed.flags, "source", "sources")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
};

export const runInfoCommand = async (io: CliIo, json: boolean): Promise<number> => {
  const result = await callLocalTool({args: {}, io, name: "application_info"});
  return printToolResult(io, json, result);
};

export const runLogsCommand = async (
  parsed: ParsedArgs,
  io: CliIo,
  json: boolean
): Promise<number> => {
  const action = parsed.positionals[1];
  if (action === "last-error") {
    const result = await callLocalTool({
      args: compactArgs({
        sources: parseSources(parsed),
      }),
      io,
      name: "last_error",
    });
    return printToolResult(io, json, result);
  }
  if (action && action !== "tail") {
    io.stderr("Usage: terreno logs [last-error]");
    return 1;
  }
  const entriesRaw = flagString(parsed.flags, "entries");
  const result = await callLocalTool({
    args: compactArgs({
      entries: entriesRaw ? Number(entriesRaw) : undefined,
      level: flagString(parsed.flags, "level"),
      since: flagString(parsed.flags, "since"),
      sources: parseSources(parsed),
    }),
    io,
    name: "read_logs",
  });
  return printToolResult(io, json, result);
};

export const runStateCommand = async (
  parsed: ParsedArgs,
  io: CliIo,
  json: boolean
): Promise<number> => {
  if (flagString(parsed.flags, "slice", "query") !== undefined) {
    io.stderr(
      "terreno state no longer reads Redux slices (removed in Terreno 58). It reads the SyncDB " +
        "client registered with createSyncDb({debug: true}); filter with --collection / --entity-id."
    );
    return 1;
  }
  const limitRaw = flagString(parsed.flags, "limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    io.stderr("--limit must be a positive integer");
    return 1;
  }
  const result = await callLocalTool({
    args: compactArgs({
      collection: flagString(parsed.flags, "collection"),
      entityId: flagString(parsed.flags, "entity-id", "id"),
      includeDebugEvents: flagBoolean(parsed.flags, "no-events") ? false : undefined,
      limit,
      name: flagString(parsed.flags, "name"),
    }),
    io,
    name: "get_syncdb_state",
  });
  return printToolResult(io, json, result);
};

export const runEvalCommand = async (
  parsed: ParsedArgs,
  io: CliIo,
  json: boolean
): Promise<number> => {
  const code = flagString(parsed.flags, "code");
  if (!code) {
    io.stderr("Usage: terreno eval --code <javascript>");
    return 1;
  }
  const result = await callLocalTool({args: compactArgs({code}), io, name: "evaluate"});
  return printToolResult(io, json, result);
};

export const runNavigateCommand = async (
  parsed: ParsedArgs,
  io: CliIo,
  json: boolean
): Promise<number> => {
  const path = parsed.positionals[1];
  if (!path) {
    io.stderr("Usage: terreno navigate <path>");
    return 1;
  }
  const result = await callLocalTool({args: compactArgs({path}), io, name: "navigate"});
  return printToolResult(io, json, result);
};

export const runDbCommand = async (
  parsed: ParsedArgs,
  io: CliIo,
  json: boolean
): Promise<number> => {
  const action = parsed.positionals[1];
  if (action === "schema") {
    const result = await callLocalTool({
      args: compactArgs({
        collectionFilter: flagString(parsed.flags, "collection-filter"),
        summary: flagBoolean(parsed.flags, "summary"),
      }),
      io,
      name: "database_schema",
    });
    return printToolResult(io, json, result);
  }
  if (action === "query") {
    const collection = flagString(parsed.flags, "collection");
    if (!collection) {
      io.stderr("Usage: terreno db query --collection <name> --operation find");
      return 1;
    }
    const filterRaw = flagString(parsed.flags, "filter");
    const pipelineRaw = flagString(parsed.flags, "pipeline");
    const limitRaw = flagString(parsed.flags, "limit");
    const result = await callLocalTool({
      args: compactArgs({
        collection,
        field: flagString(parsed.flags, "field"),
        filter: filterRaw ? parseJsonValue(filterRaw) : undefined,
        limit: limitRaw ? Number(limitRaw) : undefined,
        operation: flagString(parsed.flags, "operation") ?? "find",
        pipeline: pipelineRaw ? parseJsonValue(pipelineRaw) : undefined,
      }),
      io,
      name: "database_query",
    });
    return printToolResult(io, json, result);
  }
  io.stderr("Usage: terreno db <schema|query>");
  return 1;
};
