import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {handleLocalToolCall} from "@terreno/mcp/local-tools";

import type {CliIo} from "../io";
import {printJson} from "../io";
import {flagBoolean, flagList, flagString, type ParsedArgs} from "../parseArgs";

interface BrowserAction {
  action: string;
  [key: string]: unknown;
}

const parsePositiveInteger = (value: string | undefined, name: string): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
};

const parseNonNegativeInteger = (value: string | undefined, name: string): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return parsed;
};

const parseAction = (value: string): BrowserAction => {
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Each --action must be a JSON object.");
  }
  const action = (parsed as {action?: unknown}).action;
  if (typeof action !== "string" || !action.trim()) {
    throw new Error('Each --action needs an "action" string.');
  }
  return parsed as BrowserAction;
};

const loadActions = async (parsed: ParsedArgs, io: CliIo): Promise<BrowserAction[]> => {
  const actions = flagList(parsed.flags, "action").map(parseAction);
  const actionsFile = flagString(parsed.flags, "actions-file");
  if (!actionsFile) {
    return actions;
  }
  const text = await readFile(resolve(io.cwd, actionsFile), "utf8");
  const fileValue = JSON.parse(text) as unknown;
  if (!Array.isArray(fileValue)) {
    throw new Error("--actions-file must contain a JSON array.");
  }
  return [...actions, ...fileValue.map((action) => parseAction(JSON.stringify(action)))];
};

const callBrowser = async (args: BrowserAction): Promise<unknown> => {
  const result = await handleLocalToolCall("browser", args);
  const text = result.content.map((part) => part.text).join("\n");
  return JSON.parse(text) as unknown;
};

export const runWebCommand = async (
  parsed: ParsedArgs,
  io: CliIo,
  json: boolean
): Promise<number> => {
  const url = parsed.positionals[1] ?? io.env.TERRENO_WEB_URL ?? "http://localhost:8082";
  const actions = await loadActions(parsed, io);
  const screenshot = flagString(parsed.flags, "screenshot");
  const shouldSnapshot = flagBoolean(parsed.flags, "snapshot") || (!actions.length && !screenshot);
  const results: unknown[] = [];
  let taskError: unknown;

  try {
    results.push(
      await callBrowser({
        action: "open",
        dataDir: flagString(parsed.flags, "data-dir"),
        height: parsePositiveInteger(flagString(parsed.flags, "height"), "--height"),
        url,
        width: parsePositiveInteger(flagString(parsed.flags, "width"), "--width"),
      })
    );
    results.push(
      await callBrowser({
        action: "wait",
        timeout: parseNonNegativeInteger(flagString(parsed.flags, "wait"), "--wait") ?? 1000,
      })
    );
    for (const action of actions) {
      results.push(await callBrowser(action));
    }
    if (shouldSnapshot) {
      results.push(await callBrowser({action: "snapshot"}));
    }
    if (screenshot) {
      results.push(await callBrowser({action: "screenshot", output: screenshot}));
    }
  } catch (error) {
    taskError = error;
  }
  try {
    await callBrowser({action: "close"});
  } catch (closeError) {
    taskError ??= closeError;
  }
  if (taskError) {
    throw taskError;
  }

  const output = {ok: true, results};
  if (json) {
    printJson(io, output);
  } else {
    io.stdout(JSON.stringify(output, null, 2));
  }
  return 0;
};
