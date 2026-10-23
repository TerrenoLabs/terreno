import {DateTime} from "luxon";

import {timeout} from "../utils/timeout";
import {collectOutput, killGroup, spawnTracked} from "./childProcesses";

export interface SpawnUntilReadyOptions {
  /** Command and arguments, e.g. `[process.execPath, "e2e/smoke.ts", "serve"]`. */
  cmd: string[];
  /** URL polled until it answers 2xx. */
  url: string;
  /** How long the child may take to answer 2xx. Default 20 000 ms. */
  timeoutMs?: number;
  cwd?: string;
  /** Merged over the parent environment. */
  env?: Record<string, string | undefined>;
}

export interface SpawnedProcess {
  pid: number;
  /** Everything the child wrote to stdout and stderr so far. */
  output: () => string;
  /**
   * Sends SIGTERM to the child's process group, then SIGKILL after 5 s. Safe to call more
   * than once.
   */
  stop: () => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 20000;
const POLL_INTERVAL_MS = 100;
const STOP_GRACE_MS = 5000;
const OUTPUT_TAIL_CHARS = 4000;

const tail = (text: string): string =>
  text.length > OUTPUT_TAIL_CHARS ? `…${text.slice(-OUTPUT_TAIL_CHARS)}` : text;

/**
 * Starts a long-running child (a server) and resolves once `url` answers 2xx. Rejects with the
 * child's output when it exits first or is not ready within `timeoutMs`, and kills it. The
 * child's process group is also killed when the smoke process exits.
 */
export const spawnUntilReady = async ({
  cmd,
  url,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  cwd,
  env,
}: SpawnUntilReadyOptions): Promise<SpawnedProcess> => {
  const child = spawnTracked({cmd, cwd, env});
  const output = collectOutput(child);
  let isStopped = false;

  const stop = async (): Promise<void> => {
    if (isStopped) {
      return;
    }
    isStopped = true;
    killGroup(child, "SIGTERM");
    const exited = await Promise.race([
      child.exited.then(() => true),
      timeout(STOP_GRACE_MS).then(() => false),
    ]);
    // Anything the child started and left behind goes too.
    killGroup(child, "SIGKILL");
    if (!exited) {
      await child.exited;
    }
  };

  const command = cmd.join(" ");
  const deadline = DateTime.now().plus({milliseconds: timeoutMs});
  let lastResult = "no response";
  while (DateTime.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      await stop();
      await output.drained;
      throw new Error(
        `${command} exited with code ${child.exitCode ?? child.signalCode} before ${url} was ready.\n${tail(output.combined())}`
      );
    }
    try {
      const res = await fetch(url, {signal: AbortSignal.timeout(1000)});
      await res.body?.cancel();
      if (res.ok) {
        return {output: output.combined, pid: child.pid, stop};
      }
      lastResult = `status ${res.status}`;
    } catch (error: unknown) {
      lastResult = error instanceof Error ? error.message : String(error);
    }
    await timeout(POLL_INTERVAL_MS);
  }

  await stop();
  throw new Error(
    `${command} (pid ${child.pid}) was not ready at ${url} within ${timeoutMs} ms (last: ${lastResult}).\n${tail(output.combined())}`
  );
};
