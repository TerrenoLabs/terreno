import {describe, it} from "bun:test";
import {
  createRbacRoleModel,
  expandRolePermissions,
  terrenoDefaultRoles,
  terrenoStatements,
} from "@terreno/api";
import {assert} from "chai";
import mongoose from "mongoose";

import {access} from "./access";
import {
  AI_OBSERVABILITY_OPERATOR_ROLE,
  AI_OBSERVABILITY_VIEWER_ROLE,
  appDefaultRoles,
  DEFAULT_USER_ROLE,
  observabilityOperatorPermissions,
  observabilityReadOnlyPermissions,
  SUPERADMIN_ROLE,
} from "./rbacRoles";

describe("example-backend rbac role seeds", () => {
  it("seeds example observability roles with exact read-only and operator composition", async () => {
    await access.roles.seedDefaults();

    const RbacRole = createRbacRoleModel(mongoose.connection);
    const viewer = await RbacRole.findExactlyOne({name: AI_OBSERVABILITY_VIEWER_ROLE});
    const operator = await RbacRole.findExactlyOne({name: AI_OBSERVABILITY_OPERATOR_ROLE});

    assert.deepEqual(
      viewer.permissions,
      expandRolePermissions(observabilityReadOnlyPermissions, access.statements)
    );
    assert.deepEqual(
      operator.permissions,
      expandRolePermissions(observabilityOperatorPermissions, access.statements)
    );
  });

  it("keeps todo baseline roles unchanged and does not auto-assign observability roles", async () => {
    await access.roles.seedDefaults();

    const RbacRole = createRbacRoleModel(mongoose.connection);
    const todoUser = await RbacRole.findExactlyOne({name: DEFAULT_USER_ROLE});
    assert.deepEqual(todoUser.permissions.todo, ["create", "read", "update", "delete", "list"]);
    assert.isUndefined(todoUser.permissions.aiPrompt);

    const names = appDefaultRoles.map((role) => role.name);
    assert.include(names, AI_OBSERVABILITY_VIEWER_ROLE);
    assert.include(names, AI_OBSERVABILITY_OPERATOR_ROLE);
    assert.equal(names.filter((name) => name === DEFAULT_USER_ROLE).length, 1);
  });

  it("preserves full observability access for seeded admin and superadmin roles", async () => {
    await access.roles.seedDefaults();

    const RbacRole = createRbacRoleModel(mongoose.connection);
    const admin = await RbacRole.findExactlyOne({name: "admin"});
    const superadmin = await RbacRole.findExactlyOne({name: SUPERADMIN_ROLE});

    assert.deepEqual(admin.permissions.aiPrompt, [...terrenoStatements.aiPrompt]);
    assert.deepEqual(admin.permissions.aiTrace, [...terrenoStatements.aiTrace]);
    assert.deepEqual(admin.permissions.aiReview, [...terrenoStatements.aiReview]);
    assert.deepEqual(admin.permissions.aiDataset, [...terrenoStatements.aiDataset]);
    assert.deepEqual(admin.permissions.aiEvaluator, [...terrenoStatements.aiEvaluator]);
    assert.deepEqual(admin.permissions.aiExperiment, [...terrenoStatements.aiExperiment]);

    const superadminSpec = terrenoDefaultRoles.find((role) => role.name === SUPERADMIN_ROLE);
    assert.exists(superadminSpec);
    assert.equal(superadminSpec?.permissions, "*");
    assert.deepEqual(superadmin.permissions.aiPrompt, [...terrenoStatements.aiPrompt]);
    assert.deepEqual(superadmin.permissions.aiExperiment, [...terrenoStatements.aiExperiment]);
  });
});
