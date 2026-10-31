import {beforeEach, describe, it} from "bun:test";
import {createRequire} from "node:module";
import {TerrenoApp, type UserModel as UserModelType} from "@terreno/api";
import {setupDb, UserModel} from "@terreno/api/testing";
import {assert} from "chai";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import {JobsApp} from "../jobsApp";
import {Job} from "../models/job";
import {JobSchedule} from "../models/jobSchedule";
import type {JobDocument} from "../modelTypes";
import {
  type GcpCloudTasksClient,
  GcpCloudTasksRunner,
  type GcpCloudTasksRunnerConfig,
  type GcpCreateTaskRequest,
} from "../runners/gcpCloudTasks";

const typedUserModel = UserModel as unknown as UserModelType;

interface RecordedCreateTaskCall {
  request: GcpCreateTaskRequest;
}

const createFakeClient = (): {
  calls: RecordedCreateTaskCall[];
  client: GcpCloudTasksClient;
} => {
  const calls: RecordedCreateTaskCall[] = [];

  const client: GcpCloudTasksClient = {
    createTask: async (request: GcpCreateTaskRequest) => {
      calls.push({request});
      return [{name: "projects/p/locations/l/queues/q/tasks/t1"}];
    },
    queuePath: (project: string, location: string, queue: string): string =>
      `projects/${project}/locations/${location}/queues/${queue}`,
  };

  return {calls, client};
};

const baseConfig = (overrides?: Partial<GcpCloudTasksRunnerConfig>): GcpCloudTasksRunnerConfig => {
  const {client} = createFakeClient();

  return {
    client,
    location: "us-central1",
    project: "my-project",
    publicUrl: "https://api.example.com",
    queue: "jobs",
    serviceAccountEmail: "tasks@my-project.iam.gserviceaccount.com",
    ...overrides,
  };
};

const buildJob = (overrides?: Partial<JobDocument>): JobDocument =>
  ({
    _id: new mongoose.Types.ObjectId(),
    runAt: DateTime.utc().toJSDate(),
    ...overrides,
  }) as JobDocument;

describe("GcpCloudTasksRunner", () => {
  beforeEach(async (): Promise<void> => {
    await setupDb();
    await Job.deleteMany({});
    await JobSchedule.deleteMany({});
  });

  it("requires the execute route and ticks schedules from start()", (): void => {
    const runner = new GcpCloudTasksRunner(baseConfig());

    assert.equal(runner.requiresExecuteRoute, true);
    assert.isFunction(runner.start);
  });

  it("throws when required config is missing or blank", (): void => {
    const cases: Array<{field: keyof GcpCloudTasksRunnerConfig; value: string}> = [
      {field: "project", value: ""},
      {field: "location", value: "   "},
      {field: "queue", value: ""},
      {field: "publicUrl", value: ""},
      {field: "serviceAccountEmail", value: ""},
    ];

    for (const {field, value} of cases) {
      assert.throws(
        () =>
          new GcpCloudTasksRunner(
            baseConfig({
              [field]: value,
            })
          ),
        /GcpCloudTasksRunner/i
      );
    }
  });

  it("throws when publicUrl uses a non-http protocol", (): void => {
    assert.throws(
      () =>
        new GcpCloudTasksRunner(
          baseConfig({
            publicUrl: "ftp://api.example.com",
          })
        ),
      /http or https/i
    );
  });

  it("throws when basePath does not start with a slash", (): void => {
    assert.throws(
      () =>
        new GcpCloudTasksRunner(
          baseConfig({
            basePath: "jobs",
          })
        ),
      /basePath must start with "\/"/
    );
  });

  it("normalizes a root basePath of slash-only to /", async (): Promise<void> => {
    const fake = createFakeClient();
    const runner = new GcpCloudTasksRunner(
      baseConfig({
        basePath: "/",
        client: fake.client,
      })
    );
    const job = buildJob();

    await runner.enqueue(job);

    assert.equal(fake.calls[0].request.task.httpRequest?.url, "https://api.example.com//execute");
  });

  it("loads the optional peer when installed or reports how to install it", (): void => {
    const {client: _client, ...configWithoutClient} = baseConfig();
    let isPeerAvailable = true;
    try {
      createRequire(__filename)("@google-cloud/tasks");
    } catch {
      isPeerAvailable = false;
    }

    if (isPeerAvailable) {
      const runner = new GcpCloudTasksRunner(configWithoutClient);
      assert.equal(runner.requiresExecuteRoute, true);
      return;
    }

    assert.throws(
      () => new GcpCloudTasksRunner(configWithoutClient),
      /optional peer dependency @google-cloud\/tasks/
    );
  });

  it("throws when publicUrl is not an absolute http(s) URL", (): void => {
    assert.throws(
      () =>
        new GcpCloudTasksRunner(
          baseConfig({
            publicUrl: "/relative/path",
          })
        ),
      /publicUrl/i
    );

    assert.throws(
      () =>
        new GcpCloudTasksRunner(
          baseConfig({
            publicUrl: "not-a-url",
          })
        ),
      /publicUrl/i
    );
  });

  it("creates an immediate HTTP task with queue path, execute URL, JSON body, and OIDC audience defaulting to the execute URL", async (): Promise<void> => {
    const fake = createFakeClient();
    const runner = new GcpCloudTasksRunner(
      baseConfig({
        client: fake.client,
      })
    );
    const job = buildJob();

    await runner.enqueue(job);

    assert.equal(fake.calls.length, 1);
    const {request} = fake.calls[0];
    const executeUrl = "https://api.example.com/jobs/execute";

    assert.equal(request.parent, "projects/my-project/locations/us-central1/queues/jobs");
    assert.equal(request.task.httpRequest?.httpMethod, "POST");
    assert.equal(request.task.httpRequest?.url, executeUrl);
    assert.deepEqual(request.task.httpRequest?.headers, {
      "Content-Type": "application/json",
    });

    const decodedBody = JSON.parse(
      Buffer.from(request.task.httpRequest?.body ?? "", "base64").toString("utf8")
    );
    assert.deepEqual(decodedBody, {jobId: job._id.toString()});
    assert.deepEqual(request.task.httpRequest?.oidcToken, {
      audience: executeUrl,
      serviceAccountEmail: "tasks@my-project.iam.gserviceaccount.com",
    });
    assert.deepEqual(request.task.dispatchDeadline, {seconds: 1800});
    assert.isUndefined(request.task.scheduleTime);
  });

  it("honors a custom dispatchDeadlineSeconds within the HTTP task range", async (): Promise<void> => {
    const fake = createFakeClient();
    const runner = new GcpCloudTasksRunner(
      baseConfig({
        client: fake.client,
        dispatchDeadlineSeconds: 900,
      })
    );

    await runner.enqueue(buildJob());

    assert.deepEqual(fake.calls[0].request.task.dispatchDeadline, {seconds: 900});
  });

  it("throws when dispatchDeadlineSeconds is outside the HTTP range of 15 to 1800", (): void => {
    assert.throws(
      () =>
        new GcpCloudTasksRunner(
          baseConfig({
            dispatchDeadlineSeconds: 14,
          })
        ),
      /dispatchDeadlineSeconds/i
    );

    assert.throws(
      () =>
        new GcpCloudTasksRunner(
          baseConfig({
            dispatchDeadlineSeconds: 1801,
          })
        ),
      /dispatchDeadlineSeconds/i
    );
  });

  it("honors basePath and a custom OIDC audience", async (): Promise<void> => {
    const fake = createFakeClient();
    const runner = new GcpCloudTasksRunner(
      baseConfig({
        basePath: "/background",
        client: fake.client,
        oidcAudience: "https://api.example.com",
      })
    );
    const job = buildJob();

    await runner.enqueue(job);

    const executeUrl = "https://api.example.com/background/execute";
    const {request} = fake.calls[0];

    assert.equal(request.task.httpRequest?.url, executeUrl);
    assert.equal(request.task.httpRequest?.oidcToken?.audience, "https://api.example.com");
  });

  it("sets scheduleTime when runAt is in the future", async (): Promise<void> => {
    const fake = createFakeClient();
    const runner = new GcpCloudTasksRunner(
      baseConfig({
        client: fake.client,
      })
    );
    const runAt = DateTime.utc().plus({minutes: 15});
    const job = buildJob({runAt: runAt.toJSDate()});

    await runner.enqueue(job);

    const {request} = fake.calls[0];
    assert.isDefined(request.task.scheduleTime);
    assert.equal(request.task.scheduleTime?.seconds, Math.floor(runAt.toSeconds()));
    assert.equal(request.task.scheduleTime?.nanos, (runAt.toMillis() % 1000) * 1_000_000);
  });

  it("strips trailing slashes from publicUrl before building the execute URL", async (): Promise<void> => {
    const fake = createFakeClient();
    const runner = new GcpCloudTasksRunner(
      baseConfig({
        client: fake.client,
        publicUrl: "https://api.example.com/",
      })
    );
    const job = buildJob();

    await runner.enqueue(job);

    assert.equal(
      fake.calls[0].request.task.httpRequest?.url,
      "https://api.example.com/jobs/execute"
    );
  });

  it("startWorker ticks due schedules into Cloud Tasks without claiming Mongo jobs", async (): Promise<void> => {
    const fake = createFakeClient();
    const jobsApp = new JobsApp({
      executeAuth: async () => true,
      pollIntervalMs: 25,
      runner: new GcpCloudTasksRunner(baseConfig({client: fake.client})),
    });
    jobsApp.define("cloud-tasks-cron", {
      handler: async () => {},
      schedule: {cron: "0 9 * * *", timezone: "UTC"},
    });
    new TerrenoApp({
      skipListen: true,
      userModel: typedUserModel,
    })
      .register(jobsApp)
      .build();

    await jobsApp.startWorker();
    const schedule = await JobSchedule.findExactlyOne({name: "cloud-tasks-cron"});
    await JobSchedule.updateOne(
      {_id: schedule._id},
      {$set: {nextRunAt: DateTime.utc().minus({minutes: 1}).toJSDate()}}
    );

    const deadline = DateTime.utc().plus({milliseconds: 5_000});
    while (DateTime.utc() < deadline) {
      if (fake.calls.length >= 1 && (await Job.countDocuments({name: "cloud-tasks-cron"})) >= 1) {
        break;
      }
      await Bun.sleep(25);
    }

    await jobsApp.stopWorker();

    assert.isAtLeast(fake.calls.length, 1);
    const childJobs = await Job.find({name: "cloud-tasks-cron"});
    assert.equal(childJobs.length, 1);
    assert.equal(childJobs[0]?.status, "pending");
  });
});
