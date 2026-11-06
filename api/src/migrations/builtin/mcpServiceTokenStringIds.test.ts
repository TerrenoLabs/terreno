import {afterEach, beforeAll, beforeEach, describe, it} from "bun:test";
import {createHash, randomUUID} from "node:crypto";
import {assert} from "chai";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import {McpServiceToken} from "../../models/mcpServiceToken";
import {clearSyncRegistry} from "../../sync/registry";
import {setupDb} from "../../tests";
import type {MigrationContext, MigrationLogger} from "../types";
import {
  MCP_SERVICE_TOKEN_STRING_IDS_SLUG,
  mcpServiceTokenStringIdsMigration,
  migrateMcpServiceTokenStringIds,
} from "./mcpServiceTokenStringIds";

const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

const silentLogger: MigrationLogger = {
  debug: () => undefined,
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
};

const contextFor = (overrides: Partial<MigrationContext> = {}): MigrationContext => ({
  dryRun: false,
  logger: silentLogger,
  mongoose,
  ...overrides,
});

const tokens = (): mongoose.Collection => McpServiceToken.collection;

const legacyRow = (
  plaintext: string,
  userId: mongoose.Types.ObjectId,
  extra: Record<string, unknown> = {}
): Record<string, unknown> => ({
  _id: new mongoose.Types.ObjectId(),
  created: DateTime.now().minus({day: 3}).toJSDate(),
  name: `Legacy ${plaintext.slice(-4)}`,
  tokenHash: hashToken(plaintext),
  tokenPrefix: plaintext.slice(4, 12),
  updated: DateTime.now().minus({day: 3}).toJSDate(),
  userId,
  ...extra,
});

describe("mcp-service-token-string-ids migration", () => {
  const userId = new mongoose.Types.ObjectId();
  const activePlaintext = `mcp_${"a".repeat(64)}`;
  const revokedPlaintext = `mcp_${"b".repeat(64)}`;
  let active: Record<string, unknown>;
  let revoked: Record<string, unknown>;

  beforeAll(async () => {
    await setupDb();
    await McpServiceToken.syncIndexes();
  }, 60_000);

  beforeEach(async () => {
    clearSyncRegistry();
    await tokens().deleteMany({});
    active = legacyRow(activePlaintext, userId);
    revoked = legacyRow(revokedPlaintext, userId, {
      revokedAt: DateTime.now().minus({day: 1}).toJSDate(),
    });
    await tokens().insertMany([active, revoked]);
  });

  afterEach(async () => {
    await tokens().deleteMany({});
  });

  it("re-keys ObjectId rows to their hex string and is idempotent", async () => {
    const issued = await McpServiceToken.issueFor({_id: userId}, {name: "Already a string"});

    const first = await migrateMcpServiceTokenStringIds(contextFor());
    const second = await migrateMcpServiceTokenStringIds(contextFor());

    assert.deepEqual(first, {converted: 2, pending: 0});
    assert.deepEqual(second, {converted: 0, pending: 0});
    const rows = await tokens().find({}).toArray();
    assert.lengthOf(rows, 3);
    for (const row of rows) {
      assert.isString(row._id);
    }
    assert.equal(await tokens().countDocuments({_id: {$type: "objectId"}}), 0);

    const activeId = (active._id as mongoose.Types.ObjectId).toHexString();
    const revokedId = (revoked._id as mongoose.Types.ObjectId).toHexString();
    const migratedActive = await tokens().findOne({_id: activeId as never});
    const migratedRevoked = await tokens().findOne({_id: revokedId as never});
    assert.equal(migratedActive?.name, active.name);
    assert.equal(migratedActive?.tokenHash, active.tokenHash);
    assert.equal(String(migratedActive?.userId), String(userId));
    assert.isFalse(migratedActive?.deleted);
    assert.instanceOf(migratedRevoked?.revokedAt, Date);
    assert.equal(await tokens().countDocuments({_id: issued.mcpServiceToken._id as never}), 1);
  });

  it("keeps migrated tokens verifiable and revocable by their hex id", async () => {
    await migrateMcpServiceTokenStringIds(contextFor());

    const verified = await McpServiceToken.verify(activePlaintext);
    const activeId = (active._id as mongoose.Types.ObjectId).toHexString();
    assert.equal(verified?._id, activeId);
    assert.isNull(await McpServiceToken.verify(revokedPlaintext));

    await McpServiceToken.revokeForUser({_id: userId}, activeId);
    assert.isNull(await McpServiceToken.verify(activePlaintext));
  });

  it("finishes a row an interrupted run already parked and copied", async () => {
    const activeId = (active._id as mongoose.Types.ObjectId).toHexString();
    // Simulate a crash after the hash was parked and the copy inserted, before the delete.
    await tokens().updateOne(
      {_id: active._id as never},
      {$set: {tokenHash: `${MCP_SERVICE_TOKEN_STRING_IDS_SLUG}:${active.tokenHash}`}}
    );
    await tokens().insertOne({...active, _id: activeId as never, deleted: false});

    const result = await migrateMcpServiceTokenStringIds(contextFor());

    assert.equal(result.converted, 2);
    assert.equal(await tokens().countDocuments({}), 2);
    const migrated = await tokens().findOne({_id: activeId as never});
    assert.equal(migrated?.tokenHash, active.tokenHash);
    assert.equal((await McpServiceToken.verify(activePlaintext))?._id, activeId);
  });

  it("re-inserts a parked row whose copy never landed", async () => {
    await tokens().updateOne(
      {_id: active._id as never},
      {$set: {tokenHash: `${MCP_SERVICE_TOKEN_STRING_IDS_SLUG}:${active.tokenHash}`}}
    );

    await migrateMcpServiceTokenStringIds(contextFor());

    const activeId = (active._id as mongoose.Types.ObjectId).toHexString();
    const migrated = await tokens().findOne({_id: activeId as never});
    assert.equal(migrated?.tokenHash, active.tokenHash);
    assert.equal(await tokens().countDocuments({}), 2);
  });

  it("reports pending rows on a dry run without writing", async () => {
    const logs: string[] = [];
    const result = await migrateMcpServiceTokenStringIds(
      contextFor({
        dryRun: true,
        logger: {...silentLogger, info: (message: string) => logs.push(message)},
      })
    );

    assert.deepEqual(result, {converted: 0, pending: 2});
    assert.equal(await tokens().countDocuments({_id: {$type: "objectId"}}), 2);
    assert.match(logs[0] ?? "", /2 ObjectId rows would be re-keyed/);
  });

  it("exposes an up function for app migration files that logs progress", async () => {
    const addLogCalls: string[] = [];
    let cancellationChecks = 0;

    await mcpServiceTokenStringIdsMigration.up(
      contextFor({
        addLog: async (_level, message) => {
          addLogCalls.push(message);
        },
        checkCancellation: async () => {
          cancellationChecks += 1;
        },
      })
    );

    assert.equal(mcpServiceTokenStringIdsMigration.slug, "mcp-service-token-string-ids");
    assert.equal(await tokens().countDocuments({_id: {$type: "objectId"}}), 0);
    assert.isAbove(cancellationChecks, 0);
    assert.match(addLogCalls[0] ?? "", /re-keyed 2 rows/);
  });

  it("does nothing when every row already has a string id", async () => {
    await tokens().deleteMany({});
    await tokens().insertOne({
      ...legacyRow(activePlaintext, userId),
      _id: randomUUID() as never,
    });

    const result = await migrateMcpServiceTokenStringIds(contextFor());

    assert.deepEqual(result, {converted: 0, pending: 0});
    assert.equal(await tokens().countDocuments({}), 1);
  });
});
