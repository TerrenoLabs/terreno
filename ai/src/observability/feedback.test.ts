import {afterEach, beforeAll, beforeEach, describe, expect, it} from "bun:test";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import {createTraceId} from "../service/aiService";
import {ensureTestUsers} from "../tests/helpers";
import {FEEDBACK_SIGNALS, recordTraceFeedback} from "./feedback";
import {createLocalObservabilityPlugin} from "./local/localPlugin";
import {registerObsScore} from "./local/models/obsScore";
import {registerObsTrace} from "./local/models/obsTrace";
import type {LocalTraceStore} from "./local/traceStore";
import {ObservabilityApp, resetObservabilityApp} from "./observabilityApp";

describe("recordTraceFeedback", () => {
  let store: LocalTraceStore;
  let ownerId: string;
  let otherId: string;
  let traceId: string;

  beforeAll(async () => {
    const users = await ensureTestUsers();
    otherId = String(users[0]?._id);
    ownerId = String(users[1]?._id);
  });

  afterEach(() => {
    resetObservabilityApp();
  });

  beforeEach(async () => {
    await registerObsTrace().deleteMany({});
    await registerObsScore().collection.deleteMany({});
    const plugin = createLocalObservabilityPlugin();
    store = (plugin.traceSink as unknown as {store: LocalTraceStore}).store;
    new ObservabilityApp({plugins: [plugin]});
    traceId = createTraceId();
    await store.exportTrace({
      id: traceId,
      name: "t",
      prompts: [],
      sensitive: false,
      spans: [],
      startedAt: DateTime.utc().toISO() ?? "",
      status: "ok",
      userId: ownerId,
    });
  });

  it("exports the allowed signal names", () => {
    expect([...FEEDBACK_SIGNALS]).toEqual([
      "accepted",
      "dismissed",
      "copied",
      "edited",
      "regenerated",
    ]);
  });

  it("returns the written thumbs_up score for the owner", async () => {
    const result = await recordTraceFeedback({
      input: {comment: "  Too long  ", thumbs: "down"},
      traceId,
      user: {id: ownerId},
    });
    expect(result.traceId).toBe(traceId);
    expect(result.flaggedForDataset).toBe(false);
    expect(result.scores).toHaveLength(1);
    expect(result.scores[0]).toMatchObject({
      comment: "Too long",
      dataType: "boolean",
      name: "thumbs_up",
      source: "user-feedback",
      traceId,
      value: false,
    });
  });

  it("thumbs up then down keeps one live score with the latest value", async () => {
    await recordTraceFeedback({input: {thumbs: "up"}, traceId, user: {id: ownerId}});
    await recordTraceFeedback({input: {thumbs: "down"}, traceId, user: {id: ownerId}});
    const live = await registerObsScore().find({traceId});
    expect(live).toHaveLength(1);
    expect(live[0]?.value).toBe(false);
  });

  it("thumbs null returns no scores and soft-deletes the live one", async () => {
    await recordTraceFeedback({input: {thumbs: "up"}, traceId, user: {id: ownerId}});
    const result = await recordTraceFeedback({input: {thumbs: null}, traceId, user: {id: ownerId}});
    expect(result.scores).toEqual([]);
    expect(await registerObsScore().find({traceId})).toHaveLength(0);
  });

  it("rejects a non-owner with 403, even an admin", async () => {
    await expect(
      recordTraceFeedback({input: {thumbs: "up"}, traceId, user: {id: otherId}})
    ).rejects.toMatchObject({status: 403});
    await expect(
      recordTraceFeedback({input: {thumbs: "up"}, traceId, user: {admin: true, id: otherId}})
    ).rejects.toMatchObject({status: 403});
  });

  it("rejects an unknown trace with 404", async () => {
    await expect(
      recordTraceFeedback({
        input: {thumbs: "up"},
        traceId: new mongoose.Types.ObjectId().toString(),
        user: {id: ownerId},
      })
    ).rejects.toMatchObject({status: 404});
  });

  it("rejects an empty input and a comment without thumbs with 400", async () => {
    await expect(
      recordTraceFeedback({input: {}, traceId, user: {id: ownerId}})
    ).rejects.toMatchObject({status: 400});
    await expect(
      recordTraceFeedback({input: {comment: "x"}, traceId, user: {id: ownerId}})
    ).rejects.toMatchObject({status: 400, title: "comment needs thumbs or outcome"});
  });

  it("rejects a comment over 2000 characters after trim with 400", async () => {
    await expect(
      recordTraceFeedback({
        input: {comment: "x".repeat(2001), thumbs: "down"},
        traceId,
        user: {id: ownerId},
      })
    ).rejects.toMatchObject({status: 400});
  });

  it("rejects outcome, signal, and flagDataset with 400 'not supported yet'", async () => {
    for (const input of [{outcome: "tp"}, {signal: "copied"}, {flagDataset: true}] as const) {
      await expect(
        recordTraceFeedback({input: input as never, traceId, user: {id: ownerId}})
      ).rejects.toMatchObject({status: 400, title: "not supported yet"});
    }
  });
});
