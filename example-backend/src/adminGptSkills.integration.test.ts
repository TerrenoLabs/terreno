/**
 * AIAdminApp contributes GptSkill to the admin panel. The example gates admin models through
 * RBAC, so the model shows up only when the app declares an `adminGptSkill` statement.
 */
import {beforeAll, beforeEach, describe, it} from "bun:test";
import {GptSkill} from "@terreno/ai";
import {assert} from "chai";
import type express from "express";
import supertest from "supertest";

import {access} from "./access";
import {User} from "./models/user";
import {DEFAULT_USER_ROLE, SUPERADMIN_ROLE} from "./rbacRoles";
import {start} from "./server";
import {seedBetterAuthUserInProcess} from "./utils/betterAuthUserSeed";

const PASSWORD = "adminGptSkillsPass123";

interface AdminModelSummary {
  name: string;
  permissions: {create: boolean};
  routePath: string;
}

const signInWithRoles = async (
  app: express.Application,
  email: string,
  roles: string[]
): Promise<ReturnType<typeof supertest.agent>> => {
  await seedBetterAuthUserInProcess({email, name: email, password: PASSWORD});
  const user = await User.findExactlyOne({email});
  await User.updateOne({email}, {$set: {admin: true, roles}});
  access.invalidateCache({userId: user.id});
  const agent = supertest.agent(app);
  await agent.post("/api/auth/sign-in/email").send({email, password: PASSWORD}).expect(200);
  return agent;
};

describe("example-backend admin global skills", () => {
  let app: express.Application;

  beforeAll(async () => {
    app = await start(true);
  });

  beforeEach(async () => {
    await access.roles.seedDefaults();
    await GptSkill.deleteMany({});
  });

  it("lists GptSkill for a superadmin and creates a global skill through it", async () => {
    const agent = await signInWithRoles(app, "admin-gpt-skills@example.com", [
      SUPERADMIN_ROLE,
      DEFAULT_USER_ROLE,
    ]);
    const config = await agent.get("/admin/config").expect(200);
    const skillModel = (config.body.models as AdminModelSummary[]).find(
      (model) => model.name === "GptSkill"
    );
    assert.exists(skillModel, "GptSkill is in the superadmin's admin sidebar");
    if (!skillModel) {
      return;
    }
    assert.isTrue(skillModel.permissions.create);

    const created = await agent
      .post(skillModel.routePath)
      .send({
        description: "Make posters in the team style.",
        instructions: "Use bold colors and big type.",
        name: "team-poster",
      })
      .expect(201);
    const saved = await GptSkill.findById(created.body.data._id);
    assert.equal(saved?.scope, "global");
  });
});
