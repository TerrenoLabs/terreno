import {describe, it} from "bun:test";
import {assert} from "chai";
import mongoose from "mongoose";

import type {User} from "../auth";
import {runWithOrgContext} from "./orgContext";
import {isOrgMemberPermission, OrgQueryFilter} from "./orgPermissions";

const platformUser = (roles: string[]): User =>
  ({
    admin: false,
    id: new mongoose.Types.ObjectId().toString(),
    roles,
  }) as unknown as User;

const memberUser = (): User =>
  ({
    admin: false,
    id: new mongoose.Types.ObjectId().toString(),
    roles: [],
  }) as unknown as User;

describe("OrgQueryFilter", () => {
  it("throws when organization context is missing", () => {
    assert.throws(() => OrgQueryFilter(memberUser()), "Organization context required");
  });
});

describe("isOrgMemberPermission", () => {
  it("returns true when no object is provided", async () => {
    const allowed = await isOrgMemberPermission("list", memberUser(), undefined);

    assert.isTrue(allowed);
  });

  it("returns false when there is no user", async () => {
    const allowed = await isOrgMemberPermission("read", undefined, {
      organizationId: new mongoose.Types.ObjectId(),
    });

    assert.isFalse(allowed);
  });

  it("returns false when the document has no organizationId", async () => {
    const allowed = await isOrgMemberPermission("read", memberUser(), {});

    assert.isFalse(allowed);
  });

  it("returns false when ALS org context does not match for a non-platform member", async () => {
    const contextOrganizationId = new mongoose.Types.ObjectId();
    const documentOrganizationId = new mongoose.Types.ObjectId();
    const user = memberUser();

    const allowed = await runWithOrgContext(
      {organization: {_id: contextOrganizationId} as never},
      () => isOrgMemberPermission("read", user, {organizationId: documentOrganizationId})
    );

    assert.isFalse(await allowed);
  });

  it("returns false when ALS org context is missing for a non-platform member", async () => {
    const allowed = await isOrgMemberPermission("read", memberUser(), {
      organizationId: new mongoose.Types.ObjectId(),
    });

    assert.isFalse(allowed);
  });
});

describe("isOrgMemberPermission platform actors", () => {
  it("returns false for a platform actor without ALS org context", async () => {
    const user = platformUser(["operator"]);
    const organizationId = new mongoose.Types.ObjectId();

    const allowed = await isOrgMemberPermission("read", user, {organizationId});

    assert.isFalse(allowed);
  });

  it("returns true when ALS org context matches the document organization", async () => {
    const organizationId = new mongoose.Types.ObjectId();
    const user = platformUser(["superadmin"]);

    const allowed = await runWithOrgContext({organization: {_id: organizationId} as never}, () =>
      isOrgMemberPermission("update", user, {organizationId})
    );

    assert.isTrue(await allowed);
  });

  it("returns false when ALS org context does not match the document organization", async () => {
    const contextOrganizationId = new mongoose.Types.ObjectId();
    const documentOrganizationId = new mongoose.Types.ObjectId();
    const user = platformUser(["operator"]);

    const allowed = await runWithOrgContext(
      {organization: {_id: contextOrganizationId} as never},
      () => isOrgMemberPermission("read", user, {organizationId: documentOrganizationId})
    );

    assert.isFalse(await allowed);
  });
});
