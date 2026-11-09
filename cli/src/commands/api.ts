import {isAbsolute, join} from "node:path";

import type {CliIo} from "../io";
import {flagString, type ParsedArgs} from "../parseArgs";
import {loadOpenApiDocument} from "../rest/loadSpec";
import {runRestCommand} from "../rest/runRestCommand";

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
  return runRestCommand({
    io,
    parsed: {...parsed, positionals: parsed.positionals.slice(1)},
    spec,
  });
};
