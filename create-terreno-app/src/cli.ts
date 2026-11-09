#!/usr/bin/env node

import {realpathSync} from "node:fs";
import {fileURLToPath} from "node:url";

import {parseCliArgs, writeScaffold} from "./writeScaffold.js";

export interface RunCliOptions {
  argv?: string[];
  cwd?: string;
  write?: (line: string) => void;
  writeError?: (line: string) => void;
}

export interface RunCliResult {
  exitCode: number;
  nextSteps: string[];
  success: boolean;
  targetPath?: string;
  error?: string;
}

export const runCli = (options: RunCliOptions = {}): RunCliResult => {
  const argv = options.argv ?? process.argv.slice(2);
  const write =
    options.write ??
    ((line: string): void => {
      process.stdout.write(`${line}\n`);
    });
  const writeError =
    options.writeError ??
    ((line: string): void => {
      process.stderr.write(`${line}\n`);
    });
  const cwd = options.cwd ?? process.cwd();

  const parsed = parseCliArgs(argv);
  if (parsed.errors.length > 0) {
    for (const error of parsed.errors) {
      writeError(error);
    }
    return {
      error: parsed.errors.join("; "),
      exitCode: 1,
      nextSteps: [],
      success: false,
    };
  }

  const scaffoldResult = writeScaffold({
    appDisplayName: parsed.displayName as string,
    appName: parsed.appName as string,
    description: parsed.description,
    mcpServerUrl: parsed.mcpServerUrl,
    parentDir: cwd,
  });

  if (!scaffoldResult.success) {
    if (scaffoldResult.error) {
      writeError(scaffoldResult.error);
    }
    return {
      error: scaffoldResult.error,
      exitCode: scaffoldResult.exitCode,
      nextSteps: [],
      success: false,
      targetPath: scaffoldResult.targetPath,
    };
  }

  write(`Created ${scaffoldResult.targetPath}`);
  write("");
  write("Next steps:");
  for (const step of scaffoldResult.nextSteps) {
    write(step);
  }

  return {
    exitCode: 0,
    nextSteps: scaffoldResult.nextSteps,
    success: true,
    targetPath: scaffoldResult.targetPath,
  };
};

const resolvePath = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    // A path that cannot be resolved is compared as given.
    return path;
  }
};

/**
 * True when `scriptPath` (process.argv[1]) is this module. Package managers run the CLI through a
 * `node_modules/.bin` symlink, and either side may sit under a symlinked directory (macOS `/var`),
 * so both paths are resolved before comparing.
 */
export const isEntryPoint = (moduleUrl: string, scriptPath: string | undefined): boolean => {
  if (scriptPath === undefined) {
    return false;
  }
  return resolvePath(fileURLToPath(moduleUrl)) === resolvePath(scriptPath);
};

if (isEntryPoint(import.meta.url, process.argv[1])) {
  process.exit(runCli().exitCode);
}
