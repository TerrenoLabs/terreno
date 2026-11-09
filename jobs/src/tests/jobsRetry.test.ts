import {beforeEach, describe, it} from "bun:test";
import {TerrenoApp, type UserModel as UserModelType} from "@terreno/api";
import {setupDb, UserModel} from "@terreno/api/testing";
import {assert} from "chai";
import {DateTime} from "luxon";

import {JobsApp} from "../jobsApp";
import {getJobsService} from "../jobsService";
import {Job} from "../models/job";
import {DEFAULT_BACKOFF_MS, DEFAULT_MAX_BACKOFF_MS} from "../retryBackoff";
import {hasWorkerIdPrefix} from "../runners/mongoRunner";

const typedUserModel = UserModel as unknown as UserModelType;

const waitUntil = async (
  predicate: () => Promise<boolean>,
  options?: {intervalMs?: number; timeoutMs?: number}
): Promise<void> => {
  const intervalMs = options?.intervalMs ?? 25;
  const timeoutMs = options?.timeoutMs ?? 5_000;
  const deadline = DateTime.utc().plus({milliseconds: timeoutMs});

  while (DateTime.utc() < deadline) {
    if (await predicate()) {
      return;
    }
    await Bun.sleep(intervalMs);
  }

  throw new Error("waitUntil timed out");
};

describe("jobs retry and dead-letter", () => {
  beforeEach(async (): Promise<void> => {
    await setupDb();
    await Job.deleteMany({});
  });

  it("copies definition retry options onto the enqueued row", async (): Promise<void> => {
    const jobsApp = new JobsApp();
    jobsApp.define("retry-options", {
      handler: async () => {},
      retry: {backoffMs: 2_000, maxAttempts: 7, maxBackoffMs: 120_000},
    });

    new TerrenoApp({
      skipListen: true,
      userModel: typedUserModel,
    })
      .register(jobsApp)
      .build();

    const enqueued = await getJobsService().enqueue({
      name: "retry-options",
      payload: {},
    });

    assert.equal(enqueued.maxAttempts, 7);
    assert.equal(enqueued.backoffMs, 2_000);
    assert.equal(enqueued.maxBackoffMs, 120_000);
  });

  it("uses default retry options when definition omits retry", async (): Promise<void> => {
    const jobsApp = new JobsApp();
    jobsApp.define("default-retry", {
      handler: async () => {},
    });

    new TerrenoApp({
      skipListen: true,
      userModel: typedUserModel,
    })
      .register(jobsApp)
      .build();

    const enqueued = await getJobsService().enqueue({
      name: "default-retry",
      payload: {},
    });

    assert.equal(enqueued.maxAttempts, 5);
    assert.equal(enqueued.backoffMs, DEFAULT_BACKOFF_MS);
    assert.equal(enqueued.maxBackoffMs, DEFAULT_MAX_BACKOFF_MS);
  });

  it("marks success as completed without incrementing attemptCount", async (): Promise<void> => {
    const jobsApp = new JobsApp({pollIntervalMs: 25});
    jobsApp.define("succeed-once", {
      handler: async () => {},
    });

    new TerrenoApp({
      skipListen: true,
      userModel: typedUserModel,
    })
      .register(jobsApp)
      .build();

    const enqueued = await getJobsService().enqueue({
      name: "succeed-once",
      payload: {},
    });

    await jobsApp.startWorker();
    await waitUntil(
      async () => (await Job.findExactlyOne({_id: enqueued._id})).status === "completed"
    );
    await jobsApp.stopWorker();

    const completed = await Job.findExactlyOne({_id: enqueued._id});
    assert.equal(completed.status, "completed");
    assert.equal(completed.attemptCount, 0);
    assert.lengthOf(completed.attempts, 0);
  });

  it("schedules pending with a future runAt between retryable failures", async (): Promise<void> => {
    const jobsApp = new JobsApp({pollIntervalMs: 25});
    jobsApp.define("retryable-failure", {
      handler: async () => {
        throw new Error("transient");
      },
      retry: {backoffMs: 500, maxAttempts: 5, maxBackoffMs: 60_000},
    });

    new TerrenoApp({
      skipListen: true,
      userModel: typedUserModel,
    })
      .register(jobsApp)
      .build();

    const enqueued = await getJobsService().enqueue({
      name: "retryable-failure",
      payload: {},
    });

    await jobsApp.startWorker();
    await waitUntil(async () => {
      const row = await Job.findExactlyOne({_id: enqueued._id});
      return row.status === "pending" && row.attemptCount === 1;
    });

    const afterFirstFailure = await Job.findExactlyOne({_id: enqueued._id});
    assert.equal(afterFirstFailure.status, "pending");
    assert.isUndefined(afterFirstFailure.lockedAt);
    assert.isUndefined(afterFirstFailure.lockedBy);
    assert.isAbove(
      DateTime.fromJSDate(afterFirstFailure.runAt).toMillis(),
      DateTime.utc().toMillis()
    );
    assert.lengthOf(afterFirstFailure.attempts, 1);
    assert.equal(afterFirstFailure.attempts[0]?.error, "transient");
    assert.isDefined(afterFirstFailure.attempts[0]?.at);
    assert.isTrue(jobsApp.isWorkerActive());

    await jobsApp.stopWorker();
  });

  it("clears lastError when a previously failed job completes", async (): Promise<void> => {
    let handlerRuns = 0;

    const jobsApp = new JobsApp({pollIntervalMs: 25});
    jobsApp.define("fail-then-succeed", {
      handler: async () => {
        handlerRuns += 1;
        if (handlerRuns === 1) {
          throw new Error("transient");
        }
      },
      retry: {backoffMs: 500, maxAttempts: 5, maxBackoffMs: 60_000},
    });

    new TerrenoApp({
      skipListen: true,
      userModel: typedUserModel,
    })
      .register(jobsApp)
      .build();

    const enqueued = await getJobsService().enqueue({
      name: "fail-then-succeed",
      payload: {},
    });

    await jobsApp.startWorker();
    await waitUntil(async () => {
      const row = await Job.findExactlyOne({_id: enqueued._id});
      return row.status === "pending" && row.attemptCount === 1;
    });

    const afterFailure = await Job.findExactlyOne({_id: enqueued._id});
    assert.equal(afterFailure.lastError, "transient");

    await Job.updateOne({_id: enqueued._id}, {$set: {runAt: DateTime.utc().toJSDate()}});
    await waitUntil(
      async () => (await Job.findExactlyOne({_id: enqueued._id})).status === "completed"
    );
    await jobsApp.stopWorker();

    const completed = await Job.findExactlyOne({_id: enqueued._id});
    assert.equal(completed.status, "completed");
    assert.isUndefined(completed.lastError);
    assert.equal(handlerRuns, 2);
  });

  it("lands dead after maxAttempts failures", async (): Promise<void> => {
    let handlerRuns = 0;

    const jobsApp = new JobsApp({pollIntervalMs: 25});
    jobsApp.define("always-fail", {
      handler: async () => {
        handlerRuns += 1;
        throw new Error(`fail-${handlerRuns}`);
      },
      retry: {backoffMs: 25, maxAttempts: 3, maxBackoffMs: 60_000},
    });

    new TerrenoApp({
      skipListen: true,
      userModel: typedUserModel,
    })
      .register(jobsApp)
      .build();

    const enqueued = await getJobsService().enqueue({
      name: "always-fail",
      payload: {},
    });

    await jobsApp.startWorker();

    for (let attempt = 1; attempt < 3; attempt += 1) {
      await waitUntil(async () => {
        const row = await Job.findExactlyOne({_id: enqueued._id});
        return row.status === "pending" && row.attemptCount === attempt;
      });
      await Job.updateOne({_id: enqueued._id}, {$set: {runAt: DateTime.utc().toJSDate()}});
    }

    await waitUntil(async () => (await Job.findExactlyOne({_id: enqueued._id})).status === "dead");
    await jobsApp.stopWorker();

    const dead = await Job.findExactlyOne({_id: enqueued._id});
    assert.equal(dead.status, "dead");
    assert.equal(dead.attemptCount, 3);
    assert.lengthOf(dead.attempts, 3);
    assert.equal(dead.attempts[2]?.error, "fail-3");
    assert.equal(dead.attempts[2]?.errorClass, "Error");
    assert.match(dead.lastError ?? "", /fail-3/);
    assert.isUndefined(dead.lockedAt);
    assert.isUndefined(dead.lockedBy);
    assert.equal(handlerRuns, 3);
  });

  it("does not increment attemptCount when abort throws AbortError in-flight", async (): Promise<void> => {
    const jobsApp = new JobsApp({pollIntervalMs: 25});
    jobsApp.define("abort-no-retry", {
      handler: async (_payload, ctx) => {
        await waitUntil(() => Promise.resolve(ctx.signal.aborted));
        const abortError = new Error("Aborted");
        abortError.name = "AbortError";
        throw abortError;
      },
      retry: {maxAttempts: 3},
    });

    new TerrenoApp({
      skipListen: true,
      userModel: typedUserModel,
    })
      .register(jobsApp)
      .build();

    const enqueued = await getJobsService().enqueue({
      name: "abort-no-retry",
      payload: {},
    });

    await jobsApp.startWorker();
    await waitUntil(
      async () => (await Job.findExactlyOne({_id: enqueued._id})).status === "running"
    );
    await jobsApp.stopWorker();
    await waitUntil(async () => {
      const row = await Job.findExactlyOne({_id: enqueued._id});
      return row.status === "pending" && row.lockedAt == null;
    });

    const requeued = await Job.findExactlyOne({_id: enqueued._id});
    assert.equal(requeued.attemptCount, 0);
    assert.lengthOf(requeued.attempts, 0);
  });

  it("counts a real handler error that coincides with stopWorker", async (): Promise<void> => {
    const jobsApp = new JobsApp({pollIntervalMs: 25});
    jobsApp.define("stop-real-error", {
      handler: async (_payload, ctx) => {
        await waitUntil(() => Promise.resolve(ctx.signal.aborted));
        throw new Error("database unavailable");
      },
      retry: {backoffMs: 500, maxAttempts: 5},
    });

    new TerrenoApp({
      skipListen: true,
      userModel: typedUserModel,
    })
      .register(jobsApp)
      .build();

    const enqueued = await getJobsService().enqueue({
      name: "stop-real-error",
      payload: {},
    });

    await jobsApp.startWorker();
    await waitUntil(
      async () => (await Job.findExactlyOne({_id: enqueued._id})).status === "running"
    );
    await jobsApp.stopWorker();
    await waitUntil(async () => {
      const row = await Job.findExactlyOne({_id: enqueued._id});
      return row.status === "pending" && row.attemptCount === 1;
    });

    const retried = await Job.findExactlyOne({_id: enqueued._id});
    assert.equal(retried.attemptCount, 1);
    assert.match(retried.lastError ?? "", /database unavailable/);
    assert.lengthOf(retried.attempts, 1);
  });

  it("does not let a stale worker overwrite a reclaimed claim result or retry budget", async (): Promise<void> => {
    let releaseStaleHandler!: () => void;
    const staleHandlerBlocked = new Promise<void>((resolve) => {
      releaseStaleHandler = resolve;
    });
    let staleHandlerRunning = false;

    const staleWorker = new JobsApp({lockTtlMs: 75, pollIntervalMs: 25});
    const reclaimWorker = new JobsApp({lockTtlMs: 75, pollIntervalMs: 25});

    staleWorker.define("stale-claim-race", {
      handler: async () => {
        staleHandlerRunning = true;
        await staleHandlerBlocked;
        throw new Error("stale failure must not apply");
      },
      retry: {backoffMs: 500, maxAttempts: 5},
    });
    reclaimWorker.define("stale-claim-race", {
      handler: async () => {},
      retry: {backoffMs: 500, maxAttempts: 5},
    });

    new TerrenoApp({
      skipListen: true,
      userModel: typedUserModel,
    })
      .register(staleWorker)
      .build();

    const enqueued = await getJobsService().enqueue({
      name: "stale-claim-race",
      payload: {},
    });

    try {
      await staleWorker.startWorker();
      await waitUntil(() => Promise.resolve(staleHandlerRunning));

      // The stale worker's lease renewals stop landing (for example a stalled process), so its
      // lock ages past the TTL and another worker reclaims the row.
      await Job.updateOne(
        {_id: enqueued._id},
        {$set: {lockedAt: DateTime.utc().minus({seconds: 5}).toJSDate()}}
      );

      await reclaimWorker.startWorker();
      await waitUntil(
        async () => (await Job.findExactlyOne({_id: enqueued._id})).status === "completed"
      );

      releaseStaleHandler();
      await Bun.sleep(150);

      const finalRow = await Job.findExactlyOne({_id: enqueued._id});
      assert.equal(finalRow.status, "completed");
      assert.equal(finalRow.attemptCount, 1);
      assert.lengthOf(finalRow.attempts, 1);
      assert.equal(finalRow.attempts[0].errorClass, "LeaseExpired");
      assert.isTrue(hasWorkerIdPrefix(finalRow.lockedBy));
      assert.isTrue(staleWorker.isWorkerActive());
    } finally {
      releaseStaleHandler();
      await Promise.all([staleWorker.stopWorker(), reclaimWorker.stopWorker()]);
    }
  });

  it("keeps the worker running after a retryable handler failure", async (): Promise<void> => {
    const jobsApp = new JobsApp({pollIntervalMs: 25});
    jobsApp.define("boom", {
      handler: async () => {
        throw new Error("handler exploded");
      },
      retry: {backoffMs: 500, maxAttempts: 5},
    });

    new TerrenoApp({
      skipListen: true,
      userModel: typedUserModel,
    })
      .register(jobsApp)
      .build();

    const enqueued = await getJobsService().enqueue({
      name: "boom",
      payload: {},
    });

    await jobsApp.startWorker();
    await waitUntil(async () => {
      const row = await Job.findExactlyOne({_id: enqueued._id});
      return row.status === "pending" && row.attemptCount === 1;
    });
    assert.isTrue(jobsApp.isWorkerActive());
    await jobsApp.stopWorker();

    const pending = await Job.findExactlyOne({_id: enqueued._id});
    assert.equal(pending.status, "pending");
    assert.match(pending.lastError ?? "", /handler exploded/);
  });
});
