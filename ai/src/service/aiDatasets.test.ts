import {afterEach, describe, expect, it} from "bun:test";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import {AIDataset} from "../models/aiDataset";
import {bucketByGrain, configureAiDatasets, lttb, registerAiDataset} from "./aiDatasets";

const columns = [
  {name: "at", type: "date" as const},
  {name: "count", type: "number" as const},
];

const hourlyRows = (count: number): (string | number | null)[][] => {
  const start = DateTime.fromISO("2024-01-01T00:00:00.000Z", {zone: "utc"});
  return Array.from({length: count}, (_, index) => [
    start.plus({hours: index}).toISO(),
    Math.round(Math.sin(index / 20) * 100),
  ]);
};

describe("ai datasets", () => {
  afterEach(async () => {
    configureAiDatasets();
    await AIDataset.deleteMany({});
  });

  it("keeps a dataset with no expiresAt when datasetTtlDays is 0", async () => {
    configureAiDatasets({datasetTtlDays: 0});
    const registered = await registerAiDataset({
      columns,
      historyId: new mongoose.Types.ObjectId(),
      rows: hourlyRows(3),
      userId: new mongoose.Types.ObjectId(),
    });
    const stored = await AIDataset.findExactlyOne({_id: registered.datasetId});
    expect(stored?.expiresAt).toBeUndefined();
    expect(registered.rowCount).toBe(3);
    expect(registered.preview).toHaveLength(3);
    expect(registered.stats.count.min).toBeLessThanOrEqual(registered.stats.count.max);
  });

  it("sets expiresAt to created plus 7 days when datasetTtlDays is 7", async () => {
    configureAiDatasets({datasetTtlDays: 7});
    const registered = await registerAiDataset({
      columns,
      historyId: new mongoose.Types.ObjectId(),
      rows: hourlyRows(2),
      userId: new mongoose.Types.ObjectId(),
    });
    const stored = await AIDataset.findExactlyOne({_id: registered.datasetId});
    if (!stored?.expiresAt) {
      throw new Error("expected expiresAt");
    }
    const expected = DateTime.fromJSDate(stored.created).plus({days: 7}).toMillis();
    expect(Math.abs(stored.expiresAt.getTime() - expected)).toBeLessThan(5);
  });

  it("rejects a dataset over the row cap", async () => {
    configureAiDatasets({datasetMaxRows: 10});
    await expect(
      registerAiDataset({
        columns,
        historyId: new mongoose.Types.ObjectId(),
        rows: hourlyRows(11),
        userId: new mongoose.Types.ObjectId(),
      })
    ).rejects.toMatchObject({status: 413});
  });

  it("buckets a date column by week", () => {
    const rows = hourlyRows(24 * 14);
    const bucketed = bucketByGrain(columns, rows, "week");
    expect(bucketed.length).toBeLessThan(rows.length);
    expect(bucketed.length).toBeGreaterThan(1);
    const weekStarts = bucketed.map((row) => row[0]);
    expect(weekStarts).toEqual([...weekStarts].sort());
    expect(DateTime.fromISO(String(weekStarts[0]), {zone: "utc"}).weekday).toBe(1);
  });

  it("keeps at most the threshold and the first and last points", () => {
    const points = Array.from({length: 1000}, (_, index) => ({
      x: index,
      y: Math.sin(index / 10),
    }));
    const sampled = lttb(points, 50);
    expect(sampled.length).toBeLessThanOrEqual(50);
    expect(sampled[0]).toEqual(points[0]);
    expect(sampled[sampled.length - 1]).toEqual(points[points.length - 1]);
    const xs = sampled.map((point) => point.x);
    expect(xs).toEqual([...xs].sort((left, right) => left - right));
  });
});
