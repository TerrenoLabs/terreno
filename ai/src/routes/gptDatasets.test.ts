import {afterEach, describe, expect, it} from "bun:test";
import {DateTime} from "luxon";
import mongoose from "mongoose";
import supertest from "supertest";

import {AIDataset} from "../models/aiDataset";
import {bucketByGrain, registerAiDataset} from "../service/aiDatasets";
import {buildApp, createScriptedModel} from "../tests/chatHarness";
import {authAsUser, ensureTestUsers} from "../tests/helpers";

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

const model = createScriptedModel({steps: [[]]});

describe("GET /gpt/datasets/:id", () => {
  afterEach(async () => {
    await AIDataset.deleteMany({});
  });

  it("is not mounted when uiBlocks is off", async () => {
    await ensureTestUsers();
    const app = buildApp({model});
    const agent = await authAsUser(app, "notAdmin");
    const res = await agent.get(`/gpt/datasets/${new mongoose.Types.ObjectId().toString()}`);
    expect(res.status).toBe(404);
  });

  it("buckets by week, downsamples with LTTB, and paginates tables", async () => {
    await ensureTestUsers();
    const created = await ensureTestUsers();
    const userId = (created[1] as {_id: mongoose.Types.ObjectId})._id;
    const rows = hourlyRows(12_480);
    const registered = await registerAiDataset({
      columns,
      historyId: new mongoose.Types.ObjectId(),
      rows,
      userId,
    });
    const app = buildApp({model, uiBlocks: true});
    const agent = await authAsUser(app, "notAdmin");
    const chart = await agent.get(`/gpt/datasets/${registered.datasetId}?grain=week&limit=40`);
    expect(chart.status).toBe(200);
    const bucketed = bucketByGrain(columns, rows, "week");
    expect(chart.body.data.rows.length).toBeLessThanOrEqual(40);
    expect(chart.body.data.rows.length).toBeGreaterThan(2);
    expect(chart.body.data.rowCount).toBe(bucketed.length);
    expect(chart.body.data.more).toBe(false);
    expect(chart.body.data.rows[0][0]).toBe(bucketed[0][0]);
    expect(chart.body.data.rows[chart.body.data.rows.length - 1][0]).toBe(
      bucketed[bucketed.length - 1][0]
    );

    const table = await agent.get(
      `/gpt/datasets/${registered.datasetId}?grain=week&limit=20&page=1`
    );
    expect(table.status).toBe(200);
    expect(table.body.data.rows).toHaveLength(20);
    expect(table.body.data.more).toBe(true);
    expect(table.body.data.page).toBe(1);
    expect(table.body.data.rowCount).toBe(bucketed.length);

    const other = await authAsUser(app, "admin");
    const denied = await other.get(`/gpt/datasets/${registered.datasetId}`);
    expect(denied.status).toBe(404);
    expect(denied.body.title).toBe("Dataset not found");
  });

  it("requires authentication", async () => {
    const app = buildApp({model, uiBlocks: true});
    const res = await supertest(app).get(
      `/gpt/datasets/${new mongoose.Types.ObjectId().toString()}`
    );
    expect(res.status).toBe(401);
  });
});
