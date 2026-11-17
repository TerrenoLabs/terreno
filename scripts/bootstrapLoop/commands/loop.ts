import {resolve} from "node:path";

import {DEFAULT_MAX_ITERATIONS, runLoop} from "../loop";

const flagValue = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

export const description =
  "Build, score, rerun failing stages until the rubric passes: loop --version <v|local> --run-dir <dir> [--max-iterations N] [--previous <dir>]";

export const run = async (args: string[]): Promise<number> => {
  const version = flagValue(args, "version");
  const runDir = flagValue(args, "run-dir");
  if (!version || !runDir) {
    console.error("Usage: bootstrap-loop loop --version <v|local> --run-dir <dir>");
    return 2;
  }
  const maxIterations = Number(flagValue(args, "max-iterations") ?? DEFAULT_MAX_ITERATIONS);
  if (!Number.isInteger(maxIterations) || maxIterations < 1) {
    console.error("--max-iterations must be a positive integer");
    return 2;
  }
  const previous = flagValue(args, "previous");
  const result = await runLoop({
    maxIterations,
    previousRunDir: previous ? resolve(previous) : undefined,
    runDir: resolve(runDir),
    version,
  });
  console.info(JSON.stringify({iterations: result.iterations.length, pass: result.pass, version}));
  return result.pass ? 0 : 1;
};
