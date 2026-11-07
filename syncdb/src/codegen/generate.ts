import {mkdir, readFile, writeFile} from "node:fs/promises";
import {dirname} from "node:path";

import {discoverCollections} from "./discoverCollections";
import {discoverOperations} from "./discoverOperations";
import {emitApi} from "./emitApi";
import {applyRetriesOverrides, emitSdk} from "./emitSdk";
import {loadSpec} from "./loadSpec";
import type {CodegenConfigFile, GenerateApiArgs, GenerateArgs} from "./types";

const formatWithBiome = async (filePath: string): Promise<void> => {
  const proc = Bun.spawn(["bunx", "biome", "check", "--write", filePath], {
    stderr: "pipe",
    stdout: "pipe",
  });
  await proc.exited;
};

export const generateSyncDbSdk = async (args: GenerateArgs): Promise<string> => {
  const spec = await loadSpec(args.schema);
  const discovered = discoverCollections({collections: args.collections, spec});
  const withOverrides = applyRetriesOverrides({
    collections: discovered,
    overrides: args.config?.overrides,
  });
  const source = emitSdk({collections: withOverrides, config: args.config});
  await mkdir(dirname(args.out), {recursive: true});
  await writeFile(args.out, source, "utf8");
  if (args.format) {
    await formatWithBiome(args.out);
    return await readFile(args.out, "utf8");
  }
  return source;
};

/**
 * Write the API SDK: typed request hooks for every non-synced operation in the spec
 * (synced collection CRUD is left to the collection hooks).
 */
export const generateApiSdk = async (args: GenerateApiArgs): Promise<string> => {
  const spec = await loadSpec(args.schema);
  const operations = discoverOperations({excludePaths: args.config?.excludePaths, spec});
  const source = emitApi({config: args.config, operations, spec});
  await mkdir(dirname(args.out), {recursive: true});
  await writeFile(args.out, source, "utf8");
  if (args.format) {
    await formatWithBiome(args.out);
    return await readFile(args.out, "utf8");
  }
  return source;
};

export const parseCollectionsFlag = (value?: string): string[] | undefined => {
  if (!value) {
    return undefined;
  }
  const parsed = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : undefined;
};

export const loadConfigFile = async (path?: string): Promise<CodegenConfigFile | undefined> => {
  if (!path) {
    return undefined;
  }
  const {readFile} = await import("node:fs/promises");
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as CodegenConfigFile;
};
