#!/usr/bin/env bun
/**
 * bootstrap-loop CLI. Commands are discovered from `commands/*.ts` at startup; each exports
 * `description` and `run(args) => Promise<exitCode>`.
 */
import {readdirSync} from "node:fs";
import {join} from "node:path";
import {pathToFileURL} from "node:url";

interface CommandModule {
  description: string;
  run: (args: string[]) => Promise<number>;
}

const commandsDir = join(import.meta.dir, "commands");

const discoverCommands = (): string[] =>
  readdirSync(commandsDir)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .map((file) => file.replace(/\.ts$/, ""))
    .sort();

const main = async (): Promise<number> => {
  const [name, ...args] = process.argv.slice(2);
  const names = discoverCommands();
  if (!name || !names.includes(name)) {
    console.error(`Usage: bootstrap-loop <${names.join("|")}> [args]`);
    return 2;
  }
  const module = (await import(
    pathToFileURL(join(commandsDir, `${name}.ts`)).href
  )) as CommandModule;
  return module.run(args);
};

process.exit(await main());
