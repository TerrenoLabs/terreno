/**
 * Real-process smoke for @terreno/jobs. Run `bun e2e/smoke.ts` after `bun run compile`.
 *
 * The smoke re-runs this file with `worker` as a child process: the compiled `@terreno/jobs`
 * `JobsApp` with its default `MongoJobRunner` poll loop, against `smokeMongoUri()`, plus a
 * readiness route on a free port. The parent is the enqueuing process: it registers its own
 * `JobsApp` with the same job definition, enqueues one job, and checks that the worker process
 * ran the handler and marked the job completed. Exits non-zero on the first failed check.
 */
import {
  freePort,
  type SpawnedProcess,
  smokeMongoUri,
  spawnUntilReady,
  stopSmokeMongo,
} from "@terreno/test";
import {DateTime} from "luxon";

const WORKER_ARG = "worker";
const JOB_NAME = "jobsSmoke/record";
const RUNS_COLLECTION = "jobsSmokeRuns";
const COMPLETION_TIMEOUT_MS = 15000;
const POLL_INTERVAL_MS = 100;

interface SmokePayload {
  runId: number;
}

/** What the worker's handler writes, so the parent can see which process ran the job. */
interface SmokeRun {
  jobId: string;
  pid: number;
  runId: number;
}

/**
 * Child: a standalone worker, the shape of a dedicated jobs entrypoint. The handler records the
 * job id and this process's pid. `/health` answers once the poll loop is running, and SIGTERM
 * stops the worker before exiting. The packages are imported here, not at the top, so the
 * parent's enqueue path loads them on its own.
 */
const work = async (): Promise<void> => {
  const {logger} = await import("@terreno/api");
  const {JobsApp} = await import("@terreno/jobs");
  const {default: mongoose} = await import("mongoose");

  await mongoose.connect(process.env.MONGO_URI as string);

  const jobsApp = new JobsApp({pollIntervalMs: POLL_INTERVAL_MS});
  jobsApp.define(JOB_NAME, {
    handler: async (payload, ctx) => {
      const run: SmokeRun = {
        jobId: ctx.jobId,
        pid: process.pid,
        runId: (payload as SmokePayload).runId,
      };
      await mongoose.connection.collection(RUNS_COLLECTION).insertOne(run);
      ctx.log.info(`[jobsSmoke] ran job ${ctx.jobId} in pid ${process.pid}`);
    },
    retry: {maxAttempts: 1},
  });
  await jobsApp.startWorker();

  const server = Bun.serve({
    fetch: () => {
      const isWorkerActive = jobsApp.isWorkerActive();
      return Response.json({worker: isWorkerActive}, {status: isWorkerActive ? 200 : 503});
    },
    hostname: "127.0.0.1",
    port: Number(process.env.PORT),
  });
  process.once("SIGTERM", () => {
    void (async (): Promise<void> => {
      try {
        await jobsApp.stopWorker();
        await server.stop();
        await mongoose.disconnect();
      } finally {
        process.exit(0);
      }
    })();
  });
  logger.info(`[jobsSmoke] worker polling, ready on port ${process.env.PORT}`);
};

/** Waits for the job to leave `pending`/`running`, and returns its final status. */
const waitForTerminalStatus = async ({
  findStatus,
}: {
  findStatus: () => Promise<string | undefined>;
}): Promise<string | undefined> => {
  const deadline = DateTime.now().plus({milliseconds: COMPLETION_TIMEOUT_MS});
  let status = await findStatus();
  while (DateTime.now() < deadline && (status === "pending" || status === "running")) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    status = await findStatus();
  }
  return status;
};

/** Parent: boots the worker, enqueues one job from this process, and checks who ran it. */
const run = async (): Promise<void> => {
  const startedAt = DateTime.now();
  const runId = startedAt.toMillis();
  const {setupLogging} = await import("@terreno/api");
  const {JobsApp, Job, JobSchedule, getJobsService} = await import("@terreno/jobs");
  const {default: express} = await import("express");
  const {default: mongoose} = await import("mongoose");

  const port = await freePort();
  const mongoUri = await smokeMongoUri({databaseName: "jobsSmoke"});
  let worker: SpawnedProcess | undefined;

  try {
    worker = await spawnUntilReady({
      cmd: [process.execPath, __filename, WORKER_ARG],
      env: {MONGO_URI: mongoUri, PORT: String(port)},
      timeoutMs: 20000,
      url: `http://127.0.0.1:${port}/health`,
    });

    // Info level hides the admin routes' "no OpenAPI" debug lines from the bare Express app.
    setupLogging({disableFileLogging: true, level: "info"});
    // The enqueuing process shares the definition (for retry settings) but never starts a
    // worker, so its handler running would mean the job did not cross processes.
    await mongoose.connect(mongoUri);
    const jobsApp = new JobsApp();
    jobsApp.define(JOB_NAME, {
      handler: async () => {
        throw new Error("the enqueuing process must not run the job");
      },
      retry: {maxAttempts: 1},
    });
    jobsApp.register(express());
    // register() builds indexes in the background; finish them before disconnecting.
    await Promise.all([Job.init(), JobSchedule.init()]);

    const job = await getJobsService().enqueue({name: JOB_NAME, payload: {runId}});
    const jobId = job._id.toString();
    if (job.status !== "pending") {
      throw new Error(`enqueue: expected a pending job, got ${job.status}`);
    }
    console.info(`✅ enqueue persists pending job ${jobId} from pid ${process.pid}`);

    const status = await waitForTerminalStatus({
      findStatus: async () => (await Job.findOneOrNone({_id: job._id}))?.status,
    });
    if (status !== "completed") {
      throw new Error(
        `worker: job ${jobId} is ${status ?? "missing"}, not completed, after ${COMPLETION_TIMEOUT_MS} ms`
      );
    }
    console.info(`✅ the worker process marks job ${jobId} completed`);

    const runs = await mongoose.connection
      .collection<SmokeRun>(RUNS_COLLECTION)
      .find({jobId})
      .toArray();
    if (runs.length !== 1) {
      throw new Error(`worker: expected the handler to run once, it ran ${runs.length} times`);
    }
    const [ran] = runs;
    if (ran.pid !== worker.pid || ran.runId !== runId) {
      throw new Error(
        `worker: handler ran in pid ${ran.pid} with runId ${ran.runId}, expected worker pid ${worker.pid} and runId ${runId}`
      );
    }
    console.info(`✅ the handler ran once, in worker pid ${worker.pid}, with the enqueued payload`);
  } catch (error: unknown) {
    if (worker) {
      console.error(`--- worker output ---\n${worker.output()}`);
    }
    throw error;
  } finally {
    await worker?.stop();
    await mongoose.disconnect();
    await stopSmokeMongo();
  }

  console.info(`jobs smoke passed in ${DateTime.now().diff(startedAt).toMillis()} ms`);
};

const main = process.argv[2] === WORKER_ARG ? work : run;
main().then(
  () => {
    if (main === run) {
      process.exit(0);
    }
  },
  (error: unknown) => {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
);
