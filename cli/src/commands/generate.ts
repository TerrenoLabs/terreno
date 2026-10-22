import {readFile} from "node:fs/promises";
import {isAbsolute, join} from "node:path";
import {
  generateFormFields,
  generateInstallAdmin,
  generateModel,
  generateRoute,
  generateScreen,
  validateModelSchema,
} from "@terreno/mcp/tools";
import {
  generateApiSdk,
  generateSyncDbSdk,
  loadConfigFile,
  parseCollectionsFlag,
} from "@terreno/syncdb/codegen";

import type {CliIo} from "../io";
import {printJson} from "../io";
import {flagBoolean, flagList, flagString, type ParsedArgs} from "../parseArgs";
import {parseFormField, parseModelField} from "../parseFields";
import {generateRestCliFiles} from "../rest/generateAppCli";
import {parseOpenApiDocument} from "../rest/loadSpec";
import {readCliVersion} from "../version";
import {writeFiles} from "../writeFiles";
import {maybeWrite} from "./output";

const resolveFromCwd = (cwd: string, value: string): string => {
  if (/^https?:\/\//i.test(value) || isAbsolute(value)) {
    return value;
  }
  return join(cwd, value);
};

const parseAdminModel = (
  raw: string
): {displayName: string; listFields: string[]; modelName: string; routePath: string} => {
  const [modelName, routePath, displayName, fields] = raw.split(":");
  if (!modelName || !routePath || !displayName) {
    throw new Error(`Expected --model Model:/path:Display:field,field, got "${raw}"`);
  }
  return {
    displayName,
    listFields: (fields ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    modelName,
    routePath,
  };
};

const generateSdk = async (parsed: ParsedArgs, io: CliIo, json: boolean): Promise<number> => {
  if (flagString(parsed.flags, "config") && !flagString(parsed.flags, "schema")) {
    io.stderr(
      "terreno generate sdk no longer runs an RTK openapi-config.ts (removed in Terreno 58). " +
        "Use: terreno generate sdk --schema <url|path> --out store/apiSdk.ts [--config <json>]"
    );
    return 1;
  }
  const schema = flagString(parsed.flags, "schema");
  const out = flagString(parsed.flags, "out");
  if (!schema || !out) {
    io.stderr("Usage: terreno generate sdk --schema <url|path> --out <file> [--config <json>]");
    return 1;
  }
  const configPath = flagString(parsed.flags, "config");
  await generateApiSdk({
    config: await loadConfigFile(configPath ? resolveFromCwd(io.cwd, configPath) : undefined),
    format: !flagBoolean(parsed.flags, "no-format"),
    out: resolveFromCwd(io.cwd, out),
    schema: resolveFromCwd(io.cwd, schema),
  });
  if (json) {
    printJson(io, {ok: true, path: out});
  } else {
    io.stdout(`Wrote ${out}`);
  }
  return 0;
};

const loadSpecLiteral = async (source: string, io: CliIo): Promise<string> => {
  if (/^https?:\/\//i.test(source)) {
    const response = await io.fetch(source);
    if (!response.ok) {
      throw new Error(`Failed to fetch OpenAPI spec ${source}: HTTP ${response.status}`);
    }
    return response.text();
  }
  return readFile(source, "utf8");
};

export const runGenerateCommand = async (
  parsed: ParsedArgs,
  io: CliIo,
  json: boolean
): Promise<number> => {
  const target = parsed.positionals[1];
  const outPath = flagString(parsed.flags, "out", "o");

  if (target === "model") {
    const name = flagString(parsed.flags, "name");
    if (!name) {
      io.stderr("Usage: terreno generate model --name <Name> --field name:Type:required");
      return 1;
    }
    const content = generateModel({
      fields: flagList(parsed.flags, "field").map((field) => {
        const parsedField = parseModelField(field);
        return {
          default: parsedField.default,
          name: parsedField.name,
          ref: parsedField.ref,
          required: parsedField.required,
          type: parsedField.type,
          unique: parsedField.unique,
        };
      }),
      hasOwner: flagBoolean(parsed.flags, "owner"),
      name,
      softDelete: flagBoolean(parsed.flags, "soft-delete"),
    });
    return maybeWrite(io, content, outPath, json);
  }

  if (target === "route") {
    const modelName = flagString(parsed.flags, "model-name");
    const routePath = flagString(parsed.flags, "route-path");
    if (!modelName || !routePath) {
      io.stderr("Usage: terreno generate route --model-name <Name> --route-path /path");
      return 1;
    }
    const queryFields = flagString(parsed.flags, "query-fields");
    const content = generateRoute({
      modelName,
      ownerFiltered: flagBoolean(parsed.flags, "owner-filtered"),
      queryFields: queryFields
        ? queryFields
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        : undefined,
      routePath,
      sort: flagString(parsed.flags, "sort"),
    });
    return maybeWrite(io, content, outPath, json);
  }

  if (target === "screen") {
    const name = flagString(parsed.flags, "name");
    if (!name) {
      io.stderr("Usage: terreno generate screen --name <Name> --type list|detail|form|empty");
      return 1;
    }
    const type = (flagString(parsed.flags, "type") ?? "empty") as
      | "list"
      | "detail"
      | "form"
      | "empty";
    const content = generateScreen({
      fields: flagList(parsed.flags, "field"),
      modelName: flagString(parsed.flags, "model-name"),
      name,
      type,
    });
    return maybeWrite(io, content, outPath, json);
  }

  if (target === "form") {
    const fields = flagList(parsed.flags, "field");
    if (fields.length === 0) {
      io.stderr("Usage: terreno generate form --field name:type:required");
      return 1;
    }
    const content = generateFormFields({
      fields: fields.map((field) => {
        const parsedField = parseFormField(field);
        return {
          label: parsedField.label,
          name: parsedField.name,
          required: parsedField.required,
          type: parsedField.type,
        };
      }),
    });
    return maybeWrite(io, content, outPath, json);
  }

  if (target === "admin") {
    const models = flagList(parsed.flags, "model");
    if (models.length === 0) {
      io.stderr("Usage: terreno generate admin --model Model:/path:Display:field,field");
      return 1;
    }
    const content = generateInstallAdmin({models: models.map(parseAdminModel)});
    return maybeWrite(io, content, outPath, json);
  }

  if (target === "syncdb") {
    const schema = flagString(parsed.flags, "schema");
    const out = flagString(parsed.flags, "out");
    if (!schema || !out) {
      io.stderr("Usage: terreno generate syncdb --schema <url|path> --out <file>");
      return 1;
    }
    const configPath = flagString(parsed.flags, "config");
    await generateSyncDbSdk({
      collections: parseCollectionsFlag(flagString(parsed.flags, "collections")),
      config: await loadConfigFile(configPath ? resolveFromCwd(io.cwd, configPath) : undefined),
      format: !flagBoolean(parsed.flags, "no-format"),
      out: resolveFromCwd(io.cwd, out),
      schema: resolveFromCwd(io.cwd, schema),
    });
    if (json) {
      printJson(io, {ok: true, path: out});
    } else {
      io.stdout(`Wrote ${out}`);
    }
    return 0;
  }

  if (target === "sdk") {
    return generateSdk(parsed, io, json);
  }

  if (target === "rest-cli") {
    const schema = flagString(parsed.flags, "schema");
    const dest = flagString(parsed.flags, "out");
    const binName = flagString(parsed.flags, "name") ?? "app-cli";
    if (!schema || !dest) {
      io.stderr("Usage: terreno generate rest-cli --schema <url|path> --out <dir> --name <bin>");
      return 1;
    }
    const source = resolveFromCwd(io.cwd, schema);
    const specLiteral = await loadSpecLiteral(source, io);
    const spec = parseOpenApiDocument(specLiteral);
    const files = generateRestCliFiles({
      baseUrl: flagString(parsed.flags, "base-url"),
      binName,
      cliVersion: await readCliVersion(),
      spec,
      specLiteral,
    });
    const root = resolveFromCwd(io.cwd, dest);
    await writeFiles(root, files);
    if (json) {
      printJson(io, {ok: true, path: root});
    } else {
      io.stdout(`Wrote REST CLI (${binName}) to ${root}`);
    }
    return 0;
  }

  io.stderr("Usage: terreno generate <model|route|screen|form|admin|syncdb|sdk|rest-cli>");
  return 1;
};

export const runValidateCommand = async (
  parsed: ParsedArgs,
  io: CliIo,
  json: boolean
): Promise<number> => {
  const target = parsed.positionals[1];
  if (target !== "schema") {
    io.stderr("Usage: terreno validate schema --file <path>");
    return 1;
  }
  const file = flagString(parsed.flags, "file");
  if (!file) {
    io.stderr("Usage: terreno validate schema --file <path>");
    return 1;
  }
  const schema = await readFile(resolveFromCwd(io.cwd, file), "utf8");
  const result = validateModelSchema({schema});
  if (json) {
    printJson(io, {ok: true, result});
  } else {
    io.stdout(result);
  }
  return 0;
};
