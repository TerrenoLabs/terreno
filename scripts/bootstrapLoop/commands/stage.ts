import {resolve} from "node:path";

import {runStage} from "../runStage";
import {stageIds} from "../stages";

const flagValue = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

export const description = "Run one stage: stage <id> --version <v|local> --run-dir <dir>";

export const run = async (args: string[]): Promise<number> => {
  const stageId = args.find(
    (arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--")
  );
  if (!stageId || !stageIds().includes(stageId)) {
    console.error(`Unknown stage "${stageId ?? ""}". Valid stages: ${stageIds().join(", ")}`);
    return 2;
  }
  const version = flagValue(args, "version");
  const runDir = flagValue(args, "run-dir");
  if (!version || !runDir) {
    console.error("Usage: bootstrap-loop stage <id> --version <v|local> --run-dir <dir>");
    return 2;
  }
  const failures = args.flatMap((arg, index) => (arg === "--failure" ? [args[index + 1]] : []));
  const result = await runStage({failures, runDir: resolve(runDir), stageId, version});
  console.info(
    JSON.stringify({
      attempt: result.attempt,
      minutes: result.minutes,
      stage: result.stage,
      status: result.status,
    })
  );
  for (const check of result.checks.filter((item) => item.status === "FAIL")) {
    console.error(`FAIL ${check.name}: ${check.ev}`);
  }
  return result.status === "PASS" ? 0 : 1;
};
