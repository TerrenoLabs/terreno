import {logger} from "@terreno/api";

import {claimDueJob, runClaimedJob} from "../jobExecutor";
import type {JobDocument} from "../modelTypes";
import type {JobRunner, JobRunnerStartOptions} from "../types";

const DEFAULT_POLL_INTERVAL_MS = 1_000;

/** @internal */
export {getWorkerId, hasWorkerIdPrefix} from "../claimLock";

const waitForAbortOrTimeout = (signal: AbortSignal, timeoutMs: number): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, timeoutMs);

    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };

    signal.addEventListener("abort", onAbort, {once: true});
  });

export class MongoJobRunner implements JobRunner {
  readonly id = "mongo";
  private pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
  private running = false;
  private stopResolve: (() => void) | undefined;

  async enqueue(_job: JobDocument): Promise<void> {
    // Mongo persistence happens before dispatch; the poller picks up the row.
  }

  async start(options: JobRunnerStartOptions): Promise<void> {
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.running = true;

    try {
      while (!options.signal.aborted) {
        await options.jobs.reconcileSchedulesIfDirty();
        await options.jobs.tickSchedules();

        let processedAny = false;

        while (!options.signal.aborted) {
          const processed = await this.processNext(options);
          if (!processed) {
            break;
          }
          processedAny = true;
        }

        if (options.signal.aborted) {
          break;
        }

        if (!processedAny) {
          await waitForAbortOrTimeout(options.signal, this.pollIntervalMs);
        }
      }
    } finally {
      this.running = false;
      this.stopResolve?.();
      this.stopResolve = undefined;
    }
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.stopResolve = resolve;
    });
  }

  private async processNext(options: JobRunnerStartOptions): Promise<boolean> {
    const claimed = await claimDueJob({
      lockTtlMs: options.jobs.getLockTtlMs(),
      sort: {runAt: 1},
    });

    if (!claimed) {
      return false;
    }

    if (claimed.kind === "dead") {
      return true;
    }

    // A failure to finalize one job (for example a lost lease) must not end the poll loop.
    try {
      await runClaimedJob({
        claim: claimed.claim,
        host: options.jobs,
        job: claimed.job,
        signal: options.signal,
      });
    } catch (error: unknown) {
      logger.error(`[jobs] Failed to finalize job ${claimed.job._id.toString()}: ${String(error)}`);
    }
    return true;
  }
}
