#!/usr/bin/env bun

import {parseArgs} from "node:util";

import {generateApiSdk, generateSyncDbSdk, loadConfigFile, parseCollectionsFlag} from "./generate";

const printUsage = (): void => {
  console.error(`Usage: terreno-syncdb-codegen --schema <url|path> [--out <file>] [--api-out <file>] [options]

Options:
  --schema <url|path>     OpenAPI document (required)
  --out <file>            Synced-collection SDK output (collection hooks, SYNC_COLLECTIONS)
  --api-out <file>        API SDK output (typed hooks for every non-synced route)
  --collections a,b       Allowlist / fallback collection names
  --config <json>         Optional {overrides: {todos: {retries: false}}, excludePaths: ["/admin/"]}
  --no-format             Skip biome formatting

At least one of --out or --api-out is required.
`);
};

const main = async (): Promise<void> => {
  const {values} = parseArgs({
    allowPositionals: false,
    options: {
      "api-out": {type: "string"},
      collections: {type: "string"},
      config: {type: "string"},
      "no-format": {default: false, type: "boolean"},
      out: {type: "string"},
      schema: {type: "string"},
    },
    strict: true,
  });

  if (!values.schema || (!values.out && !values["api-out"])) {
    printUsage();
    process.exit(1);
  }

  try {
    const config = await loadConfigFile(values.config);
    const format = values["no-format"] !== true;
    if (values.out) {
      await generateSyncDbSdk({
        collections: parseCollectionsFlag(values.collections),
        config,
        format,
        out: values.out,
        schema: values.schema,
      });
    }
    if (values["api-out"]) {
      await generateApiSdk({config, format, out: values["api-out"], schema: values.schema});
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
};

void main();
