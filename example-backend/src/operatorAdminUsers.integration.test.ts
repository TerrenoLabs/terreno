/**
 * The admin User record is where platform staff reach a user's Security screen
 * (`/admin/users/:id/security`). The example opts User into per-model admin access
 * (`adminUser`), so the operator role must hold `adminUser:read` to find and open users there.
 */
import {beforeAll, beforeEach, describe, it} from "bun:test";
import {assert} from "chai";
import type express from "express";
import supertest from "supertest";

import {access} from "./access";
import {User} from "./models/user";
import {DEFAULT_USER_ROLE} from "./rbacRoles";
import {start} from "./server";
import {seedBetterAuthUserInProcess} from "./utils/betterAuthUserSeed";

const PASSWORD = "operatorAdminUsersPass123";

interface AdminModelSummary {
  name: string;
  routePath: string;
}

const signIn = async (
  app: express.Application,
  email: string
): Promise<ReturnType<typeof supertest.agent>> => {
  const agent = supertest.agent(app);
  await agent.post("/api/auth/sign-in/email").send({email, password: PASSWORD}).expect(200);
  return agent;
};

/** modelRouter refuses a denied permission with 405 before loading the record, 403 after. */
const DENIED_STATUSES = [403, 405];

const expectDenied = (response: {status: number}, label: string): void => {
  assert.include(DENIED_STATUSES, response.status, `${label} answered ${response.status}`);
};

/** Seeds a Better Auth user, sets its roles, and returns its app User id. */
const createUserWithRoles = async (email: string, roles: string[]): Promise<string> => {
  await seedBetterAuthUserInProcess({email, name: email, password: PASSWORD});
  const user = await User.findExactlyOne({email});
  await User.updateOne({email}, {$set: {admin: false, roles}});
  access.invalidateCache({userId: user.id});
  return user.id;
};

describe("example-backend operator access to admin Users", () => {
  let app: express.Application;

  beforeAll(async () => {
    app = await start(true);
  });

  beforeEach(async () => {
    await access.roles.seedDefaults();
  });

  it("lets an operator find and open a user in the admin panel", async () => {
    // Every signup also holds todoUser, so the e2e operator does too.
    await createUserWithRoles("admin-users-operator@example.com", ["operator", DEFAULT_USER_ROLE]);
    const targetId = await createUserWithRoles("admin-users-target@example.com", [
      DEFAULT_USER_ROLE,
    ]);

    const agent = await signIn(app, "admin-users-operator@example.com");
    const config = await agent.get("/admin/config").expect(200);
    const userModel = (config.body.models as AdminModelSummary[]).find(
      (model) => model.name === "User"
    );
    assert.exists(userModel, "the User model is in the operator's admin sidebar");
    if (!userModel) {
      return;
    }

    const list = await agent.get(userModel.routePath).expect(200);
    const listedIds = (list.body.data as {_id: string}[]).map((row) => String(row._id));
    assert.include(listedIds, targetId);

    const read = await agent.get(`${userModel.routePath}/${targetId}`).expect(200);
    assert.equal(String(read.body.data._id), targetId);
  });

  it("does not let an operator edit, create, or delete users through the admin panel", async () => {
    await createUserWithRoles("admin-users-writer@example.com", ["operator", DEFAULT_USER_ROLE]);
    const targetId = await createUserWithRoles("admin-users-write-target@example.com", [
      DEFAULT_USER_ROLE,
    ]);

    const agent = await signIn(app, "admin-users-writer@example.com");
    expectDenied(
      await agent.patch(`/admin/users/${targetId}`).send({name: "Renamed by operator"}),
      "PATCH"
    );
    expectDenied(
      await agent
        .post("/admin/users")
        .send({email: "admin-users-created@example.com", name: "Created"}),
      "POST"
    );
    expectDenied(await agent.delete(`/admin/users/${targetId}`), "DELETE");

    const target = await User.findExactlyOne({_id: targetId});
    assert.equal(target.name, "admin-users-write-target@example.com");
  });

  it("does not let a plain user list or read users in the admin panel", async () => {
    await createUserWithRoles("admin-users-plain@example.com", [DEFAULT_USER_ROLE]);
    const targetId = await createUserWithRoles("admin-users-plain-target@example.com", [
      DEFAULT_USER_ROLE,
    ]);

    const agent = await signIn(app, "admin-users-plain@example.com");
    await agent.get("/admin/config").expect(403);
    expectDenied(await agent.get("/admin/users"), "list");
    expectDenied(await agent.get(`/admin/users/${targetId}`), "read");
  });
});
