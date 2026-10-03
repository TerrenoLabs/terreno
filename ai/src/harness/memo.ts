import {DateTime} from "luxon";
import type mongoose from "mongoose";

import type {HarnessLeaseSettings, HarnessMemo} from "../types/harness";
import {HARNESS_TASK_STATUSES} from "../types/harness";
import {HarnessCommitConflictError, type HarnessModels, isDuplicateKeyError} from "./commit";
import {inTransaction} from "./transaction";

/** The run allowed to write: its task, phase, and lease token. */
export interface MemoFence {
  phase: string;
  taskId: mongoose.Types.ObjectId;
  token: string | undefined;
}

/** JSON copy of a memo value; throws for values JSON cannot represent. */
const toMemoValue = (key: string, value: unknown): unknown => {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch (error: unknown) {
    throw new Error(
      `memo "${key}": value is not JSON-serializable (${error instanceof Error ? error.message : String(error)})`
    );
  }
  if (serialized === undefined) {
    throw new Error(`memo "${key}": value is not JSON-serializable`);
  }
  return JSON.parse(serialized);
};

/**
 * Build a memo function scoped to `scopeTaskId`. Reads return the stored value. A write
 * runs in its own transaction: it renews the fenced run's lease (so a run that lost its
 * lease writes nothing and conflicts with a concurrent commit or takeover), then inserts
 * the row only when the key is unset. The stored value is returned, so the first write
 * wins across concurrent calls, replays, and processes.
 */
export const createMemo = ({
  assertWritable,
  fence,
  lease,
  models,
  scopeTaskId,
}: {
  /** Throws when the phase can no longer write (it already committed). */
  assertWritable: () => void;
  fence: MemoFence;
  lease: HarnessLeaseSettings;
  models: HarnessModels;
  scopeTaskId: mongoose.Types.ObjectId;
}): HarnessMemo => {
  const read = async (key: string): Promise<unknown> => {
    const row = await models.memo.findOneOrNone({key, taskId: scopeTaskId});
    return row?.value;
  };

  const write = async (key: string, value: unknown): Promise<unknown> => {
    assertWritable();
    const stored = toMemoValue(key, value);
    try {
      await inTransaction(async (session) => {
        const renewed = await models.task.updateOne(
          {
            _id: fence.taskId,
            "lease.token": fence.token ?? null,
            phase: fence.phase,
            status: HARNESS_TASK_STATUSES.running,
          },
          {$set: {"lease.expiresAt": DateTime.now().plus(lease.duration).toJSDate()}},
          {session}
        );
        if (renewed.matchedCount === 0) {
          throw new HarnessCommitConflictError(String(fence.taskId), fence.phase);
        }
        await models.memo.updateOne(
          {key, taskId: scopeTaskId},
          {$setOnInsert: {key, taskId: scopeTaskId, value: stored}},
          {session, upsert: true}
        );
      });
    } catch (error: unknown) {
      // A concurrent first write inserted the row between our read and upsert.
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
    }
    return read(key);
  };

  const memo = async (key: string, ...rest: unknown[]): Promise<unknown> => {
    if (typeof key !== "string" || !key.trim()) {
      throw new Error("memo requires a non-empty key");
    }
    if (rest.length === 0 || rest[0] === undefined) {
      return read(key);
    }
    return write(key, rest[0]);
  };
  return memo as HarnessMemo;
};
