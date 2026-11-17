import {resolve} from "node:path";

import {readDeployRecord, teardownRun} from "../teardown";

const flagValue = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

export const description =
  "Delete a run's deploy, database and CI branch (refuses a run marked keep: true): teardown --run-dir <dir>";

export const run = async (args: string[]): Promise<number> => {
  const runDir = flagValue(args, "run-dir");
  if (!runDir) {
    console.error("Usage: bootstrap-loop teardown --run-dir <dir>");
    return 2;
  }
  const root = resolve(runDir);
  try {
    if (readDeployRecord(root).keep === true) {
      console.error(`${root} is marked keep: true; refusing to tear it down`);
      return 2;
    }
    const {removed} = await teardownRun({
      command: process.env.BOOTSTRAP_LOOP_TEARDOWN_CMD,
      runDir: root,
    });
    console.info(JSON.stringify({removed}));
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
};
