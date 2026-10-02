import {beforeAll, beforeEach, describe, it} from "bun:test";
import {assert} from "chai";
import type express from "express";
import supertest from "supertest";

import {access} from "./access";
import {User} from "./models/user";
import {
  AI_OBSERVABILITY_OPERATOR_ROLE,
  AI_OBSERVABILITY_VIEWER_ROLE,
  DEFAULT_USER_ROLE,
  SUPERADMIN_ROLE,
} from "./rbacRoles";
import {start} from "./server";
import {seedBetterAuthUserInProcess} from "./utils/betterAuthUserSeed";

const OBSERVABILITY_SCREEN_NAMES = [
  "ai-prompts",
  "ai-traces",
  "ai-evaluators",
  "ai-datasets",
  "ai-experiments",
  "ai-review",
] as const;

const PASSWORD = "observabilityRbacPass123";

const signIn = async (
  app: express.Application,
  email: string
): Promise<ReturnType<typeof supertest.agent>> => {
  const agent = supertest.agent(app);
  await agent.post("/api/auth/sign-in/email").send({email, password: PASSWORD}).expect(200);
  return agent;
};

const observabilityScreenNames = (body: {customScreens?: {name: string}[]}): string[] => {
  return (body.customScreens ?? [])
    .map((screen) => screen.name)
    .filter((name) =>
      OBSERVABILITY_SCREEN_NAMES.includes(name as (typeof OBSERVABILITY_SCREEN_NAMES)[number])
    );
};

type StatusPermissions = Record<string, Record<string, boolean | undefined> | undefined>;

const statusPermissions = (body: {data?: {permissions?: StatusPermissions}}): StatusPermissions => {
  assert.exists(body.data?.permissions, "expected GET /ai/observability/status data.permissions");
  return body.data.permissions;
};

const createPromptBody = (prefix: string): Record<string, string> => {
  return {
    folder: "rbac",
    name: `${prefix}-${Date.now()}`,
    system: "Summarize",
    template: "{{text}}",
    type: "text",
  };
};

describe("example-backend observability RBAC integration", () => {
  let app: express.Application;

  beforeAll(async () => {
    app = await start(true);
  });

  beforeEach(async () => {
    await access.roles.seedDefaults();
  });

  it("grants the seeded admin role every observability screen and write action", async () => {
    const email = "rbac-admin@example.com";
    await seedBetterAuthUserInProcess({email, name: email, password: PASSWORD});
    const user = await User.findExactlyOne({email});
    await User.updateOne({email}, {$set: {admin: false, roles: ["admin"]}});
    access.invalidateCache({userId: user.id});

    const agent = await signIn(app, email);
    const config = await agent.get("/admin/config").expect(200);
    const screens = observabilityScreenNames(config.body);
    assert.deepEqual([...screens].sort(), [...OBSERVABILITY_SCREEN_NAMES].sort());

    const status = await agent.get("/ai/observability/status").expect(200);
    const permissions = statusPermissions(status.body);
    assert.isTrue(permissions.aiPrompt?.create);
    assert.isTrue(permissions.aiPrompt?.playground);
    assert.isTrue(permissions.aiReview?.score);

    await agent.post("/ai/observability/prompts").send(createPromptBody("rbac-admin")).expect(201);
  });

  it("honors the example read-only observability role on screens, status, and mutations", async () => {
    const email = "rbac-viewer@example.com";
    await seedBetterAuthUserInProcess({email, name: email, password: PASSWORD});
    const user = await User.findExactlyOne({email});
    await User.updateOne({email}, {$set: {admin: false, roles: [AI_OBSERVABILITY_VIEWER_ROLE]}});
    access.invalidateCache({userId: user.id});

    const agent = await signIn(app, email);
    const config = await agent.get("/admin/config").expect(200);
    const screens = observabilityScreenNames(config.body);
    assert.deepEqual([...screens].sort(), [...OBSERVABILITY_SCREEN_NAMES].sort());

    const status = await agent.get("/ai/observability/status").expect(200);
    const permissions = statusPermissions(status.body);
    assert.isTrue(permissions.aiPrompt?.list);
    assert.isTrue(permissions.aiPrompt?.read);
    assert.isFalse(permissions.aiPrompt?.create);
    assert.isFalse(permissions.aiPrompt?.playground);
    assert.isFalse(permissions.aiPrompt?.promote);
    assert.isFalse(permissions.aiDataset?.delete);

    await agent.get("/ai/observability/prompts").expect(200);
    await agent.post("/ai/observability/prompts").send(createPromptBody("rbac-viewer")).expect(403);
  });

  it("grants the example operator role full observability actions", async () => {
    const email = "rbac-operator@example.com";
    await seedBetterAuthUserInProcess({email, name: email, password: PASSWORD});
    const user = await User.findExactlyOne({email});
    await User.updateOne({email}, {$set: {admin: false, roles: [AI_OBSERVABILITY_OPERATOR_ROLE]}});
    access.invalidateCache({userId: user.id});

    const agent = await signIn(app, email);
    const status = await agent.get("/ai/observability/status").expect(200);
    const permissions = statusPermissions(status.body);
    assert.isTrue(permissions.aiPrompt?.create);
    assert.isTrue(permissions.aiExperiment?.create);
    assert.isTrue(permissions.aiReview?.assign);

    await agent
      .post("/ai/observability/prompts")
      .send(createPromptBody("rbac-operator"))
      .expect(201);
  });

  it("grants the superadmin role full observability without the legacy admin flag", async () => {
    const email = "rbac-superadmin@example.com";
    await seedBetterAuthUserInProcess({email, name: email, password: PASSWORD});
    const user = await User.findExactlyOne({email});
    await User.updateOne({email}, {$set: {admin: false, roles: [SUPERADMIN_ROLE]}});
    access.invalidateCache({userId: user.id});

    const agent = await signIn(app, email);
    const config = await agent.get("/admin/config").expect(200);
    const screens = observabilityScreenNames(config.body);
    assert.deepEqual([...screens].sort(), [...OBSERVABILITY_SCREEN_NAMES].sort());

    const status = await agent.get("/ai/observability/status").expect(200);
    const permissions = statusPermissions(status.body);
    assert.isTrue(permissions.aiPrompt?.create);
    assert.isTrue(permissions.aiPrompt?.playground);
    assert.isTrue(permissions.aiDataset?.delete);
    assert.isTrue(permissions.aiExperiment?.promote);
    assert.isTrue(permissions.aiReview?.assign);

    await agent
      .post("/ai/observability/prompts")
      .send(createPromptBody("rbac-superadmin"))
      .expect(201);
  });

  it("denies baseline todo users observability admin and HTTP routes", async () => {
    const email = "rbac-todouser@example.com";
    await seedBetterAuthUserInProcess({email, name: email, password: PASSWORD});
    const user = await User.findExactlyOne({email});
    await User.updateOne({email}, {$set: {admin: false, roles: [DEFAULT_USER_ROLE]}});
    access.invalidateCache({userId: user.id});

    const agent = await signIn(app, email);
    await agent.get("/admin/config").expect(403);
    await agent.get("/ai/observability/status").expect(403);
    await agent.get("/ai/observability/prompts").expect(403);
    await agent
      .post("/ai/observability/prompts")
      .send(createPromptBody("rbac-todouser"))
      .expect(403);
  });
});
