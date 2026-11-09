/**
 * Built-in data migration for Terreno 58: McpServiceToken became a synced collection with
 * String `_id`s. Rows minted before 58 have ObjectId `_id`s; this migration re-inserts each
 * one with `_id = oldId.toHexString()` and deletes the original, so existing tokens keep
 * the same id string clients already saw.
 *
 * Apps run it through their own `migrations/` directory (see `run-mongodb-migrations.md`):
 *
 * ```typescript
 * // migrations/20261022120000-mcp-service-token-string-ids.ts
 * import {mcpServiceTokenStringIdsMigration} from "@terreno/api";
 *
 * export const id = "20261022120000-mcp-service-token-string-ids";
 * export const up = mcpServiceTokenStringIdsMigration.up;
 * ```
 *
 * Idempotent: only ObjectId-keyed rows are selected, and a run interrupted mid-row resumes
 * cleanly. It works on standalone servers (no transaction): the original row's unique
 * `tokenHash` is parked behind a marker prefix before the copy is inserted, so a crash never
 * loses a row. That token fails MCP auth only for the instant between park and copy.
 */
import type mongoose from "mongoose";

import type {MigrationContext} from "../types";

export const MCP_SERVICE_TOKEN_STRING_IDS_SLUG = "mcp-service-token-string-ids";

const COLLECTION_NAME = "mcpservicetokens";
const BATCH_SIZE = 200;
const PARKED_HASH_PREFIX = "mcp-service-token-string-ids:";
const LEGACY_ID_FILTER = {_id: {$type: "objectId" as const}};

interface LegacyTokenRow {
  _id: mongoose.Types.ObjectId;
  deleted?: boolean;
  tokenHash: string;
  [key: string]: unknown;
}

export interface McpServiceTokenStringIdsResult {
  /** Rows re-keyed to a String `_id` in this run. */
  converted: number;
  /** ObjectId-keyed rows still waiting (non-zero only for dry runs). */
  pending: number;
}

const unparkedHash = (tokenHash: string): string =>
  tokenHash.startsWith(PARKED_HASH_PREFIX) ? tokenHash.slice(PARKED_HASH_PREFIX.length) : tokenHash;

const convertRow = async ({
  collection,
  row,
}: {
  collection: mongoose.Collection;
  row: LegacyTokenRow;
}): Promise<void> => {
  const stringId = row._id.toHexString();
  const tokenHash = unparkedHash(row.tokenHash);
  const parkedHash = `${PARKED_HASH_PREFIX}${tokenHash}`;
  // Free the unique tokenHash for the copy while keeping the original row recoverable.
  if (row.tokenHash !== parkedHash) {
    await collection.updateOne({_id: row._id}, {$set: {tokenHash: parkedHash}});
  }
  const existingCopy = await collection.findOne({_id: stringId as never});
  if (!existingCopy) {
    await collection.insertOne({
      ...row,
      _id: stringId as never,
      deleted: row.deleted ?? false,
      tokenHash,
    });
  }
  await collection.deleteOne({_id: row._id});
};

/**
 * Re-key every ObjectId McpServiceToken row to its hex string. Returns how many rows were
 * converted; a dry run converts nothing and reports how many are pending.
 */
export const migrateMcpServiceTokenStringIds = async (
  ctx: MigrationContext
): Promise<McpServiceTokenStringIdsResult> => {
  const collection = ctx.mongoose.connection.collection(COLLECTION_NAME);

  if (ctx.dryRun) {
    const pending = await collection.countDocuments(LEGACY_ID_FILTER);
    ctx.logger.info(
      `[${MCP_SERVICE_TOKEN_STRING_IDS_SLUG}] dry run: ${pending} ObjectId rows would be re-keyed`
    );
    return {converted: 0, pending};
  }

  let converted = 0;
  for (;;) {
    await ctx.checkCancellation?.();
    const batch = (await collection
      .find(LEGACY_ID_FILTER)
      .limit(BATCH_SIZE)
      .toArray()) as unknown as LegacyTokenRow[];
    if (batch.length === 0) {
      break;
    }
    for (const row of batch) {
      await convertRow({collection, row});
      converted += 1;
    }
  }

  const message = `[${MCP_SERVICE_TOKEN_STRING_IDS_SLUG}] re-keyed ${converted} rows to String ids`;
  ctx.logger.info(message);
  await ctx.addLog?.("info", message);
  return {converted, pending: 0};
};

/** Ready-made `up` for an app migration file (irreversible: new rows use UUID ids). */
export const mcpServiceTokenStringIdsMigration = {
  slug: MCP_SERVICE_TOKEN_STRING_IDS_SLUG,
  up: async (ctx: MigrationContext): Promise<void> => {
    await migrateMcpServiceTokenStringIds(ctx);
  },
};
