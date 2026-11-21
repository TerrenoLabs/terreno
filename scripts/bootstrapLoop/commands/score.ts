import {resolve} from "node:path";

import {scoreBuild} from "../score/score";

const flagValue = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

export const description =
  "Score a build in a separate session: score --run-dir <dir> [--previous <dir>]";

export const run = async (args: string[]): Promise<number> => {
  const runDir = flagValue(args, "run-dir");
  if (!runDir) {
    console.error("Usage: bootstrap-loop score --run-dir <dir> [--previous <dir>]");
    return 2;
  }
  const previous = flagValue(args, "previous");
  try {
    const result = await scoreBuild({
      previousDir: previous ? resolve(previous) : undefined,
      runDir: resolve(runDir),
    });
    console.info(JSON.stringify({pass: result.pass, version: result.version}));
    for (const row of result.rows.filter((item) => item.status === "FAIL")) {
      console.error(`FAIL ${row.row}: ${row.reason}`);
    }
    return result.pass ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
};
