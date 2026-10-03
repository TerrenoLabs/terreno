import {randomUUID} from "node:crypto";
import {hostname} from "node:os";
import {logger} from "@terreno/api";
import {Duration, type DurationLike} from "luxon";

import type {HarnessLeaseSettings, HarnessRunner, HarnessRunnerContext} from "../../types/harness";
import {errorMessage, harnessError} from "../errors";

export interface InProcessRunnerOptions {
  /** How often the runner renews its owner lease and its running task's lease. */
  heartbeatInterval?: DurationLike;
  /** How long the owner lease and each task lease live without a heartbeat. */
  leaseDuration?: DurationLike;
  /** Runner instance id written into leases. Defaults to `hostname:pid:uuid`. */
  ownerId?: string;
  /** How long an idle owner sleeps before polling for runnable tasks again. */
  pollInterval?: DurationLike;
}

/** `owner` drains tasks; `standby` waits for the owner lease; `stopped` does neither. */
export const IN_PROCESS_RUNNER_ROLES = {
  owner: "owner",
  standby: "standby",
  stopped: "stopped",
} as const;

export type InProcessRunnerRole =
  (typeof IN_PROCESS_RUNNER_ROLES)[keyof typeof IN_PROCESS_RUNNER_ROLES];

/**
 * Executes runnable tasks inside this process, one at a time, until each is terminal.
 * Only the process holding the singleton `HarnessOwner` lease drains; every other
 * process stays on standby and takes over once that lease expires. On becoming owner,
 * and on every heartbeat while owner, it recovers tasks whose lease expired.
 */
export class InProcessRunner implements HarnessRunner {
  private context: HarnessRunnerContext | undefined;
  private heartbeatInFlight: Promise<void> = Promise.resolve();
  private heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  private hasPendingWake = false;
  private isHeartbeatStopped = false;
  private isStopping = false;
  private readonly lease: HarnessLeaseSettings;
  private loop: Promise<void> | undefined;
  private readonly pollIntervalMs: number;
  private currentRole: InProcessRunnerRole = IN_PROCESS_RUNNER_ROLES.stopped;
  private wakeSleeper: (() => void) | undefined;

  constructor(options: InProcessRunnerOptions = {}) {
    const duration = Duration.fromDurationLike(options.leaseDuration ?? {seconds: 30});
    const heartbeat = Duration.fromDurationLike(options.heartbeatInterval ?? {seconds: 10});
    if (heartbeat.toMillis() <= 0 || heartbeat.toMillis() >= duration.toMillis()) {
      throw harnessError({
        detail: "InProcessRunner heartbeatInterval must be positive and shorter than leaseDuration",
        kind: "configInvalid",
      });
    }
    this.lease = {
      duration,
      heartbeat,
      owner: options.ownerId ?? `${hostname()}:${process.pid}:${randomUUID()}`,
    };
    this.pollIntervalMs = Duration.fromDurationLike(
      options.pollInterval ?? {milliseconds: 250}
    ).toMillis();
  }

  /** Whether this runner currently drains tasks, waits for the lease, or is stopped. */
  get role(): InProcessRunnerRole {
    return this.currentRole;
  }

  /** Id written into every lease this runner holds. */
  get ownerId(): string {
    return this.lease.owner;
  }

  async start(context: HarnessRunnerContext): Promise<void> {
    if (this.loop !== undefined) {
      throw harnessError({detail: "InProcessRunner is already started", kind: "alreadyStarted"});
    }
    this.context = context;
    this.isStopping = false;
    this.isHeartbeatStopped = false;
    this.currentRole = IN_PROCESS_RUNNER_ROLES.standby;
    this.loop = this.drain();
    this.scheduleHeartbeat();
  }

  /** Stop claiming new work, wait for the task in flight, then release the owner lease. */
  async stop(): Promise<void> {
    if (this.loop === undefined) {
      return;
    }
    this.isStopping = true;
    this.wake();
    // Keep renewing the owner lease until the task in flight settles, so a standby does
    // not take over while this process is still working.
    await this.loop;
    this.isHeartbeatStopped = true;
    clearTimeout(this.heartbeatTimer);
    await this.heartbeatInFlight;
    const context = this.context;
    if (context && this.currentRole === IN_PROCESS_RUNNER_ROLES.owner) {
      try {
        await context.releaseOwnerLease(this.lease);
      } catch (error: unknown) {
        logger.warn(`InProcessRunner could not release the owner lease: ${errorMessage(error)}`);
      }
    }
    this.currentRole = IN_PROCESS_RUNNER_ROLES.stopped;
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
      if (this.currentRole !== IN_PROCESS_RUNNER_ROLES.owner) {
        const isOwner = await this.tryTakeOwnership(this.context);
        if (!isOwner) {
          await this.sleep(this.lease.heartbeat.toMillis());
          continue;
        }
      }
      const isIdle = await this.runNext(this.context);
      if (isIdle && !this.isStopping) {
        await this.sleep(this.pollIntervalMs);
      }
    }
  }

  /** Become owner when the lease is free or expired, then recover abandoned tasks. */
  private async tryTakeOwnership(context: HarnessRunnerContext): Promise<boolean> {
    try {
      if (!(await context.acquireOwnerLease(this.lease))) {
        return false;
      }
      this.currentRole = IN_PROCESS_RUNNER_ROLES.owner;
      logger.info(`InProcessRunner ${this.lease.owner} now owns harness execution`);
      await context.recoverExpired();
      return true;
    } catch (error: unknown) {
      logger.error(`InProcessRunner could not take ownership: ${errorMessage(error)}`);
      return this.currentRole === IN_PROCESS_RUNNER_ROLES.owner;
    }
  }

  /** Run one claimed task; returns true when nothing was runnable. */
  private async runNext(context: HarnessRunnerContext): Promise<boolean> {
    try {
      const task = await context.claimNext(this.lease);
      if (!task) {
        return true;
      }
      await context.runTask(task, this.lease);
      return false;
    } catch (error: unknown) {
      logger.error(`InProcessRunner iteration failed: ${errorMessage(error)}`);
      return true;
    }
  }

  private scheduleHeartbeat(): void {
    if (this.isHeartbeatStopped) {
      return;
    }
    this.heartbeatTimer = setTimeout(() => {
      this.heartbeatInFlight = this.heartbeat().finally(() => this.scheduleHeartbeat());
    }, this.lease.heartbeat.toMillis());
  }

  /** Renew the owner lease and sweep for expired task leases; demote on a lost lease. */
  private async heartbeat(): Promise<void> {
    const context = this.context;
    if (!context || this.currentRole !== IN_PROCESS_RUNNER_ROLES.owner) {
      return;
    }
    try {
      if (!(await context.acquireOwnerLease(this.lease))) {
        this.currentRole = IN_PROCESS_RUNNER_ROLES.standby;
        logger.warn(`InProcessRunner ${this.lease.owner} lost the owner lease; now standby`);
        return;
      }
      // A stopping owner only holds the lease for its last task; recovery is the next owner's job.
      if (!this.isStopping && (await context.recoverExpired()) > 0) {
        this.wake();
      }
    } catch (error: unknown) {
      logger.warn(`InProcessRunner heartbeat failed: ${errorMessage(error)}`);
    }
  }

  private sleep(ms: number): Promise<void> {
    if (this.hasPendingWake) {
      this.hasPendingWake = false;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wakeSleeper = undefined;
        resolve();
      }, ms);
      this.wakeSleeper = () => {
        clearTimeout(timer);
        this.wakeSleeper = undefined;
        resolve();
      };
    });
  }
}
