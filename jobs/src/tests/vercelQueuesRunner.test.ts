import {beforeEach, describe, it} from "bun:test";
import {setupDb} from "@terreno/api/testing";
import {assert} from "chai";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import {JobDispatchError} from "../dispatchError";
import {JobsApp} from "../jobsApp";
import {getJobsService} from "../jobsService";
import {Job} from "../models/job";
import type {JobDocument} from "../modelTypes";
import {
  applyVercelQueueExecutionOutcome,
  buildVercelQueueSendOptions,
  clampVercelQueueRetryAfterSeconds,
  computeVercelQueueDelaySeconds,
  computeVercelQueueRetryAfterSeconds,
  createVercelQueuesConsumer,
  resolveVercelQueueConsumerRetry,
  resolveVercelQueueSendRetentionSeconds,
  VERCEL_QUEUE_DEFAULT_RETENTION_SECONDS,
  VERCEL_QUEUE_LOCKED_RETRY_SECONDS,
  VERCEL_QUEUE_MAX_DELAY_SECONDS,
  VERCEL_QUEUE_MAX_VISIBILITY_TIMEOUT_SECONDS,
  VERCEL_QUEUE_MIN_VISIBILITY_TIMEOUT_SECONDS,
  type VercelHandleCallbackFn,
  type VercelHandleCallbackOptions,
  VercelQueueConsumerControl,
  type VercelQueueMessageMetadata,
  type VercelQueueRetryDirective,
  VercelQueueRunAtBeyondLimitError,
  type VercelQueueSendFn,
  type VercelQueueSendOptions,
  VercelQueuesRunner,
  type VercelQueuesRunnerConfig,
} from "../runners/vercelQueues";

/** A fixed, valid instant; the runner helpers take `DateTime<true>`. */
const parseValidUtc = (iso: string): DateTime<true> => {
  const parsed = DateTime.fromISO(iso, {zone: "utc"});
  if (!parsed.isValid) {
    throw new Error(`Invalid ISO timestamp: ${iso}`);
  }
  return parsed;
};
const FIXED_NOW = parseValidUtc("2026-06-01T12:00:00.000Z");

interface RecordedSendCall {
  options?: VercelQueueSendOptions;
  payload: unknown;
  topic: string;
}

interface RecordedHandleCallback {
  handler: (message: unknown, metadata: VercelQueueMessageMetadata) => Promise<void>;
  options?: VercelHandleCallbackOptions;
}

const sampleMetadata = (): VercelQueueMessageMetadata => ({
  consumerGroup: "default",
  createdAt: DateTime.utc().toJSDate(),
  deliveryCount: 1,
  expiresAt: DateTime.utc().plus({hours: 1}).toJSDate(),
  messageId: "msg-1",
  region: "iad1",
  topicName: "terreno-jobs",
});

const createFakeSend = (): {calls: RecordedSendCall[]; send: VercelQueueSendFn} => {
  const calls: RecordedSendCall[] = [];

  const send: VercelQueueSendFn = async (
    topic: string,
    payload: unknown,
    options?: VercelQueueSendOptions
  ) => {
    calls.push({options, payload, topic});
    return {messageId: "msg-1"};
  };

  return {calls, send};
};

const createFakeHandleCallback = (): {
  getRecorded: () => RecordedHandleCallback | undefined;
  handleCallback: VercelHandleCallbackFn;
} => {
  let recorded: RecordedHandleCallback | undefined;

  const handleCallback: VercelHandleCallbackFn = (handler, options) => {
    recorded = {handler, options};
    return async (requestOrEvent: Request | {request: Request}) => {
      const request = requestOrEvent instanceof Request ? requestOrEvent : requestOrEvent.request;
      const message = await request.json();
      try {
        await handler(message, sampleMetadata());
        return new Response("ok", {status: 200});
      } catch (error: unknown) {
        const directive = options?.retry?.(error, sampleMetadata());
        if (directive && "acknowledge" in directive) {
          return new Response("acknowledged", {status: 200});
        }
        if (directive && "afterSeconds" in directive) {
          return Response.json(directive, {status: 202});
        }
        throw error;
      }
    };
  };

  return {
    getRecorded: () => recorded,
    handleCallback,
  };
};

const baseConfig = (overrides?: Partial<VercelQueuesRunnerConfig>): VercelQueuesRunnerConfig => {
  const {send} = createFakeSend();

  return {
    send,
    topic: "terreno-jobs",
    ...overrides,
  };
};

const buildJob = (overrides?: Partial<JobDocument>): JobDocument =>
  ({
    _id: new mongoose.Types.ObjectId(),
    runAt: DateTime.utc().toJSDate(),
    ...overrides,
  }) as JobDocument;

const registerJobsApp = (jobsApp: JobsApp): void => {
  const app = {
    get: (): typeof app => app,
    post: (): typeof app => app,
  };
  jobsApp.register(app as never);
};

describe("VercelQueuesRunner", () => {
  beforeEach(async (): Promise<void> => {
    await setupDb();
    await Job.deleteMany({});
  });

  it("does not require the execute route and does not implement start", (): void => {
    const runner = new VercelQueuesRunner(baseConfig());

    assert.equal(runner.requiresExecuteRoute, false);
    assert.isUndefined(Reflect.get(runner, "start"));
  });

  it("throws when topic is missing or blank", (): void => {
    assert.throws(() => new VercelQueuesRunner(baseConfig({topic: ""})), /topic/i);
    assert.throws(() => new VercelQueuesRunner(baseConfig({topic: "   "})), /topic/i);
  });

  it("throws when retentionSeconds is outside the Vercel 7-day bounds", (): void => {
    assert.throws(
      () => new VercelQueuesRunner(baseConfig({retentionSeconds: 30})),
      /retentionSeconds/i
    );
    assert.throws(
      () =>
        new VercelQueuesRunner(baseConfig({retentionSeconds: VERCEL_QUEUE_MAX_DELAY_SECONDS + 1})),
      /retentionSeconds/i
    );
  });

  it("publishes only {jobId} with topic, idempotency key, region, and explicit retention", async (): Promise<void> => {
    const fake = createFakeSend();
    const runner = new VercelQueuesRunner(
      baseConfig({
        region: "sfo1",
        retentionSeconds: 3600,
        send: fake.send,
        topic: "background-jobs",
      })
    );
    const job = buildJob();

    await runner.enqueue(job);

    assert.equal(fake.calls.length, 1);
    const call = fake.calls[0];
    assert.equal(call.topic, "background-jobs");
    assert.deepEqual(call.payload, {jobId: job._id.toString()});
    assert.deepEqual(call.options, {
      idempotencyKey: job._id.toString(),
      region: "sfo1",
      retentionSeconds: 3600,
    });
  });

  it("defaults retention to 86400 for immediate jobs", async (): Promise<void> => {
    const fake = createFakeSend();
    const runner = new VercelQueuesRunner(baseConfig({send: fake.send}));
    await runner.enqueue(buildJob());

    assert.equal(fake.calls[0].options?.retentionSeconds, VERCEL_QUEUE_DEFAULT_RETENTION_SECONDS);
    assert.isUndefined(fake.calls[0].options?.delaySeconds);
  });

  it("bumps retention to cover delaySeconds beyond 24h with a fixed now", (): void => {
    const now = FIXED_NOW;
    const runAt = now.plus({hours: 30});
    const job = buildJob({runAt: runAt.toJSDate()});
    const options = buildVercelQueueSendOptions(job, {}, now);

    assert.equal(options.delaySeconds, computeVercelQueueDelaySeconds(runAt.toJSDate(), now));
    assert.equal(options.retentionSeconds, options.delaySeconds);
    assert.isAbove(options.retentionSeconds ?? 0, VERCEL_QUEUE_DEFAULT_RETENTION_SECONDS);
  });

  it("rejects runAt beyond the 7-day Vercel delay window instead of capping delivery", (): void => {
    const now = DateTime.utc();
    assert.throws(
      () => computeVercelQueueDelaySeconds(now.plus({days: 8}).toJSDate(), now),
      VercelQueueRunAtBeyondLimitError
    );
  });

  it("compensates dispatch when runAt exceeds the Vercel delay window", async (): Promise<void> => {
    const jobsApp = new JobsApp({
      runner: new VercelQueuesRunner(baseConfig()),
    });
    jobsApp.define("future", {handler: async () => {}});
    registerJobsApp(jobsApp);

    try {
      await getJobsService().enqueue({
        name: "future",
        payload: {x: 1},
        runAt: DateTime.utc().plus({days: 8}).toJSDate(),
      });
      assert.fail("expected enqueue to throw");
    } catch (error: unknown) {
      assert.instanceOf(error, JobDispatchError);
      assert.equal((error as JobDispatchError).compensationSucceeded, true);
    }

    assert.equal(await Job.countDocuments({}), 0);
  });

  it("propagates send failures with dispatch compensation", async (): Promise<void> => {
    const send: VercelQueueSendFn = async () => {
      throw new Error("queue unavailable");
    };
    const jobsApp = new JobsApp({
      runner: new VercelQueuesRunner(baseConfig({send})),
    });
    jobsApp.define("fail-send", {handler: async () => {}});
    registerJobsApp(jobsApp);

    try {
      await getJobsService().enqueue({name: "fail-send", payload: {}});
      assert.fail("expected enqueue to throw");
    } catch (error: unknown) {
      assert.instanceOf(error, JobDispatchError);
      assert.equal((error as JobDispatchError).compensationSucceeded, true);
      assert.match((error as Error).message, /queue unavailable/i);
    }

    assert.equal(await Job.countDocuments({}), 0);
  });
});

describe("computeVercelQueueRetryAfterSeconds", () => {
  const now = FIXED_NOW;

  it("clamps retry visibility to the vendor 30..3600 second range", (): void => {
    assert.equal(
      clampVercelQueueRetryAfterSeconds(10),
      VERCEL_QUEUE_MIN_VISIBILITY_TIMEOUT_SECONDS
    );
    assert.equal(clampVercelQueueRetryAfterSeconds(30), 30);
    assert.equal(clampVercelQueueRetryAfterSeconds(300), 300);
    assert.equal(clampVercelQueueRetryAfterSeconds(3600), 3600);
    assert.equal(
      clampVercelQueueRetryAfterSeconds(7200),
      VERCEL_QUEUE_MAX_VISIBILITY_TIMEOUT_SECONDS
    );
  });

  it("uses seconds until runAt when due within one hour", (): void => {
    assert.equal(computeVercelQueueRetryAfterSeconds(now.plus({minutes: 5}).toJSDate(), now), 300);
    assert.equal(
      computeVercelQueueRetryAfterSeconds(now.plus({seconds: 10}).toJSDate(), now),
      VERCEL_QUEUE_MIN_VISIBILITY_TIMEOUT_SECONDS
    );
  });

  it("caps not_due retries at one hour until the job is due", (): void => {
    assert.equal(
      computeVercelQueueRetryAfterSeconds(now.plus({hours: 2}).toJSDate(), now),
      VERCEL_QUEUE_MAX_VISIBILITY_TIMEOUT_SECONDS
    );
    assert.equal(
      computeVercelQueueRetryAfterSeconds(now.plus({hours: 1, seconds: 1}).toJSDate(), now),
      VERCEL_QUEUE_MAX_VISIBILITY_TIMEOUT_SECONDS
    );
  });
});

describe("resolveVercelQueueSendRetentionSeconds", () => {
  it("keeps retention at or above delaySeconds", (): void => {
    assert.equal(resolveVercelQueueSendRetentionSeconds(undefined, 3600), 3600);
    assert.equal(resolveVercelQueueSendRetentionSeconds(7200, 3600), 7200);
    assert.equal(
      resolveVercelQueueSendRetentionSeconds(7200),
      VERCEL_QUEUE_DEFAULT_RETENTION_SECONDS
    );
  });
});

describe("createVercelQueuesConsumer", () => {
  beforeEach(async (): Promise<void> => {
    await setupDb();
    await Job.deleteMany({});
  });

  it("delegates to the injected handleCallback and returns a Web Response", async (): Promise<void> => {
    const jobsApp = new JobsApp({
      runner: new VercelQueuesRunner(baseConfig()),
    });
    jobsApp.define("noop", {handler: async () => {}});
    registerJobsApp(jobsApp);

    const fake = createFakeHandleCallback();
    const routeHandler = createVercelQueuesConsumer({
      handleCallback: fake.handleCallback,
      host: jobsApp,
    });

    assert.isDefined(fake.getRecorded());
    const response = await routeHandler(
      new Request("https://example.com/api/queues/terreno-jobs", {
        body: JSON.stringify({jobId: new mongoose.Types.ObjectId().toString()}),
        headers: {"content-type": "application/json"},
        method: "POST",
      })
    );

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "acknowledged");
  });

  it("ACKs malformed queue payloads through the vendor retry handler", async (): Promise<void> => {
    const jobsApp = new JobsApp({
      runner: new VercelQueuesRunner(baseConfig()),
    });
    jobsApp.define("noop", {handler: async () => {}});
    registerJobsApp(jobsApp);

    const fake = createFakeHandleCallback();
    const routeHandler = createVercelQueuesConsumer({
      handleCallback: fake.handleCallback,
      host: jobsApp,
    });

    const response = await routeHandler(
      new Request("https://example.com/api/queues/terreno-jobs", {
        body: JSON.stringify({notJobId: "x"}),
        headers: {"content-type": "application/json"},
        method: "POST",
      })
    );

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "acknowledged");
  });

  it("throws when visibilityTimeoutSeconds is outside the vendor range", (): void => {
    const fake = createFakeHandleCallback();
    assert.throws(
      () =>
        createVercelQueuesConsumer({
          handleCallback: fake.handleCallback,
          host: {
            getDefinition: () => undefined,
            getLockTtlMs: () => 15 * 60 * 1_000,
          },
          visibilityTimeoutSeconds: 10,
        }),
      /visibilityTimeoutSeconds/i
    );
  });

  it("forwards visibilityTimeoutSeconds to handleCallback", (): void => {
    const fake = createFakeHandleCallback();
    createVercelQueuesConsumer({
      handleCallback: fake.handleCallback,
      host: {
        getDefinition: () => undefined,
        getLockTtlMs: () => 15 * 60 * 1_000,
      },
      visibilityTimeoutSeconds: 900,
    });

    assert.equal(fake.getRecorded()?.options?.visibilityTimeoutSeconds, 900);
  });

  it("defaults visibilityTimeoutSeconds to 1800 for the 30-minute execution abort", (): void => {
    const fake = createFakeHandleCallback();
    createVercelQueuesConsumer({
      handleCallback: fake.handleCallback,
      host: {
        getDefinition: () => undefined,
        getLockTtlMs: () => 15 * 60 * 1_000,
      },
    });

    assert.equal(fake.getRecorded()?.options?.visibilityTimeoutSeconds, 1800);
  });

  it("executes the referenced job through the JobsApp seam", async (): Promise<void> => {
    let executedPayload: unknown;
    const jobsApp = new JobsApp({
      runner: new VercelQueuesRunner(baseConfig()),
    });
    jobsApp.define("deliver", {
      handler: async (payload) => {
        executedPayload = payload;
      },
    });
    registerJobsApp(jobsApp);

    const job = await getJobsService().enqueue({
      name: "deliver",
      payload: {userId: "u1"},
    });

    const fake = createFakeHandleCallback();
    const routeHandler = createVercelQueuesConsumer({
      handleCallback: fake.handleCallback,
      host: jobsApp,
    });

    const response = await routeHandler(
      new Request("https://example.com/api/queues/terreno-jobs", {
        body: JSON.stringify({jobId: job._id.toString()}),
        headers: {"content-type": "application/json"},
        method: "POST",
      })
    );

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "ok");
    const stored = await Job.findExactlyOne({_id: job._id});
    assert.equal(stored.status, "completed");
    assert.deepEqual(executedPayload, {userId: "u1"});
  });
});

describe("Vercel queue consumer retry directives", () => {
  it("ACKs malformed payloads and not_found jobs", (): void => {
    assert.deepEqual(
      resolveVercelQueueConsumerRetry(new VercelQueueConsumerControl({acknowledge: true})),
      {acknowledge: true}
    );

    try {
      applyVercelQueueExecutionOutcome({kind: "not_found"});
      assert.fail("expected control throw");
    } catch (error: unknown) {
      assert.deepEqual(resolveVercelQueueConsumerRetry(error), {acknowledge: true});
    }
  });

  it("retries live-lock conflicts after a bounded delay", (): void => {
    try {
      applyVercelQueueExecutionOutcome({kind: "conflict", reason: "locked"});
      assert.fail("expected control throw");
    } catch (error: unknown) {
      assert.deepEqual(resolveVercelQueueConsumerRetry(error), {
        afterSeconds: VERCEL_QUEUE_LOCKED_RETRY_SECONDS,
      });
    }
  });

  it("retries not_due conflicts aligned to runAt within visibility bounds", (): void => {
    const now = DateTime.utc();
    const runAt = now.plus({minutes: 5}).toJSDate();
    try {
      applyVercelQueueExecutionOutcome({kind: "conflict", reason: "not_due", runAt});
      assert.fail("expected control throw");
    } catch (error: unknown) {
      const directive = resolveVercelQueueConsumerRetry(error) as VercelQueueRetryDirective;
      const expected = computeVercelQueueRetryAfterSeconds(runAt, now);
      assert.equal((directive as {afterSeconds: number}).afterSeconds, expected);
      assert.isAtMost((directive as {afterSeconds: number}).afterSeconds, 300);
      assert.isAtLeast((directive as {afterSeconds: number}).afterSeconds, 290);
    }
  });

  it("retries handler failures that leave the job pending at Terreno runAt", (): void => {
    const now = DateTime.utc();
    const runAt = now.plus({minutes: 2}).toJSDate();
    const job = buildJob({runAt, status: "pending"});

    try {
      applyVercelQueueExecutionOutcome({job, kind: "executed"});
      assert.fail("expected control throw");
    } catch (error: unknown) {
      const directive = resolveVercelQueueConsumerRetry(error) as VercelQueueRetryDirective;
      assert.equal(
        (directive as {afterSeconds: number}).afterSeconds,
        computeVercelQueueRetryAfterSeconds(runAt, now)
      );
    }
  });

  it("retries executed pending jobs with runAt in the past using the vendor minimum", (): void => {
    const runAt = DateTime.utc().minus({minutes: 1}).toJSDate();
    const job = buildJob({runAt, status: "pending"});

    try {
      applyVercelQueueExecutionOutcome({job, kind: "executed"});
      assert.fail("expected control throw");
    } catch (error: unknown) {
      assert.deepEqual(resolveVercelQueueConsumerRetry(error), {
        afterSeconds: VERCEL_QUEUE_MIN_VISIBILITY_TIMEOUT_SECONDS,
      });
    }
  });

  it("ACKs terminal duplicate deliveries without retry directives", (): void => {
    const completedJob = buildJob({status: "completed"});
    applyVercelQueueExecutionOutcome({job: completedJob, kind: "noop"});
    applyVercelQueueExecutionOutcome({job: buildJob({status: "dead"}), kind: "noop"});
  });
});
