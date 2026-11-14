import type {CliIo} from "../io";
import {callLocalTool, compactArgs, printToolResult} from "../localTool";
import {flagBoolean, flagString, type ParsedArgs} from "../parseArgs";
import {parseJsonValue} from "../rest/flagValues";

const SYNCDB_ACTIONS = [
  "mutate",
  "setLocalEntity",
  "deleteLocalEntity",
  "flush",
  "reconcile",
  "forceResync",
  "resolveConflict",
  "retryFailed",
  "goOffline",
  "goOnline",
  "clearDebug",
  "mergeSnapshot",
];
const SNAPSHOT_ACTIONS = ["capture", "list", "get", "compare", "delete"];
const BROWSER_ACTIONS = [
  "open",
  "click",
  "type",
  "press",
  "scroll",
  "evaluate",
  "snapshot",
  "screenshot",
  "back",
  "forward",
  "reload",
  "wait",
  "close",
];

const flagNumber = (parsed: ParsedArgs, name: string): number | undefined => {
  const raw = flagString(parsed.flags, name);
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`--${name} must be a number.`);
  }
  return value;
};

const flagJsonObject = (parsed: ParsedArgs, name: string): Record<string, unknown> | undefined => {
  const value = parseJsonValue(flagString(parsed.flags, name));
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`--${name} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
};

/** A flag given without a value parses as `true`; only an explicit flag sets the boolean. */
const flagOptionalBoolean = (parsed: ParsedArgs, name: string): boolean | undefined => {
  if (parsed.flags[name] === undefined) {
    return undefined;
  }
  return flagBoolean(parsed.flags, name);
};

const stateFilterArgs = (parsed: ParsedArgs): Record<string, unknown> => ({
  collection: flagString(parsed.flags, "collection"),
  entityId: flagString(parsed.flags, "entity-id"),
  includeDebugEvents: flagBoolean(parsed.flags, "no-events") ? false : undefined,
  limit: flagNumber(parsed, "limit"),
  name: flagString(parsed.flags, "name"),
});

export const runSyncDbCommand = async (
  parsed: ParsedArgs,
  io: CliIo,
  json: boolean
): Promise<number> => {
  const group = parsed.positionals[1];
  const action = parsed.positionals[2];

  if (group === "state") {
    const result = await callLocalTool({
      args: compactArgs(stateFilterArgs(parsed)),
      io,
      name: "get_syncdb_state",
    });
    return printToolResult(io, json, result);
  }

  if (group === "action") {
    if (!action || !SYNCDB_ACTIONS.includes(action)) {
      io.stderr(`Usage: terreno syncdb action <${SYNCDB_ACTIONS.join("|")}>`);
      return 1;
    }
    const result = await callLocalTool({
      args: compactArgs({
        action,
        collection: flagString(parsed.flags, "collection"),
        data: flagJsonObject(parsed, "data"),
        deleted: flagOptionalBoolean(parsed, "deleted"),
        entityId: flagString(parsed.flags, "entity-id"),
        id: flagString(parsed.flags, "id"),
        maxAttempts: flagNumber(parsed, "max-attempts"),
        mutationId: flagString(parsed.flags, "mutation-id"),
        name: flagString(parsed.flags, "name"),
        operation: flagString(parsed.flags, "operation"),
        seq: flagNumber(parsed, "seq"),
        snapshotId: flagString(parsed.flags, "snapshot-id"),
        strategy: flagString(parsed.flags, "strategy"),
        stream: flagString(parsed.flags, "stream"),
      }),
      io,
      name: "syncdb_action",
      // Merging needs the snapshot that an earlier `syncdb snapshot capture` left in the session.
      needsSession: action === "mergeSnapshot",
    });
    return printToolResult(io, json, result);
  }

  if (group === "snapshot") {
    if (!action || !SNAPSHOT_ACTIONS.includes(action)) {
      io.stderr(`Usage: terreno syncdb snapshot <${SNAPSHOT_ACTIONS.join("|")}>`);
      return 1;
    }
    const result = await callLocalTool({
      args: compactArgs({
        ...stateFilterArgs(parsed),
        action,
        otherSnapshotId: flagString(parsed.flags, "other-snapshot-id"),
        snapshotId: flagString(parsed.flags, "snapshot-id") ?? parsed.positionals[3],
      }),
      io,
      name: "syncdb_snapshot",
      needsSession: true,
    });
    return printToolResult(io, json, result);
  }

  io.stderr("Usage: terreno syncdb <state|action|snapshot>");
  return 1;
};

export const runStorageCommand = async (
  parsed: ParsedArgs,
  io: CliIo,
  json: boolean
): Promise<number> => {
  const action = parsed.positionals[1];
  if (action === "read") {
    const keys = flagString(parsed.flags, "keys")
      ?.split(",")
      .map((key) => key.trim())
      .filter(Boolean);
    const result = await callLocalTool({
      args: compactArgs({keys, prefix: flagString(parsed.flags, "prefix")}),
      io,
      name: "read_local_storage",
    });
    return printToolResult(io, json, result);
  }
  if (action === "write") {
    const key = flagString(parsed.flags, "key");
    const value = flagString(parsed.flags, "value");
    if (!key || value === undefined) {
      io.stderr("Usage: terreno storage write --key <key> --value <string>");
      return 1;
    }
    const result = await callLocalTool({args: {key, value}, io, name: "write_local_storage"});
    return printToolResult(io, json, result);
  }
  io.stderr("Usage: terreno storage <read|write>");
  return 1;
};

export const runDevCommand = async (
  parsed: ParsedArgs,
  io: CliIo,
  json: boolean
): Promise<number> => {
  const action = parsed.positionals[1];
  if (action === "list") {
    const result = await callLocalTool({args: {}, io, name: "list_dev_commands"});
    return printToolResult(io, json, result);
  }
  if (action === "run") {
    const name = parsed.positionals[2];
    if (!name) {
      io.stderr("Usage: terreno dev run <name> [--args <json>]");
      return 1;
    }
    const result = await callLocalTool({
      args: compactArgs({arguments: flagJsonObject(parsed, "args"), name}),
      io,
      name: "invoke_dev_command",
    });
    return printToolResult(io, json, result);
  }
  io.stderr("Usage: terreno dev <list|run>");
  return 1;
};

export const runDispatchCommand = async (
  parsed: ParsedArgs,
  io: CliIo,
  json: boolean
): Promise<number> => {
  const type = parsed.positionals[1];
  if (!type) {
    io.stderr("Usage: terreno dispatch <type> [--payload <json>]");
    return 1;
  }
  const result = await callLocalTool({
    args: compactArgs({payload: parseJsonValue(flagString(parsed.flags, "payload")), type}),
    io,
    name: "dispatch_client_action",
  });
  return printToolResult(io, json, result);
};

export const runBrowserCommand = async (
  parsed: ParsedArgs,
  io: CliIo,
  json: boolean
): Promise<number> => {
  const action = parsed.positionals[1];
  if (!action || !BROWSER_ACTIONS.includes(action)) {
    io.stderr(`Usage: terreno browser <${BROWSER_ACTIONS.join("|")}> [options]`);
    return 1;
  }
  const modifiers = flagString(parsed.flags, "modifiers")
    ?.split(",")
    .map((modifier) => modifier.trim())
    .filter(Boolean);
  const url =
    flagString(parsed.flags, "url") ??
    parsed.positionals[2] ??
    (action === "open" ? (io.env.TERRENO_WEB_URL ?? "http://localhost:8082") : undefined);
  const result = await callLocalTool({
    args: compactArgs({
      action,
      code: flagString(parsed.flags, "code"),
      dataDir: flagString(parsed.flags, "data-dir"),
      height: flagNumber(parsed, "height"),
      key: flagString(parsed.flags, "key"),
      modifiers,
      output: flagString(parsed.flags, "output"),
      quality: flagNumber(parsed, "quality"),
      selector: flagString(parsed.flags, "selector"),
      text: flagString(parsed.flags, "text"),
      timeout: flagNumber(parsed, "timeout"),
      url: action === "open" ? url : undefined,
      width: flagNumber(parsed, "width"),
      x: flagNumber(parsed, "x"),
      y: flagNumber(parsed, "y"),
    }),
    io,
    name: "browser",
    needsSession: true,
  });
  return printToolResult(io, json, result);
};
