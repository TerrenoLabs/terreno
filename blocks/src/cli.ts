#!/usr/bin/env bun

import {readFileSync} from "node:fs";
import {basename} from "node:path";

import {parseBlocks} from "./parse";
import {validateBlocks} from "./validate";

const usage = "Usage: terreno-blocks validate <file | ->\n";

const formatError = (error: {code: string; fix: string; message: string; path: string}): string =>
  `${error.path}  ${error.code}  ${error.message} — ${error.fix}`;

export const runBlocksCli = (
  argv: readonly string[],
  input: {readFile: (path: string) => string; readStdin: () => string}
): {code: number; stderr: string; stdout: string} => {
  const [command, target, extra] = argv;
  if (command !== "validate" || target === undefined || extra !== undefined) {
    return {code: 1, stderr: usage, stdout: ""};
  }
  let text: string;
  try {
    text = target === "-" ? input.readStdin() : input.readFile(target);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read the file.";
    return {code: 1, stderr: `${message}\n`, stdout: ""};
  }
  const parsed = parseBlocks(text);
  if (!parsed.ok) {
    return {code: 1, stderr: "", stdout: `${parsed.errors.map(formatError).join("\n")}\n`};
  }
  const validated = validateBlocks(parsed.value);
  if (!validated.ok) {
    return {code: 1, stderr: "", stdout: `${validated.errors.map(formatError).join("\n")}\n`};
  }
  const warnings =
    validated.warnings.length === 0 ? "" : `${validated.warnings.map(formatError).join("\n")}\n`;
  return {code: 0, stderr: "", stdout: warnings};
};

const main = (): void => {
  const result = runBlocksCli(process.argv.slice(2), {
    readFile: (path) => readFileSync(path, "utf8"),
    readStdin: () => readFileSync(0, "utf8"),
  });
  if (result.stdout !== "") {
    process.stdout.write(result.stdout);
  }
  if (result.stderr !== "") {
    process.stderr.write(result.stderr);
  }
  process.exit(result.code);
};

/** Runs validate when the process was started as the `terreno-blocks` bin. */
export const launchBlocksCli = (argv1: string | undefined): void => {
  const entry = basename(argv1 ?? "");
  // npm links the bin as `terreno-blocks`, so argv[1] is that name rather than cli.js.
  if (entry === "cli.ts" || entry === "cli.js" || entry === "terreno-blocks") {
    main();
  }
};

launchBlocksCli(process.argv[1]);
