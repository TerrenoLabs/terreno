import {beforeAll, beforeEach, describe, expect, it} from "bun:test";
import {AdminApp} from "@terreno/admin-backend";
import {TerrenoApp} from "@terreno/api";
import {expectAPIError} from "@terreno/test";
import express from "express";

import {AIAdminApp} from "./aiAdminApp";
import {GptSkill} from "./models/gptSkill";
import {authAsUser, ensureTestUsers, UserModel} from "./tests/helpers";

describe("AIAdminApp", () => {
  it("registers explorer routes and contributes the AI Requests screen", () => {
    const app = express();
    const plugin = new AIAdminApp({openApiOptions: {title: "Admin"}});

    plugin.register(app);

    const routePaths = (app.router.stack as Array<{route?: {path?: string}}>).flatMap((layer) =>
      layer.route?.path ? [layer.route.path] : []
    );
    expect(routePaths).toContain("/aiRequestsExplorer");
    expect(plugin.adminContribution().customScreens).toEqual([
      {displayName: "AI Requests", icon: "robot", name: "ai-requests"},
    ]);
  });
});

describe("AIAdminApp skills admin", () => {
  const buildApp = (): express.Application =>
    new TerrenoApp({skipListen: true, userModel: UserModel as never})
      .register(new AdminApp({}))
      .register(new AIAdminApp())
      .build();

  beforeAll(async () => {
    await ensureTestUsers();
  });

  beforeEach(async () => {
    await GptSkill.deleteMany({});
  });

  it("contributes GptSkill under /gpt/skills in the AI group with global-only list fields", async () => {
    const contribution = new AIAdminApp().adminContribution();
    const skills = contribution.models?.find((model) => model.routePath === "/gpt/skills");

    expect(skills?.model).toBe(GptSkill as never);
    expect(skills?.admin.displayName).toBe("Skills");
    expect(skills?.admin.group).toBe("AI");
    expect(skills?.admin.listFields).toEqual([
      "name",
      "description",
      "scope",
      "enabled",
      "updated",
    ]);
    expect(skills?.admin.hiddenFields).toEqual(
      expect.arrayContaining(["scope", "userId", "files"])
    );
    expect(await skills?.admin.adminFilter?.({} as express.Request)).toEqual({scope: "global"});
  });

  it("keeps the AI Requests screen alongside the skills model", () => {
    expect(new AIAdminApp().adminContribution().customScreens).toEqual([
      {displayName: "AI Requests", icon: "robot", name: "ai-requests"},
    ]);
  });

  it("saves an admin create without scope as a global skill", async () => {
    const agent = await authAsUser(buildApp(), "admin");

    const res = await agent
      .post("/admin/gpt/skills")
      .send({description: "d", instructions: "i", name: "house-style"});

    expect(res.status).toBe(201);
    const stored = await GptSkill.findOne({name: "house-style"}).lean();
    expect(stored?.scope).toBe("global");
    expect(stored?.userId).toBeUndefined();
  });

  it("lists only global skills, never a user's personal skill", async () => {
    const [admin] = await UserModel.find({email: "admin@example.com"}).lean();
    await GptSkill.create({
      description: "d",
      instructions: "secret personal text",
      name: "personal-one",
      scope: "user",
      userId: admin._id,
    });
    await GptSkill.create({
      description: "d",
      instructions: "i",
      name: "global-one",
      scope: "global",
    });
    const agent = await authAsUser(buildApp(), "admin");

    const res = await agent.get("/admin/gpt/skills");

    expect(res.status).toBe(200);
    expect(res.body.data.map((row: {name: string}) => row.name)).toEqual(["global-one"]);
    expect(JSON.stringify(res.body)).not.toContain("secret personal text");
  });

  it("returns 409 when an admin creates a global skill with a taken name", async () => {
    await GptSkill.create({description: "d", instructions: "i", name: "taken", scope: "global"});
    const agent = await authAsUser(buildApp(), "admin");

    const res = await agent
      .post("/admin/gpt/skills")
      .send({description: "d", instructions: "i", name: "taken"});

    await expectAPIError(res, {status: 409});
  });

  it("rejects a non-admin on the admin skills route with 405", async () => {
    const agent = await authAsUser(buildApp(), "notAdmin");

    const res = await agent.get("/admin/gpt/skills");

    await expectAPIError(res, {status: 405});
  });
});
