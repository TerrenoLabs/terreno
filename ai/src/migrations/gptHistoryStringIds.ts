/**
 * Data migration for Terreno 58: GptHistory became a synced collection with String `_id`s.
 * Histories saved before 58 have ObjectId `_id`s, which sync clients and the String-typed
 * schema cannot address. This migration re-inserts each one with `_id` set to the same id's
 * hex string, so URLs and client caches that hold the hex id keep working, rewrites
 * `AIDataset.historyId` refs to that hex string, and then deletes the ObjectId originals.
 *
 * It writes through the native driver: `syncPlugin` forbids the hard deletes and
 * multi-document writes a move needs, and the copies keep every stored field as-is.
 * Running it again is a no-op.
 */
import type {MigrationContext, MigrationLogger} from "@terreno/api";
import type mongoose from "mongoose";

import {AIDataset} from "../models/aiDataset";
import {GptHistory} from "../models/gptHistory";

/** Slug for the timestamped file an app adds to its `migrations/` directory. */
export const GPT_HISTORY_STRING_IDS_MIGRATION = "gpt-history-string-ids";

const DEFAULT_BATCH_SIZE = 500;

const DUPLICATE_KEY_CODE = 11000;

/** Only ObjectId `_id`s still need a move; String ids are already migrated or new. */
const OBJECT_ID_FILTER = {_id: {$type: "objectId" as const}};

/** Server-side ObjectId → hex string, so refs move without reading each dataset. */
const HISTORY_ID_TO_STRING = [{$set: {historyId: {$toString: "$historyId"}}}];

export interface GptHistoryStringIdsResult {
  /** AIDataset rows whose ObjectId `historyId` was rewritten (or would be, in a dry run). */
  datasetsUpdated: number;
  /** Histories moved to a String `_id` (or that would move, in a dry run). */
  historiesMigrated: number;
}

interface WriteErrorLike {
  code?: number;
  writeErrors?: Array<{code?: number}>;
}

/** An insert that failed only because the hex-id copy exists from an interrupted earlier run. */
const isOnlyDuplicateKeyError = (error: unknown): boolean => {
  const writeError = error as WriteErrorLike;
  if (writeError.writeErrors?.length) {
    return writeError.writeErrors.every((item) => item.code === DUPLICATE_KEY_CODE);
  }
  return writeError.code === DUPLICATE_KEY_CODE;
};

const insertCopies = async ({
  collection,
  copies,
}: {
  collection: mongoose.mongo.Collection;
  copies: mongoose.mongo.Document[];
}): Promise<void> => {
  try {
    await collection.insertMany(copies, {ordered: false});
  } catch (error) {
    if (!isOnlyDuplicateKeyError(error)) {
      throw error;
    }
  }
};

/**
 * Moves every ObjectId-id GptHistory to its hex-string id in batches and rewrites the
 * AIDataset refs. In a dry run it only counts what it would change.
 */
export const migrateGptHistoryStringIds = async ({
  batchSize = DEFAULT_BATCH_SIZE,
  checkCancellation,
  connection,
  dryRun,
  logger,
}: {
  batchSize?: number;
  checkCancellation?: () => Promise<void>;
  connection: mongoose.Connection;
  dryRun: boolean;
  logger?: MigrationLogger;
}): Promise<GptHistoryStringIdsResult> => {
  const histories = connection.collection(GptHistory.collection.collectionName);
  const datasets = connection.collection(AIDataset.collection.collectionName);
  const datasetFilter = {historyId: {$type: "objectId" as const}};

  if (dryRun) {
    const result = {
      datasetsUpdated: await datasets.countDocuments(datasetFilter),
      historiesMigrated: await histories.countDocuments(OBJECT_ID_FILTER),
    };
    logger?.info(`[${GPT_HISTORY_STRING_IDS_MIGRATION}] dry run`, result);
    return result;
  }

  let historiesMigrated = 0;
  let datasetsUpdated = 0;
  while (true) {
    await checkCancellation?.();
    const batch = await histories.find(OBJECT_ID_FILTER).limit(batchSize).toArray();
    if (batch.length === 0) {
      break;
    }
    const originalIds = batch.map((doc) => doc._id);
    // Copy first and delete second, so an interrupted run never loses a history: the next
    // run finds the original again and the copy's duplicate key is ignored.
    await insertCopies({
      collection: histories,
      copies: batch.map((doc) => ({...doc, _id: String(doc._id)})),
    });
    const moved = await datasets.updateMany({historyId: {$in: originalIds}}, HISTORY_ID_TO_STRING);
    datasetsUpdated += moved.modifiedCount;
    await histories.deleteMany({_id: {$in: originalIds}});
    historiesMigrated += batch.length;
    logger?.info(
      `[${GPT_HISTORY_STRING_IDS_MIGRATION}] moved ${historiesMigrated} histories to String ids`
    );
  }

  // Refs whose history was moved by an interrupted run, or never existed, still hold ObjectIds.
  const remaining = await datasets.updateMany(datasetFilter, HISTORY_ID_TO_STRING);
  datasetsUpdated += remaining.modifiedCount;
  const result = {datasetsUpdated, historiesMigrated};
  logger?.info(`[${GPT_HISTORY_STRING_IDS_MIGRATION}] done`, result);
  return result;
};

/**
 * Ready-made `up` for an app's `migrations/<YYYYMMDDHHmmss>-gpt-history-string-ids.ts` file.
 * Run it before deploying Terreno 58 frontends, which address histories by String id. It has
 * no `down`: new histories get UUIDs, which have no ObjectId to go back to.
 */
export const gptHistoryStringIdsMigration = {
  slug: GPT_HISTORY_STRING_IDS_MIGRATION,
  up: async (ctx: MigrationContext): Promise<void> => {
    const result = await migrateGptHistoryStringIds({
      checkCancellation: ctx.checkCancellation,
      connection: ctx.mongoose.connection,
      dryRun: ctx.dryRun,
      logger: ctx.logger,
    });
    await ctx.addLog?.(
      "info",
      `[${GPT_HISTORY_STRING_IDS_MIGRATION}] ${ctx.dryRun ? "would move" : "moved"} ` +
        `${result.historiesMigrated} histories and ${result.datasetsUpdated} dataset refs`
    );
  },
};
