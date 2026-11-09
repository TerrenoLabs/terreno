import {beforeEach, describe, it} from "bun:test";
import {TerrenoApp, type UserModel as UserModelType} from "@terreno/api";
import {setupDb, UserModel} from "@terreno/api/testing";
import {assert} from "chai";
import {DateTime} from "luxon";

import {JobsApp} from "../jobsApp";
import {getJobsService} from "../jobsService";
import {Job} from "../models/job";
import {JobSchedule} from "../models/jobSchedule";

const typedUserModel = UserModel as unknown as UserModelType;

const waitUntil = async (
  predicate: () => Promise<boolean>,
  options?: {intervalMs?: number; timeoutMs?: number}
): Promise<void> => {
  const intervalMs = options?.intervalMs ?? 10;
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

const registerJobsApp = (jobsApp: JobsApp): void => {
  new TerrenoApp({
    skipListen: true,
    userModel: typedUserModel,
  })
    .register(jobsApp)
    .build();
};

const createStaleRunningJob = async ({
  maxAttempts,
  name,
}: {
  maxAttempts: number;
  name: string;
}): Promise<string> => {
  const stale = await Job.create({
    attemptCount: 0,
    lockedAt: DateTime.utc().minus({seconds: 5}).toJSDate(),
    lockedBy: "crashed-worker:1:stale-token",
    maxAttempts,
    name,
    payload: {},
    payloadRedacted: false,
    runAt: DateTime.utc().minus({seconds: 5}).toJSDate(),
    status: "running",
  });
  return stale._id.toString();
};

describe("jobs claim lease", () => {
  beforeEach(async (): Promise<void> => {
    await setupDb();
    await Job.deleteMany({});
    await JobSchedule.deleteMany({});
  });

  it("keeps the lease of a live handler so a later execute dispatch is rejected as locked", async (): Promise<void> => {
    let invocations = 0;
    let concurrent = 0;
    let maxConcurrent = 0;

    const jobsApp = new JobsApp({lockTtlMs: 100});
    jobsApp.define("long-once", {
      handler: async () => {
        invocations += 1;
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await Bun.sleep(400);
        concurrent -= 1;
      },
      retry: {maxAttempts: 1},
    });
    registerJobsApp(jobsApp);

    const enqueued = await getJobsService().enqueue({name: "long-once", payload: {}});
    const jobId = enqueued._id.toString();

    const first = jobsApp.executeQueuedJob(jobId);
    await Bun.sleep(30);
    const duplicateWithinTtl = await jobsApp.executeQueuedJob(jobId);
    await Bun.sleep(220);
    const duplicateAfterTtl = await jobsApp.executeQueuedJob(jobId);
    const firstOutcome = await first;

    assert.equal(duplicateWithinTtl.kind, "conflict");
    assert.equal(duplicateAfterTtl.kind, "conflict");
    assert.equal(firstOutcome.kind, "executed");
    assert.equal(invocations, 1);
    assert.equal(maxConcurrent, 1);

    const row = await Job.findExactlyOne({_id: jobId});
    assert.equal(row.status, "completed");
    assert.equal(row.attemptCount, 0);
  });

  it("runs a long handler once across two poll workers and keeps both workers active", async (): Promise<void> => {
    let invocations = 0;
    let concurrent = 0;
    let maxConcurrent = 0;
    const handler = async (): Promise<void> => {
      invocations += 1;
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await Bun.sleep(600);
      concurrent -= 1;
    };

    const workerA = new JobsApp({lockTtlMs: 150, pollIntervalMs: 20});
    const workerB = new JobsApp({lockTtlMs: 150, pollIntervalMs: 20});
    workerA.define("long-poll-once", {handler, retry: {maxAttempts: 1}});
    workerB.define("long-poll-once", {handler, retry: {maxAttempts: 1}});
    registerJobsApp(workerA);

    const enqueued = await getJobsService().enqueue({name: "long-poll-once", payload: {}});

    try {
      await Promise.all([workerA.startWorker(), workerB.startWorker()]);
      await waitUntil(
        async () => (await Job.findExactlyOne({_id: enqueued._id})).status === "completed"
      );
      await Bun.sleep(200);

      assert.equal(invocations, 1);
      assert.equal(maxConcurrent, 1);
      assert.isTrue(workerA.isWorkerActive());
      assert.isTrue(workerB.isWorkerActive());

      const row = await Job.findExactlyOne({_id: enqueued._id});
      assert.equal(row.status, "completed");
      assert.equal(row.attemptCount, 0);
    } finally {
      await Promise.all([workerA.stopWorker(), workerB.stopWorker()]);
    }
  });

  it("dead-letters an expired running job on execute once its attempts are exhausted", async (): Promise<void> => {
    let invocations = 0;
    const jobsApp = new JobsApp({lockTtlMs: 100});
    jobsApp.define("crashed-once", {
      handler: async () => {
        invocations += 1;
      },
      retry: {maxAttempts: 1},
    });
    registerJobsApp(jobsApp);

    const jobId = await createStaleRunningJob({maxAttempts: 1, name: "crashed-once"});
    const outcome = await jobsApp.executeQueuedJob(jobId);

    assert.equal(outcome.kind, "executed");
    assert.equal(invocations, 0);
    const row = await Job.findExactlyOne({_id: jobId});
    assert.equal(row.status, "dead");
    assert.equal(row.attemptCount, 1);
    assert.lengthOf(row.attempts, 1);
    assert.isUndefined(row.lockedAt);
    assert.isUndefined(row.lockedBy);
  });

  it("dead-letters an expired running job in the poll loop once its attempts are exhausted", async (): Promise<void> => {
    let invocations = 0;
    const jobsApp = new JobsApp({lockTtlMs: 100, pollIntervalMs: 20});
    jobsApp.define("crashed-poll-once", {
      handler: async () => {
        invocations += 1;
      },
      retry: {maxAttempts: 1},
    });
    registerJobsApp(jobsApp);

    const jobId = await createStaleRunningJob({maxAttempts: 1, name: "crashed-poll-once"});

    try {
      await jobsApp.startWorker();
      await waitUntil(async () => (await Job.findExactlyOne({_id: jobId})).status === "dead");
    } finally {
      await jobsApp.stopWorker();
    }

    assert.equal(invocations, 0);
    const row = await Job.findExactlyOne({_id: jobId});
    assert.equal(row.attemptCount, 1);
  });

  it("counts a reclaim as an attempt and still runs the job when attempts remain", async (): Promise<void> => {
    let invocations = 0;
    const jobsApp = new JobsApp({lockTtlMs: 100});
    jobsApp.define("crashed-retryable", {
      handler: async () => {
        invocations += 1;
      },
      retry: {maxAttempts: 3},
    });
    registerJobsApp(jobsApp);

    const jobId = await createStaleRunningJob({maxAttempts: 3, name: "crashed-retryable"});
    const outcome = await jobsApp.executeQueuedJob(jobId);

    assert.equal(outcome.kind, "executed");
    assert.equal(invocations, 1);
    const row = await Job.findExactlyOne({_id: jobId});
    assert.equal(row.status, "completed");
    assert.equal(row.attemptCount, 1);
  });

  it("aborts a handler that loses its lease and keeps the poll loop alive", async (): Promise<void> => {
    let sawAbort = false;
    let handlerStarted = false;

    const jobsApp = new JobsApp({lockTtlMs: 90, pollIntervalMs: 20});
    jobsApp.define("lease-lost", {
      handler: async (_payload, ctx) => {
        handlerStarted = true;
        await waitUntil(() => Promise.resolve(ctx.signal.aborted), {timeoutMs: 2_000});
        sawAbort = true;
      },
      retry: {maxAttempts: 1},
    });
    jobsApp.define("after-lease-lost", {
      handler: async () => {},
    });
    registerJobsApp(jobsApp);

    const enqueued = await getJobsService().enqueue({name: "lease-lost", payload: {}});

    try {
      await jobsApp.startWorker();
      await waitUntil(() => Promise.resolve(handlerStarted));
      // Another consumer takes the row over (for example after this worker stalled past the TTL).
      await Job.updateOne(
        {_id: enqueued._id},
        {
          $set: {
            lockedAt: DateTime.utc().plus({minutes: 5}).toJSDate(),
            lockedBy: "other-worker:2:other-token",
          },
        }
      );
      await waitUntil(() => Promise.resolve(sawAbort));

      const followUp = await getJobsService().enqueue({name: "after-lease-lost", payload: {}});
      await waitUntil(
        async () => (await Job.findExactlyOne({_id: followUp._id})).status === "completed"
      );

      assert.isTrue(jobsApp.isWorkerActive());
      const row = await Job.findExactlyOne({_id: enqueued._id});
      assert.equal(row.status, "running");
      assert.equal(row.lockedBy, "other-worker:2:other-token");
    } finally {
      await jobsApp.stopWorker();
    }
  });
});
