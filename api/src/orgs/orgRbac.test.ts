import {describe, it} from "bun:test";
import {assert} from "chai";
import mongoose from "mongoose";

import type {User} from "../auth";
import {createAccess} from "../rbac/access";
import {
  createRbacRoleModel,
  organizationOperatorRole,
  terrenoDefaultRoles,
} from "../rbac/roleModel";
import {terrenoStatements} from "../rbac/statements";
import {setupDb} from "../tests";
import type {MembershipDocument} from "../types/membership";
import type {OrganizationDocument} from "../types/organization";
import {Membership, Organization} from "./organizationModel";
import {type ResolvedOrgContext, runWithOrgContext} from "./orgContext";

const createTestUser = (
  overrides: Partial<User & {roles: string[]}> = {}
): User & {roles: string[]} => {
  const id = new mongoose.Types.ObjectId();
  return {
    _id: id as unknown as User["_id"],
    admin: false,
    id: id.toString(),
    roles: [],
    ...overrides,
  };
};

const orgAdminContext = (): ResolvedOrgContext => ({
  membership: {roleName: "org-admin", status: "active"} as MembershipDocument,
  organization: {_id: new mongoose.Types.ObjectId()} as OrganizationDocument,
});

const memberContext = (): ResolvedOrgContext => ({
  membership: {roleName: "member", status: "active"} as MembershipDocument,
  organization: {_id: new mongoose.Types.ObjectId()} as OrganizationDocument,
});

describe("organization RBAC", () => {
  it("adds organization actions to terreno statements", () => {
    assert.deepEqual(terrenoStatements.organization, [
      "create",
      "list",
      "read",
      "update",
      "delete",
      "manageMembers",
      "disable",
    ]);
  });

  it("seeds a locked operator role with platform org grants", async () => {
    await setupDb();
    const RbacRole = createRbacRoleModel(mongoose.connection);
    await RbacRole.seedDefaults({
      extraRoles: [organizationOperatorRole],
      statements: terrenoStatements,
    });

    assert.notInclude(
      terrenoDefaultRoles.map((role) => role.name),
      "operator"
    );
    assert.equal(organizationOperatorRole.name, "operator");
    assert.notInclude(
      terrenoDefaultRoles.map((role) => role.name),
      "org-admin"
    );

    const operator = await RbacRole.findExactlyOne({name: "operator"});
    assert.isTrue(operator.isLocked);
    assert.deepEqual(operator.permissions.organization, [...terrenoStatements.organization]);
    assert.deepEqual(operator.permissions.admin, ["access"]);
    assert.deepEqual(operator.permissions.user, ["list", "read", "update", "manageSecurity"]);

    const orgAdminRole = await RbacRole.findOne({name: "org-admin"});
    assert.isNull(orgAdminRole);
  });

  it("lets operator organization:list and denies it to org-admin membership", async () => {
    await setupDb();
    const access = createAccess({
      connection: mongoose.connection,
      organizations: true,
      statements: terrenoStatements,
    });
    await access.roles.seedDefaults();

    const operator = createTestUser({roles: ["operator"]});
    const operatorList = await access.can({
      permissions: {organization: ["list"]},
      user: operator,
    });
    assert.isTrue(operatorList.allowed);

    const orgAdmin = createTestUser();
    const orgAdminList = await runWithOrgContext(orgAdminContext(), () =>
      access.can({
        permissions: {organization: ["list"]},
        user: orgAdmin,
      })
    );
    assert.isFalse(orgAdminList.allowed);

    const orgAdminUpdate = await runWithOrgContext(orgAdminContext(), () =>
      access.can({
        permissions: {organization: ["update", "read", "manageMembers"]},
        user: orgAdmin,
      })
    );
    assert.isTrue(orgAdminUpdate.allowed);
  });

  it("does not grant org-admin from user.roles; membership in context wins", async () => {
    await setupDb();
    const access = createAccess({
      connection: mongoose.connection,
      organizations: true,
      statements: terrenoStatements,
    });
    await access.roles.seedDefaults();

    const spoofed = createTestUser({roles: ["org-admin"]});
    const spoofedUpdate = await access.can({
      permissions: {organization: ["update"]},
      user: spoofed,
    });
    assert.isFalse(spoofedUpdate.allowed);

    const spoofedInMemberContext = await runWithOrgContext(memberContext(), () =>
      access.can({
        permissions: {organization: ["update"]},
        user: spoofed,
      })
    );
    assert.isFalse(spoofedInMemberContext.allowed);

    const suspendedAdmin = createTestUser();
    const suspendedContext: ResolvedOrgContext = {
      membership: {roleName: "org-admin", status: "suspended"} as MembershipDocument,
      organization: {_id: new mongoose.Types.ObjectId()} as OrganizationDocument,
    };
    const suspendedUpdate = await runWithOrgContext(suspendedContext, () =>
      access.can({
        permissions: {organization: ["update"]},
        user: suspendedAdmin,
      })
    );
    assert.isFalse(suspendedUpdate.allowed);

    const memberOnly = createTestUser();
    const memberUpdate = await runWithOrgContext(memberContext(), () =>
      access.can({
        permissions: {organization: ["update"]},
        user: memberOnly,
      })
    );
    assert.isFalse(memberUpdate.allowed);

    const admin = createTestUser({roles: ["admin"]});
    const adminList = await access.can({
      permissions: {organization: ["list"]},
      user: admin,
    });
    assert.isFalse(adminList.allowed);
  });

  it("grants only admin:access outside org context when the user has an active org-admin membership", async () => {
    await setupDb();
    const access = createAccess({
      connection: mongoose.connection,
      organizations: true,
      statements: terrenoStatements,
    });
    await access.roles.seedDefaults();

    const userId = new mongoose.Types.ObjectId();
    const user = createTestUser({_id: userId as unknown as User["_id"], id: userId.toString()});
    const org = await Organization.create({
      name: "Alpha Workspace",
      ownerId: userId,
    });
    await Membership.create({
      organizationId: org._id,
      roleName: "org-admin",
      userId,
    });

    const shellAccess = await access.can({
      permissions: {admin: ["access"]},
      user,
    });
    assert.isTrue(shellAccess.allowed);

    const orgList = await access.can({
      permissions: {organization: ["list"]},
      user,
    });
    assert.isFalse(orgList.allowed);

    const orgUpdate = await access.can({
      permissions: {organization: ["update"]},
      user,
    });
    assert.isFalse(orgUpdate.allowed);
  });

  it("denies admin:access outside org context when the user has only member memberships", async () => {
    await setupDb();
    const access = createAccess({
      connection: mongoose.connection,
      organizations: true,
      statements: terrenoStatements,
    });
    await access.roles.seedDefaults();

    const userId = new mongoose.Types.ObjectId();
    const user = createTestUser({_id: userId as unknown as User["_id"], id: userId.toString()});
    const org = await Organization.create({
      name: "Member Org",
      ownerId: userId,
    });
    await Membership.create({
      organizationId: org._id,
      roleName: "member",
      userId,
    });

    const shellAccess = await access.can({
      permissions: {admin: ["access"]},
      user,
    });
    assert.isFalse(shellAccess.allowed);
  });

  it("does not leak org-admin grants across organization contexts via the permission cache", async () => {
    await setupDb();
    const access = createAccess({
      cacheTtlMs: 60_000,
      connection: mongoose.connection,
      organizations: true,
      statements: terrenoStatements,
    });
    await access.roles.seedDefaults();

    const user = createTestUser();
    const firstOrg = orgAdminContext();
    const allowed = await runWithOrgContext(firstOrg, () =>
      access.can({
        permissions: {organization: ["update"]},
        user,
      })
    );
    assert.isTrue(allowed.allowed);

    const leaked = await runWithOrgContext(memberContext(), () =>
      access.can({
        permissions: {organization: ["update"]},
        user,
      })
    );
    assert.isFalse(leaked.allowed);
  });
});
