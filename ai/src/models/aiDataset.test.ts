import {afterEach, describe, expect, it} from "bun:test";
import mongoose from "mongoose";

import {AIDataset} from "./aiDataset";

describe("AIDataset model", () => {
  afterEach(async () => {
    await AIDataset.deleteMany({});
  });

  it("stores rows for an owner and aliases ownerId to userId", async () => {
    const userId = new mongoose.Types.ObjectId();
    const dataset = await AIDataset.create({
      columns: [{name: "count", type: "number"}],
      historyId: new mongoose.Types.ObjectId(),
      rowCount: 1,
      rows: [[3]],
      userId,
    });
    expect(dataset.deleted).toBe(false);
    expect(dataset.created).toBeInstanceOf(Date);
    expect(dataset.expiresAt).toBeUndefined();
    expect((dataset as unknown as {ownerId: mongoose.Types.ObjectId}).ownerId.toString()).toBe(
      userId.toString()
    );
  });

  it("expires documents that have expiresAt and keeps documents that do not", () => {
    const indexes = AIDataset.schema.indexes();
    expect(indexes).toEqual(
      expect.arrayContaining([[{expiresAt: 1}, expect.objectContaining({expireAfterSeconds: 0})]])
    );
  });
});
