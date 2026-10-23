import {collectOutput, killGroup, spawnTracked} from "./childProcesses";

export interface RunBinOptions {
  /** A command on PATH, or a path to a script. `.js`, `.mjs`, `.cjs`, and `.ts` files run with Bun. */
  bin: string;
  args?: string[];
  cwd?: string;
  /** Merged over the parent environment. */
  env?: Record<string, string | undefined>;
  /** The process and everything it started are killed, and the call rejects, after this long. Default 30 000 ms. */
  timeoutMs?: number;
}

export interface RunBinResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const DEFAULT_TIMEOUT_MS = 30000;
const SCRIPT_EXTENSION = /\.(c|m)?(j|t)s$/;

/**
 * Runs a binary to completion and returns its exit code and output. A non-zero exit resolves;
 * assert on `exitCode`. Running longer than `timeoutMs` rejects. Background processes the
 * binary leaves behind are killed when it exits.
 */
export const runBin = async ({
  bin,
  args = [],
  cwd,
  env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: RunBinOptions): Promise<RunBinResult> => {
  const cmd = SCRIPT_EXTENSION.test(bin) ? [process.execPath, bin, ...args] : [bin, ...args];
  const child = spawnTracked({cmd, cwd, env});
  const output = collectOutput(child);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const isTimedOut = await Promise.race([
    child.exited.then(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), timeoutMs);
    }),
  ]);
  clearTimeout(timer);

  // Grandchildren keep the pipes open, so the whole group goes before reading the rest.
  killGroup(child, "SIGKILL");
  const exitCode = await child.exited;
  await output.drained;

  if (isTimedOut) {
    throw new Error(`${cmd.join(" ")} timed out after ${timeoutMs} ms.\n${output.combined()}`);
  }
  return {exitCode, stderr: output.stderr(), stdout: output.stdout()};
};
