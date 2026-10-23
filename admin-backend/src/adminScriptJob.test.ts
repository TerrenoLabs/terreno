import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {
  addAuthRoutes,
  apiErrorMiddleware,
  apiUnauthorizedMiddleware,
  BackgroundTask,
  createScriptArgs,
  setupAuth,
  type UserModel as UserModelType,
} from "@terreno/api";
import {getBaseServer, setupDb, UserModel} from "@terreno/api/testing";
import {Job, type JobDefinition, JobsApp, unregisterJobsService} from "@terreno/jobs";

import {
  ADMIN_SCRIPT_JOB_NAME,
  type AdminScriptJobTarget,
  defineAdminScriptJob,
  runRegisteredScriptTask,
  tryCancelAdminScriptJob,
  tryEnqueueAdminScriptJob,
} from "./adminScriptJob";

const getAdminScriptHandler = (
  getScript: (name: string) => AdminScriptJobTarget | undefined = () => echoScript
): JobDefinition["handler"] => {
  let handler: JobDefinition["handler"] | undefined;
  defineAdminScriptJob(
    {
      define: (_name, definition) => {
        handler = definition.handler;
      },
    },
    getScript
  );
  if (!handler) {
    throw new Error("admin/script handler was not registered");
  }
  return handler;
};

const mockJobContext = {
  attempt: 1,
  jobId: "job-test",
  signal: new AbortController().signal,
};

const echoScript = {
  description: "Echo",
  name: "echo",
  runner: async (wetRun: boolean) => ({
    results: [wetRun ? "wet" : "dry"],
    success: true,
  }),
};

describe("admin/script durable job adapter", () => {
  beforeEach(async () => {
    await setupDb();
    await BackgroundTask.deleteMany({});
    await Job.deleteMany({});
    unregisterJobsService();
  });

  afterEach(async () => {
    unregisterJobsService();
  });

  it("parses a valid payload and rejects malformed ones", async () => {
    const handler = getAdminScriptHandler();
    const task = await BackgroundTask.create({
      isDryRun: true,
      logs: [],
      status: "pending",
      taskType: "echo",
    });
    await handler(
      {
        args: {model: "todos"},
        createdByName: "Ada",
        scriptName: "echo",
        taskId: String(task._id),
        wetRun: false,
      },
      mockJobContext
    );
    const completed = await BackgroundTask.findById(task._id);
    expect(completed?.status).toBe("completed");

    await expect(handler(null, mockJobContext)).rejects.toThrow("Invalid admin/script job payload");

    const omittedArgsTask = await BackgroundTask.create({
      isDryRun: true,
      logs: [],
      status: "pending",
      taskType: "echo",
    });
    await handler(
      {
        scriptName: "echo",
        taskId: String(omittedArgsTask._id),
        wetRun: false,
      },
      mockJobContext
    );
    expect((await BackgroundTask.findById(omittedArgsTask._id))?.status).toBe("completed");

    await expect(handler({scriptName: "echo"}, mockJobContext)).rejects.toThrow(
      "Invalid admin/script job payload"
    );
    await expect(
      handler(
        {
          args: {bad: {nested: true}},
          scriptName: "echo",
          taskId: "abc",
          wetRun: true,
        },
        mockJobContext
      )
    ).rejects.toThrow("Invalid admin/script job payload");
  });

  it("does not enqueue when JobsApp is unregistered", async () => {
    const enqueued = await tryEnqueueAdminScriptJob({
      args: {},
      scriptName: "echo",
      taskId: "000000000000000000000001",
      wetRun: false,
    });
    expect(enqueued).toBeUndefined();
  });

  it("runs a script against a BackgroundTask row", async () => {
    const task = await BackgroundTask.create({
      isDryRun: true,
      logs: [],
      status: "pending",
      taskType: "echo",
    });
    const {args} = createScriptArgs({values: {}});
    await runRegisteredScriptTask({
      args,
      script: echoScript,
      taskId: String(task._id),
      wetRun: false,
    });
    const refreshed = await BackgroundTask.findById(task._id);
    expect(refreshed?.status).toBe("completed");
    expect(refreshed?.result).toContain("dry");
  });

  it("enqueues admin/script with maxAttempts 1 and completes via executeQueuedJob", async () => {
    const jobsApp = new JobsApp({pollIntervalMs: 25});
    defineAdminScriptJob(jobsApp, (name) => (name === "echo" ? echoScript : undefined));
    const app = getBaseServer();
    setupAuth(app, UserModel as unknown as UserModelType);
    addAuthRoutes(app, UserModel as unknown as UserModelType);
    jobsApp.register(app);
    app.use(apiUnauthorizedMiddleware);
    app.use(apiErrorMiddleware);

    const task = await BackgroundTask.create({
      isDryRun: true,
      logs: [],
      status: "pending",
      taskType: "echo",
    });
    const enqueued = await tryEnqueueAdminScriptJob({
      args: {},
      scriptName: "echo",
      taskId: String(task._id),
      wetRun: false,
    });
    expect(enqueued).toBeDefined();
    const job = await Job.findById(enqueued?.id);
    expect(job?.name).toBe(ADMIN_SCRIPT_JOB_NAME);
    expect(job?.maxAttempts).toBe(1);

    const outcome = await jobsApp.executeQueuedJob(String(job?._id));
    expect(outcome.kind).toBe("executed");
    if (outcome.kind === "executed") {
      expect(outcome.job.lastError).toBeUndefined();
      expect(outcome.job.status).toBe("completed");
    }
    const current = await BackgroundTask.findById(task._id);
    expect(current?.status).toBe("completed");
    expect(current?.result).toContain("dry");
  });

  it("treats omitted args as empty and rejects empty script names", async () => {
    const handler = getAdminScriptHandler();
    const taggedTask = await BackgroundTask.create({
      isDryRun: true,
      logs: [],
      status: "pending",
      taskType: "echo",
    });
    await handler(
      {
        args: {tags: ["a", "b"]},
        scriptName: "echo",
        taskId: String(taggedTask._id),
        wetRun: true,
      },
      mockJobContext
    );
    expect((await BackgroundTask.findById(taggedTask._id))?.result).toContain("wet");

    await expect(
      handler(
        {
          args: [],
          scriptName: "echo",
          taskId: "abc",
          wetRun: true,
        },
        mockJobContext
      )
    ).rejects.toThrow("Invalid admin/script job payload");
    await expect(
      handler({scriptName: "", taskId: "abc", wetRun: true}, mockJobContext)
    ).rejects.toThrow("Invalid admin/script job payload");
    await expect(
      handler({scriptName: "echo", taskId: "", wetRun: true}, mockJobContext)
    ).rejects.toThrow("Invalid admin/script job payload");
    await expect(
      handler({scriptName: "echo", taskId: "abc", wetRun: "yes"}, mockJobContext)
    ).rejects.toThrow("Invalid admin/script job payload");
  });

  it("marks the BackgroundTask cancelled when the job signal is aborted", async () => {
    const task = await BackgroundTask.create({
      isDryRun: true,
      logs: [],
      status: "pending",
      taskType: "echo",
    });
    const {args} = createScriptArgs({values: {}});
    const signal = AbortSignal.abort();
    await runRegisteredScriptTask({
      args,
      script: echoScript,
      signal,
      taskId: String(task._id),
      wetRun: false,
    });
    const refreshed = await BackgroundTask.findById(task._id);
    expect(refreshed?.status).toBe("cancelled");
  });

  it("fails the BackgroundTask when the script name is unknown", async () => {
    const jobsApp = new JobsApp({pollIntervalMs: 50});
    defineAdminScriptJob(jobsApp, () => undefined);
    const app = getBaseServer();
    jobsApp.register(app);
    const task = await BackgroundTask.create({
      isDryRun: true,
      logs: [],
      status: "pending",
      taskType: "missing",
    });
    const enqueued = await tryEnqueueAdminScriptJob({
      args: {model: "todos"},
      scriptName: "missing",
      taskId: String(task._id),
      wetRun: false,
    });
    const outcome = await jobsApp.executeQueuedJob(String(enqueued?.id));
    expect(outcome.kind).toBe("executed");
    const refreshed = await BackgroundTask.findById(task._id);
    expect(refreshed?.status).toBe("failed");
    expect(refreshed?.error).toInclude("Script not found");
  });

  it("does not run the durable handler for a task that already started", async () => {
    let calls = 0;
    const countingScript: AdminScriptJobTarget = {
      name: "counting",
      runner: async (wetRun: boolean) => {
        calls += 1;
        return {results: [`wetRun=${wetRun} call=${calls}`], success: true};
      },
    };
    const handler = getAdminScriptHandler(() => countingScript);
    const task = await BackgroundTask.create({
      isDryRun: false,
      logs: [],
      status: "running",
      taskType: "counting",
    });

    await expect(
      handler(
        {args: {}, scriptName: "counting", taskId: String(task._id), wetRun: true},
        mockJobContext
      )
    ).rejects.toThrow("already started");
    expect(calls).toBe(0);
    expect((await BackgroundTask.findById(task._id))?.status).toBe("running");
  });

  it("skips the durable handler quietly for a task cancelled before it started", async () => {
    let calls = 0;
    const countingScript: AdminScriptJobTarget = {
      name: "counting",
      runner: async () => {
        calls += 1;
        return {results: [], success: true};
      },
    };
    const handler = getAdminScriptHandler(() => countingScript);
    const task = await BackgroundTask.create({
      isDryRun: false,
      logs: [],
      status: "cancelled",
      taskType: "counting",
    });

    await handler(
      {args: {}, scriptName: "counting", taskId: String(task._id), wetRun: true},
      mockJobContext
    );
    expect(calls).toBe(0);
    expect((await BackgroundTask.findById(task._id))?.status).toBe("cancelled");
  });

  it("still runs the in-process script path for a task created as running", async () => {
    const task = await BackgroundTask.create({
      isDryRun: true,
      logs: [],
      status: "running",
      taskType: "echo",
    });
    const {args} = createScriptArgs({values: {}});
    await runRegisteredScriptTask({
      args,
      script: echoScript,
      taskId: String(task._id),
      wetRun: false,
    });
    const refreshed = await BackgroundTask.findById(task._id);
    expect(refreshed?.status).toBe("completed");
    expect(refreshed?.result).toContain("dry");
  });

  it("runs a wet script once when a duplicate dispatch arrives after the lock TTL", async () => {
    let calls = 0;
    let concurrent = 0;
    let maxConcurrent = 0;
    const slowScript: AdminScriptJobTarget = {
      name: "slow-wet",
      runner: async (wetRun: boolean) => {
        calls += 1;
        const call = calls;
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        if (call === 1) {
          await Bun.sleep(400);
        }
        concurrent -= 1;
        return {results: [`wetRun=${wetRun} call=${call}`], success: true};
      },
    };
    const jobsApp = new JobsApp({lockTtlMs: 100});
    defineAdminScriptJob(jobsApp, (name) => (name === "slow-wet" ? slowScript : undefined));
    const app = getBaseServer();
    jobsApp.register(app);

    const task = await BackgroundTask.create({
      isDryRun: false,
      logs: [],
      status: "pending",
      taskType: "slow-wet",
    });
    const enqueued = await tryEnqueueAdminScriptJob({
      args: {},
      scriptName: "slow-wet",
      taskId: String(task._id),
      wetRun: true,
    });
    const jobId = String(enqueued?.id);

    const first = jobsApp.executeQueuedJob(jobId);
    await Bun.sleep(30);
    const withinTtl = await jobsApp.executeQueuedJob(jobId);
    await Bun.sleep(170);
    const afterTtl = await jobsApp.executeQueuedJob(jobId);
    const firstOutcome = await first;

    expect(withinTtl.kind).toBe("conflict");
    expect(afterTtl.kind).toBe("conflict");
    expect(firstOutcome.kind).toBe("executed");
    expect(calls).toBe(1);
    expect(maxConcurrent).toBe(1);
    const refreshed = await BackgroundTask.findById(task._id);
    expect(refreshed?.status).toBe("completed");
    expect(refreshed?.result).toEqual(["wetRun=true call=1"]);
  });

  it("cancels the matching job row for a script task", async () => {
    const jobsApp = new JobsApp({pollIntervalMs: 50});
    defineAdminScriptJob(jobsApp, (name) => (name === "echo" ? echoScript : undefined));
    const app = getBaseServer();
    jobsApp.register(app);

    const task = await BackgroundTask.create({
      isDryRun: true,
      logs: [],
      status: "pending",
      taskType: "echo",
    });
    const enqueued = await tryEnqueueAdminScriptJob({
      args: {},
      scriptName: "echo",
      taskId: String(task._id),
      wetRun: false,
    });
    await tryCancelAdminScriptJob(String(task._id));
    const job = await Job.findById(enqueued?.id);
    expect(job?.status).toBe("cancelled");
  });
});
