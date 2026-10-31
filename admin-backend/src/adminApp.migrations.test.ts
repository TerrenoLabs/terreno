import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {
  type AnyTerrenoAccess,
  addAuthRoutes,
  apiErrorMiddleware,
  apiUnauthorizedMiddleware,
  BackgroundTask,
  createAccess,
  MIGRATION_LOCK_ID,
  MIGRATIONS_COLLECTION,
  type MigrationStoreDoc,
  setupAuth,
  terrenoStatements,
  type UserModel as UserModelType,
} from "@terreno/api";
import {authAsUser, getBaseServer, setupDb, UserModel} from "@terreno/api/testing";
import type express from "express";
import mongoose from "mongoose";
import type TestAgent from "supertest/lib/agent";

import {AdminApp} from "./adminApp";

const fixturesDir = join(__dirname, "../../api/src/migrations/fixtures/valid");

const buildApp = ({
  accessControl,
  migrationsDir,
}: {
  accessControl?: AnyTerrenoAccess;
  migrationsDir?: string;
} = {}): express.Application => {
  const app = getBaseServer();
  setupAuth(app, UserModel as unknown as UserModelType);
  addAuthRoutes(app, UserModel as unknown as UserModelType);
  const admin = new AdminApp({
    accessControl,
    basePath: "/admin",
    migrations: migrationsDir ? {dir: migrationsDir} : undefined,
    models: [],
  });
  admin.register(app);
  app.use(apiUnauthorizedMiddleware);
  app.use(apiErrorMiddleware);
  return app;
};

const waitForTask = (): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, 500));
};

const appliedIds = async (): Promise<string[]> => {
  const docs = await mongoose.connection
    .collection<MigrationStoreDoc>(MIGRATIONS_COLLECTION)
    .find({_id: {$ne: MIGRATION_LOCK_ID}})
    .project({id: 1})
    .toArray();
  return docs.map((doc) => String(doc.id)).sort();
};

describe("AdminApp migrations routes", () => {
  let app: express.Application;
  let adminAgent: TestAgent;
  let notAdminAgent: TestAgent;

  afterEach(async () => {
    await waitForTask();
    await BackgroundTask.deleteMany({});
  });

  describe("when migrations are not configured", () => {
    beforeEach(async () => {
      await setupDb();
      await mongoose.connection.collection(MIGRATIONS_COLLECTION).deleteMany({});
      app = buildApp();
      adminAgent = await authAsUser(app, "admin");
    });

    it("returns 404 for GET /admin/migrations/status", async () => {
      await adminAgent.get("/admin/migrations/status").expect(404);
    });

    it("returns 404 for POST /admin/migrations/run", async () => {
      await adminAgent.post("/admin/migrations/run").expect(404);
    });

    it("omits enabled migrations from config", async () => {
      const res = await adminAgent.get("/admin/config").expect(200);
      expect(res.body.migrations?.enabled).toBe(false);
    });
  });

  describe("when migrations are configured", () => {
    beforeEach(async () => {
      await setupDb();
      await mongoose.connection.collection(MIGRATIONS_COLLECTION).deleteMany({});
      app = buildApp({migrationsDir: fixturesDir});
      adminAgent = await authAsUser(app, "admin");
      notAdminAgent = await authAsUser(app, "notAdmin");
    });

    it("returns 404 when the configured directory is missing", async () => {
      const missingApp = buildApp({
        migrationsDir: join(tmpdir(), "terreno-admin-migrations-missing"),
      });
      const agent = await authAsUser(missingApp, "admin");
      const res = await agent.get("/admin/migrations/status").expect(404);
      expect(res.body.title).toBe("Migration directory not found");
    });

    it("returns pending status for admins", async () => {
      const res = await adminAgent.get("/admin/migrations/status").expect(200);
      expect(res.body.data.pending.map((row: {id: string}) => row.id)).toEqual([
        "20260910120000-alpha",
        "20260910120001-beta",
      ]);
    });

    it("disables CRUD on the migrations mount", async () => {
      await adminAgent.get("/admin/migrations").expect(405);
    });

    it("forbids non-admins", async () => {
      await notAdminAgent.get("/admin/migrations/status").expect(405);
      await notAdminAgent.post("/admin/migrations/run").expect(405);
    });

    it("requires admin:runScripts to start a run when accessControl is configured", async () => {
      const accessControl = createAccess({
        connection: mongoose.connection,
        resolvePermissions: async () => ({admin: ["access"]}),
        statements: terrenoStatements,
      });
      const rbacApp = buildApp({accessControl, migrationsDir: fixturesDir});
      const accessOnly = await authAsUser(rbacApp, "admin");

      await accessOnly.get("/admin/migrations/status").expect(200);
      await accessOnly.post("/admin/migrations/run").expect(405);
      await accessOnly.post("/admin/migrations/run?wetRun=true").expect(405);
      expect(await appliedIds()).toEqual([]);
    });

    it("allows admin:runScripts to start a dry-run", async () => {
      const accessControl = createAccess({
        connection: mongoose.connection,
        resolvePermissions: async () => ({
          admin: ["access", "runScripts", "viewBackgroundTasks"],
        }),
        statements: terrenoStatements,
      });
      const rbacApp = buildApp({accessControl, migrationsDir: fixturesDir});
      const runner = await authAsUser(rbacApp, "admin");

      const res = await runner.post("/admin/migrations/run").expect(201);
      expect(res.body.data.taskId).toBeDefined();
      await waitForTask();
      expect(await appliedIds()).toEqual([]);
    });

    it("sets migrations.enabled on config", async () => {
      const res = await adminAgent.get("/admin/config").expect(200);
      expect(res.body.migrations.enabled).toBe(true);
    });

    it("dry-run does not persist applied ids", async () => {
      const res = await adminAgent.post("/admin/migrations/run").expect(201);
      expect(res.body.data.taskId).toBeDefined();
      await waitForTask();
      expect(await appliedIds()).toEqual([]);
      const task = await BackgroundTask.findById(res.body.data.taskId);
      expect(task?.isDryRun).toBe(true);
      expect(task?.taskType).toBe("migrations:up");
      const polled = await adminAgent
        .get(`/admin/scripts/tasks/${res.body.data.taskId}`)
        .expect(200);
      expect(polled.body.task.status).toBe("completed");
    });

    it("applies pending on wet run", async () => {
      const res = await adminAgent.post("/admin/migrations/run?wetRun=true").expect(201);
      await waitForTask();
      expect(await appliedIds()).toEqual(["20260910120000-alpha", "20260910120001-beta"]);
      const task = await BackgroundTask.findById(res.body.data.taskId);
      expect(task?.isDryRun).toBe(false);
    });

    it("returns 403 for production wet apply without ALLOW_MIGRATIONS", async () => {
      const previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      Reflect.deleteProperty(process.env, "ALLOW_MIGRATIONS");
      try {
        await adminAgent.post("/admin/migrations/run?wetRun=true").expect(403);
        expect(await appliedIds()).toEqual([]);
      } finally {
        process.env.NODE_ENV = previousNodeEnv;
      }
    });
  });

  describe("when a migration up throws", () => {
    let dir: string;

    beforeEach(async () => {
      await setupDb();
      await mongoose.connection.collection(MIGRATIONS_COLLECTION).deleteMany({});
      dir = await mkdtemp(join(tmpdir(), "admin-mig-fail-"));
      await writeFile(
        join(dir, "20260910120000-boom.ts"),
        `export const id = "20260910120000-boom";
export const up = async () => {
  throw new Error("boom");
};
`
      );
      app = buildApp({migrationsDir: dir});
      adminAgent = await authAsUser(app, "admin");
    });

    afterEach(async () => {
      await rm(dir, {force: true, recursive: true});
    });

    it("marks the background task failed", async () => {
      const res = await adminAgent.post("/admin/migrations/run").expect(201);
      await waitForTask();
      const task = await BackgroundTask.findById(res.body.data.taskId);
      expect(task?.status).toBe("failed");
      expect(task?.error).toContain("boom");
    });
  });
});
