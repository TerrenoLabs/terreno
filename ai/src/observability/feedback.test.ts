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

  const liveScores = async (): Promise<{[key: string]: unknown}[]> => {
    return (await registerObsScore().find({traceId})).map(
      (doc) => doc.toObject() as unknown as {[key: string]: unknown}
    ); // cast: Mongoose doc type has no index signature
  };

  it("signal dismissed writes a boolean true user-signal score", async () => {
    const result = await recordTraceFeedback({
      input: {signal: "dismissed"},
      traceId,
      user: {id: ownerId},
    });
    expect(result.scores).toHaveLength(1);
    expect(result.scores[0]).toMatchObject({
      dataType: "boolean",
      name: "dismissed",
      source: "user-signal",
      traceId,
      value: true,
    });
  });

  it("every allowed signal is accepted and named after itself", async () => {
    for (const signal of FEEDBACK_SIGNALS) {
      const result = await recordTraceFeedback({input: {signal}, traceId, user: {id: ownerId}});
      expect(result.scores[0]).toMatchObject({name: signal, source: "user-signal", value: true});
    }
    expect(await liveScores()).toHaveLength(FEEDBACK_SIGNALS.length);
  });

  it("the same signal twice keeps one live score", async () => {
    await recordTraceFeedback({input: {signal: "copied"}, traceId, user: {id: ownerId}});
    await recordTraceFeedback({input: {signal: "copied"}, traceId, user: {id: ownerId}});
    const live = await liveScores();
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({name: "copied", source: "user-signal"});
  });

  it("concurrent identical signals leave one live score", async () => {
    await Promise.all([
      recordTraceFeedback({input: {signal: "copied"}, traceId, user: {id: ownerId}}),
      recordTraceFeedback({input: {signal: "copied"}, traceId, user: {id: ownerId}}),
    ]);
    expect(await liveScores()).toHaveLength(1);
  });

  it("different signals coexist as separate scores", async () => {
    await recordTraceFeedback({input: {signal: "copied"}, traceId, user: {id: ownerId}});
    await recordTraceFeedback({input: {signal: "accepted"}, traceId, user: {id: ownerId}});
    expect(await liveScores()).toHaveLength(2);
  });

  it("an unknown signal is rejected with 400 and the title lists the allowed signals", async () => {
    const error = await recordTraceFeedback({
      input: {signal: "liked"} as never,
      traceId,
      user: {id: ownerId},
    }).catch((caught: unknown) => caught as {status?: number; title?: string});
    expect(error).toMatchObject({status: 400});
    for (const signal of FEEDBACK_SIGNALS) {
      expect((error as {title?: string}).title).toContain(signal);
    }
    expect(await liveScores()).toHaveLength(0);
  });

  it("outcome fp with a comment writes a categorical user-feedback score", async () => {
    const result = await recordTraceFeedback({
      input: {comment: "  Not a crisis  ", outcome: "fp"},
      traceId,
      user: {id: ownerId},
    });
    expect(result.scores).toHaveLength(1);
    expect(result.scores[0]).toMatchObject({
      comment: "Not a crisis",
      dataType: "categorical",
      name: "outcome",
      source: "user-feedback",
      traceId,
      value: "fp",
    });
  });

  it("outcome alone, without a comment, is valid for every outcome value", async () => {
    for (const outcome of ["tp", "fp", "tn", "fn"] as const) {
      const result = await recordTraceFeedback({input: {outcome}, traceId, user: {id: ownerId}});
      expect(result.scores[0]).toMatchObject({name: "outcome", value: outcome});
    }
  });

  it("a second outcome replaces the first", async () => {
    await recordTraceFeedback({input: {outcome: "fp"}, traceId, user: {id: ownerId}});
    await recordTraceFeedback({input: {outcome: "tp"}, traceId, user: {id: ownerId}});
    const live = await liveScores();
    expect(live).toHaveLength(1);
    expect(live[0]?.value).toBe("tp");
  });

  it("an invalid outcome is rejected with 400 and keeps the earlier valid outcome", async () => {
    await recordTraceFeedback({input: {outcome: "tp"}, traceId, user: {id: ownerId}});
    await expect(
      recordTraceFeedback({input: {outcome: "xx"} as never, traceId, user: {id: ownerId}})
    ).rejects.toMatchObject({status: 400});
    const live = await liveScores();
    expect(live).toHaveLength(1);
    expect(live[0]?.value).toBe("tp");
  });

  it("the ObsScore model accepts source user-signal", async () => {
    const doc = new (registerObsScore())({
      dataType: "boolean",
      name: "dismissed",
      source: "user-signal",
      traceId,
      value: true,
    });
    await expect(doc.validate()).resolves.toBeUndefined();
  });

  it("a comment with only a signal or only flagDataset is still 400", async () => {
    await expect(
      recordTraceFeedback({
        input: {comment: "x", signal: "copied"},
        traceId,
        user: {id: ownerId},
      })
    ).rejects.toMatchObject({status: 400, title: "comment needs thumbs or outcome"});
    await expect(
      recordTraceFeedback({
        input: {comment: "x", flagDataset: true},
        traceId,
        user: {id: ownerId},
      })
    ).rejects.toMatchObject({status: 400, title: "comment needs thumbs or outcome"});
  });

  it("flagDataset true sets the flag and false clears it", async () => {
    const on = await recordTraceFeedback({
      input: {flagDataset: true},
      traceId,
      user: {id: ownerId},
    });
    expect(on.flaggedForDataset).toBe(true);
    expect(on.scores).toEqual([]);
    expect((await registerObsTrace().findById(traceId))?.flaggedForDataset).toBe(true);

    const off = await recordTraceFeedback({
      input: {flagDataset: false},
      traceId,
      user: {id: ownerId},
    });
    expect(off.flaggedForDataset).toBe(false);
    expect((await registerObsTrace().findById(traceId))?.flaggedForDataset).toBe(false);
  });

  it("a request without flagDataset leaves an existing flag in place", async () => {
    await recordTraceFeedback({input: {flagDataset: true}, traceId, user: {id: ownerId}});
    const result = await recordTraceFeedback({
      input: {thumbs: "up"},
      traceId,
      user: {id: ownerId},
    });
    expect(result.flaggedForDataset).toBe(true);
    expect((await registerObsTrace().findById(traceId))?.flaggedForDataset).toBe(true);
  });

  it("thumbs, signal, and flagDataset combine in one call", async () => {
    const result = await recordTraceFeedback({
      input: {flagDataset: true, signal: "regenerated", thumbs: "down"},
      traceId,
      user: {id: ownerId},
    });
    expect(result.flaggedForDataset).toBe(true);
    expect(result.scores).toHaveLength(2);
    expect(result.scores.map((score) => `${score.source}:${score.name}`).sort()).toEqual([
      "user-feedback:thumbs_up",
      "user-signal:regenerated",
    ]);
    expect(await liveScores()).toHaveLength(2);
  });

  it("a non-owner cannot send a signal or flag a trace", async () => {
    await expect(
      recordTraceFeedback({input: {signal: "copied"}, traceId, user: {id: otherId}})
    ).rejects.toMatchObject({status: 403});
    await expect(
      recordTraceFeedback({input: {flagDataset: true}, traceId, user: {id: otherId}})
    ).rejects.toMatchObject({status: 403});
    expect((await registerObsTrace().findById(traceId))?.flaggedForDataset).toBeFalsy();
  });
});
