import {resolve} from "node:path";

import {buildPassed, runBuild, selectStages} from "../build";

const flagValue = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

export const description =
  "Run every stage in order: build --version <v|local> --run-dir <dir> [--from <stage>] [--only a,b] [--keep-going]";

export const run = async (args: string[]): Promise<number> => {
  const version = flagValue(args, "version");
  const runDir = flagValue(args, "run-dir");
  if (!version || !runDir) {
    console.error("Usage: bootstrap-loop build --version <v|local> --run-dir <dir>");
    return 2;
  }
  const from = flagValue(args, "from");
  const only = flagValue(args, "only")?.split(",");
  let selected: string[];
  try {
    selected = selectStages({from, only});
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  const build = await runBuild({
    from,
    keepGoing: args.includes("--keep-going"),
    only,
    runDir: resolve(runDir),
    version,
  });
  console.info(JSON.stringify({totalMinutes: build.totalMinutes, version: build.version}));
  for (const stage of build.stages.filter((item) => item.status === "FAIL")) {
    console.error(`FAIL ${stage.id} after ${String(stage.attempts)} attempt(s)`);
  }
  return buildPassed(build, selected) ? 0 : 1;
};
