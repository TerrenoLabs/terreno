import {createScopedLogger, logger, runWithRequestContext} from "@terreno/api";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import {beginActiveJobExecution, endActiveJobExecution} from "./activeJobExecution";
import {
  buildClaimOwnershipFilter,
  createClaimLock,
  isAbortError,
  type JobClaimLock,
} from "./claimLock";
import {Job} from "./models/job";
import type {JobAttempt, JobDocument} from "./modelTypes";
import {computeRetryRunAt} from "./retryBackoff";
import type {JobDefinition} from "./types";

export interface JobExecutionHost {
  getDefinition(name: string): JobDefinition | undefined;
  getLockTtlMs(): number;
}

export type ExecuteJobOutcome =
  | {job: JobDocument; kind: "executed"}
  | {job: JobDocument; kind: "noop"}
  | {kind: "conflict"; reason: "locked"}
  | {kind: "conflict"; reason: "not_due"; runAt: Date}
  | {kind: "not_found"};

const TERMINAL_NOOP_STATUSES = new Set(["cancelled", "completed", "dead", "failed"]);

const LEASE_EXPIRED_ERROR = "Lease expired before the previous attempt finished";
const LEASE_EXPIRED_ERROR_CLASS = "LeaseExpired";

/** Result of an atomic claim: a row to run, or a reclaimed row dead-lettered with no attempts left. */
export type JobClaimResult =
  | {claim: JobClaimLock; job: JobDocument; kind: "claimed"}
  | {job: JobDocument; kind: "dead"};

const buildLockExpiry = (lockTtlMs: number, now: Date): Date =>
  DateTime.fromJSDate(now, {zone: "utc"}).minus({milliseconds: lockTtlMs}).toJSDate();

const isLiveLock = (lockedAt: Date | undefined, lockExpiry: Date): boolean =>
  Boolean(lockedAt && lockedAt > lockExpiry);

const classifyConflict = (job: JobDocument, lockExpiry: Date, now: Date): ExecuteJobOutcome => {
  if (job.runAt > now) {
    return {kind: "conflict", reason: "not_due", runAt: job.runAt};
  }

  if (job.status === "running" && isLiveLock(job.lockedAt, lockExpiry)) {
    return {kind: "conflict", reason: "locked"};
  }

  return {kind: "conflict", reason: "locked"};
};

const recordHandlerSuccess = async (
  jobId: JobDocument["_id"],
  claim: JobClaimLock
): Promise<JobDocument> => {
  const updated = await Job.findOneAndUpdate(
    {
      ...buildClaimOwnershipFilter(jobId, claim),
      status: "running",
    },
    {
      $set: {status: "completed"},
      $unset: {lastError: ""},
    },
    {returnDocument: "after"}
  );

  if (!updated) {
    const current = await Job.findOneOrNone({_id: jobId});
    if (current?.status === "cancelled") {
      return current;
    }

    throw new Error(`Failed to record success for job ${jobId.toString()}`);
  }

  return updated;
};

const recordMissingHandlerFailure = async (
  job: JobDocument,
  message: string,
  claim: JobClaimLock
): Promise<JobDocument> => {
  const updated = await Job.findOneAndUpdate(
    buildClaimOwnershipFilter(job._id, claim),
    {
      $set: {
        lastError: message,
        status: "failed",
      },
    },
    {returnDocument: "after"}
  );

  if (!updated) {
    throw new Error(`Failed to record missing handler for job ${job._id.toString()}`);
  }

  return updated;
};

const recordHandlerFailure = async ({
  claim,
  error,
  job,
  signal,
}: {
  claim: JobClaimLock;
  error: unknown;
  job: JobDocument;
  signal: AbortSignal;
}): Promise<JobDocument> => {
  if (signal.aborted && isAbortError(error)) {
    const current = await Job.findOneOrNone({_id: job._id});
    if (current?.status === "cancelled") {
      return current;
    }

    const released = await Job.findOneAndUpdate(
      buildClaimOwnershipFilter(job._id, claim),
      {
        $set: {status: "pending"},
        $unset: {lockedAt: "", lockedBy: ""},
      },
      {returnDocument: "after"}
    );

    if (!released) {
      throw new Error(`Failed to release lock for job ${job._id.toString()}`);
    }

    return released;
  }

  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorClass = error instanceof Error ? error.name : "Error";
  const attemptedAt = DateTime.utc().toJSDate();
  const attemptEntry: JobAttempt = {
    at: attemptedAt,
    error: errorMessage,
    errorClass,
  };
  const nextAttemptCount = job.attemptCount + 1;
  const ownershipFilter = buildClaimOwnershipFilter(job._id, claim);

  if (nextAttemptCount >= job.maxAttempts) {
    const dead = await Job.findOneAndUpdate(
      ownershipFilter,
      {
        $push: {attempts: attemptEntry},
        $set: {
          attemptCount: nextAttemptCount,
          lastError: errorMessage,
          status: "dead",
        },
        $unset: {lockedAt: "", lockedBy: ""},
      },
      {returnDocument: "after"}
    );

    if (!dead) {
      throw new Error(`Failed to record dead status for job ${job._id.toString()}`);
    }

    return dead;
  }

  const runAt = computeRetryRunAt({
    attemptCount: nextAttemptCount,
    backoffMs: job.backoffMs,
    from: DateTime.utc(),
    maxBackoffMs: job.maxBackoffMs,
  }).toJSDate();

  const pending = await Job.findOneAndUpdate(
    ownershipFilter,
    {
      $push: {attempts: attemptEntry},
      $set: {
        attemptCount: nextAttemptCount,
        lastError: errorMessage,
        runAt,
        status: "pending",
      },
      $unset: {lockedAt: "", lockedBy: ""},
    },
    {returnDocument: "after"}
  );

  if (!pending) {
    throw new Error(`Failed to record retry for job ${job._id.toString()}`);
  }

  return pending;
};

const buildLeaseRenewalIntervalMs = (lockTtlMs: number): number =>
  Math.max(1, Math.floor(lockTtlMs / 3));

interface LeaseHeartbeat {
  getClaim: () => JobClaimLock;
  isLeaseLost: () => boolean;
  stop: () => Promise<void>;
}

/**
 * Renews the claim's lockedAt while a handler runs so no other consumer treats the live job as
 * abandoned. Renewals run one at a time; when a renewal no longer matches the claim, the lease is
 * lost and the handler signal is aborted.
 */
const startLeaseHeartbeat = ({
  claim,
  jobId,
  leaseController,
  lockTtlMs,
}: {
  claim: JobClaimLock;
  jobId: JobDocument["_id"];
  leaseController: AbortController;
  lockTtlMs: number;
}): LeaseHeartbeat => {
  let currentClaim = claim;
  let leaseLost = false;
  let stopped = false;
  let renewal: Promise<void> = Promise.resolve();

  const renew = async (): Promise<void> => {
    if (stopped || leaseLost) {
      return;
    }

    const renewedAt = DateTime.utc().toJSDate();
    const renewed = await Job.findOneAndUpdate(
      {...buildClaimOwnershipFilter(jobId, currentClaim), status: "running"},
      {$set: {lockedAt: renewedAt}},
      {returnDocument: "after"}
    );

    if (!renewed) {
      leaseLost = true;
      clearInterval(timer);
      logger.warn(`[jobs] Lost the claim lease for job ${jobId.toString()}; aborting handler`);
      leaseController.abort();
      return;
    }

    currentClaim = {lockedAt: renewedAt, lockedBy: currentClaim.lockedBy};
  };

  const timer = setInterval(() => {
    renewal = renewal.then(renew).catch((error: unknown) => {
      logger.warn(
        `[jobs] Failed to renew the claim lease for job ${jobId.toString()}: ${String(error)}`
      );
    });
  }, buildLeaseRenewalIntervalMs(lockTtlMs));

  return {
    getClaim: (): JobClaimLock => currentClaim,
    isLeaseLost: (): boolean => leaseLost,
    stop: async (): Promise<void> => {
      stopped = true;
      clearInterval(timer);
      await renewal;
    },
  };
};

const linkAbortSignal = (parent: AbortSignal, controller: AbortController): void => {
  if (parent.aborted) {
    controller.abort();
    return;
  }

  parent.addEventListener("abort", () => controller.abort(), {once: true});
};

export const runClaimedJob = async ({
  claim,
  host,
  job,
  signal,
}: {
  claim: JobClaimLock;
  host: JobExecutionHost;
  job: JobDocument;
  signal: AbortSignal;
}): Promise<JobDocument> => {
  const definition = host.getDefinition(job.name);
  if (!definition) {
    const message = `No handler registered for job name "${job.name}"`;
    return recordMissingHandlerFailure(job, message, claim);
  }

  const log = createScopedLogger({
    labels: {jobId: job._id.toString(), jobName: job.name},
    prefix: "[Job]",
  });
  const leaseController = new AbortController();
  linkAbortSignal(signal, leaseController);
  const executionSignal = beginActiveJobExecution(job._id.toString(), leaseController.signal);
  const heartbeat = startLeaseHeartbeat({
    claim,
    jobId: job._id,
    leaseController,
    lockTtlMs: host.getLockTtlMs(),
  });

  let handlerError: unknown;
  let handlerFailed = false;

  try {
    await runWithRequestContext({jobId: job._id.toString()}, async () => {
      await definition.handler(job.payload, {
        jobId: job._id.toString(),
        log,
        signal: executionSignal,
      });
    });
  } catch (error: unknown) {
    handlerFailed = true;
    handlerError = error;
  }

  try {
    await heartbeat.stop();

    // Another consumer owns the row now; its result is the one that counts.
    if (heartbeat.isLeaseLost()) {
      return Job.findExactlyOne({_id: job._id});
    }

    const currentClaim = heartbeat.getClaim();
    if (handlerFailed) {
      return await recordHandlerFailure({
        claim: currentClaim,
        error: handlerError,
        job,
        signal: executionSignal,
      });
    }

    return await recordHandlerSuccess(job._id, currentClaim);
  } finally {
    endActiveJobExecution(job._id.toString());
  }
};

/**
 * Atomically claims one due job matching `filter`. An expired `running` row is reclaimed first and
 * the lost attempt is counted; once that exhausts `maxAttempts` the row is dead-lettered instead of
 * run again.
 */
export const claimDueJob = async ({
  filter = {},
  lockTtlMs,
  now = DateTime.utc().toJSDate(),
  sort,
}: {
  filter?: Record<string, unknown>;
  lockTtlMs: number;
  now?: Date;
  sort?: Record<string, 1 | -1>;
}): Promise<JobClaimResult | undefined> => {
  const lockExpiry = buildLockExpiry(lockTtlMs, now);
  const unlockedOrExpired = [
    {lockedAt: {$exists: false}},
    {lockedAt: null},
    {lockedAt: {$lte: lockExpiry}},
  ];
  const queryOptions = {returnDocument: "after" as const, ...(sort ? {sort} : {})};

  const reclaimLock = createClaimLock(now);
  const reclaimed = await Job.findOneAndUpdate(
    {...filter, $or: unlockedOrExpired, runAt: {$lte: now}, status: "running"},
    {
      $inc: {attemptCount: 1},
      $push: {
        attempts: {at: now, error: LEASE_EXPIRED_ERROR, errorClass: LEASE_EXPIRED_ERROR_CLASS},
      },
      $set: {
        lastError: LEASE_EXPIRED_ERROR,
        lockedAt: reclaimLock.lockedAt,
        lockedBy: reclaimLock.lockedBy,
      },
    },
    queryOptions
  );

  if (reclaimed) {
    if (reclaimed.attemptCount < reclaimed.maxAttempts) {
      return {claim: reclaimLock, job: reclaimed, kind: "claimed"};
    }

    const dead = await Job.findOneAndUpdate(
      buildClaimOwnershipFilter(reclaimed._id, reclaimLock),
      {
        $set: {status: "dead"},
        $unset: {lockedAt: "", lockedBy: ""},
      },
      {returnDocument: "after"}
    );

    if (!dead) {
      throw new Error(`Failed to record dead status for job ${reclaimed._id.toString()}`);
    }

    logger.warn(
      `[jobs] Job ${reclaimed._id.toString()} (${reclaimed.name}) lost its lease with no attempts left; marked dead`
    );
    return {job: dead, kind: "dead"};
  }

  const claimLock = createClaimLock(now);
  const claimed = await Job.findOneAndUpdate(
    {
      ...filter,
      $or: unlockedOrExpired,
      runAt: {$lte: now},
      status: {$in: ["pending", "scheduled"]},
    },
    {
      $set: {
        lockedAt: claimLock.lockedAt,
        lockedBy: claimLock.lockedBy,
        status: "running",
      },
    },
    queryOptions
  );

  if (!claimed) {
    return undefined;
  }

  return {claim: claimLock, job: claimed, kind: "claimed"};
};

export const executeJobById = async ({
  host,
  jobId,
  signal,
}: {
  host: JobExecutionHost;
  jobId: string;
  signal: AbortSignal;
}): Promise<ExecuteJobOutcome> => {
  if (!mongoose.isValidObjectId(jobId)) {
    return {kind: "not_found"};
  }

  const existing = await Job.findOneOrNone({_id: jobId});
  if (!existing) {
    return {kind: "not_found"};
  }

  const now = DateTime.utc().toJSDate();
  const lockExpiry = buildLockExpiry(host.getLockTtlMs(), now);

  if (TERMINAL_NOOP_STATUSES.has(existing.status)) {
    return {job: existing, kind: "noop"};
  }

  if (existing.runAt > now) {
    return {kind: "conflict", reason: "not_due", runAt: existing.runAt};
  }

  if (existing.status === "running" && isLiveLock(existing.lockedAt, lockExpiry)) {
    return {kind: "conflict", reason: "locked"};
  }

  const claimed = await claimDueJob({
    filter: {_id: jobId},
    lockTtlMs: host.getLockTtlMs(),
    now,
  });
  if (!claimed) {
    const refreshed = await Job.findOneOrNone({_id: jobId});
    if (!refreshed) {
      return {kind: "not_found"};
    }

    if (TERMINAL_NOOP_STATUSES.has(refreshed.status)) {
      return {job: refreshed, kind: "noop"};
    }

    return classifyConflict(refreshed, lockExpiry, now);
  }

  if (claimed.kind === "dead") {
    return {job: claimed.job, kind: "executed"};
  }

  const executed = await runClaimedJob({
    claim: claimed.claim,
    host,
    job: claimed.job,
    signal,
  });

  return {job: executed, kind: "executed"};
};
