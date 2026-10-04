import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {OpenFeature} from "@openfeature/server-sdk";
import {
  addAuthRoutes,
  apiErrorMiddleware,
  apiUnauthorizedMiddleware,
  setupAuth,
  type UserModel as UserModelType,
} from "@terreno/api";
import {authAsUser, getBaseServer, setupDb, UserModel} from "@terreno/api/testing";
import type express from "express";
import supertest from "supertest";
import type TestAgent from "supertest/lib/agent";

import {FeatureFlag} from "../featureFlagModel";
import {FeatureFlagsApp} from "../featureFlagsApp";
import type {SegmentFunction} from "../types";

const buildApp = (options?: {
  basePath?: string;
  segments?: Record<string, SegmentFunction>;
}): express.Application => {
  const app = getBaseServer();
  setupAuth(app, UserModel as unknown as UserModelType);
  addAuthRoutes(app, UserModel as unknown as UserModelType);

  const plugin = new FeatureFlagsApp(options);
  plugin.register(app);

  app.use(apiUnauthorizedMiddleware);
  app.use(apiErrorMiddleware);
  return app;
};

describe("FeatureFlagsApp", () => {
  let app: express.Application;
  let adminAgent: TestAgent;
  let notAdminAgent: TestAgent;

  beforeEach(async () => {
    await setupDb();
    await FeatureFlag.deleteMany({});
  });

  afterEach(async () => {
    await FeatureFlag.deleteMany({});
    await OpenFeature.clearProviders();
  });

  describe("construction", () => {
    it("contributes FeatureFlag admin metadata and the overrides home widget", () => {
      const contribution = new FeatureFlagsApp().adminContribution();

      expect(contribution.models).toHaveLength(1);
      expect(contribution.models?.[0]?.model).toBe(FeatureFlag);
      expect(contribution.models?.[0]?.routePath).toBe("/feature-flags");
      expect(contribution.models?.[0]?.admin.displayName).toBe("Feature Flags");
      expect(contribution.homeWidgets).toEqual([
        {displayName: "Flag Overrides", icon: "flag", id: "feature-flags-overrides"},
      ]);
    });

    it("defaults basePath to /feature-flags and segments to an empty object", async () => {
      app = buildApp();
      adminAgent = await authAsUser(app, "admin");

      const res = await adminAgent.get("/feature-flags/segments").expect(200);
      expect(res.body.data).toEqual([]);
    });

    it("respects a custom basePath", async () => {
      app = buildApp({basePath: "/flags"});
      adminAgent = await authAsUser(app, "admin");

      await adminAgent.get("/flags/segments").expect(200);
      await adminAgent.get("/feature-flags/segments").expect(404);
    });

    it("accepts an empty options object", async () => {
      app = buildApp({});
      adminAgent = await authAsUser(app, "admin");

      const res = await adminAgent.get("/feature-flags/segments").expect(200);
      expect(res.body.data).toEqual([]);
    });
  });

  describe("admin CRUD routes", () => {
    beforeEach(async () => {
      app = buildApp();
      adminAgent = await authAsUser(app, "admin");
      notAdminAgent = await authAsUser(app, "notAdmin");
    });

    it("lets admins create, list, read, update, and delete flags", async () => {
      const createRes = await adminAgent
        .post("/feature-flags/flags")
        .send({enabled: true, key: "new-flag", name: "New Flag"})
        .expect(201);

      const flagId: string = createRes.body.data._id;
      expect(createRes.body.data.key).toBe("new-flag");

      const listRes = await adminAgent.get("/feature-flags/flags").expect(200);
      expect(listRes.body.data.length).toBe(1);

      const readRes = await adminAgent.get(`/feature-flags/flags/${flagId}`).expect(200);
      expect(readRes.body.data.key).toBe("new-flag");

      const updateRes = await adminAgent
        .patch(`/feature-flags/flags/${flagId}`)
        .send({rolloutPercentage: 50})
        .expect(200);
      expect(updateRes.body.data.rolloutPercentage).toBe(50);

      await adminAgent.delete(`/feature-flags/flags/${flagId}`).expect(204);
      const finalList = await adminAgent.get("/feature-flags/flags").expect(200);
      expect(finalList.body.data.length).toBe(0);
    });

    it("rejects non-admins from the CRUD routes", async () => {
      // modelRouter responds with 405 Method Not Allowed when permissions fail
      await notAdminAgent.get("/feature-flags/flags").expect(405);
      await notAdminAgent
        .post("/feature-flags/flags")
        .send({key: "nope", name: "Nope"})
        .expect(405);
    });

    it("rejects unauthenticated requests to CRUD routes", async () => {
      const unauth = supertest(app);
      await unauth.get("/feature-flags/flags").expect(401);
    });
  });

  describe("GET /feature-flags/evaluate", () => {
    beforeEach(async () => {
      const segments: Record<string, SegmentFunction> = {
        admins: (user: unknown) => (user as {admin?: boolean}).admin === true,
      };
      app = buildApp({segments});
    });

    it("returns 401 for unauthenticated callers", async () => {
      const unauth = supertest(app);
      await unauth.get("/feature-flags/evaluate").expect(401);
    });

    it("returns all enabled, non-archived flag values for the current user", async () => {
      await FeatureFlag.create({
        enabled: true,
        key: "rolled-out",
        name: "Rolled out",
        rolloutPercentage: 100,
      });
      await FeatureFlag.create({
        enabled: false,
        key: "disabled-flag",
        name: "Disabled",
        rolloutPercentage: 100,
      });
      await FeatureFlag.create({
        archived: true,
        enabled: true,
        key: "archived-flag",
        name: "Archived",
        rolloutPercentage: 100,
      });
      await FeatureFlag.create({
        enabled: true,
        key: "admins-only",
        name: "Admins",
        rolloutPercentage: 0,
        rules: [{enabled: true, segment: "admins"}],
      });

      adminAgent = await authAsUser(app, "admin");

      const res = await adminAgent.get("/feature-flags/evaluate").expect(200);
      expect(res.body.data["rolled-out"]).toBe(true);
      expect(res.body.data["admins-only"]).toBe(true);
      expect(res.body.data["disabled-flag"]).toBeUndefined();
      expect(res.body.data["archived-flag"]).toBeUndefined();
    });

    it("includes an admin's own evaluated flags", async () => {
      await FeatureFlag.create({
        enabled: true,
        key: "user-only",
        name: "User only",
        rolloutPercentage: 0,
        rules: [{enabled: true, field: "admin", operator: "eq", value: true}],
      });

      adminAgent = await authAsUser(app, "admin");
      const res = await adminAgent.get("/feature-flags/evaluate").expect(200);
      expect(res.body.data["user-only"]).toBe(true);

      notAdminAgent = await authAsUser(app, "notAdmin");
      const notAdminRes = await notAdminAgent.get("/feature-flags/evaluate").expect(200);
      // notAdmin isn't admin, rolloutPercentage is 0 → should evaluate false
      expect(notAdminRes.body.data["user-only"]).toBe(false);
    });

    it("includes Deprecation and Sunset headers on GET /evaluate", async () => {
      await FeatureFlag.create({
        enabled: true,
        key: "hdr-flag",
        name: "Hdr",
        rolloutPercentage: 100,
      });
      adminAgent = await authAsUser(app, "admin");
      const res = await adminAgent.get("/feature-flags/evaluate").expect(200);
      expect(res.headers.deprecation).toBe("true");
      expect(res.headers.sunset).toBeDefined();
      expect(res.body.data["hdr-flag"]).toBe(true);
    });
  });

  describe("GET /feature-flags/flagConfiguration", () => {
    beforeEach(async () => {
      const segments: Record<string, SegmentFunction> = {
        admins: (user: unknown) => (user as {admin?: boolean}).admin === true,
      };
      app = buildApp({segments});
    });

    it("returns 401 when unauthenticated", async () => {
      const unauth = supertest(app);
      await unauth.get("/feature-flags/flagConfiguration").expect(401);
    });

    it("returns OpenFeature-shaped entries and resolves disabled boolean flags to off", async () => {
      await FeatureFlag.create({
        enabled: true,
        key: "bool-active",
        name: "Bool",
        rolloutPercentage: 100,
        type: "boolean",
      });
      await FeatureFlag.create({
        defaultVariant: "compact",
        enabled: true,
        key: "profile",
        name: "Profile",
        rules: [],
        type: "variant",
        variants: [
          {key: "compact", weight: 50},
          {key: "detailed", weight: 50},
        ],
      });
      await FeatureFlag.create({
        enabled: false,
        key: "disabled-one",
        name: "Off",
        rolloutPercentage: 100,
        type: "boolean",
      });
      await FeatureFlag.create({
        archived: true,
        enabled: true,
        key: "archived-one",
        name: "Archived",
        rolloutPercentage: 100,
        type: "boolean",
      });

      adminAgent = await authAsUser(app, "admin");
      const res = await adminAgent.get("/feature-flags/flagConfiguration").expect(200);
      const data = res.body.data as Record<
        string,
        {defaultVariant: string; disabled: boolean; variants: Record<string, boolean | string>}
      >;

      expect(data["bool-active"]).toEqual({
        defaultVariant: "on",
        disabled: false,
        variants: {off: false, on: true},
      });
      expect(data.profile?.disabled).toBe(false);
      expect(["compact", "detailed"].includes(data.profile?.defaultVariant ?? "")).toBe(true);
      expect(data.profile?.variants.compact).toBe("compact");
      expect(data["disabled-one"]).toEqual({
        defaultVariant: "off",
        disabled: false,
        variants: {off: false, on: true},
      });
      expect(data["archived-one"]).toBeUndefined();
    });

    it("uses resolved boolean variant as defaultVariant (not the persisted schema default alone)", async () => {
      await FeatureFlag.create({
        defaultVariant: "off",
        enabled: true,
        key: "resolved-bool",
        name: "Resolved",
        rolloutPercentage: 100,
        rules: [],
        type: "boolean",
      });
      adminAgent = await authAsUser(app, "admin");
      const res = await adminAgent.get("/feature-flags/flagConfiguration").expect(200);
      expect(res.body.data["resolved-bool"].defaultVariant).toBe("on");
      expect(res.body.data["resolved-bool"].variants.on).toBe(true);
    });
  });

  describe("GET /feature-flags/segments", () => {
    beforeEach(async () => {
      app = buildApp({
        segments: {
          admins: () => true,
          "beta-testers": () => false,
        },
      });
    });

    it("returns the registered segment keys for admins", async () => {
      adminAgent = await authAsUser(app, "admin");

      const res = await adminAgent.get("/feature-flags/segments").expect(200);
      expect(res.body.data.sort()).toEqual(["admins", "beta-testers"]);
    });

    it("rejects non-admin users", async () => {
      notAdminAgent = await authAsUser(app, "notAdmin");

      const res = await notAdminAgent.get("/feature-flags/segments").expect(403);
      expect(res.body.title).toInclude("Only admins can view segments");
    });

    it("requires authentication", async () => {
      const unauth = supertest(app);
      await unauth.get("/feature-flags/segments").expect(401);
    });
  });
});
