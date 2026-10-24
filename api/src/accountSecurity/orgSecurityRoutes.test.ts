import {afterEach, beforeAll, beforeEach, describe, expect, it} from "bun:test";
import express from "express";
import {DateTime} from "luxon";
import mongoose from "mongoose";
import supertest from "supertest";

import {AuditApp} from "../audit/auditApp";
import {resetAuditRecorderForTests} from "../audit/record";
import {BetterAuthApp} from "../betterAuthApp";
import {Membership, Organization} from "../orgs/organizationModel";
import {getOrgContext} from "../orgs/orgContext";
import {OrgsApp} from "../orgs/orgsApp";
import {createAccess} from "../rbac/access";
import {terrenoStatements} from "../rbac/statements";
import type {PermissionSource, PermissionSourceGrants} from "../rbac/types";
import {TerrenoApp} from "../terrenoApp";
import {
  access,
  appUserId,
  buildApp,
  resetAccountSecurityState,
  SecurityUser,
  securityEventsFor,
  securityUserModel,
  signInWithPassword,
  signUp,
  testBetterAuthConfig,
} from "../tests/accountSecurityTestApp";
import {enrollTwoFactor, uniqueEmail} from "../tests/betterAuthStubs";
import {AccountSecurityApp} from "./accountSecurityApp";
import {suspendMembershipAction} from "./membershipActions";
import type {OrgRecoveryOptions} from "./orgSecurityRoutes";
import {clearSecurityActionListenersForTests} from "./securityEvents";

interface TestUser {
  email: string;
  id: string;
  token: string;
}

const memberPath = (orgId: string, userId: string): string =>
  `/orgs/${orgId}/members/${userId}/security`;

const orgSummary = (
  app: express.Application,
  token: string,
  orgId: string,
  userId: string
): supertest.Test =>
  supertest(app).get(memberPath(orgId, userId)).set("authorization", `Bearer ${token}`);

const orgAction = (
  app: express.Application,
  token: string,
  orgId: string,
  userId: string,
  action: string
): supertest.Test =>
  supertest(app)
    .post(`${memberPath(orgId, userId)}/${action}`)
    .set("authorization", `Bearer ${token}`)
    .send({});

const actionIdsOf = (res: supertest.Response): string[] =>
  (res.body.data.actions as {id: string}[]).map((action) => action.id);

const titleOf = (res: supertest.Response): string | undefined => res.body.title;

const NOT_ORG_ADMIN = "Only org-admins of this organization can manage member security";

const createOrg = async (name: string, ownerId: string): Promise<string> => {
  const organization = await Organization.create({name, ownerId});
  return String(organization._id);
};

const addMember = async (
  orgId: string,
  userId: string,
  {
    roleName = "member",
    status = "active",
  }: {roleName?: "member" | "org-admin"; status?: "active" | "suspended"} = {}
): Promise<string> => {
  const membership = await Membership.create({
    organizationId: orgId,
    roleName,
    status,
    userId,
  });
  return String(membership._id);
};

const membershipStatus = async (orgId: string, userId: string): Promise<string | undefined> => {
  const membership = await Membership.findOneOrNone({organizationId: orgId, userId});
  return membership?.status;
};

/** A user with 2FA on, so reset-two-factor has something to change. */
const signUpWithTwoFactor = async (app: express.Application, label: string): Promise<TestUser> => {
  const email = uniqueEmail(label);
  const {token} = await enrollTwoFactor(app, email);
  return {email, id: await appUserId(email), token};
};

/**
 * Asserts that both the summary and reset-two-factor are refused with `status` (and `title`) and
 * that nothing was recorded for the target.
 */
const expectRefused = async ({
  app,
  orgId,
  status,
  targetId,
  title,
  token,
}: {
  app: express.Application;
  orgId: string;
  status: number;
  targetId: string;
  title?: string;
  token: string;
}): Promise<void> => {
  const summary = await orgSummary(app, token, orgId, targetId);
  const reset = await orgAction(app, token, orgId, targetId, "reset-two-factor");
  expect({reset: reset.status, summary: summary.status}).toEqual({reset: status, summary: status});
  if (title) {
    expect({reset: titleOf(reset), summary: titleOf(summary)}).toEqual({
      reset: title,
      summary: title,
    });
  }
  if (mongoose.isValidObjectId(targetId)) {
    expect(await securityEventsFor(targetId)).toHaveLength(0);
  }
};

interface OrgFixture {
  app: express.Application;
  accountSecurityApp?: AccountSecurityApp;
  orgA: string;
  orgAdmin: TestUser;
  orgB: string;
}

const buildOrgApp = async ({
  accountSecurity = true,
  orgRecovery,
}: {
  accountSecurity?: boolean;
  orgRecovery?: OrgRecoveryOptions;
} = {}): Promise<OrgFixture> => {
  const {accountSecurityApp, app} = buildApp({
    accountSecurity,
    organizations: orgRecovery ? {orgRecovery} : true,
  });
  const orgAdmin = await signUp(app, "org-admin-a");
  const orgA = await createOrg(`Org A ${orgAdmin.id}`, orgAdmin.id);
  const orgB = await createOrg(`Org B ${orgAdmin.id}`, orgAdmin.id);
  await addMember(orgA, orgAdmin.id, {roleName: "org-admin"});
  return {accountSecurityApp, app, orgA, orgAdmin, orgB};
};

describe("org-admin recovery routes", () => {
  beforeAll(async () => {
    await access.roles.seedDefaults();
  });

  beforeEach(async () => {
    await resetAccountSecurityState();
    await Membership.deleteMany({});
    await Organization.deleteMany({});
  });

  afterEach(() => {
    resetAuditRecorderForTests();
    clearSecurityActionListenersForTests();
  });

  describe("authorization matrix (summary and reset-two-factor)", () => {
    it("allows the org-admin of A on an active member of A who also belongs to B", async () => {
      const {app, orgA, orgAdmin, orgB} = await buildOrgApp();
      const target = await signUpWithTwoFactor(app, "member-a-and-b");
      await addMember(orgA, target.id);
      await addMember(orgB, target.id);

      const summary = await orgSummary(app, orgAdmin.token, orgA, target.id);
      expect(summary.status).toBe(200);
      expect(summary.body.data.twoFactor.enabled).toBe(true);
      expect(actionIdsOf(summary)).toContain("reset-two-factor");

      const reset = await orgAction(app, orgAdmin.token, orgA, target.id, "reset-two-factor");
      expect(reset.status).toBe(200);
      expect(reset.body.data.changed).toBe(true);

      const signIn = await signInWithPassword(app, target.email);
      expect(signIn.status).toBe(200);
      expect(signIn.body.twoFactorRedirect).toBeUndefined();

      const events = await securityEventsFor(target.id);
      expect(events).toHaveLength(1);
      expect(String(events[0].actorId)).toBe(orgAdmin.id);
      expect(events[0].after).toEqual({organizationId: orgA, securityAction: "reset-two-factor"});
    });

    it("answers 404 for a member of another org only", async () => {
      const {app, orgA, orgAdmin, orgB} = await buildOrgApp();
      const target = await signUpWithTwoFactor(app, "member-b-only");
      await addMember(orgB, target.id);

      await expectRefused({
        app,
        orgId: orgA,
        status: 404,
        targetId: target.id,
        title: "Member not found",
        token: orgAdmin.token,
      });
    });

    it("answers 404 for a suspended member", async () => {
      const {app, orgA, orgAdmin} = await buildOrgApp();
      const target = await signUpWithTwoFactor(app, "suspended-member");
      await addMember(orgA, target.id, {status: "suspended"});

      await expectRefused({
        app,
        orgId: orgA,
        status: 404,
        targetId: target.id,
        title: "Member not found",
        token: orgAdmin.token,
      });
    });

    it("refuses with 403 a member who holds superadmin, operator, or admin: true", async () => {
      const {app, orgA, orgAdmin} = await buildOrgApp();
      const superadmin = await signUp(app, "member-superadmin", ["superadmin"]);
      const operator = await signUp(app, "member-operator", ["operator"]);
      const admin = await signUp(app, "member-admin");
      await SecurityUser.updateOne({_id: admin.id}, {$set: {admin: true}});
      for (const target of [superadmin, operator, admin]) {
        await addMember(orgA, target.id);
        await expectRefused({
          app,
          orgId: orgA,
          status: 403,
          targetId: target.id,
          title: "Platform staff are managed by platform staff",
          token: orgAdmin.token,
        });
      }
    });

    it("allows the org-admin of A on another org-admin of A", async () => {
      const {app, orgA, orgAdmin} = await buildOrgApp();
      const target = await signUpWithTwoFactor(app, "second-org-admin");
      await addMember(orgA, target.id, {roleName: "org-admin"});

      expect((await orgSummary(app, orgAdmin.token, orgA, target.id)).status).toBe(200);
      const reset = await orgAction(app, orgAdmin.token, orgA, target.id, "reset-two-factor");
      expect(reset.status).toBe(200);
      expect(reset.body.data.changed).toBe(true);
    });

    it("refuses with 403 a member holding permissions the org-admin lacks (D9)", async () => {
      const {app, orgA, orgAdmin} = await buildOrgApp();
      const target = await signUp(app, "member-auditor", ["auditor"]);
      await addMember(orgA, target.id);

      await expectRefused({
        app,
        orgId: orgA,
        status: 403,
        targetId: target.id,
        title: "Target holds permissions you lack",
        token: orgAdmin.token,
      });
    });

    it("refuses an org-admin acting on themselves", async () => {
      const {app, orgA, orgAdmin} = await buildOrgApp();

      await expectRefused({
        app,
        orgId: orgA,
        status: 403,
        targetId: orgAdmin.id,
        title: "Use your own security settings to change your account",
        token: orgAdmin.token,
      });
    });

    it("refuses a plain member with 403", async () => {
      const {app, orgA} = await buildOrgApp();
      const actor = await signUp(app, "plain-member");
      await addMember(orgA, actor.id);
      const target = await signUpWithTwoFactor(app, "plain-target");
      await addMember(orgA, target.id);

      await expectRefused({
        app,
        orgId: orgA,
        status: 403,
        targetId: target.id,
        title: NOT_ORG_ADMIN,
        token: actor.token,
      });
    });

    it("refuses a suspended org-admin with 403", async () => {
      const {app, orgA} = await buildOrgApp();
      const actor = await signUp(app, "suspended-org-admin");
      await addMember(orgA, actor.id, {roleName: "org-admin", status: "suspended"});
      const target = await signUpWithTwoFactor(app, "suspended-admin-target");
      await addMember(orgA, target.id);

      await expectRefused({
        app,
        orgId: orgA,
        status: 403,
        targetId: target.id,
        title: NOT_ORG_ADMIN,
        token: actor.token,
      });
    });

    it("refuses the org-admin of B acting in A with 403", async () => {
      const {app, orgA, orgB} = await buildOrgApp();
      const adminB = await signUp(app, "org-admin-b");
      await addMember(orgB, adminB.id, {roleName: "org-admin"});
      const target = await signUpWithTwoFactor(app, "member-of-a");
      await addMember(orgA, target.id);
      await addMember(orgB, target.id);

      await expectRefused({
        app,
        orgId: orgA,
        status: 403,
        targetId: target.id,
        title: NOT_ORG_ADMIN,
        token: adminB.token,
      });
    });

    it("refuses with 403 when the organization is disabled", async () => {
      const {app, orgA, orgAdmin} = await buildOrgApp();
      const target = await signUpWithTwoFactor(app, "disabled-org-member");
      await addMember(orgA, target.id);
      await Organization.updateOne({_id: orgA}, {$set: {disabled: true}});

      await expectRefused({
        app,
        orgId: orgA,
        status: 403,
        targetId: target.id,
        title: "Organization is disabled",
        token: orgAdmin.token,
      });
    });

    it("answers 404 for an unknown organization", async () => {
      const {app, orgAdmin} = await buildOrgApp();
      const target = await signUp(app, "unknown-org-target");

      for (const orgId of ["64b7f0f0f0f0f0f0f0f0f0f0", "not-an-id"]) {
        await expectRefused({
          app,
          orgId,
          status: 404,
          targetId: target.id,
          title: "Organization not found",
          token: orgAdmin.token,
        });
      }
    });

    it("answers 404 for a malformed member id or a member whose user is gone", async () => {
      const {app, orgA, orgAdmin} = await buildOrgApp();
      expect((await orgSummary(app, orgAdmin.token, orgA, "not-an-id")).status).toBe(404);
      const ghostId = new mongoose.Types.ObjectId().toString();
      await addMember(orgA, ghostId);

      const ghost = await orgSummary(app, orgAdmin.token, orgA, ghostId);
      expect(ghost.status).toBe(404);
      expect(titleOf(ghost)).toBe("Member not found");
    });

    it("lets a platform operator through without a membership", async () => {
      const {app, orgA} = await buildOrgApp();
      const operator = await signUp(app, "platform-operator", ["operator"]);
      const target = await signUpWithTwoFactor(app, "operator-target");
      await addMember(orgA, target.id);

      expect((await orgSummary(app, operator.token, orgA, target.id)).status).toBe(200);
      const reset = await orgAction(app, operator.token, orgA, target.id, "reset-two-factor");
      expect(reset.status).toBe(200);
      // The target must still be an active member of the org named in the path.
      const outsider = await signUp(app, "operator-outsider");
      await expectRefused({
        app,
        orgId: orgA,
        status: 404,
        targetId: outsider.id,
        title: "Member not found",
        token: operator.token,
      });
    });
  });

  describe("orgRecovery.minMembershipDays", () => {
    const attachByEmail = (
      app: express.Application,
      token: string,
      orgId: string,
      email: string
    ): supertest.Test =>
      supertest(app)
        .post(`/orgs/${orgId}/members`)
        .set("authorization", `Bearer ${token}`)
        .send({email});

    it("refuses resetting 2FA on a user attached by email the same day", async () => {
      const {app, orgA, orgAdmin} = await buildOrgApp({orgRecovery: {minMembershipDays: 7}});
      const target = await signUpWithTwoFactor(app, "attached-today");
      expect((await attachByEmail(app, orgAdmin.token, orgA, target.email)).status).toBe(201);

      const reset = await orgAction(app, orgAdmin.token, orgA, target.id, "reset-two-factor");
      expect(reset.status).toBe(403);
      expect(titleOf(reset)).toBe("Member joined too recently");
      expect(await securityEventsFor(target.id)).toHaveLength(0);
    });

    it("allows a member who joined longer ago than the minimum", async () => {
      const {app, orgA, orgAdmin} = await buildOrgApp({orgRecovery: {minMembershipDays: 7}});
      const target = await signUpWithTwoFactor(app, "joined-long-ago");
      const membershipId = await addMember(orgA, target.id);
      // Write past createdUpdatedPlugin, which stamps `created` on save.
      await Membership.collection.updateOne(
        {_id: new mongoose.Types.ObjectId(membershipId)},
        {$set: {created: DateTime.now().minus({days: 8}).toJSDate()}}
      );

      const reset = await orgAction(app, orgAdmin.token, orgA, target.id, "reset-two-factor");
      expect(reset.status).toBe(200);
    });

    it("allows the same-day reset with the default of 0", async () => {
      const {app, orgA, orgAdmin} = await buildOrgApp();
      const target = await signUpWithTwoFactor(app, "attached-default");
      expect((await attachByEmail(app, orgAdmin.token, orgA, target.email)).status).toBe(201);

      const reset = await orgAction(app, orgAdmin.token, orgA, target.id, "reset-two-factor");
      expect(reset.status).toBe(200);
      expect(reset.body.data.changed).toBe(true);
    });

    it("does not apply to platform staff", async () => {
      const {app, orgA, orgAdmin} = await buildOrgApp({orgRecovery: {minMembershipDays: 7}});
      const operator = await signUp(app, "operator-recent", ["operator"]);
      const target = await signUpWithTwoFactor(app, "attached-for-operator");
      expect((await attachByEmail(app, orgAdmin.token, orgA, target.email)).status).toBe(201);

      const reset = await orgAction(app, operator.token, orgA, target.id, "reset-two-factor");
      expect(reset.status).toBe(200);
    });
  });

  describe("suspend-membership", () => {
    it("suspends only the A membership; the user can still sign in", async () => {
      const {app, orgA, orgAdmin, orgB} = await buildOrgApp();
      const target = await signUp(app, "suspend-target");
      await addMember(orgA, target.id);
      await addMember(orgB, target.id);

      const summary = await orgSummary(app, orgAdmin.token, orgA, target.id);
      expect(actionIdsOf(summary)).toContain("suspend-membership");
      expect(actionIdsOf(summary)).not.toContain("disable");
      expect(actionIdsOf(summary)).not.toContain("enable");
      expect(actionIdsOf(summary)).not.toContain("issue-sign-in-link");

      const res = await orgAction(app, orgAdmin.token, orgA, target.id, "suspend-membership");
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        action: "suspend-membership",
        changed: true,
        status: "suspended",
      });

      expect(await membershipStatus(orgA, target.id)).toBe("suspended");
      expect(await membershipStatus(orgB, target.id)).toBe("active");
      expect((await SecurityUser.findById(target.id))?.disabled).toBe(false);
      expect((await signInWithPassword(app, target.email)).status).toBe(200);
      const me = await supertest(app)
        .get("/auth/me")
        .set("authorization", `Bearer ${target.token}`);
      expect(me.status).toBe(200);

      const events = await securityEventsFor(target.id);
      expect(events).toHaveLength(1);
      expect(events[0].after).toMatchObject({
        organizationId: orgA,
        roleName: "member",
        securityAction: "suspend-membership",
      });
      // A suspended member is out of reach; restore them through PATCH /orgs/:id/members/:memberId.
      expect((await orgSummary(app, orgAdmin.token, orgA, target.id)).status).toBe(404);
    });

    it("takes a suspended org-admin's grants away at once, not after the permission cache expires", async () => {
      const {app, orgA, orgAdmin} = await buildOrgApp();
      const target = await signUp(app, "suspended-co-admin");
      await addMember(orgA, target.id, {roleName: "org-admin"});
      const targetUser = await SecurityUser.findById(target.id);
      const asAuthUser = targetUser as unknown as Parameters<
        typeof access.getPermissions
      >[0]["user"];
      // Resolve (and cache) the co-admin's grants while the membership is active.
      expect((await access.getPermissions({user: asAuthUser})).admin).toEqual(["access"]);

      const res = await orgAction(app, orgAdmin.token, orgA, target.id, "suspend-membership");
      expect(res.status).toBe(200);
      expect(await membershipStatus(orgA, target.id)).toBe("suspended");
      expect((await access.getPermissions({user: asAuthUser})).admin).toBeUndefined();
    });

    it("refuses to suspend the last active org-admin", async () => {
      const {app, orgA, orgAdmin} = await buildOrgApp();
      const operator = await signUp(app, "operator-last-admin", ["operator"]);

      const res = await orgAction(app, operator.token, orgA, orgAdmin.id, "suspend-membership");
      expect(res.status).toBe(400);
      expect(titleOf(res)).toBe("Cannot remove the last org-admin");
      expect(await membershipStatus(orgA, orgAdmin.id)).toBe("active");
    });

    it("changes nothing without an active membership, and refuses to run outside an org", async () => {
      const {app, orgA} = await buildOrgApp();
      const target = await signUp(app, "suspend-direct");
      const user = await SecurityUser.findById(target.id);
      const context = {
        target: user,
      } as unknown as Parameters<typeof suspendMembershipAction.run>[0];

      expect(await suspendMembershipAction.run({...context, org: {id: orgA}})).toEqual({
        changed: false,
      });
      await expect(suspendMembershipAction.run(context)).rejects.toThrow(
        "Security action not available"
      );
    });

    it("is not mounted under the platform /users prefix", async () => {
      const {app, orgA} = await buildOrgApp();
      const operator = await signUp(app, "operator-users-prefix", ["operator"]);
      const target = await signUp(app, "users-prefix-target");
      await addMember(orgA, target.id);

      const res = await supertest(app)
        .post(`/users/${target.id}/security/suspend-membership`)
        .set("authorization", `Bearer ${operator.token}`)
        .send({});
      expect(res.status).toBe(404);
      // A mounted route runs the auth guards first (401 without a session); an unmounted one
      // falls through to the 404, so this tells "not mounted" apart from a handler's own 404.
      const unauthenticated = await supertest(app)
        .post(`/users/${target.id}/security/suspend-membership`)
        .send({});
      expect(unauthenticated.status).toBe(404);
      const mounted = await supertest(app)
        .post(`/users/${target.id}/security/revoke-sessions`)
        .send({});
      expect(mounted.status).toBe(401);
      const summary = await supertest(app)
        .get(`/users/${target.id}/security`)
        .set("authorization", `Bearer ${operator.token}`);
      expect(actionIdsOf(summary)).not.toContain("suspend-membership");
    });

    it("never leaves the org without an active org-admin when two admins suspend each other", async () => {
      const {app, orgA, orgAdmin} = await buildOrgApp();
      const second = await signUp(app, "mutual-org-admin");
      await addMember(orgA, second.id, {roleName: "org-admin"});

      const results = await Promise.all([
        orgAction(app, orgAdmin.token, orgA, second.id, "suspend-membership"),
        orgAction(app, second.token, orgA, orgAdmin.id, "suspend-membership"),
      ]);

      const activeAdmins = await Membership.countDocuments({
        organizationId: orgA,
        roleName: "org-admin",
        status: "active",
      });
      expect(activeAdmins).toBeGreaterThanOrEqual(1);
      const suspended = results.filter((res) => res.status === 200 && res.body.data.changed);
      expect(suspended.length).toBeLessThanOrEqual(1);
      expect(activeAdmins).toBe(2 - suspended.length);
    });
  });

  describe("org-scoped permissions in the reach check (D9)", () => {
    let extraGrant: {orgId: string; userId: string} | undefined;
    // The user whose lookups the source fails, as during an outage.
    let failingUserId: string | undefined;
    /** Grants `user:delete` to one user, but only under their own membership in one org. */
    const orgScopedSource: PermissionSource = {
      getGrants: async ({user}): Promise<PermissionSourceGrants | null> => {
        if (failingUserId && String(user.id) === failingUserId) {
          throw new Error("permission source down");
        }
        const membership = getOrgContext()?.membership;
        if (!membership || !extraGrant) {
          return null;
        }
        const isGranted =
          String(membership.userId) === extraGrant.userId &&
          String(membership.organizationId) === extraGrant.orgId;
        return isGranted ? {permissions: {user: ["delete"]}} : null;
      },
      name: "test-org-scoped-extra",
      ttlMs: 0,
    };
    const scopedAccess = createAccess({
      connection: mongoose.connection,
      organizations: true,
      sources: [orgScopedSource],
      statements: terrenoStatements,
      userModel: securityUserModel,
    });

    const buildScopedApp = async (): Promise<OrgFixture> => {
      const {accountSecurityApp, app} = buildApp({
        accessControl: scopedAccess,
        organizations: true,
      });
      const orgAdmin = await signUp(app, "scoped-org-admin");
      const orgA = await createOrg(`Scoped A ${orgAdmin.id}`, orgAdmin.id);
      const orgB = await createOrg(`Scoped B ${orgAdmin.id}`, orgAdmin.id);
      await addMember(orgA, orgAdmin.id, {roleName: "org-admin"});
      return {accountSecurityApp, app, orgA, orgAdmin, orgB};
    };

    afterEach(() => {
      extraGrant = undefined;
      failingUserId = undefined;
    });

    it("refuses with 503 when the target's grants cannot be resolved, not with their grants dropped", async () => {
      const {app, orgA, orgAdmin} = await buildScopedApp();
      const target = await signUpWithTwoFactor(app, "scoped-source-down");
      await addMember(orgA, target.id);
      extraGrant = {orgId: orgA, userId: target.id};
      // One good fetch first, so the outage is not a cold failure the source would fail closed on.
      expect((await orgSummary(app, orgAdmin.token, orgA, target.id)).status).toBe(403);

      failingUserId = target.id;
      scopedAccess.invalidateCache({userId: target.id});

      await expectRefused({
        app,
        orgId: orgA,
        status: 503,
        targetId: target.id,
        title: "Permission source unavailable",
        token: orgAdmin.token,
      });
    });

    it("refuses a target whose own membership in the org grants more than the actor holds", async () => {
      const {app, orgA, orgAdmin} = await buildScopedApp();
      const target = await signUpWithTwoFactor(app, "scoped-extra-target");
      await addMember(orgA, target.id);
      extraGrant = {orgId: orgA, userId: target.id};

      await expectRefused({
        app,
        orgId: orgA,
        status: 403,
        targetId: target.id,
        title: "Target holds permissions you lack",
        token: orgAdmin.token,
      });
    });

    it("still allows an org-admin acting on another org-admin of the org", async () => {
      const {app, orgA, orgAdmin} = await buildScopedApp();
      const target = await signUpWithTwoFactor(app, "scoped-peer-admin");
      await addMember(orgA, target.id, {roleName: "org-admin"});

      expect((await orgSummary(app, orgAdmin.token, orgA, target.id)).status).toBe(200);
      const reset = await orgAction(app, orgAdmin.token, orgA, target.id, "reset-two-factor");
      expect(reset.status).toBe(200);
    });

    it("ignores a grant the target holds only in another org", async () => {
      const {app, orgA, orgAdmin, orgB} = await buildScopedApp();
      const target = await signUpWithTwoFactor(app, "scoped-other-org");
      await addMember(orgA, target.id);
      await addMember(orgB, target.id);
      extraGrant = {orgId: orgB, userId: target.id};

      expect((await orgSummary(app, orgAdmin.token, orgA, target.id)).status).toBe(200);
    });
  });

  describe("registration", () => {
    it("refuses an AccountSecurityApp that is not registered on the app", () => {
      expect(() =>
        buildApp({
          accountSecurity: false,
          organizations: {
            accountSecurity: new AccountSecurityApp({audit: false, userModel: securityUserModel}),
          },
        })
      ).toThrow("OrgsApp accountSecurity is not registered");

      const orgsApp = new OrgsApp({
        access,
        accountSecurity: new AccountSecurityApp({audit: false, userModel: securityUserModel}),
        userModel: securityUserModel,
      });
      expect(() => orgsApp.register(express())).toThrow(
        "OrgsApp accountSecurity is not registered"
      );
    });

    it("accepts an AccountSecurityApp registered on the same app after OrgsApp", async () => {
      const accountSecurity = new AccountSecurityApp();
      const terrenoApp = new TerrenoApp({
        accessControl: access,
        skipListen: true,
        userModel: securityUserModel,
      })
        .register(new BetterAuthApp({config: testBetterAuthConfig(), userModel: securityUserModel}))
        .register(new AuditApp())
        .register(new OrgsApp({access, accountSecurity, userModel: securityUserModel}))
        .register(accountSecurity);
      const app = terrenoApp.build();
      const orgAdmin = await signUp(app, "late-registration-admin");
      const orgA = await createOrg(`Late ${orgAdmin.id}`, orgAdmin.id);
      await addMember(orgA, orgAdmin.id, {roleName: "org-admin"});
      const target = await signUpWithTwoFactor(app, "late-registration-target");
      await addMember(orgA, target.id);

      expect((await orgSummary(app, orgAdmin.token, orgA, target.id)).status).toBe(200);
    });
  });

  it("documents the org routes in OpenAPI with orgId and userId path parameters", async () => {
    const {accountSecurityApp, app} = await buildOrgApp();
    const spec = (await supertest(app).get("/openapi.json").expect(200)).body as {
      paths: Record<string, Record<string, {parameters?: {in: string; name: string}[]}>>;
    };
    const orgPaths = Object.keys(spec.paths).filter((path) => path.startsWith("/orgs/"));
    expect(orgPaths.some((path) => path.includes("orgId") && !path.includes("{orgId}"))).toBe(
      false
    );

    const expected = [
      {method: "get", path: "/orgs/{orgId}/members/{userId}/security"},
      ...(accountSecurityApp?.getActions() ?? [])
        .filter((action) => !action.platformOnly)
        .map((action) => ({
          method: action.method,
          path: `/orgs/{orgId}/members/{userId}/security${action.path.replace(/:([A-Za-z]+)/g, "{$1}")}`,
        })),
    ];
    for (const {method, path} of expected) {
      const operation = spec.paths[path]?.[method];
      expect({method, operation: Boolean(operation), path}).toEqual({
        method,
        operation: true,
        path,
      });
      const pathParams = (operation?.parameters ?? [])
        .filter((parameter) => parameter.in === "path")
        .map((parameter) => parameter.name);
      expect(pathParams).toEqual(expect.arrayContaining(["orgId", "userId"]));
    }
    expect(spec.paths["/orgs/{orgId}/members/{userId}/security/disable"]).toBeUndefined();
  });

  it("exposes no /orgs/*/security routes without AccountSecurityApp", async () => {
    const {app, orgA, orgAdmin} = await buildOrgApp({accountSecurity: false});
    const target = await signUp(app, "no-security-target");
    await addMember(orgA, target.id);

    expect((await orgSummary(app, orgAdmin.token, orgA, target.id)).status).toBe(404);
    const reset = await orgAction(app, orgAdmin.token, orgA, target.id, "reset-two-factor");
    expect(reset.status).toBe(404);
    // OrgsApp itself is still mounted.
    const organization = await supertest(app)
      .get(`/orgs/${orgA}`)
      .set("authorization", `Bearer ${orgAdmin.token}`);
    expect(organization.status).toBe(200);
  });

  it("reaches every non-platform-only action under the org prefix, and no platform-only one", async () => {
    const {accountSecurityApp, app, orgA} = await buildOrgApp();
    const actor = await signUp(app, "reachability-member");
    await addMember(orgA, actor.id);
    const target = await signUp(app, "reachability-target");
    await addMember(orgA, target.id);
    const actions = accountSecurityApp?.getActions() ?? [];
    expect(actions.length).toBeGreaterThan(0);

    for (const action of actions) {
      const path = `${memberPath(orgA, target.id)}${action.path.replace(/:[A-Za-z]+/g, "x")}`;
      const res = await supertest(app)
        [action.method](path)
        .set("authorization", `Bearer ${actor.token}`)
        .send({});
      if (action.platformOnly) {
        // Not mounted: the request falls through to a 404 instead of reaching the authorizer.
        expect({id: action.id, status: res.status}).toEqual({id: action.id, status: 404});
      } else {
        // Mounted: the org authorizer answers (a plain member is refused).
        expect({id: action.id, status: res.status, title: titleOf(res)}).toEqual({
          id: action.id,
          status: 403,
          title: NOT_ORG_ADMIN,
        });
      }
    }
  });
});
