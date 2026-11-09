import {readFile} from "node:fs/promises";
import {isAbsolute, join} from "node:path";

import type {CliIo} from "../io";
import {printJson} from "../io";
import {flagBoolean, flagList, flagString, type ParsedArgs} from "../parseArgs";
import {parseHeaderFlags, parseJsonValue, parseNameValuePairs} from "./flagValues";
import {type InvokeRestResult, invokeRestOperation} from "./invoke";
import {defaultBaseUrl} from "./loadSpec";
import {
  findRestOperation,
  listRestOperations,
  type OpenApiDocument,
  type RestOperation,
} from "./operations";

export interface RunRestCommandOptions {
  defaultBaseUrl?: string;
  io: CliIo;
  parsed: ParsedArgs;
  spec: OpenApiDocument;
}

const resolveFromCwd = (cwd: string, value: string): string => {
  if (isAbsolute(value)) {
    return value;
  }
  return join(cwd, value);
};

const loadBody = async (parsed: ParsedArgs, io: CliIo): Promise<unknown> => {
  const bodyFile = flagString(parsed.flags, "body-file");
  if (bodyFile) {
    return parseJsonValue(await readFile(resolveFromCwd(io.cwd, bodyFile), "utf8"));
  }
  return parseJsonValue(flagString(parsed.flags, "body"));
};

const printResult = (io: CliIo, json: boolean, result: InvokeRestResult): number => {
  if (json) {
    printJson(io, {body: result.parsed, status: result.status, url: result.url});
  } else {
    io.stdout(`HTTP ${String(result.status)} ${result.url}`);
    io.stdout(
      typeof result.parsed === "string" ? result.parsed : JSON.stringify(result.parsed, null, 2)
    );
  }
  return result.ok ? 0 : 1;
};

const invokeOperation = async ({
  io,
  operation,
  parsed,
  baseUrl,
}: {
  baseUrl: string;
  io: CliIo;
  operation: RestOperation;
  parsed: ParsedArgs;
}): Promise<number> => {
  const result = await invokeRestOperation({
    baseUrl,
    body: await loadBody(parsed, io),
    fetch: io.fetch,
    headers: parseHeaderFlags(flagList(parsed.flags, "header")),
    operation,
    params: parseNameValuePairs(flagList(parsed.flags, "param")),
    token: flagString(parsed.flags, "token") ?? io.env.TERRENO_TOKEN,
  });
  return printResult(io, flagBoolean(parsed.flags, "json"), result);
};

export const runRestCommand = async ({
  defaultBaseUrl: configuredBaseUrl,
  io,
  parsed,
  spec,
}: RunRestCommandOptions): Promise<number> => {
  const action = parsed.positionals[0];
  const operations = listRestOperations(spec);
  const baseUrl =
    flagString(parsed.flags, "base-url") ??
    io.env.TERRENO_API_URL ??
    configuredBaseUrl ??
    defaultBaseUrl(spec);
  const json = flagBoolean(parsed.flags, "json");

  if (action === "list") {
    const rows = operations.map((operation) => ({
      id: operation.id,
      method: operation.method.toUpperCase(),
      path: operation.path,
      summary: operation.summary ?? "",
    }));
    if (json) {
      printJson(io, rows);
    } else {
      for (const row of rows) {
        io.stdout(`${row.id.padEnd(28)} ${row.method.padEnd(7)} ${row.path}  ${row.summary}`);
      }
    }
    return 0;
  }

  if (action === "call") {
    const id = parsed.positionals[1];
    if (!id) {
      io.stderr("Missing operationId");
      return 1;
    }
    const operation = findRestOperation(operations, {id});
    if (!operation) {
      io.stderr(`Unknown operation "${id}"`);
      return 1;
    }
    return invokeOperation({baseUrl, io, operation, parsed});
  }

  if (action === "request") {
    const method = parsed.positionals[1];
    const path = parsed.positionals[2];
    if (!method || !path) {
      io.stderr("Usage: request <METHOD> <path>");
      return 1;
    }
    const operation = findRestOperation(operations, {method, path});
    if (!operation) {
      io.stderr(`No operation for ${method.toUpperCase()} ${path}`);
      return 1;
    }
    return invokeOperation({baseUrl, io, operation, parsed});
  }

  io.stderr(`Unknown REST command "${action ?? ""}"`);
  return 1;
};
