import {logger} from "@terreno/api";
import {Duration, type DurationLike} from "luxon";

import type {HarnessRunner, HarnessRunnerContext} from "../../types/harness";

export interface InProcessRunnerOptions {
  /** How long an idle runner sleeps before polling for runnable tasks again. */
  pollInterval?: DurationLike;
}

/**
 * Executes runnable tasks inside this process, one at a time, until each is terminal.
 * Task 1.2 adds the `HarnessOwner` lease so only one process drains at a time.
 */
export class InProcessRunner implements HarnessRunner {
  private context: HarnessRunnerContext | undefined;
  private loop: Promise<void> | undefined;
  private readonly pollIntervalMs: number;
  private hasPendingWake = false;
  private isStopping = false;
  private wakeSleeper: (() => void) | undefined;

  constructor(options: InProcessRunnerOptions = {}) {
    this.pollIntervalMs = Duration.fromDurationLike(
      options.pollInterval ?? {milliseconds: 250}
    ).toMillis();
  }

  async start(context: HarnessRunnerContext): Promise<void> {
    if (this.loop !== undefined) {
      throw new Error("InProcessRunner is already started");
    }
    this.context = context;
    this.isStopping = false;
    this.loop = this.drain();
  }

  /** Stop claiming new work and wait for the task in flight to settle. */
  async stop(): Promise<void> {
    this.isStopping = true;
    this.wake();
    await this.loop;
    this.loop = undefined;
    this.context = undefined;
  }

  /** Skip the rest of the idle sleep, e.g. right after a task is created. */
  wake(): void {
    if (this.wakeSleeper) {
      this.wakeSleeper();
      return;
    }
    // Remember a wake that lands between a claim and the next sleep.
    this.hasPendingWake = true;
  }

  private async drain(): Promise<void> {
    while (!this.isStopping && this.context) {
      const isIdle = await this.runNext(this.context);
      if (isIdle && !this.isStopping) {
        await this.sleep();
      }
    }
  }

  /** Run one claimed task; returns true when nothing was runnable. */
  private async runNext(context: HarnessRunnerContext): Promise<boolean> {
    try {
      const task = await context.claimNext();
      if (!task) {
        return true;
      }
      await context.runTask(task);
      return false;
    } catch (error: unknown) {
      logger.error(`InProcessRunner iteration failed: ${String(error)}`);
      return true;
    }
  }

  private sleep(): Promise<void> {
    if (this.hasPendingWake) {
      this.hasPendingWake = false;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wakeSleeper = undefined;
        resolve();
      }, this.pollIntervalMs);
      this.wakeSleeper = () => {
        clearTimeout(timer);
        this.wakeSleeper = undefined;
        resolve();
      };
    });
  }
}
