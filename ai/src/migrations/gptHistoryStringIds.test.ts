import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import type {MigrationContext} from "@terreno/api";
import mongoose from "mongoose";

import {AIDataset} from "../models/aiDataset";
import {GptHistory} from "../models/gptHistory";
import {gptHistoryStringIdsMigration, migrateGptHistoryStringIds} from "./gptHistoryStringIds";

const userId = new mongoose.Types.ObjectId();

const historiesCollection = (): mongoose.mongo.Collection =>
  mongoose.connection.collection(GptHistory.collection.collectionName);

const datasetsCollection = (): mongoose.mongo.Collection =>
  mongoose.connection.collection(AIDataset.collection.collectionName);

const legacyHistory = (title: string): mongoose.mongo.Document => ({
  _id: new mongoose.Types.ObjectId(),
  created: new Date("2026-01-05T09:00:00.000Z"),
  deleted: false,
  prompts: [
    {text: `Question about ${title}`, type: "user"},
    {model: "gemini", text: `Answer about ${title}`, type: "assistant"},
  ],
  title,
  updated: new Date("2026-01-05T09:01:00.000Z"),
  userId,
});

const legacyDataset = (historyId: unknown): mongoose.mongo.Document => ({
  _id: new mongoose.Types.ObjectId(),
  columns: [{name: "count", type: "number"}],
  created: new Date("2026-01-05T09:02:00.000Z"),
  deleted: false,
  historyId,
  rowCount: 1,
  rows: [[1]],
  updated: new Date("2026-01-05T09:02:00.000Z"),
  userId,
});

interface Seeded {
  histories: mongoose.mongo.Document[];
  stringHistoryId: string;
}

/** Five ObjectId histories (two batches at batchSize 2, plus one), a String one, and refs. */
const seed = async (): Promise<Seeded> => {
  const histories = ["a", "b", "c", "d", "e"].map(legacyHistory);
  const stringHistoryId = "already-a-string-id";
  await historiesCollection().insertMany([
    ...histories,
    {...legacyHistory("string"), _id: stringHistoryId},
  ]);
  await datasetsCollection().insertMany([
    legacyDataset(histories[0]._id),
    legacyDataset(histories[0]._id),
    legacyDataset(histories[3]._id),
    // A ref whose history was deleted long ago still becomes a String.
    legacyDataset(new mongoose.Types.ObjectId()),
    legacyDataset(stringHistoryId),
  ]);
  return {histories, stringHistoryId};
};

const idTypes = async (collection: mongoose.mongo.Collection, field: string): Promise<string[]> => {
  const rows = await collection
    .aggregate<{type: string}>([{$project: {_id: 0, type: {$type: `$${field}`}}}])
    .toArray();
  return [...new Set(rows.map((row) => row.type))].sort();
};

const migrationContext = (dryRun: boolean, logs: string[] = []): MigrationContext => ({
  addLog: async (_level, message): Promise<void> => {
    logs.push(message);
  },
  dryRun,
  logger: {debug: () => {}, error: () => {}, info: () => {}, warn: () => {}},
  mongoose,
});

describe("gpt-history-string-ids migration", () => {
  beforeEach(async () => {
    await historiesCollection().deleteMany({});
    await datasetsCollection().deleteMany({});
  });

  afterEach(async () => {
    await historiesCollection().deleteMany({});
    await datasetsCollection().deleteMany({});
  });

  it("moves ObjectId histories to their hex string ids, rewrites refs, and is a no-op the second time", async () => {
    const {histories, stringHistoryId} = await seed();
    const historyCount = await historiesCollection().countDocuments();
    const datasetCount = await datasetsCollection().countDocuments();

    const first = await migrateGptHistoryStringIds({
      batchSize: 2,
      connection: mongoose.connection,
      dryRun: false,
    });
    const second = await migrateGptHistoryStringIds({
      batchSize: 2,
      connection: mongoose.connection,
      dryRun: false,
    });

    expect(first).toEqual({datasetsUpdated: 4, historiesMigrated: 5});
    expect(second).toEqual({datasetsUpdated: 0, historiesMigrated: 0});
    expect(await historiesCollection().countDocuments()).toBe(historyCount);
    expect(await datasetsCollection().countDocuments()).toBe(datasetCount);
    expect(await idTypes(historiesCollection(), "_id")).toEqual(["string"]);
    expect(await idTypes(datasetsCollection(), "historyId")).toEqual(["string"]);

    const ids = (await historiesCollection().find({}).toArray()).map((doc) => doc._id).sort();
    expect(ids).toEqual([...histories.map((doc) => doc._id.toHexString()), stringHistoryId].sort());
    const firstHex = histories[0]._id.toHexString();
    expect(await datasetsCollection().countDocuments({historyId: firstHex})).toBe(2);
    expect(
      await datasetsCollection().countDocuments({historyId: histories[3]._id.toHexString()})
    ).toBe(1);
    expect(await datasetsCollection().countDocuments({historyId: stringHistoryId})).toBe(1);
  });

  it("keeps every stored field, so the moved history loads through the model", async () => {
    const {histories} = await seed();

    await migrateGptHistoryStringIds({connection: mongoose.connection, dryRun: false});

    const hexId = histories[1]._id.toHexString();
    const history = await GptHistory.findById(hexId);
    expect(history?._id).toBe(hexId);
    expect(history?.title).toBe("b");
    expect(history?.userId.toString()).toBe(userId.toString());
    expect(history?.prompts.map((prompt) => prompt.text)).toEqual([
      "Question about b",
      "Answer about b",
    ]);
    const datasets = await AIDataset.find({historyId: histories[0]._id.toHexString()});
    expect(datasets).toHaveLength(2);
  });

  it("finishes a run that stopped after copying a history but before deleting the original", async () => {
    const {histories} = await seed();
    const interrupted = histories[2];
    await historiesCollection().insertOne({...interrupted, _id: interrupted._id.toHexString()});

    const result = await migrateGptHistoryStringIds({
      connection: mongoose.connection,
      dryRun: false,
    });

    expect(result.historiesMigrated).toBe(5);
    expect(await historiesCollection().countDocuments()).toBe(6);
    expect(await idTypes(historiesCollection(), "_id")).toEqual(["string"]);
  });

  it("rewrites refs left as ObjectIds when a run stopped after moving their history", async () => {
    const orphanedHistory = new mongoose.Types.ObjectId();
    await historiesCollection().insertOne({
      ...legacyHistory("moved"),
      _id: orphanedHistory.toHexString(),
    });
    await datasetsCollection().insertOne(legacyDataset(orphanedHistory));

    const result = await migrateGptHistoryStringIds({
      connection: mongoose.connection,
      dryRun: false,
    });

    expect(result).toEqual({datasetsUpdated: 1, historiesMigrated: 0});
    expect(
      await datasetsCollection().countDocuments({historyId: orphanedHistory.toHexString()})
    ).toBe(1);
  });

  it("only counts in a dry run", async () => {
    await seed();

    const result = await migrateGptHistoryStringIds({
      connection: mongoose.connection,
      dryRun: true,
    });

    expect(result).toEqual({datasetsUpdated: 4, historiesMigrated: 5});
    expect(await idTypes(historiesCollection(), "_id")).toEqual(["objectId", "string"]);
    expect(await historiesCollection().countDocuments({_id: {$type: "objectId"}})).toBe(5);
  });

  it("runs as a migration up through the migration context", async () => {
    await seed();

    const logs: string[] = [];
    await gptHistoryStringIdsMigration.up(migrationContext(true, logs));
    expect(await historiesCollection().countDocuments({_id: {$type: "objectId"}})).toBe(5);

    await gptHistoryStringIdsMigration.up(migrationContext(false, logs));
    await gptHistoryStringIdsMigration.up(migrationContext(false, logs));
    expect(gptHistoryStringIdsMigration.slug).toBe("gpt-history-string-ids");
    expect(logs).toEqual([
      "[gpt-history-string-ids] would move 5 histories and 4 dataset refs",
      "[gpt-history-string-ids] moved 5 histories and 4 dataset refs",
      "[gpt-history-string-ids] moved 0 histories and 0 dataset refs",
    ]);
    expect(await historiesCollection().countDocuments({_id: {$type: "objectId"}})).toBe(0);
    expect(await datasetsCollection().countDocuments({historyId: {$type: "objectId"}})).toBe(0);
  });

  it("stops between batches when the run is cancelled", async () => {
    await seed();
    let checks = 0;
    const checkCancellation = async (): Promise<void> => {
      checks += 1;
      if (checks > 1) {
        throw new Error("cancelled");
      }
    };

    await expect(
      migrateGptHistoryStringIds({
        batchSize: 2,
        checkCancellation,
        connection: mongoose.connection,
        dryRun: false,
      })
    ).rejects.toThrow("cancelled");
    expect(await historiesCollection().countDocuments({_id: {$type: "objectId"}})).toBe(3);
  });
});
