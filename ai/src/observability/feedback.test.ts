import {afterEach, beforeAll, beforeEach, describe, expect, it, spyOn} from "bun:test";
import {logger, TerrenoApp} from "@terreno/api";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import {createTraceId} from "../service/aiService";
import {authAsUser, ensureTestUsers, terrenoUserModel} from "../tests/helpers";
import {FEEDBACK_SIGNALS, recordTraceFeedback} from "./feedback";
import {LocalEvaluatorStore} from "./local/evaluatorStore";
import {createLocalObservabilityPlugin} from "./local/localPlugin";
import {registerObsEvaluator} from "./local/models/obsEvaluator";
import {registerObsPrompt} from "./local/models/obsPrompt";
import {registerObsPromptLabel} from "./local/models/obsPromptLabel";
import {registerObsPromptVersion} from "./local/models/obsPromptVersion";
import {registerObsReviewItem} from "./local/models/obsReviewItem";
import {registerObsScore} from "./local/models/obsScore";
import {registerObsTrace} from "./local/models/obsTrace";
import {LocalPromptStore} from "./local/promptStore";
import {LocalReviewStore} from "./local/reviewStore";
import type {LocalTraceStore} from "./local/traceStore";
import {getObservabilityApp, ObservabilityApp, resetObservabilityApp} from "./observabilityApp";

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

describe("thumbs down enqueues human review (feedbackReview)", () => {
  let store: LocalTraceStore;
  let ownerId: string;
  let traceId: string;
  let humanId: string;
  let judgeId: string;
  const reviewStore = new LocalReviewStore();

  const reviewItems = async (): Promise<{[key: string]: unknown}[]> => {
    // traceId is stringified so tests compare it with the string trace id.
    return (await registerObsReviewItem().find({})).map((doc) => ({
      ...(doc.toObject() as unknown as {[key: string]: unknown}),
      traceId: String(doc.traceId),
    }));
  };

  const startApp = (feedbackReview?: {evaluatorName: string}): void => {
    resetObservabilityApp();
    const plugin = createLocalObservabilityPlugin();
    store = (plugin.traceSink as unknown as {store: LocalTraceStore}).store;
    new ObservabilityApp({feedbackReview, plugins: [plugin]});
  };

  const exportTraceFor = async (id: string): Promise<void> => {
    await store.exportTrace({
      id,
      name: "t",
      prompts: [],
      sensitive: false,
      spans: [],
      startedAt: DateTime.utc().toISO() ?? "",
      status: "ok",
      userId: ownerId,
    });
  };

  beforeAll(async () => {
    const users = await ensureTestUsers();
    ownerId = String(users[1]?._id);
  });

  afterEach(() => {
    resetObservabilityApp();
  });

  beforeEach(async () => {
    await registerObsTrace().deleteMany({});
    await registerObsScore().collection.deleteMany({});
    await registerObsReviewItem().deleteMany({});
    await registerObsEvaluator().deleteMany({});
    await Promise.all([
      registerObsPrompt().deleteMany({}),
      registerObsPromptVersion().deleteMany({}),
      registerObsPromptLabel().deleteMany({}),
    ]);
    const evaluators = new LocalEvaluatorStore();
    humanId = (
      await evaluators.create({
        dimensions: [{dataType: "boolean", key: "correct", required: true}],
        name: "feedback-human",
        target: "full trace",
        type: "human",
      })
    ).id;
    const prompts = new LocalPromptStore();
    await prompts.create({
      folder: "evaluators",
      name: "feedback-judge",
      outputSchema: {
        properties: {correct: {type: "boolean"}},
        required: ["correct"],
        type: "object",
      },
      system: "Judge it.",
      type: "chat",
    });
    await prompts.moveLabel("feedback-judge", {label: "production", version: 1});
    judgeId = (
      await evaluators.create({
        dimensions: [{dataType: "boolean", key: "correct", required: true}],
        judgePromptName: "feedback-judge",
        name: "feedback-judge-eval",
        target: "full trace",
        type: "llm-judge",
      })
    ).id;
    startApp({evaluatorName: "feedback-human"});
    traceId = createTraceId();
    await exportTraceFor(traceId);
  });

  const down = (id = traceId): ReturnType<typeof recordTraceFeedback> =>
    recordTraceFeedback({input: {thumbs: "down"}, traceId: id, user: {id: ownerId}});

  it("exposes feedbackReview on the registry", () => {
    expect(getObservabilityApp()?.feedbackReview).toEqual({evaluatorName: "feedback-human"});
    startApp();
    expect(getObservabilityApp()?.feedbackReview).toBeUndefined();
  });

  it("thumbs down creates one pending feedback item and returns its id", async () => {
    const result = await down();
    const items = await reviewItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({reason: "feedback", status: "pending", traceId});
    expect(String(items[0]?.evaluatorId)).toBe(humanId);
    expect(result.reviewItemId).toBe(String(items[0]?._id));
  });

  it("thumbs down again returns the same id and adds no item", async () => {
    const first = await down();
    const second = await down();
    expect(second.reviewItemId).toBe(first.reviewItemId);
    expect(await reviewItems()).toHaveLength(1);
  });

  it("concurrent thumbs downs queue one item and both return its id", async () => {
    const results = await Promise.all([down(), down(), down()]);
    expect(await reviewItems()).toHaveLength(1);
    const ids = new Set(results.map((result) => result.reviewItemId));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toBeDefined();
  });

  it("down, up, down keeps one open item", async () => {
    const first = await down();
    await recordTraceFeedback({input: {thumbs: "up"}, traceId, user: {id: ownerId}});
    const third = await down();
    expect(third.reviewItemId).toBe(first.reviewItemId);
    expect(await reviewItems()).toHaveLength(1);
  });

  it("an in_progress item counts as open", async () => {
    const first = await down();
    await reviewStore.assign(first.reviewItemId ?? "", new mongoose.Types.ObjectId().toString());
    const again = await down();
    expect(again.reviewItemId).toBe(first.reviewItemId);
    expect(await reviewItems()).toHaveLength(1);
  });

  it("a done item does not block a second pending item", async () => {
    const first = await down();
    await reviewStore.submit({id: first.reviewItemId ?? "", scores: {correct: true}, sinks: []});
    const second = await down();
    expect(second.reviewItemId).toBeDefined();
    expect(second.reviewItemId).not.toBe(first.reviewItemId);
    const items = await reviewItems();
    expect(items).toHaveLength(2);
    expect(items.filter((item) => item.status === "pending")).toHaveLength(1);
  });

  it("a skipped item does not block a second pending item", async () => {
    const first = await down();
    await reviewStore.skip(first.reviewItemId ?? "");
    const second = await down();
    expect(second.reviewItemId).not.toBe(first.reviewItemId);
    expect(await reviewItems()).toHaveLength(2);
  });

  it("an open item on another trace does not block this one", async () => {
    const otherTraceId = createTraceId();
    await exportTraceFor(otherTraceId);
    const other = await down(otherTraceId);
    const mine = await down();
    expect(mine.reviewItemId).not.toBe(other.reviewItemId);
    expect(await reviewItems()).toHaveLength(2);
  });

  it("thumbs down with a comment still enqueues", async () => {
    const result = await recordTraceFeedback({
      input: {comment: "wrong", thumbs: "down"},
      traceId,
      user: {id: ownerId},
    });
    expect(result.reviewItemId).toBeDefined();
    expect(await reviewItems()).toHaveLength(1);
  });

  it("thumbs up, signals, and outcomes never enqueue", async () => {
    const up = await recordTraceFeedback({input: {thumbs: "up"}, traceId, user: {id: ownerId}});
    expect(up.reviewItemId).toBeUndefined();
    for (const signal of FEEDBACK_SIGNALS) {
      const result = await recordTraceFeedback({input: {signal}, traceId, user: {id: ownerId}});
      expect(result.reviewItemId).toBeUndefined();
    }
    for (const outcome of ["tp", "fp", "tn", "fn"] as const) {
      const result = await recordTraceFeedback({input: {outcome}, traceId, user: {id: ownerId}});
      expect(result.reviewItemId).toBeUndefined();
    }
    const cleared = await recordTraceFeedback({
      input: {thumbs: null},
      traceId,
      user: {id: ownerId},
    });
    expect(cleared.reviewItemId).toBeUndefined();
    expect(await reviewItems()).toHaveLength(0);
  });

  it("a failing external ScoreSink is logged and the thumbs down is still scored and queued", async () => {
    resetObservabilityApp();
    const plugin = createLocalObservabilityPlugin();
    store = (plugin.traceSink as unknown as {store: LocalTraceStore}).store;
    new ObservabilityApp({
      feedbackReview: {evaluatorName: "feedback-human"},
      plugins: [
        plugin,
        {
          capabilities: new Set(["scores"]),
          id: "vendor",
          scoreSink: {
            export: async (): Promise<void> => {
              throw new Error("vendor down");
            },
          },
        },
      ],
    });
    const errorSpy = spyOn(logger, "error").mockImplementation(() => logger);
    try {
      const result = await down();
      expect(result.scores).toHaveLength(1);
      expect(typeof result.reviewItemId).toBe("string");
      expect(
        errorSpy.mock.calls.some((call) => call[0] === "Feedback ScoreSink.export failed")
      ).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
    expect(await registerObsScore().countDocuments({deleted: false, traceId})).toBe(1);
  });

  it("option unset enqueues nothing", async () => {
    startApp();
    const result = await down();
    expect(result.reviewItemId).toBeUndefined();
    expect(await reviewItems()).toHaveLength(0);
  });

  it("a missing evaluator logs an error and still returns the score without reviewItemId", async () => {
    startApp({evaluatorName: "no-such-evaluator"});
    const errorSpy = spyOn(logger, "error").mockImplementation(() => logger);
    try {
      const result = await down();
      expect(result.reviewItemId).toBeUndefined();
      expect(result.scores).toHaveLength(1);
      expect(errorSpy).toHaveBeenCalled();
      expect(await reviewItems()).toHaveLength(0);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("an llm-judge evaluator logs an error and enqueues nothing", async () => {
    startApp({evaluatorName: "feedback-judge-eval"});
    const errorSpy = spyOn(logger, "error").mockImplementation(() => logger);
    try {
      const result = await down();
      expect(judgeId).toBeDefined();
      expect(result.reviewItemId).toBeUndefined();
      expect(result.scores).toHaveLength(1);
      expect(errorSpy).toHaveBeenCalled();
      expect(await reviewItems()).toHaveLength(0);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("a successful enqueue logs no error", async () => {
    const errorSpy = spyOn(logger, "error").mockImplementation(() => logger);
    try {
      await down();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("a non-owner is refused with 403 and enqueues nothing", async () => {
    const users = await ensureTestUsers();
    await expect(
      recordTraceFeedback({
        input: {thumbs: "down"},
        traceId,
        user: {admin: true, id: String(users[0]?._id)},
      })
    ).rejects.toMatchObject({status: 403});
    expect(await reviewItems()).toHaveLength(0);
  });

  describe("route and review queue", () => {
    // The outer beforeEach already exports `traceId`; exporting it again here hit a duplicate _id.
    // Users can be recreated by earlier suites in this file, so re-own the trace by the current
    // "notAdmin" user that authAsUser signs in as.
    beforeEach(async () => {
      const users = await ensureTestUsers();
      ownerId = String(users[1]?._id);
      await registerObsTrace().updateOne({_id: traceId}, {$set: {userId: users[1]?._id}});
    });

    const buildApp = (feedbackReview?: {
      evaluatorName: string;
    }): ReturnType<TerrenoApp["build"]> => {
      resetObservabilityApp();
      const plugin = createLocalObservabilityPlugin();
      store = (plugin.traceSink as unknown as {store: LocalTraceStore}).store;
      return new TerrenoApp({skipListen: true, userModel: terrenoUserModel})
        .register(new ObservabilityApp({feedbackReview, plugins: [plugin]}))
        .build();
    };

    it("POST thumbs down returns 200 with reviewItemId, repeat returns the same id", async () => {
      const app = buildApp({evaluatorName: "feedback-human"});
      const agent = await authAsUser(app, "notAdmin");
      const path = `/ai/observability/traces/${traceId}/feedback`;
      const first = await agent.post(path).send({thumbs: "down"});
      expect(first.status).toBe(200);
      expect(typeof first.body.data.reviewItemId).toBe("string");
      const second = await agent.post(path).send({thumbs: "down"});
      expect(second.status).toBe(200);
      expect(second.body.data.reviewItemId).toBe(first.body.data.reviewItemId);
    });

    it("GET /review lists the item under Pending with reason feedback", async () => {
      const app = buildApp({evaluatorName: "feedback-human"});
      const owner = await authAsUser(app, "notAdmin");
      const sent = await owner
        .post(`/ai/observability/traces/${traceId}/feedback`)
        .send({thumbs: "down"});
      const admin = await authAsUser(app, "admin");
      const listed = await admin.get("/ai/observability/review?status=pending");
      expect(listed.status).toBe(200);
      expect(listed.body.counts.pending).toBe(1);
      expect(listed.body.data).toHaveLength(1);
      expect(listed.body.data[0]).toMatchObject({
        id: sent.body.data.reviewItemId,
        reason: "feedback",
        status: "pending",
        traceId,
      });
    });

    it("POST with a missing evaluator is 200 without reviewItemId", async () => {
      const app = buildApp({evaluatorName: "no-such-evaluator"});
      const errorSpy = spyOn(logger, "error").mockImplementation(() => logger);
      try {
        const agent = await authAsUser(app, "notAdmin");
        const res = await agent
          .post(`/ai/observability/traces/${traceId}/feedback`)
          .send({thumbs: "down"});
        expect(res.status).toBe(200);
        expect(res.body.data.reviewItemId).toBeUndefined();
        expect(errorSpy).toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
      }
    });
  });
});
