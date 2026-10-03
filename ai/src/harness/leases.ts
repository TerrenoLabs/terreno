import {logger} from "@terreno/api";
import {DateTime} from "luxon";
import type mongoose from "mongoose";

import type {HarnessLeaseSettings, HarnessTestHooks} from "../types/harness";
import {HARNESS_TASK_STATUSES} from "../types/harness";
import {type HarnessModels, isDuplicateKeyError} from "./commit";

/** `HarnessOwner.key` of the lease every `InProcessRunner` competes for. */
const DEFAULT_OWNER_LEASE_KEY = "default";

/**
 * Take the owner lease when it is free or expired, or renew it when `lease.owner`
 * already holds it. Returns false when another live owner holds it.
 */
export const acquireOwnerLease = async ({
  lease,
  models,
  testHooks,
}: {
  lease: HarnessLeaseSettings;
  models: HarnessModels;
  testHooks?: HarnessTestHooks;
}): Promise<boolean> => {
  if (testHooks?.isHeartbeatSuspended?.()) {
    return false;
  }
  const now = DateTime.now();
  try {
    const held = await models.owner.findOneAndUpdate(
      {
        $or: [{owner: lease.owner}, {expiresAt: {$lte: now.toJSDate()}}],
        key: DEFAULT_OWNER_LEASE_KEY,
      },
      {$set: {expiresAt: now.plus(lease.duration).toJSDate(), owner: lease.owner}},
      {returnDocument: "after", upsert: true}
    );
    return held?.owner === lease.owner;
  } catch (error: unknown) {
    // A live owner's row exists, so the upsert collided with the unique key.
    if (isDuplicateKeyError(error)) {
      return false;
    }
    throw error;
  }
};

/** Expire the owner lease now so a standby takes over without waiting it out. */
export const releaseOwnerLease = async ({
  lease,
  models,
}: {
  lease: HarnessLeaseSettings;
  models: HarnessModels;
}): Promise<void> => {
  await models.owner.updateOne(
    {key: DEFAULT_OWNER_LEASE_KEY, owner: lease.owner},
    {$set: {expiresAt: DateTime.now().toJSDate()}}
  );
};

export interface TaskHeartbeat {
  /** Stop renewing and wait for a renewal in flight. */
  stop: () => Promise<void>;
}

/**
 * Renew one task lease every `lease.heartbeat` while a phase runs. Renewal is fenced on
 * the lease token; once it no longer matches (another runner took the task) renewal
 * stops, `onLost` fires, and the phase's eventual commit is rejected.
 */
export const startTaskHeartbeat = ({
  lease,
  models,
  onLost,
  taskId,
  testHooks,
  token,
}: {
  lease: HarnessLeaseSettings;
  models: HarnessModels;
  /** Called once when renewal finds the lease gone (taken over, aborted, or settled). */
  onLost?: () => void;
  taskId: mongoose.Types.ObjectId;
  testHooks?: HarnessTestHooks;
  token: string | undefined;
}): TaskHeartbeat => {
  let isStopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> = Promise.resolve();

  const renew = async (): Promise<void> => {
    if (testHooks?.isHeartbeatSuspended?.()) {
      schedule();
      return;
    }
    try {
      const result = await models.task.updateOne(
        {_id: taskId, "lease.token": token ?? null, status: HARNESS_TASK_STATUSES.running},
        {$set: {"lease.expiresAt": DateTime.now().plus(lease.duration).toJSDate()}}
      );
      if (result.matchedCount === 0) {
        logger.warn(`Harness task ${taskId} lost its lease; the running phase cannot commit`);
        isStopped = true;
        onLost?.();
        return;
      }
    } catch (error: unknown) {
      logger.warn(`Harness task ${taskId} lease renewal failed: ${String(error)}`);
    }
    schedule();
  };

  const schedule = (): void => {
    if (isStopped) {
      return;
    }
    timer = setTimeout(() => {
      inFlight = renew();
    }, lease.heartbeat.toMillis());
  };

  schedule();
  return {
    stop: async () => {
      isStopped = true;
      clearTimeout(timer);
      await inFlight;
    },
  };
};
