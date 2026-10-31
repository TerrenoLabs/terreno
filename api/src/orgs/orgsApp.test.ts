import {afterEach, beforeEach, describe, it} from "bun:test";
import {authAsUser as loginWithPassword} from "@terreno/test";
import {assert} from "chai";
import type {Application} from "express";
import mongoose from "mongoose";
import type {PassportLocalMongooseDocument} from "passport-local-mongoose";

import {
  type User as AuthUser,
  type UserModel as AuthUserModel,
  addAuthRoutes,
  setupAuth,
} from "../auth";
import {apiErrorMiddleware, apiUnauthorizedMiddleware} from "../errors";
import {createAccess} from "../rbac/access";
import {terrenoStatements} from "../rbac/statements";
import {getBaseServer} from "../tests";
import {type User, UserModel} from "../tests/models";
import {Membership, Organization} from "./organizationModel";
import {
  createOrganizationSettingsSchema,
  registerOrganizationSettings,
} from "./organizationSettings";
import {type OrgAuditEvent, OrgsApp} from "./orgsApp";

const PASSWORD = "testpassword123";

const setPassword = async (user: User, password: string): Promise<void> => {
  await (user as unknown as PassportLocalMongooseDocument).setPassword(password);
  await (user as unknown as {save: () => Promise<void>}).save();
};

const createUser = async (args: {email: string; roles?: string[]}): Promise<User> => {
  const user = await UserModel.create({
    email: args.email,
    name: args.email,
    roles: args.roles ?? [],
  });
  await setPassword(user, PASSWORD);
  return user;
};

describe("OrgsApp", () => {
  let app: Application;
  let auditEvents: OrgAuditEvent[];
  let access: ReturnType<typeof createAccess>;

  beforeEach(async () => {
    await Promise.all([
      Membership.deleteMany({}),
      Organization.deleteMany({}),
      UserModel.deleteMany({}),
    ]);
    auditEvents = [];
    access = createAccess({
      connection: mongoose.connection,
      organizations: true,
      statements: terrenoStatements,
      userModel: UserModel as unknown as AuthUserModel,
    });
    await access.roles.seedDefaults();

    app = getBaseServer();
    setupAuth(app, UserModel as unknown as AuthUserModel);
    addAuthRoutes(app, UserModel as unknown as AuthUserModel);
    app.use(apiUnauthorizedMiddleware);
    new OrgsApp({
      access,
      onOrgAudit: (event): void => {
        auditEvents.push(event);
      },
      userModel: UserModel as unknown as AuthUserModel,
    }).register(app);
    app.use(apiErrorMiddleware);
  });

  afterEach(() => {
    registerOrganizationSettings();
  });

  it("returns 403 on GET /orgs for org-admin and 200 for operator", async () => {
    const operator = await createUser({email: "operator@example.com", roles: ["operator"]});
    const orgAdmin = await createUser({email: "orgadmin@example.com"});
    const org = await Organization.create({name: "Acme", ownerId: operator._id});
    await Membership.create({
      organizationId: org._id,
      roleName: "org-admin",
      userId: orgAdmin._id,
    });

    const orgAdminAgent = await loginWithPassword(app, {
      email: "orgadmin@example.com",
      password: PASSWORD,
    });
    const denied = await orgAdminAgent.get("/orgs");
    assert.equal(denied.status, 403);

    const operatorAgent = await loginWithPassword(app, {
      email: "operator@example.com",
      password: PASSWORD,
    });
    const listed = await operatorAgent.get("/orgs");
    assert.equal(listed.status, 200);
    assert.equal(listed.body.data.length, 1);
    assert.equal(listed.body.data[0].name, "Acme");
  });

  it("creates an organization without requiring membership", async () => {
    await createUser({email: "operator@example.com", roles: ["operator"]});
    const operatorAgent = await loginWithPassword(app, {
      email: "operator@example.com",
      password: PASSWORD,
    });
    const created = await operatorAgent.post("/orgs").send({name: "New Co"});
    assert.equal(created.status, 201);
    assert.equal(created.body.data.name, "New Co");
    const memberships = await Membership.find({organizationId: created.body.data._id});
    assert.equal(memberships.length, 0);
    assert.equal(auditEvents[0]?.verb, "created");
  });

  it("lists /orgs/mine as orgs the caller admins", async () => {
    const operator = await createUser({email: "operator@example.com", roles: ["operator"]});
    const orgAdmin = await createUser({email: "orgadmin@example.com"});
    const acme = await Organization.create({name: "Acme", ownerId: operator._id});
    await Organization.create({name: "Other", ownerId: operator._id});
    await Membership.create({
      organizationId: acme._id,
      roleName: "org-admin",
      userId: orgAdmin._id,
    });

    const orgAdminAgent = await loginWithPassword(app, {
      email: "orgadmin@example.com",
      password: PASSWORD,
    });
    const mine = await orgAdminAgent.get("/orgs/mine");
    assert.equal(mine.status, 200);
    assert.equal(mine.body.data.length, 1);
    assert.equal(mine.body.data[0].name, "Acme");
  });

  it("lets org-admin read and patch name but not disable", async () => {
    const owner = await createUser({email: "owner@example.com", roles: ["operator"]});
    const orgAdmin = await createUser({email: "orgadmin@example.com"});
    const org = await Organization.create({name: "Acme", ownerId: owner._id});
    await Membership.create({
      organizationId: org._id,
      roleName: "org-admin",
      userId: orgAdmin._id,
    });
    const orgAdminAgent = await loginWithPassword(app, {
      email: "orgadmin@example.com",
      password: PASSWORD,
    });

    const read = await orgAdminAgent.get(`/orgs/${org._id}`);
    assert.equal(read.status, 200);

    const patched = await orgAdminAgent.patch(`/orgs/${org._id}`).send({name: "Acme Renamed"});
    assert.equal(patched.status, 200);
    assert.equal(patched.body.data.name, "Acme Renamed");

    const disable = await orgAdminAgent.patch(`/orgs/${org._id}`).send({disabled: true});
    assert.equal(disable.status, 403);
  });

  it("disables an organization and suspends memberships", async () => {
    const operator = await createUser({email: "operator@example.com", roles: ["operator"]});
    const orgAdmin = await createUser({email: "orgadmin@example.com"});
    const org = await Organization.create({name: "Acme", ownerId: operator._id});
    await Membership.create({
      organizationId: org._id,
      roleName: "org-admin",
      userId: orgAdmin._id,
    });
    const operatorAgent = await loginWithPassword(app, {
      email: "operator@example.com",
      password: PASSWORD,
    });
    const disabled = await operatorAgent.patch(`/orgs/${org._id}`).send({disabled: true});
    assert.equal(disabled.status, 200);
    assert.isTrue(disabled.body.data.disabled);
    const membership = await Membership.findOne({organizationId: org._id});
    assert.equal(membership?.status, "suspended");
    assert.isTrue(auditEvents.some((event) => event.verb === "disabled"));
  });

  it("soft-deletes an organization and suspends memberships", async () => {
    const operator = await createUser({email: "operator@example.com", roles: ["operator"]});
    const orgAdmin = await createUser({email: "orgadmin@example.com"});
    const org = await Organization.create({name: "Acme", ownerId: operator._id});
    await Membership.create({
      organizationId: org._id,
      roleName: "org-admin",
      userId: orgAdmin._id,
    });

    const orgAdminAgent = await loginWithPassword(app, {
      email: "orgadmin@example.com",
      password: PASSWORD,
    });
    const deniedDelete = await orgAdminAgent.delete(`/orgs/${org._id}`);
    assert.equal(deniedDelete.status, 403);

    const operatorAgent = await loginWithPassword(app, {
      email: "operator@example.com",
      password: PASSWORD,
    });
    const deleted = await operatorAgent.delete(`/orgs/${org._id}`);
    assert.equal(deleted.status, 204);

    const gone = await Organization.findOne({_id: org._id});
    assert.isNull(gone);
    const withDeleted = await Organization.findOne({_id: org._id, deleted: true});
    assert.isOk(withDeleted);
    const membership = await Membership.findOne({organizationId: org._id});
    assert.equal(membership?.status, "suspended");
    assert.isTrue(auditEvents.some((event) => event.verb === "deleted"));
  });

  it("attaches an existing user by email and 404s unknown emails", async () => {
    const operator = await createUser({email: "operator@example.com", roles: ["operator"]});
    await createUser({email: "member@example.com"});
    const org = await Organization.create({name: "Acme", ownerId: operator._id});
    const operatorAgent = await loginWithPassword(app, {
      email: "operator@example.com",
      password: PASSWORD,
    });

    const missing = await operatorAgent
      .post(`/orgs/${org._id}/members`)
      .send({email: "ghost@example.com", roleName: "member"});
    assert.equal(missing.status, 404);
    assert.equal(missing.body.title, "User not found");

    const attached = await operatorAgent
      .post(`/orgs/${org._id}/members`)
      .send({email: "member@example.com", roleName: "member"});
    assert.equal(attached.status, 201);
    assert.equal(attached.body.data.roleName, "member");
    assert.isTrue(auditEvents.some((event) => event.verb === "memberAttached"));

    const listed = await operatorAgent.get(`/orgs/${org._id}/members`);
    assert.equal(listed.status, 200);
    assert.equal(listed.body.data.length, 1);
    assert.equal(listed.body.data[0].userId.email, "member@example.com");

    const mixedCase = await operatorAgent
      .post(`/orgs/${org._id}/members`)
      .send({email: "Member@Example.com", roleName: "member"});
    assert.equal(mixedCase.status, 409);
  });

  it("applies a membership's org-admin grants at once, not after the permission cache expires", async () => {
    const operator = await createUser({email: "operator@example.com", roles: ["operator"]});
    const member = await createUser({email: "new-org-admin@example.com"});
    const org = await Organization.create({name: "Acme", ownerId: operator._id});
    const operatorAgent = await loginWithPassword(app, {
      email: "operator@example.com",
      password: PASSWORD,
    });
    const memberUser = member as unknown as AuthUser;
    // Resolve (and cache) the user's permissions before they join.
    assert.isUndefined((await access.getPermissions({user: memberUser})).admin);

    const attached = await operatorAgent
      .post(`/orgs/${org._id}/members`)
      .send({email: "new-org-admin@example.com", roleName: "org-admin"});
    assert.equal(attached.status, 201);
    assert.deepEqual((await access.getPermissions({user: memberUser})).admin, ["access"]);

    const demoted = await operatorAgent
      .patch(`/orgs/${org._id}/members/${attached.body.data._id}`)
      .send({roleName: "member"});
    // The operator's attach left the new member as the only org-admin, so demoting is refused;
    // suspend instead, which another active org-admin makes possible.
    assert.equal(demoted.status, 400);
    await Membership.create({organizationId: org._id, roleName: "org-admin", userId: operator._id});
    const suspended = await operatorAgent
      .patch(`/orgs/${org._id}/members/${attached.body.data._id}`)
      .send({status: "suspended"});
    assert.equal(suspended.status, 200);
    assert.isUndefined((await access.getPermissions({user: memberUser})).admin);
  });

  describe("permission cache", () => {
    const setUpOrgAdmins = async (): Promise<{
      operatorAgent: Awaited<ReturnType<typeof loginWithPassword>>;
      org: Awaited<ReturnType<typeof Organization.create>>;
      orgAdmins: AuthUser[];
      removable: Awaited<ReturnType<typeof Membership.create>>;
    }> => {
      const operator = await createUser({email: "operator@example.com", roles: ["operator"]});
      const first = await createUser({email: "first-org-admin@example.com"});
      const second = await createUser({email: "second-org-admin@example.com"});
      const org = await Organization.create({name: "Acme", ownerId: operator._id});
      const removable = await Membership.create({
        organizationId: org._id,
        roleName: "org-admin",
        userId: first._id,
      });
      await Membership.create({organizationId: org._id, roleName: "org-admin", userId: second._id});
      const orgAdmins = [first, second] as unknown as AuthUser[];
      // Resolve (and cache) each org-admin's permissions before the change.
      for (const orgAdmin of orgAdmins) {
        assert.deepEqual((await access.getPermissions({user: orgAdmin})).admin, ["access"]);
      }
      const operatorAgent = await loginWithPassword(app, {
        email: "operator@example.com",
        password: PASSWORD,
      });
      return {operatorAgent, org, orgAdmins, removable};
    };

    it("takes a removed org-admin's permissions away at once", async () => {
      const {operatorAgent, org, orgAdmins, removable} = await setUpOrgAdmins();

      const removed = await operatorAgent.delete(`/orgs/${org._id}/members/${removable._id}`);

      assert.equal(removed.status, 204);
      assert.isUndefined((await access.getPermissions({user: orgAdmins[0] as AuthUser})).admin);
    });

    it("takes every org-admin's permissions away at once when the organization is disabled", async () => {
      const {operatorAgent, org, orgAdmins} = await setUpOrgAdmins();

      const disabled = await operatorAgent.patch(`/orgs/${org._id}`).send({disabled: true});

      assert.equal(disabled.status, 200);
      for (const orgAdmin of orgAdmins) {
        assert.isUndefined((await access.getPermissions({user: orgAdmin})).admin);
      }
    });

    it("takes every org-admin's permissions away at once when the organization is deleted", async () => {
      const {operatorAgent, org, orgAdmins} = await setUpOrgAdmins();

      const deleted = await operatorAgent.delete(`/orgs/${org._id}`);

      assert.equal(deleted.status, 204);
      for (const orgAdmin of orgAdmins) {
        assert.isUndefined((await access.getPermissions({user: orgAdmin})).admin);
      }
    });
  });

  it("attaches an existing user by userId", async () => {
    const operator = await createUser({email: "operator@example.com", roles: ["operator"]});
    const member = await createUser({email: "member-id@example.com"});
    const org = await Organization.create({name: "Acme", ownerId: operator._id});
    const operatorAgent = await loginWithPassword(app, {
      email: "operator@example.com",
      password: PASSWORD,
    });

    const attached = await operatorAgent
      .post(`/orgs/${org._id}/members`)
      .send({roleName: "member", userId: String(member._id)});
    assert.equal(attached.status, 201);
    assert.equal(attached.body.data.roleName, "member");
  });

  it("rejects demoting or removing the last org-admin", async () => {
    const operator = await createUser({email: "operator@example.com", roles: ["operator"]});
    const orgAdmin = await createUser({email: "orgadmin@example.com"});
    const org = await Organization.create({name: "Acme", ownerId: operator._id});
    const membership = await Membership.create({
      organizationId: org._id,
      roleName: "org-admin",
      userId: orgAdmin._id,
    });
    const operatorAgent = await loginWithPassword(app, {
      email: "operator@example.com",
      password: PASSWORD,
    });

    const demote = await operatorAgent
      .patch(`/orgs/${org._id}/members/${membership._id}`)
      .send({roleName: "member"});
    assert.equal(demote.status, 400);
    assert.equal(demote.body.title, "Cannot remove the last org-admin");

    const removed = await operatorAgent.delete(`/orgs/${org._id}/members/${membership._id}`);
    assert.equal(removed.status, 400);
    assert.equal(removed.body.title, "Cannot remove the last org-admin");
    const stillAdmin = await Membership.findById(membership._id);
    assert.equal(stillAdmin?.roleName, "org-admin");
  });

  it("returns 409 when POST /orgs collides with a soft-deleted slug", async () => {
    const operator = await createUser({email: "op-deleted@example.com", roles: ["operator"]});
    const org = await Organization.create({name: "Acme Corp", ownerId: operator._id});
    const operatorAgent = await loginWithPassword(app, {
      email: "op-deleted@example.com",
      password: PASSWORD,
    });
    const deleted = await operatorAgent.delete(`/orgs/${org._id}`);
    assert.equal(deleted.status, 204);

    const created = await operatorAgent.post("/orgs").send({name: "Acme Corp"});
    assert.equal(created.status, 409);
    assert.equal(created.body.title, "Organization name already in use");
  });

  it("returns 409 when POST /orgs collides on slug", async () => {
    const operator = await createUser({email: "op@example.com", roles: ["operator"]});
    await Organization.create({name: "Acme Corp", ownerId: operator._id});

    const operatorAgent = await loginWithPassword(app, {
      email: "op@example.com",
      password: PASSWORD,
    });
    const created = await operatorAgent.post("/orgs").send({name: "Acme Corp"});
    assert.equal(created.status, 409);
    assert.equal(created.body.title, "Organization name already in use");
  });

  it("returns 409 when PATCH /orgs/:id rename collides on slug", async () => {
    const operator = await createUser({email: "op2@example.com", roles: ["operator"]});
    await Organization.create({name: "Acme Corp", ownerId: operator._id});
    const other = await Organization.create({name: "Other Co", ownerId: operator._id});

    const operatorAgent = await loginWithPassword(app, {
      email: "op2@example.com",
      password: PASSWORD,
    });
    const patched = await operatorAgent.patch(`/orgs/${other._id}`).send({name: "Acme Corp"});
    assert.equal(patched.status, 409);
    assert.equal(patched.body.title, "Organization name already in use");
  });

  it("lets an org-admin attach another existing user", async () => {
    const owner = await createUser({email: "owner@example.com", roles: ["operator"]});
    const orgAdmin = await createUser({email: "orgadmin@example.com"});
    await createUser({email: "teammate@example.com"});
    const org = await Organization.create({name: "Acme", ownerId: owner._id});
    await Membership.create({
      organizationId: org._id,
      roleName: "org-admin",
      userId: orgAdmin._id,
    });
    const orgAdminAgent = await loginWithPassword(app, {
      email: "orgadmin@example.com",
      password: PASSWORD,
    });
    const attached = await orgAdminAgent
      .post(`/orgs/${org._id}/members`)
      .send({email: "teammate@example.com", roleName: "member"});
    assert.equal(attached.status, 201);
  });

  it("validates PATCH settings against a registered settings schema", async () => {
    registerOrganizationSettings(
      createOrganizationSettingsSchema({
        timezone: {
          description: "IANA timezone for the organization",
          type: String,
        },
      })
    );
    const operator = await createUser({email: "settings-op@example.com", roles: ["operator"]});
    const org = await Organization.create({name: "Settings Co", ownerId: operator._id});
    const operatorAgent = await loginWithPassword(app, {
      email: "settings-op@example.com",
      password: PASSWORD,
    });

    const rejected = await operatorAgent
      .patch(`/orgs/${org._id}`)
      .send({settings: {plan: "enterprise"}});
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.title, "Organization settings are invalid");

    const patched = await operatorAgent
      .patch(`/orgs/${org._id}`)
      .send({settings: {timezone: "America/Chicago"}});
    assert.equal(patched.status, 200);
    assert.equal(patched.body.data.settings.timezone, "America/Chicago");
  });
});
