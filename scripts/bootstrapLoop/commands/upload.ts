import {basename, join, resolve} from "node:path";

import {uploadRun} from "../upload";

const flagValue = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

export const description =
  "Copy a run's app tarball, screenshots and reports (redacted) to the artifacts dir: upload --run-dir <dir> [--dest <dir>]";

export const run = async (args: string[]): Promise<number> => {
  const runDir = flagValue(args, "run-dir");
  if (!runDir) {
    console.error("Usage: bootstrap-loop upload --run-dir <dir> [--dest <dir>]");
    return 2;
  }
  const root = resolve(runDir);
  const artifacts = process.env.BOOTSTRAP_LOOP_ARTIFACTS ?? "/opt/cursor/artifacts/bootstrap-loop";
  const dest = resolve(flagValue(args, "dest") ?? join(artifacts, basename(root)));
  try {
    const {files} = await uploadRun({dest, runDir: root});
    console.info(JSON.stringify({dest, files: files.length}));
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
};
