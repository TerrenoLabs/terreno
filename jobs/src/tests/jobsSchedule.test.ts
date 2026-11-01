import {beforeEach, describe, it} from "bun:test";
import {isAPIError, TerrenoApp, type UserModel as UserModelType} from "@terreno/api";
import {setupDb, UserModel} from "@terreno/api/testing";
import {assert} from "chai";
import {DateTime} from "luxon";

import {JobsApp} from "../jobsApp";
import {getJobsService, JobsService} from "../jobsService";
import {Job} from "../models/job";
import {JobSchedule} from "../models/jobSchedule";
import {buildScheduleRunIdempotencyKey, tickDueSchedules} from "../scheduler";

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

const registerJobsApp = (jobsApp: JobsApp): void => {
  new TerrenoApp({
    skipListen: true,
    userModel: typedUserModel,
  })
    .register(jobsApp)
    .build();
};

const captureError = (operation: () => void): unknown => {
  try {
    operation();
    return undefined;
  } catch (error: unknown) {
    return error;
  }
};

const startScheduledWorker = async (
  jobsApp: JobsApp,
  name: string,
  handler: () => Promise<void>,
  schedule: {cron: string; timezone?: string}
): Promise<void> => {
  jobsApp.define(name, {handler, schedule});
  registerJobsApp(jobsApp);
  await jobsApp.startWorker();
};

describe("jobs recurring schedules", () => {
  beforeEach(async (): Promise<void> => {
    await setupDb();
    await Job.deleteMany({});
    await JobSchedule.deleteMany({});
    await Job.syncIndexes();
    await JobSchedule.syncIndexes();
  });

  it("rejects invalid cron when defining a scheduled job", (): void => {
    const jobsApp = new JobsApp();
    const error = captureError(() =>
      jobsApp.define("bad-cron", {
        handler: async () => {},
        schedule: {cron: "not-a-cron"},
      })
    );

    assert.isTrue(isAPIError(error));
    assert.equal((error as {status: number}).status, 400);
  });

  it("rejects invalid timezone when defining a scheduled job", (): void => {
    const jobsApp = new JobsApp();
    const error = captureError(() =>
      jobsApp.define("bad-timezone", {
        handler: async () => {},
        schedule: {cron: "0 9 * * *", timezone: "Not/A_Zone"},
      })
    );

    assert.isTrue(isAPIError(error));
    assert.equal((error as {status: number}).status, 400);
  });

  it("upserts JobSchedule on startWorker with default UTC timezone", async (): Promise<void> => {
    const jobsApp = new JobsApp({pollIntervalMs: 25});
    jobsApp.define("utc-daily", {
      handler: async () => {},
      schedule: {cron: "0 9 * * *"},
    });
    registerJobsApp(jobsApp);

    await jobsApp.startWorker();
    await jobsApp.stopWorker();

    const schedule = await JobSchedule.findExactlyOne({name: "utc-daily"});
    assert.equal(schedule.timezone, "UTC");
    assert.equal(schedule.handlerName, "utc-daily");
    assert.equal(schedule.enabled, true);
    assert.isAbove(schedule.nextRunAt.getTime(), DateTime.utc().toMillis() - 1_000);
  });

  it("uses JobsApp timezone when the schedule omits timezone", async (): Promise<void> => {
    const jobsApp = new JobsApp({pollIntervalMs: 25, timezone: "America/New_York"});
    jobsApp.define("app-tz-daily", {
      handler: async () => {},
      schedule: {cron: "0 9 * * *"},
    });
    registerJobsApp(jobsApp);

    await jobsApp.startWorker();
    await jobsApp.stopWorker();

    const schedule = await JobSchedule.findExactlyOne({name: "app-tz-daily"});
    assert.equal(schedule.timezone, "America/New_York");
  });

  it("enqueues a recurring child job with scheduleId when due", async (): Promise<void> => {
    let handlerRuns = 0;
    const jobsApp = new JobsApp({pollIntervalMs: 25});
    jobsApp.define("recurring-child", {
      handler: async () => {
        handlerRuns += 1;
      },
      schedule: {cron: "0 9 * * *", timezone: "UTC"},
    });
    registerJobsApp(jobsApp);

    await jobsApp.startWorker();
    const schedule = await JobSchedule.findExactlyOne({name: "recurring-child"});
    await JobSchedule.updateOne(
      {_id: schedule._id},
      {$set: {nextRunAt: DateTime.utc().minus({minutes: 1}).toJSDate()}}
    );

    await waitUntil(async () => handlerRuns >= 1);
    await jobsApp.stopWorker();

    const childJobs = await Job.find({name: "recurring-child"});
    assert.equal(childJobs.length, 1);
    assert.equal(childJobs[0]?.scheduleId?.toString(), schedule._id.toString());
    assert.equal(handlerRuns, 1);

    const updatedSchedule = await JobSchedule.findExactlyOne({_id: schedule._id});
    assert.isAbove(updatedSchedule.nextRunAt.getTime(), DateTime.utc().toMillis() - 1_000);
  });

  it("skips enqueue when a child is still in-flight but advances nextRunAt", async (): Promise<void> => {
    const jobsApp = new JobsApp({pollIntervalMs: 25});
    jobsApp.define("overlap-skip", {
      handler: async () => {},
      schedule: {cron: "0 9 * * *", timezone: "UTC"},
    });
    registerJobsApp(jobsApp);

    await jobsApp.startWorker();
    const schedule = await JobSchedule.findExactlyOne({name: "overlap-skip"});
    // Stop polling before the schedule is due so a 25ms tick cannot enqueue
    // between the due write and the in-flight child.
    await jobsApp.stopWorker();

    const staleNextRunAt = DateTime.utc().minus({minutes: 1}).toJSDate();
    await JobSchedule.updateOne({_id: schedule._id}, {$set: {nextRunAt: staleNextRunAt}});

    await getJobsService().enqueue({
      name: "overlap-skip",
      payload: {},
      scheduleId: schedule._id.toString(),
    });

    await tickDueSchedules({
      jobsService: getJobsService(),
      now: DateTime.utc().toJSDate(),
    });

    const updated = await JobSchedule.findExactlyOne({_id: schedule._id});
    assert.isAbove(updated.nextRunAt.getTime(), staleNextRunAt.getTime());

    const childJobs = await Job.find({name: "overlap-skip"});
    assert.equal(childJobs.length, 1, "overlap tick must not enqueue a second child");
  });

  it("stores America/New_York nextRunAt differently from UTC for the same cron", async (): Promise<void> => {
    const utcApp = new JobsApp({pollIntervalMs: 25});
    utcApp.define("tz-compare-utc", {
      handler: async () => {},
      schedule: {cron: "0 9 * * *", timezone: "UTC"},
    });
    registerJobsApp(utcApp);
    await utcApp.startWorker();
    await utcApp.stopWorker();

    const newYorkApp = new JobsApp({pollIntervalMs: 25});
    newYorkApp.define("tz-compare-ny", {
      handler: async () => {},
      schedule: {cron: "0 9 * * *", timezone: "America/New_York"},
    });
    registerJobsApp(newYorkApp);
    await newYorkApp.startWorker();
    await newYorkApp.stopWorker();

    const utcSchedule = await JobSchedule.findExactlyOne({name: "tz-compare-utc"});
    const newYorkSchedule = await JobSchedule.findExactlyOne({name: "tz-compare-ny"});

    assert.notEqual(
      utcSchedule.nextRunAt.toISOString(),
      newYorkSchedule.nextRunAt.toISOString(),
      "same cron in different IANA zones must not share nextRunAt"
    );
  });

  it("preserves overdue nextRunAt and enabled:false across reconcile when cron/timezone unchanged", async (): Promise<void> => {
    const jobsApp = new JobsApp({pollIntervalMs: 25});
    await startScheduledWorker(jobsApp, "paused-overdue", async () => {}, {
      cron: "0 9 * * *",
      timezone: "UTC",
    });

    const overdue = DateTime.utc().minus({hours: 2}).toJSDate();
    await JobSchedule.updateOne(
      {name: "paused-overdue"},
      {$set: {enabled: false, nextRunAt: overdue}}
    );

    await getJobsService().reconcileSchedules();

    const schedule = await JobSchedule.findExactlyOne({name: "paused-overdue"});
    assert.equal(schedule.enabled, false);
    assert.equal(schedule.nextRunAt.toISOString(), overdue.toISOString());

    await jobsApp.stopWorker();
  });

  it("does not enqueue when disabled and catches up overdue rows after re-enable", async (): Promise<void> => {
    let handlerRuns = 0;
    const jobsApp = new JobsApp({pollIntervalMs: 25});
    await startScheduledWorker(
      jobsApp,
      "pause-resume",
      async () => {
        handlerRuns += 1;
      },
      {cron: "0 9 * * *", timezone: "UTC"}
    );

    const overdue = DateTime.utc().minus({minutes: 5}).toJSDate();
    await JobSchedule.updateOne(
      {name: "pause-resume"},
      {$set: {enabled: false, nextRunAt: overdue}}
    );

    await waitUntil(async () => (await Job.countDocuments({name: "pause-resume"})) === 0, {
      timeoutMs: 500,
    });

    await JobSchedule.updateOne({name: "pause-resume"}, {$set: {enabled: true}});
    await waitUntil(async () => handlerRuns >= 1);

    assert.equal(await Job.countDocuments({name: "pause-resume"}), 1);
    await jobsApp.stopWorker();
  });

  it("updates nextRunAt but preserves enabled:false when cron changes", async (): Promise<void> => {
    const jobsApp = new JobsApp({pollIntervalMs: 25});
    jobsApp.define("cron-change", {
      handler: async () => {},
      schedule: {cron: "0 9 * * *", timezone: "UTC"},
    });
    registerJobsApp(jobsApp);
    await jobsApp.startWorker();

    const before = await JobSchedule.findExactlyOne({name: "cron-change"});
    await JobSchedule.updateOne({name: "cron-change"}, {$set: {enabled: false}});

    jobsApp.define("cron-change", {
      handler: async () => {},
      schedule: {cron: "0 10 * * *", timezone: "UTC"},
    });
    getJobsService().markSchedulesDirty();
    await getJobsService().reconcileSchedulesIfDirty();

    const after = await JobSchedule.findExactlyOne({name: "cron-change"});
    assert.equal(after.enabled, false);
    assert.notEqual(after.nextRunAt.toISOString(), before.nextRunAt.toISOString());
    assert.equal(after.cron, "0 10 * * *");

    await jobsApp.stopWorker();
  });

  it("persists a schedule defined after the worker has started via dirty reconcile", async (): Promise<void> => {
    const jobsApp = new JobsApp({pollIntervalMs: 25});
    jobsApp.define("existing", {
      handler: async () => {},
    });
    registerJobsApp(jobsApp);
    await jobsApp.startWorker();

    jobsApp.define("late-schedule", {
      handler: async () => {},
      schedule: {cron: "0 9 * * *", timezone: "UTC"},
    });

    await waitUntil(async () => (await JobSchedule.countDocuments({name: "late-schedule"})) === 1);
    assert.isFalse(getJobsService().isSchedulesDirty());

    await jobsApp.stopWorker();
  });

  it("creates exactly one child when two workers race the same due schedule", async (): Promise<void> => {
    let handlerRuns = 0;
    const handler = async (): Promise<void> => {
      handlerRuns += 1;
    };

    const workerA = new JobsApp({pollIntervalMs: 25});
    const workerB = new JobsApp({pollIntervalMs: 25});
    workerA.define("race-schedule", {handler, schedule: {cron: "0 9 * * *", timezone: "UTC"}});
    workerB.define("race-schedule", {handler, schedule: {cron: "0 9 * * *", timezone: "UTC"}});
    registerJobsApp(workerA);

    try {
      await Promise.all([workerA.startWorker(), workerB.startWorker()]);

      const schedule = await JobSchedule.findExactlyOne({name: "race-schedule"});
      await JobSchedule.updateOne(
        {_id: schedule._id},
        {$set: {nextRunAt: DateTime.utc().minus({minutes: 1}).toJSDate()}}
      );

      await waitUntil(async () => handlerRuns >= 1);

      assert.equal(await Job.countDocuments({name: "race-schedule"}), 1);
      assert.equal(handlerRuns, 1);
    } finally {
      await Promise.allSettled([workerA.stopWorker(), workerB.stopWorker()]);
    }
  });

  it("rolls back nextRunAt and retries enqueue so exactly one child is created", async (): Promise<void> => {
    const jobsApp = new JobsApp({pollIntervalMs: 25});
    jobsApp.define("enqueue-retry", {
      handler: async () => {},
      schedule: {cron: "0 9 * * *", timezone: "UTC"},
    });
    registerJobsApp(jobsApp);
    await jobsApp.startWorker();

    const schedule = await JobSchedule.findExactlyOne({name: "enqueue-retry"});
    const dueRunAt = DateTime.utc().minus({minutes: 1}).toJSDate();
    await JobSchedule.updateOne({_id: schedule._id}, {$set: {nextRunAt: dueRunAt}});

    const service = getJobsService();
    const originalEnqueue = service.enqueue.bind(service);
    let enqueueAttempts = 0;
    service.enqueue = async (params) => {
      enqueueAttempts += 1;
      if (enqueueAttempts === 1) {
        throw new Error("simulated enqueue failure");
      }
      return originalEnqueue(params);
    };

    await tickDueSchedules({jobsService: service, now: DateTime.utc().toJSDate()});

    const rolledBack = await JobSchedule.findExactlyOne({_id: schedule._id});
    assert.equal(rolledBack.nextRunAt.toISOString(), dueRunAt.toISOString());
    assert.equal(await Job.countDocuments({name: "enqueue-retry"}), 0);

    await tickDueSchedules({jobsService: service, now: DateTime.utc().toJSDate()});

    assert.equal(enqueueAttempts, 2);
    assert.equal(await Job.countDocuments({name: "enqueue-retry"}), 1);
    assert.equal(
      (await Job.findExactlyOne({name: "enqueue-retry"})).idempotencyKey,
      buildScheduleRunIdempotencyKey(schedule._id.toString(), dueRunAt)
    );

    await jobsApp.stopWorker();
  });

  it("isolates tick errors so other due schedules still enqueue", async (): Promise<void> => {
    const jobsApp = new JobsApp({pollIntervalMs: 25});
    jobsApp.define("fail-tick", {
      handler: async () => {},
      schedule: {cron: "0 9 * * *", timezone: "UTC"},
    });
    jobsApp.define("ok-tick", {
      handler: async () => {},
      schedule: {cron: "0 9 * * *", timezone: "UTC"},
    });
    registerJobsApp(jobsApp);
    await jobsApp.startWorker();

    const due = DateTime.utc().minus({minutes: 1}).toJSDate();
    await JobSchedule.updateMany({}, {$set: {nextRunAt: due}});

    const service = getJobsService();
    const originalEnqueue = service.enqueue.bind(service);
    service.enqueue = async (params) => {
      if (params.name === "fail-tick") {
        throw new Error("simulated tick enqueue failure");
      }
      return originalEnqueue(params);
    };

    await tickDueSchedules({jobsService: service, now: DateTime.utc().toJSDate()});

    assert.equal(await Job.countDocuments({name: "fail-tick"}), 0);
    assert.equal(await Job.countDocuments({name: "ok-tick"}), 1);

    await jobsApp.stopWorker();
  });

  it("keeps the worker running after a schedule tick enqueue failure", async (): Promise<void> => {
    let manualRuns = 0;
    const jobsApp = new JobsApp({pollIntervalMs: 25});
    jobsApp.define("fail-tick-worker", {
      handler: async () => {},
      schedule: {cron: "0 9 * * *", timezone: "UTC"},
    });
    jobsApp.define("manual-job", {
      handler: async () => {
        manualRuns += 1;
      },
    });
    registerJobsApp(jobsApp);
    await jobsApp.startWorker();

    const due = DateTime.utc().minus({minutes: 1}).toJSDate();
    await JobSchedule.updateOne({name: "fail-tick-worker"}, {$set: {nextRunAt: due}});

    const service = getJobsService();
    const originalEnqueue = service.enqueue.bind(service);
    service.enqueue = async (params) => {
      if (params.name === "fail-tick-worker") {
        throw new Error("simulated tick enqueue failure");
      }
      return originalEnqueue(params);
    };

    await getJobsService().enqueue({name: "manual-job", payload: {}});

    await waitUntil(async () => manualRuns >= 1);
    assert.isTrue(jobsApp.isWorkerActive());

    await jobsApp.stopWorker();
  });

  it("survives worker restart with overdue nextRunAt intact until caught up", async (): Promise<void> => {
    let handlerRuns = 0;
    const jobsApp = new JobsApp({pollIntervalMs: 25});
    await startScheduledWorker(
      jobsApp,
      "restart-catchup",
      async () => {
        handlerRuns += 1;
      },
      {cron: "0 9 * * *", timezone: "UTC"}
    );

    await jobsApp.stopWorker();

    const overdue = DateTime.utc().minus({minutes: 10}).toJSDate();
    await JobSchedule.updateOne({name: "restart-catchup"}, {$set: {nextRunAt: overdue}});

    await getJobsService().reconcileSchedules();
    const afterReconcile = await JobSchedule.findExactlyOne({name: "restart-catchup"});
    assert.equal(afterReconcile.nextRunAt.toISOString(), overdue.toISOString());

    await jobsApp.startWorker();
    await waitUntil(async () => handlerRuns >= 1);
    await jobsApp.stopWorker();

    assert.equal(handlerRuns, 1);
    assert.equal(await Job.countDocuments({name: "restart-catchup"}), 1);
  });
});

describe("jobs schedule reconcile unit", () => {
  beforeEach(async (): Promise<void> => {
    await setupDb();
    await Job.deleteMany({});
    await JobSchedule.deleteMany({});
  });

  it("initializes enabled and nextRunAt on first reconcile insert", async (): Promise<void> => {
    const service = new JobsService({defaultTimezone: "UTC"});
    service.define("fresh", {
      handler: async () => {},
      schedule: {cron: "0 9 * * *", timezone: "UTC"},
    });

    await service.reconcileSchedules();

    const schedule = await JobSchedule.findExactlyOne({name: "fresh"});
    assert.equal(schedule.enabled, true);
    assert.isAbove(schedule.nextRunAt.getTime(), DateTime.utc().toMillis() - 1_000);
  });
});
