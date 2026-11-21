import {spawnSync} from "node:child_process";
import {resolve} from "node:path";

import {run as runBuildCommand} from "./build";
import {run as runScoreCommand} from "./score";

const DEFAULT_DESCOPE = "R5,R9,R13";

const flagValue = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

export const description =
  "One prompt, then score: single --version <v|local> --run-dir <dir> (AI, CI and deploy rows descoped unless BOOTSTRAP_LOOP_DESCOPE is set)";

export const run = async (args: string[]): Promise<number> => {
  const version = flagValue(args, "version");
  const runDir = flagValue(args, "run-dir");
  if (!version || !runDir) {
    console.error("Usage: bootstrap-loop single --version <v|local> --run-dir <dir>");
    return 2;
  }
  process.env.BOOTSTRAP_LOOP_DESCOPE ??= DEFAULT_DESCOPE;
  if (version === "local") {
    // The local prompt runs the compiled checkout, so a changed prompt needs a recompile.
    const compile = spawnSync("bun", ["run", "compile"], {
      cwd: resolve(import.meta.dir, "../../../mcp-server"),
      stdio: "inherit",
    });
    if (compile.status !== 0) {
      console.error("mcp-server compile failed");
      return 1;
    }
  }
  const built = await runBuildCommand([
    "--version",
    version,
    "--run-dir",
    runDir,
    "--only",
    "scaffold",
  ]);
  if (built !== 0) {
    return built;
  }
  return runScoreCommand(["--run-dir", runDir]);
};
