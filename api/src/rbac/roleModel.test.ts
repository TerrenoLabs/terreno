import {describe, expect, it} from "bun:test";
import {assert} from "chai";
import mongoose from "mongoose";

import {setupDb} from "../tests";
import {createRbacAuditModel} from "./auditModel";
import {
  createRbacRoleModel,
  expandRolePermissions,
  organizationOperatorRole,
  terrenoDefaultRoles,
} from "./roleModel";
import {READ_ONLY_ROLE_PERMISSIONS, terrenoStatements} from "./statements";

describe("rbac role model", () => {
  it("defines terreno default roles with expected names", () => {
    const names = terrenoDefaultRoles.map((role) => role.name);

    expect(names).toEqual(["superadmin", "admin", "auditor", "member"]);

    const admin = terrenoDefaultRoles.find((role) => role.name === "admin");
    assert.isObject(admin?.permissions);
    if (!admin?.permissions || admin.permissions === "*" || "readOnly" in admin.permissions) {
      assert.fail("Expected concrete admin permissions");
    }
    assert.deepEqual(admin.permissions.adminAnnouncementAcknowledgement, ["read"]);
    assert.deepEqual(admin.permissions.adminAnnouncementClickEvent, ["read"]);
    assert.deepEqual(admin.permissions.adminAnnouncementImpression, ["read"]);
  });

  it("seeds default roles with expanded permissions", async () => {
    await setupDb();
    const RbacRole = createRbacRoleModel(mongoose.connection);
    await RbacRole.seedDefaults({statements: terrenoStatements});

    const superadmin = await RbacRole.findExactlyOne({name: "superadmin"});
    expect(superadmin.isSealed).toBe(true);
    expect(superadmin.permissions.admin).toContain("access");
    expect(superadmin.permissions.user).toContain("delete");
    expect(superadmin.permissions.featureFlag).toContain("list");
    expect(superadmin.permissions.consentForm).toContain("list");
    expect(superadmin.permissions.consentResponse).toEqual(["list", "read"]);
    expect(superadmin.permissions.organization).toContain("list");

    expect(await RbacRole.findOne({name: "operator"})).toBeNull();

    const auditor = await RbacRole.findExactlyOne({name: "auditor"});
    expect(auditor.permissions.user).toEqual(["list", "read"]);
    expect(auditor.permissions.rbac).toEqual(["read"]);
  });

  it("seeds the locked operator role when passed as an extra role", async () => {
    await setupDb();
    const RbacRole = createRbacRoleModel(mongoose.connection);
    await RbacRole.seedDefaults({
      extraRoles: [organizationOperatorRole],
      statements: terrenoStatements,
    });

    const operator = await RbacRole.findExactlyOne({name: "operator"});
    expect(operator.isLocked).toBe(true);
    expect(operator.permissions.organization).toEqual([...terrenoStatements.organization]);
    expect(operator.permissions.admin).toEqual(["access"]);
    expect(operator.permissions.user).toEqual(["list", "read", "update"]);
  });

  it("upserts default roles without duplicating", async () => {
    await setupDb();
    const RbacRole = createRbacRoleModel(mongoose.connection);
    await RbacRole.seedDefaults({statements: terrenoStatements});
    await RbacRole.seedDefaults({statements: terrenoStatements});

    const defaultRoleNames = terrenoDefaultRoles.map((role) => role.name);
    const roles = await RbacRole.find({name: {$in: defaultRoleNames}});
    expect(roles).toHaveLength(terrenoDefaultRoles.length);
  });

  it("does not overwrite customized unsealed roles on re-seed", async () => {
    await setupDb();
    const RbacRole = createRbacRoleModel(mongoose.connection);
    await RbacRole.seedDefaults({statements: terrenoStatements});
    await RbacRole.updateOne({name: "member"}, {$set: {permissions: {user: ["read"]}}});
    await RbacRole.seedDefaults({statements: terrenoStatements});

    const member = await RbacRole.findExactlyOne({name: "member"});
    expect(member.permissions.user).toEqual(["read"]);
  });

  it("seeds admin with full observability grants", async () => {
    await setupDb();
    const RbacRole = createRbacRoleModel(mongoose.connection);
    await RbacRole.seedDefaults({statements: terrenoStatements});

    const admin = await RbacRole.findExactlyOne({name: "admin"});
    expect(admin.permissions.aiPrompt).toEqual([...terrenoStatements.aiPrompt]);
    expect(admin.permissions.aiTrace).toEqual([...terrenoStatements.aiTrace]);
    expect(admin.permissions.aiReview).toEqual([...terrenoStatements.aiReview]);
    expect(admin.permissions.aiDataset).toEqual([...terrenoStatements.aiDataset]);
    expect(admin.permissions.aiEvaluator).toEqual([...terrenoStatements.aiEvaluator]);
    expect(admin.permissions.aiExperiment).toEqual([...terrenoStatements.aiExperiment]);
  });

  it("merges missing observability grants into customized unsealed admin on re-seed", async () => {
    await setupDb();
    const RbacRole = createRbacRoleModel(mongoose.connection);
    await RbacRole.seedDefaults({statements: terrenoStatements});
    await RbacRole.updateOne(
      {name: "admin"},
      {
        $set: {
          permissions: {
            customApp: ["deploy"],
            user: ["read"],
          },
        },
      }
    );
    await RbacRole.seedDefaults({statements: terrenoStatements});

    const admin = await RbacRole.findExactlyOne({name: "admin"});
    expect(admin.permissions.user).toEqual(["read"]);
    expect(admin.permissions.customApp).toEqual(["deploy"]);
    expect(admin.permissions.aiPrompt).toEqual([...terrenoStatements.aiPrompt]);
    expect(admin.permissions.aiTrace).toEqual([...terrenoStatements.aiTrace]);
    expect(admin.permissions.aiReview).toEqual([...terrenoStatements.aiReview]);
    expect(admin.permissions.aiDataset).toEqual([...terrenoStatements.aiDataset]);
    expect(admin.permissions.aiEvaluator).toEqual([...terrenoStatements.aiEvaluator]);
    expect(admin.permissions.aiExperiment).toEqual([...terrenoStatements.aiExperiment]);
  });

  it("seeds auditor with observability list and read grants", async () => {
    await setupDb();
    const RbacRole = createRbacRoleModel(mongoose.connection);
    await RbacRole.seedDefaults({statements: terrenoStatements});

    const auditor = await RbacRole.findExactlyOne({name: "auditor"});
    expect(auditor.permissions.aiPrompt).toEqual(["list", "read"]);
    expect(auditor.permissions.aiTrace).toEqual(["list", "read"]);
    expect(auditor.permissions.aiReview).toEqual(["list", "read"]);
    expect(auditor.permissions.aiDataset).toEqual(["list", "read"]);
    expect(auditor.permissions.aiEvaluator).toEqual(["list", "read"]);
    expect(auditor.permissions.aiExperiment).toEqual(["list", "read"]);
  });

  it("merges missing observability read grants into customized unsealed auditor on re-seed", async () => {
    await setupDb();
    const RbacRole = createRbacRoleModel(mongoose.connection);
    await RbacRole.seedDefaults({statements: terrenoStatements});
    await RbacRole.updateOne(
      {name: "auditor"},
      {
        $set: {
          permissions: {
            customAudit: ["export"],
            user: ["list", "read"],
          },
        },
      }
    );
    await RbacRole.seedDefaults({statements: terrenoStatements});

    const auditor = await RbacRole.findExactlyOne({name: "auditor"});
    expect(auditor.permissions.user).toEqual(["list", "read"]);
    expect(auditor.permissions.customAudit).toEqual(["export"]);
    expect(auditor.permissions.aiPrompt).toEqual(["list", "read"]);
    expect(auditor.permissions.aiTrace).toEqual(["list", "read"]);
    expect(auditor.permissions.aiReview).toEqual(["list", "read"]);
    expect(auditor.permissions.aiDataset).toEqual(["list", "read"]);
    expect(auditor.permissions.aiEvaluator).toEqual(["list", "read"]);
    expect(auditor.permissions.aiExperiment).toEqual(["list", "read"]);
  });

  it("refreshes sealed default roles on re-seed", async () => {
    await setupDb();
    const RbacRole = createRbacRoleModel(mongoose.connection);
    await RbacRole.seedDefaults({statements: terrenoStatements});
    await RbacRole.updateOne({name: "superadmin"}, {$set: {permissions: {user: ["read"]}}});
    await RbacRole.seedDefaults({statements: terrenoStatements});

    const superadmin = await RbacRole.findExactlyOne({name: "superadmin"});
    expect(superadmin.permissions.admin).toContain("access");
    expect(superadmin.permissions.user).toContain("delete");
  });

  it("seeds extra roles through the same upsert as terreno defaults", async () => {
    await setupDb();
    const RbacRole = createRbacRoleModel(mongoose.connection);
    await RbacRole.seedDefaults({
      extraRoles: [
        {
          displayName: "App Editor",
          name: "app-editor",
          permissions: {user: ["read"]},
        },
      ],
      statements: terrenoStatements,
    });

    const extra = await RbacRole.findExactlyOne({name: "app-editor"});
    expect(extra.displayName).toBe("App Editor");
    expect(extra.permissions.user).toEqual(["read"]);
  });

  it("registers models only on the connection passed to the factory", async () => {
    await setupDb();
    const uri = `mongodb://${mongoose.connection.host}:${mongoose.connection.port}/${mongoose.connection.name}`;
    const isolated = await mongoose.createConnection(uri).asPromise();
    try {
      expect(isolated.models.RbacRole).toBeUndefined();
      expect(isolated.models.RbacAudit).toBeUndefined();
      createRbacRoleModel(isolated);
      expect(isolated.models.RbacRole).toBeDefined();
      expect(isolated.models.RbacAudit).toBeUndefined();
      createRbacAuditModel(isolated);
      expect(isolated.models.RbacAudit).toBeDefined();
    } finally {
      await isolated.close();
    }
  });

  it("expands read-only sentinel at seed time", () => {
    const auditor = terrenoDefaultRoles.find((role) => role.name === "auditor");
    expect(auditor?.permissions).toBe(READ_ONLY_ROLE_PERMISSIONS);

    const expanded = expandRolePermissions(
      auditor?.permissions ?? READ_ONLY_ROLE_PERMISSIONS,
      terrenoStatements
    );
    expect(expanded.configuration).toEqual(["read"]);
  });
});
