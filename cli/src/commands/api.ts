import {isAbsolute, join} from "node:path";

import type {CliIo} from "../io";
import {flagString, type ParsedArgs} from "../parseArgs";
import {defaultBaseUrl, loadOpenApiDocument} from "../rest/loadSpec";
import {runRestCommand} from "../rest/runRestCommand";
import {readStoredToken} from "./auth";

const resolveFromCwd = (cwd: string, value: string): string => {
  if (/^https?:\/\//i.test(value) || isAbsolute(value)) {
    return value;
  }
  return join(cwd, value);
};

const requireSchema = (parsed: ParsedArgs, io: CliIo): string | undefined => {
  return flagString(parsed.flags, "schema") ?? io.env.TERRENO_OPENAPI;
};

export const runApiCommand = async (
  parsed: ParsedArgs,
  io: CliIo,
  _json: boolean
): Promise<number> => {
  const schema = requireSchema(parsed, io);
  if (!schema) {
    io.stderr("Pass --schema <openapi.json|yaml|url> or set TERRENO_OPENAPI");
    return 1;
  }
  const spec = await loadOpenApiDocument(resolveFromCwd(io.cwd, schema), io.fetch);
  // Fall back to the token saved by `terreno login` when it belongs to the API being called.
  const hasToken = Boolean(flagString(parsed.flags, "token") ?? io.env.TERRENO_TOKEN);
  // A spec served by the API itself often lists no servers; its own origin is the API.
  const specBaseUrl =
    defaultBaseUrl(spec) || (/^https?:\/\//i.test(schema) ? new URL(schema).origin : "");
  const baseUrl = flagString(parsed.flags, "base-url") ?? io.env.TERRENO_API_URL ?? specBaseUrl;
  const storedToken = hasToken || !baseUrl ? undefined : await readStoredToken(io, baseUrl);
  return runRestCommand({
    defaultBaseUrl: specBaseUrl || undefined,
    io: storedToken ? {...io, env: {...io.env, TERRENO_TOKEN: storedToken}} : io,
    parsed: {...parsed, positionals: parsed.positionals.slice(1)},
    spec,
  });
};
