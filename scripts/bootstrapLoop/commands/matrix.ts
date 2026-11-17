import {resolve} from "node:path";

import {runMatrix} from "../matrix/matrix";
import {
  assertSupportedFloor,
  fetchRegistryVersions,
  LOCAL_VERSION,
  listVersions,
  MIN_VERSION,
} from "../matrix/versions";

const flagValue = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

export const description =
  "Run the loop for every stable 58.x release plus local and write REGRESSIONS.md: matrix [--versions a,b] [--from-version <v>] [--no-local] [--work-dir <dir>] [--out <dir>] [--max-iterations N]";

export const run = async (args: string[]): Promise<number> => {
  const fromVersion = flagValue(args, "from-version") ?? MIN_VERSION;
  try {
    assertSupportedFloor(fromVersion);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  const includeLocal = !args.includes("--no-local");
  const explicit = flagValue(args, "versions");
  const versions = explicit
    ? explicit.split(",").filter(Boolean)
    : listVersions(await fetchRegistryVersions(), {fromVersion, includeLocal});
  const maxIterations = Number(flagValue(args, "max-iterations") ?? 3);
  const result = await runMatrix({
    maxIterations,
    outDir: resolve(flagValue(args, "out") ?? "docs/bootstrapLoop"),
    versions,
    workRoot: resolve(flagValue(args, "work-dir") ?? "/tmp/bootstrap-loop-matrix"),
  });
  console.info(
    JSON.stringify({
      regressions: result.diffs.map((d) => ({
        from: d.from,
        rows: d.rowRegressions.length,
        to: d.to,
      })),
      report: result.reportPath,
      versions: result.snapshots.map((s) => s.version),
    })
  );
  return result.snapshots.every((s) => s.version === LOCAL_VERSION || s.score.pass) ? 0 : 1;
};
