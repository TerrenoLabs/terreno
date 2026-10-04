import {randomUUID} from "node:crypto";
import {hostname} from "node:os";
import {logger} from "@terreno/api";
import {type JobDocument, type JobsApp, tryGetJobsService} from "@terreno/jobs";
import {DateTime, Duration, type DurationLike} from "luxon";

import type {
  HarnessLeaseSettings,
  HarnessRunnableTask,
  HarnessRunner,
  HarnessRunnerContext,
} from "../../types/harness";
import {errorMessage, harnessError} from "../errors";

/** Job that runs one phase of one harness task. */
export const HARNESS_PHASE_JOB_NAME = "terreno.harness.phase";

/** Job statuses that still lead to a handler run; any other status will never claim. */
const IN_FLIGHT_JOB_STATUSES = new Set<JobDocument["status"]>(["pending", "running", "scheduled"]);

export interface JobsRunnerOptions {
  /** How many runnable tasks one dispatch tick enqueues at most. */
  dispatchBatchSize?: number;
  /** How often a running phase renews its task lease, and how often expired leases are swept. */
  heartbeatInterval?: DurationLike;
  /** The registered `JobsApp`; the runner defines `terreno.harness.phase` on it. */
  jobs: JobsApp;
  /** How long a task lease lives without a heartbeat. */
  leaseDuration?: DurationLike;
  /** Runner instance id written into task leases. Defaults to `hostname:pid:uuid`. */
  ownerId?: string;
  /** How long the dispatcher sleeps between scans for runnable tasks. */
  pollInterval?: DurationLike;
}

interface PhaseJobPayload {
  taskId: string;
}

const parsePayload = (payload: unknown): PhaseJobPayload => {
  const taskId = (payload as Partial<PhaseJobPayload> | null)?.taskId;
  if (typeof taskId !== "string" || !taskId) {
    throw harnessError({
      detail: `${HARNESS_PHASE_JOB_NAME} payload needs a taskId string`,
      kind: "invalidRequest",
    });
  }
  return {taskId};
};

/** `taskId:phase:attempt:claims` — one key per runnable visit of a phase. */
const phaseJobKey = (task: HarnessRunnableTask): string =>
  `${task.taskId}:${task.phase}:${task.attempt}:${task.claims}`;

/**
 * Executes harness phases as `@terreno/jobs` jobs so any number of instances share the
 * work. Every instance runs a dispatcher that enqueues one `terreno.harness.phase` job per
 * runnable task (deduplicated by idempotency key) and sweeps expired task leases. The job
 * handler claims its task under a fenced lease, runs one phase while heartbeating, and
 * hands a still-running task back as `pending` for the next job. The task lease, not the
 * job lock, decides who may commit: a duplicate or late job finds the task claimed and
 * does nothing, and a stale lease holder's commit is rejected.
 */
export class JobsRunner implements HarnessRunner {
  private context: HarnessRunnerContext | undefined;
  private readonly dispatchBatchSize: number;
  private hasPendingWake = false;
  private readonly inFlight = new Set<Promise<void>>();
  private isStopping = false;
  private readonly lease: HarnessLeaseSettings;
  private loop: Promise<void> | undefined;
  private nextSweepAt = DateTime.fromMillis(0);
  private readonly pollIntervalMs: number;
  private wakeSleeper: (() => void) | undefined;

  constructor(options: JobsRunnerOptions) {
    const duration = Duration.fromDurationLike(options.leaseDuration ?? {seconds: 30});
    const heartbeat = Duration.fromDurationLike(options.heartbeatInterval ?? {seconds: 10});
    if (heartbeat.toMillis() <= 0 || heartbeat.toMillis() >= duration.toMillis()) {
      throw harnessError({
        detail: "JobsRunner heartbeatInterval must be positive and shorter than leaseDuration",
        kind: "configInvalid",
      });
    }
    this.lease = {
      duration,
      heartbeat,
      owner: options.ownerId ?? `${hostname()}:${process.pid}:${randomUUID()}`,
    };
    this.pollIntervalMs = Duration.fromDurationLike(
      options.pollInterval ?? {milliseconds: 500}
    ).toMillis();
    this.dispatchBatchSize = options.dispatchBatchSize ?? 100;
    options.jobs.define(HARNESS_PHASE_JOB_NAME, {
      handler: (payload) => this.runPhaseJob(payload),
    });
  }

  /** Id written into every task lease this runner holds. */
  get ownerId(): string {
    return this.lease.owner;
  }

  async start(context: HarnessRunnerContext): Promise<void> {
    if (this.loop !== undefined) {
      throw harnessError({detail: "JobsRunner is already started", kind: "alreadyStarted"});
    }
    if (!tryGetJobsService()) {
      throw harnessError({
        detail:
          "JobsRunner needs a registered JobsApp: register it and build the app before harness.start()",
        kind: "configInvalid",
      });
    }
    this.context = context;
    this.isStopping = false;
    this.nextSweepAt = DateTime.fromMillis(0);
    this.loop = this.dispatchLoop();
  }

  /** Stop dispatching, then wait for every phase this instance is running. */
  async stop(): Promise<void> {
    if (this.loop === undefined) {
      return;
    }
    this.isStopping = true;
    this.wake();
    await this.loop;
    await Promise.allSettled([...this.inFlight]);
    this.loop = undefined;
    this.context = undefined;
  }

  /** Dispatch now instead of after the rest of the idle sleep. */
  wake(): void {
    if (this.wakeSleeper) {
      this.wakeSleeper();
      return;
    }
    this.hasPendingWake = true;
  }

  /** Job handler: claim the task, run one phase, and hand it back if it still runs. */
  private async runPhaseJob(payload: unknown): Promise<void> {
    const {taskId} = parsePayload(payload);
    // Tracked from before the claim, so stop() also waits for a claim in flight.
    const job = this.claimAndRunPhase(taskId);
    this.inFlight.add(job);
    try {
      await job;
    } finally {
      this.inFlight.delete(job);
    }
  }

  private async claimAndRunPhase(taskId: string): Promise<void> {
    const context = this.context;
    if (!context || this.isStopping) {
      // Throwing makes the jobs worker retry later, on this instance or another one.
      throw harnessError({
        detail: `JobsRunner is not running; task ${taskId} stays runnable`,
        kind: "runnerStopped",
      });
    }
    const task = await context.claimTask(taskId, this.lease);
    if (!task) {
      // Another job claimed it first, or it stopped being runnable since dispatch.
      return;
    }
    await context.runTask(task, this.lease, {maxPhases: 1});
    // The next phase (or a retry that is already due) can be dispatched right away.
    this.wake();
  }

  private async dispatchLoop(): Promise<void> {
    while (!this.isStopping && this.context) {
      await this.tick(this.context);
      if (!this.isStopping) {
        await this.sleep(this.pollIntervalMs);
      }
    }
  }

  /** Recover expired leases once per heartbeat, then enqueue a job per runnable task. */
  private async tick(context: HarnessRunnerContext): Promise<void> {
    try {
      if (DateTime.now() >= this.nextSweepAt) {
        this.nextSweepAt = DateTime.now().plus(this.lease.heartbeat);
        await context.recoverExpired();
      }
      const runnable = await context.listRunnable(this.dispatchBatchSize);
      for (const task of runnable) {
        if (this.isStopping) {
          return;
        }
        await this.dispatch(task);
      }
    } catch (error: unknown) {
      logger.error(`JobsRunner dispatch failed: ${errorMessage(error)}`);
    }
  }

  /**
   * Enqueue the job for this runnable visit. When the job with that key already ended
   * without claiming the task (its handler kept failing, or it ran where the task was not
   * runnable), follow or extend the chain `<key>:<endedJobId>` until a job is in flight, so
   * the task is not stranded. A newly created job is always in flight, so this ends.
   */
  private async dispatch(task: HarnessRunnableTask): Promise<void> {
    const jobs = tryGetJobsService();
    if (!jobs) {
      throw harnessError({detail: "JobsApp is no longer registered", kind: "configInvalid"});
    }
    let idempotencyKey = phaseJobKey(task);
    for (;;) {
      const job = await jobs.enqueue({
        idempotencyKey,
        name: HARNESS_PHASE_JOB_NAME,
        payload: {taskId: task.taskId} satisfies PhaseJobPayload,
      });
      if (IN_FLIGHT_JOB_STATUSES.has(job.status)) {
        return;
      }
      idempotencyKey = `${phaseJobKey(task)}:${job._id}`;
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
