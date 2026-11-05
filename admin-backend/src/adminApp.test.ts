import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {
  type AnyTerrenoAccess,
  addAuthRoutes,
  apiErrorMiddleware,
  apiUnauthorizedMiddleware,
  BackgroundTask,
  createAccess,
  type ScriptRunner,
  setupAuth,
  terrenoStatements,
  type UserModel as UserModelType,
} from "@terreno/api";
import {authAsUser, getBaseServer, setupDb, UserModel} from "@terreno/api/testing";
import {Job, JobsApp, unregisterJobsService} from "@terreno/jobs";
import type express from "express";
import mongoose from "mongoose";
import supertest from "supertest";
import type TestAgent from "supertest/lib/agent";

import {AdminApp, type AdminScriptConfig} from "./adminApp";

const createTestScript = (overrides?: {
  runner?: ScriptRunner;
  name?: string;
  description?: string;
}) => ({
  description: overrides?.description ?? "A test script",
  name: overrides?.name ?? "test-script",
  runner:
    overrides?.runner ??
    (async (wetRun: boolean) => ({
      results: [`Ran in ${wetRun ? "wet" : "dry"} mode`],
      success: true,
    })),
});

const createSlowScript = () => ({
  description: "A slow script for testing async behavior",
  name: "slow-script",
  runner: async (_wetRun: boolean) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    return {results: ["Done"], success: true};
  },
});

const createFailingScript = () => ({
  description: "A script that throws",
  name: "failing-script",
  runner: async () => {
    throw new Error("Script exploded");
  },
});

const buildApp = (
  scripts: AdminScriptConfig[] = [createTestScript()],
  accessControl?: AnyTerrenoAccess
): express.Application => {
  const app = getBaseServer();
  setupAuth(app, UserModel as unknown as UserModelType);
  addAuthRoutes(app, UserModel as unknown as UserModelType);

  const admin = new AdminApp({
    accessControl,
    basePath: "/admin",
    models: [],
    scripts,
  });
  admin.register(app);

  // Error middleware must come after routes
  app.use(apiUnauthorizedMiddleware);
  app.use(apiErrorMiddleware);

  return app;
};

/** Wait long enough for async scripts to settle before cleanup. */
const waitForScripts = () => new Promise((resolve) => setTimeout(resolve, 500));

describe("AdminApp script routes", () => {
  let app: express.Application;
  let adminAgent: TestAgent;
  let notAdminAgent: TestAgent;

  afterEach(async () => {
    // Wait for any async script runners to finish before deleting tasks
    await waitForScripts();
    await BackgroundTask.deleteMany({});
  });

  describe("POST /admin/scripts/:name/run", () => {
    beforeEach(async () => {
      await setupDb();
      app = buildApp();
      adminAgent = await authAsUser(app, "admin");
      notAdminAgent = await authAsUser(app, "notAdmin");
    });

    it("starts a script and returns a taskId", async () => {
      const res = await adminAgent.post("/admin/scripts/test-script/run").expect(201);

      expect(res.body.taskId).toBeDefined();
      expect(typeof res.body.taskId).toBe("string");

      // Verify the task was created in the database
      const task = await BackgroundTask.findById(res.body.taskId);
      expect(task).not.toBeNull();
      expect(task?.taskType).toBe("test-script");
      expect(task?.isDryRun).toBe(true);
    });

    it("requires admin:runScripts when accessControl is configured", async () => {
      const accessControl = createAccess({
        connection: mongoose.connection,
        resolvePermissions: async () => ({admin: ["access"]}),
        statements: terrenoStatements,
      });
      const rbacApp = buildApp([createTestScript()], accessControl);
      const legacyAdmin = await authAsUser(rbacApp, "admin");

      await legacyAdmin.post("/admin/scripts/test-script/run").expect(403);
    });

    it("allows admin:runScripts through accessControl", async () => {
      const accessControl = createAccess({
        connection: mongoose.connection,
        resolvePermissions: async () => ({
          admin: ["access", "runScripts", "viewBackgroundTasks"],
        }),
        statements: terrenoStatements,
      });
      const rbacApp = buildApp([createTestScript()], accessControl);
      const superadmin = await authAsUser(rbacApp, "admin");

      await superadmin.post("/admin/scripts/test-script/run").expect(201);
    });

    it("creates a wet run task when wetRun=true", async () => {
      const res = await adminAgent.post("/admin/scripts/test-script/run?wetRun=true").expect(201);

      const task = await BackgroundTask.findById(res.body.taskId);
      expect(task).not.toBeNull();
      expect(task?.isDryRun).toBe(false);
    });

    it("creates a dry run task by default", async () => {
      const res = await adminAgent.post("/admin/scripts/test-script/run").expect(201);

      const task = await BackgroundTask.findById(res.body.taskId);
      expect(task).not.toBeNull();
      expect(task?.isDryRun).toBe(true);
    });

    it("returns 404 for unknown script", async () => {
      const res = await adminAgent.post("/admin/scripts/nonexistent/run").expect(404);

      expect(res.body.title).toInclude("Script not found");
    });

    it("returns 403 for non-admin user", async () => {
      const res = await notAdminAgent.post("/admin/scripts/test-script/run").expect(403);

      expect(res.body.title).toInclude("Only admins can run scripts");
    });

    it("returns 401 for unauthenticated user", async () => {
      const unauthAgent = supertest(app);
      await unauthAgent.post("/admin/scripts/test-script/run").expect(401);
    });

    it("records initial log with admin name", async () => {
      const res = await adminAgent.post("/admin/scripts/test-script/run").expect(201);

      const task = await BackgroundTask.findById(res.body.taskId);
      expect(task?.logs).toHaveLength(1);
      expect(task?.logs[0].level).toBe("info");
      expect(task?.logs[0].message).toInclude("Script started by");
    });

    it("completes the task asynchronously with results", async () => {
      const res = await adminAgent.post("/admin/scripts/test-script/run").expect(201);

      // Wait for async script execution
      await new Promise((resolve) => setTimeout(resolve, 100));

      const task = await BackgroundTask.findById(res.body.taskId);
      expect(task?.status).toBe("completed");
      expect(task?.result).toContain("Ran in dry mode");
      expect(task?.completedAt).toBeDefined();
      expect(task?.progress?.percentage).toBe(100);
    });

    it("marks task as failed when script throws", async () => {
      app = buildApp([createFailingScript()]);
      adminAgent = await authAsUser(app, "admin");

      const res = await adminAgent.post("/admin/scripts/failing-script/run").expect(201);

      await new Promise((resolve) => setTimeout(resolve, 100));

      const task = await BackgroundTask.findById(res.body.taskId);
      expect(task?.status).toBe("failed");
      expect(task?.error).toBe("Script exploded");
      expect(task?.result).toContain("Script exploded");
    });
  });

  describe("POST /admin/scripts/:name/run with arguments", () => {
    const createArgScript = () => ({
      args: [
        {default: "all", description: "Which model", name: "model", type: "string" as const},
        {description: "Limit", name: "limit", required: true, type: "number" as const},
      ],
      description: "Echoes its arguments",
      name: "argScript",
      runner: async (
        _wetRun: boolean,
        ctx?: {
          args: {
            getString: (n: string, f?: string) => string | undefined;
            getNumber: (n: string) => number | undefined;
          };
        }
      ) => ({
        results: [`model=${ctx?.args.getString("model")}`, `limit=${ctx?.args.getNumber("limit")}`],
        success: true,
      }),
    });

    beforeEach(async () => {
      await setupDb();
      app = buildApp([createArgScript()]);
      adminAgent = await authAsUser(app, "admin");
    });

    it("passes JSON body args to the runner", async () => {
      const res = await adminAgent
        .post("/admin/scripts/argScript/run")
        .send({args: {limit: 5, model: "todos"}})
        .expect(201);

      await new Promise((resolve) => setTimeout(resolve, 100));
      const task = await BackgroundTask.findById(res.body.taskId);
      expect(task?.status).toBe("completed");
      expect(task?.result).toContain("model=todos");
      expect(task?.result).toContain("limit=5");
    });

    it("passes query params as args", async () => {
      const res = await adminAgent
        .post("/admin/scripts/argScript/run?model=users&limit=9")
        .expect(201);

      await new Promise((resolve) => setTimeout(resolve, 100));
      const task = await BackgroundTask.findById(res.body.taskId);
      expect(task?.result).toContain("model=users");
      expect(task?.result).toContain("limit=9");
    });

    it("applies declared defaults when an arg is omitted", async () => {
      const res = await adminAgent
        .post("/admin/scripts/argScript/run")
        .send({args: {limit: 1}})
        .expect(201);

      await new Promise((resolve) => setTimeout(resolve, 100));
      const task = await BackgroundTask.findById(res.body.taskId);
      expect(task?.result).toContain("model=all");
    });

    it("returns 400 when a required arg is missing", async () => {
      const res = await adminAgent.post("/admin/scripts/argScript/run").expect(400);
      expect(res.body.title).toInclude("Invalid arguments for script: argScript");
      expect(res.body.detail).toInclude("Missing required argument: --limit");
    });

    it("returns 400 when an arg fails type coercion", async () => {
      const res = await adminAgent
        .post("/admin/scripts/argScript/run")
        .send({args: {limit: "not-a-number"}})
        .expect(400);
      expect(res.body.detail).toInclude("expected a number");
    });

    it("strips reserved runner flags from ctx.args over HTTP", async () => {
      const echoScript = {
        description: "Echoes arg keys",
        name: "echoArgs",
        runner: async (_wetRun: boolean, ctx?: {args: {raw: Record<string, unknown>}}) => ({
          results: [
            Object.keys(ctx?.args.raw ?? {})
              .sort()
              .join(","),
          ],
          success: true,
        }),
      };
      app = buildApp([echoScript]);
      const agent = await authAsUser(app, "admin");
      const res = await agent
        .post("/admin/scripts/echoArgs/run?wetRun=true&json=true&keep=yes")
        .expect(201);

      await new Promise((resolve) => setTimeout(resolve, 100));
      const task = await BackgroundTask.findById(res.body.taskId);
      expect(task?.result?.[0]).toBe("keep");
    });
  });

  describe("GET /admin/scripts/tasks/:id", () => {
    let taskId: string;

    beforeEach(async () => {
      await setupDb();
      app = buildApp([createSlowScript()]);
      adminAgent = await authAsUser(app, "admin");
      notAdminAgent = await authAsUser(app, "notAdmin");

      const res = await adminAgent.post("/admin/scripts/slow-script/run").expect(201);
      taskId = res.body.taskId;
    });

    it("returns task status for admin", async () => {
      const res = await adminAgent.get(`/admin/scripts/tasks/${taskId}`).expect(200);

      expect(res.body.task).toBeDefined();
      expect(res.body.task._id).toBe(taskId);
      expect(res.body.task.taskType).toBe("slow-script");
      expect(res.body.task.status).toBeDefined();
    });

    it("returns 403 for non-admin user", async () => {
      const res = await notAdminAgent.get(`/admin/scripts/tasks/${taskId}`).expect(403);

      expect(res.body.title).toInclude("Only admins can view tasks");
    });

    it("returns 404 for nonexistent task", async () => {
      const fakeId = "000000000000000000000000";
      const res = await adminAgent.get(`/admin/scripts/tasks/${fakeId}`).expect(404);

      expect(res.body.title).toInclude("Task not found");
    });

    it("returns 400 for invalid task ID", async () => {
      const res = await adminAgent.get("/admin/scripts/tasks/not-a-valid-id").expect(400);

      expect(res.body.title).toInclude("Invalid task ID");
    });

    it("shows completed task with results after script finishes", async () => {
      // Wait for the slow script to finish
      await new Promise((resolve) => setTimeout(resolve, 400));

      const res = await adminAgent.get(`/admin/scripts/tasks/${taskId}`).expect(200);

      expect(res.body.task.status).toBe("completed");
      expect(res.body.task.result).toContain("Done");
    });
  });

  describe("DELETE /admin/scripts/tasks/:id", () => {
    beforeEach(async () => {
      await setupDb();
      app = buildApp([createSlowScript()]);
      adminAgent = await authAsUser(app, "admin");
      notAdminAgent = await authAsUser(app, "notAdmin");
    });

    it("cancels a running task", async () => {
      const res1 = await adminAgent.post("/admin/scripts/slow-script/run").expect(201);

      const res = await adminAgent.delete(`/admin/scripts/tasks/${res1.body.taskId}`).expect(200);

      expect(res.body.message).toBe("Task cancelled");
      expect(res.body.task.status).toBe("cancelled");
      expect(res.body.task.completedAt).toBeDefined();
    });

    it("adds cancellation log entry", async () => {
      const res1 = await adminAgent.post("/admin/scripts/slow-script/run").expect(201);

      const res = await adminAgent.delete(`/admin/scripts/tasks/${res1.body.taskId}`).expect(200);

      const logs = res.body.task.logs;
      const cancelLog = logs.find((l: {message: string; level: string}) =>
        l.message.includes("cancelled")
      );
      expect(cancelLog).toBeDefined();
      expect(cancelLog.level).toBe("info");
    });

    it("returns 403 for non-admin user", async () => {
      const res1 = await adminAgent.post("/admin/scripts/slow-script/run").expect(201);

      const res = await notAdminAgent
        .delete(`/admin/scripts/tasks/${res1.body.taskId}`)
        .expect(403);

      expect(res.body.title).toInclude("Only admins can cancel tasks");
    });

    it("returns 400 when cancelling a completed task", async () => {
      const res1 = await adminAgent.post("/admin/scripts/slow-script/run").expect(201);

      // Wait for task to complete
      await new Promise((resolve) => setTimeout(resolve, 400));

      const res = await adminAgent.delete(`/admin/scripts/tasks/${res1.body.taskId}`).expect(400);

      expect(res.body.title).toInclude("Cannot cancel task with status");
    });

    it("returns 404 for nonexistent task", async () => {
      const fakeId = "000000000000000000000000";
      const res = await adminAgent.delete(`/admin/scripts/tasks/${fakeId}`).expect(404);

      expect(res.body.title).toInclude("Task not found");
    });

    it("returns 400 for invalid task ID", async () => {
      const res = await adminAgent.delete("/admin/scripts/tasks/not-a-valid-id").expect(400);

      expect(res.body.title).toInclude("Invalid task ID");
    });
  });

  describe("GET /admin/scripts/runs", () => {
    beforeEach(async () => {
      await setupDb();
      app = buildApp([
        createTestScript({description: "Migrate old data", name: "migrate-data"}),
        createTestScript({description: "Clean up orphans", name: "cleanup"}),
      ]);
      adminAgent = await authAsUser(app, "admin");
      notAdminAgent = await authAsUser(app, "notAdmin");
    });

    it("returns runs for registered scripts, newest first", async () => {
      await adminAgent.post("/admin/scripts/migrate-data/run").expect(201);
      await adminAgent.post("/admin/scripts/cleanup/run?wetRun=true").expect(201);
      await waitForScripts();

      const res = await adminAgent.get("/admin/scripts/runs").expect(200);

      expect(res.body.data).toHaveLength(2);
      expect(res.body.total).toBe(2);
      // Newest run (cleanup) is listed first.
      expect(res.body.data[0].taskType).toBe("cleanup");
      expect(res.body.data[1].taskType).toBe("migrate-data");
    });

    it("narrows history to a single script via the name query", async () => {
      await adminAgent.post("/admin/scripts/migrate-data/run").expect(201);
      await adminAgent.post("/admin/scripts/cleanup/run").expect(201);
      await waitForScripts();

      const res = await adminAgent.get("/admin/scripts/runs?name=cleanup").expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].taskType).toBe("cleanup");
    });

    it("returns no runs when the name query is not a registered script", async () => {
      await adminAgent.post("/admin/scripts/migrate-data/run").expect(201);
      await adminAgent.post("/admin/scripts/cleanup/run").expect(201);
      await waitForScripts();

      const res = await adminAgent.get("/admin/scripts/runs?name=does-not-exist").expect(200);

      expect(res.body.data).toHaveLength(0);
      expect(res.body.total).toBe(0);
    });

    it("excludes tasks whose taskType is not a registered script", async () => {
      await BackgroundTask.create({
        isDryRun: false,
        logs: [],
        status: "completed",
        taskType: "some-other-task",
      });
      await adminAgent.post("/admin/scripts/migrate-data/run").expect(201);
      await waitForScripts();

      const res = await adminAgent.get("/admin/scripts/runs").expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].taskType).toBe("migrate-data");
    });

    it("paginates and reports `more`", async () => {
      await adminAgent.post("/admin/scripts/migrate-data/run").expect(201);
      await adminAgent.post("/admin/scripts/cleanup/run").expect(201);
      await waitForScripts();

      const res = await adminAgent.get("/admin/scripts/runs?limit=1&page=1").expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.limit).toBe(1);
      expect(res.body.more).toBe(true);
      expect(res.body.total).toBe(2);
    });

    it("includes the triggering admin's display name", async () => {
      await adminAgent.post("/admin/scripts/migrate-data/run").expect(201);
      await waitForScripts();

      const res = await adminAgent.get("/admin/scripts/runs").expect(200);

      expect(res.body.data[0].createdByName).toBeDefined();
    });

    it("returns 403 for non-admin user", async () => {
      const res = await notAdminAgent.get("/admin/scripts/runs").expect(403);
      expect(res.body.title).toInclude("Only admins can view run history");
    });

    it("returns 401 for unauthenticated user", async () => {
      await supertest(app).get("/admin/scripts/runs").expect(401);
    });
  });

  describe("script runs through durable jobs when JobsApp is registered", () => {
    let jobsApp: JobsApp;

    beforeEach(async () => {
      await setupDb();
      await Job.deleteMany({});
      await BackgroundTask.deleteMany({});
      jobsApp = new JobsApp({pollIntervalMs: 25});
      const server = getBaseServer();
      setupAuth(server, UserModel as unknown as UserModelType);
      addAuthRoutes(server, UserModel as unknown as UserModelType);
      jobsApp.register(server);
      const admin = new AdminApp({
        basePath: "/admin",
        models: [],
        scripts: [createTestScript(), createFailingScript()],
      });
      admin.register(server);
      server.use(apiUnauthorizedMiddleware);
      server.use(apiErrorMiddleware);
      app = server;
      adminAgent = await authAsUser(app, "admin");
    });

    afterEach(async () => {
      unregisterJobsService();
      await Job.deleteMany({});
    });

    it("returns taskId, persists a job row, and completes the BackgroundTask", async () => {
      const res = await adminAgent.post("/admin/scripts/test-script/run").expect(201);
      const taskId = res.body.taskId as string;
      const job = await Job.findOne({name: "admin/script", "payload.taskId": taskId});
      expect(job).not.toBeNull();
      expect(job?.maxAttempts).toBe(1);
      const outcome = await jobsApp.executeQueuedJob(String(job?._id));
      expect(outcome.kind).toBe("executed");
      const task = await BackgroundTask.findById(taskId);
      expect(task?.status).toBe("completed");
      expect(task?.result).toContain("Ran in dry mode");
    });

    it("marks the BackgroundTask failed when the script throws", async () => {
      const res = await adminAgent.post("/admin/scripts/failing-script/run").expect(201);
      const job = await Job.findOne({
        name: "admin/script",
        "payload.taskId": res.body.taskId,
      });
      expect(job).not.toBeNull();
      await jobsApp.executeQueuedJob(String(job?._id));
      const task = await BackgroundTask.findById(res.body.taskId);
      expect(task?.status).toBe("failed");
      expect(task?.error).toBe("Script exploded");
    });

    it("marks the BackgroundTask failed when enqueue throws", async () => {
      unregisterJobsService();
      const throwingJobs = new JobsApp({
        pollIntervalMs: 25,
        runner: {
          enqueue: async (): Promise<void> => {
            throw new Error("Cloud Tasks unavailable");
          },
          id: "throw-enqueue",
        },
      });
      const server = getBaseServer();
      setupAuth(server, UserModel as unknown as UserModelType);
      addAuthRoutes(server, UserModel as unknown as UserModelType);
      throwingJobs.register(server);
      const admin = new AdminApp({
        basePath: "/admin",
        models: [],
        scripts: [createTestScript()],
      });
      admin.register(server);
      server.use(apiUnauthorizedMiddleware);
      server.use(apiErrorMiddleware);
      const agent = await authAsUser(server, "admin");

      const res = await agent.post("/admin/scripts/test-script/run").expect(500);
      expect(res.body.title).toMatch(/enqueue/i);
      const pending = await BackgroundTask.find({status: "pending"});
      expect(pending).toHaveLength(0);
      const failed = await BackgroundTask.find({taskType: "test-script"});
      expect(failed).toHaveLength(1);
      expect(failed[0]?.status).toBe("failed");
      expect(failed[0]?.error).toContain("Cloud Tasks unavailable");
    });
  });

  describe("GET /admin/config with scripts", () => {
    beforeEach(async () => {
      await setupDb();
      app = buildApp([
        createTestScript({description: "Migrate old data", name: "migrate-data"}),
        createTestScript({description: "Clean up orphans", name: "cleanup"}),
      ]);
      adminAgent = await authAsUser(app, "admin");
    });

    it("includes scripts in config response", async () => {
      const res = await adminAgent.get("/admin/config").expect(200);

      expect(res.body.scripts).toHaveLength(2);
      expect(res.body.scripts[0].name).toBe("migrate-data");
      expect(res.body.scripts[0].description).toBe("Migrate old data");
      expect(res.body.scripts[1].name).toBe("cleanup");
      expect(res.body.scripts[1].description).toBe("Clean up orphans");
      expect(res.body.scripts[0].args).toEqual([]);
    });

    it("exposes declared script args in the config response", async () => {
      app = buildApp([
        {
          args: [{description: "Which model", name: "model", type: "string"}],
          description: "Echoes args",
          name: "argScript",
          runner: async () => ({results: [], success: true}),
        },
      ]);
      const freshAdmin = await authAsUser(app, "admin");
      const res = await freshAdmin.get("/admin/config").expect(200);

      expect(res.body.scripts[0].args).toHaveLength(1);
      expect(res.body.scripts[0].args[0].name).toBe("model");
    });

    it("returns empty scripts array when no scripts configured", async () => {
      app = buildApp([]);
      const freshAdmin = await authAsUser(app, "admin");
      const res = await freshAdmin.get("/admin/config").expect(200);

      expect(res.body.scripts).toHaveLength(0);
    });
  });
});
