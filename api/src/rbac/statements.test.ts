import {describe, expect, it} from "bun:test";
import {assert} from "chai";

import {
  ADMIN_PAGE_PERMISSION,
  AI_EXPERIMENT_ACTIONS,
  AI_PROMPT_ACTIONS,
  AI_REVIEW_ACTIONS,
  AI_TRACE_ACTIONS,
  expandRolePermissions,
  mergeMissingResourcePermissions,
  mergeStatements,
  OBSERVABILITY_RBAC_RESOURCES,
  READ_ACTIONS,
  READ_ONLY_ROLE_PERMISSIONS,
  terrenoStatementDescriptions,
  terrenoStatements,
} from "./statements";

describe("rbac statements", () => {
  it("exports terreno default vocabulary", () => {
    expect(terrenoStatements.admin).toContain("access");
    expect(terrenoStatements.admin).toContain("jobs");
    expect(ADMIN_PAGE_PERMISSION).toEqual({admin: ["access"]});
    expect(terrenoStatements.rbac).toContain("manageRoles");
    expect(terrenoStatements.user).toContain("read");
    expect(terrenoStatements.configuration).toContain("update");
    expect(terrenoStatements.featureFlag).toEqual(["create", "list", "read", "update", "delete"]);
    expect(terrenoStatements.organization).toEqual([
      "create",
      "list",
      "read",
      "update",
      "delete",
      "manageMembers",
      "disable",
    ]);
    expect(terrenoStatements.consentForm).toEqual(["create", "list", "read", "update", "delete"]);
    expect(terrenoStatements.consentResponse).toEqual(["list", "read"]);
    assert.deepEqual(
      [...terrenoStatements.adminAnnouncementClickEvent],
      ["read", "write", "writeOwned"]
    );
  });

  it("merges app statements over terreno defaults", () => {
    const merged = mergeStatements({
      patient: ["create", "read", "update"],
      user: ["read"],
    });

    expect(merged.admin).toEqual(terrenoStatements.admin);
    expect(merged.patient).toEqual(["create", "read", "update"]);
    expect(merged.user).toEqual(["read"]);
  });

  it("expands wildcard permissions to every action", () => {
    const expanded = expandRolePermissions("*", terrenoStatements, READ_ACTIONS);

    expect(expanded.admin).toEqual([...terrenoStatements.admin]);
    expect(expanded.user).toEqual([...terrenoStatements.user]);
    expect(expanded.featureFlag).toEqual([...terrenoStatements.featureFlag]);
    expect(expanded.consentForm).toEqual([...terrenoStatements.consentForm]);
    expect(expanded.consentResponse).toEqual([...terrenoStatements.consentResponse]);
    assert.deepEqual(expanded.adminAnnouncementClickEvent, [
      ...terrenoStatements.adminAnnouncementClickEvent,
    ]);
  });

  it("expands read-only sentinel to read-ish actions", () => {
    const expanded = expandRolePermissions(
      READ_ONLY_ROLE_PERMISSIONS,
      terrenoStatements,
      READ_ACTIONS
    );

    expect(expanded.admin).toBeUndefined();
    expect(expanded.user).toEqual(["list", "read"]);
    expect(expanded.rbac).toEqual(["read"]);
    expect(expanded.configuration).toEqual(["read"]);
    expect(expanded.featureFlag).toEqual(["list", "read"]);
    expect(expanded.consentForm).toEqual(["list", "read"]);
    expect(expanded.consentResponse).toEqual(["list", "read"]);
    expect(expanded.organization).toEqual(["list", "read"]);
  });

  it("returns concrete permission sets unchanged", () => {
    const permissions = {patient: ["read"]};
    const expanded = expandRolePermissions(permissions, terrenoStatements, READ_ACTIONS);

    expect(expanded).toEqual(permissions);
  });

  it("exports observability RBAC vocabulary (Q62/Q63)", () => {
    expect(terrenoStatements.aiPrompt).toEqual([...AI_PROMPT_ACTIONS]);
    expect(terrenoStatements.aiTrace).toEqual([...AI_TRACE_ACTIONS]);
    expect(terrenoStatements.aiReview).toEqual([...AI_REVIEW_ACTIONS]);
    expect(terrenoStatements.aiExperiment).toEqual([...AI_EXPERIMENT_ACTIONS]);
    expect(terrenoStatements.aiDataset).toEqual(["create", "list", "read", "update", "delete"]);
    expect(terrenoStatements.aiEvaluator).toEqual(["create", "list", "read", "update", "delete"]);
    expect(OBSERVABILITY_RBAC_RESOURCES).toEqual([
      "aiPrompt",
      "aiTrace",
      "aiReview",
      "aiDataset",
      "aiExperiment",
      "aiEvaluator",
    ]);
  });

  it("expands read-only sentinel to observability list and read actions", () => {
    const expanded = expandRolePermissions(
      READ_ONLY_ROLE_PERMISSIONS,
      terrenoStatements,
      READ_ACTIONS
    );

    expect(expanded.aiPrompt).toEqual(["list", "read"]);
    expect(expanded.aiTrace).toEqual(["list", "read"]);
    expect(expanded.aiReview).toEqual(["list", "read"]);
    expect(expanded.aiDataset).toEqual(["list", "read"]);
    expect(expanded.aiEvaluator).toEqual(["list", "read"]);
    expect(expanded.aiExperiment).toEqual(["list", "read"]);
  });

  it("includes human-readable descriptions for observability resources", () => {
    expect(terrenoStatementDescriptions.aiPrompt?.promote).toContain("production");
    expect(terrenoStatementDescriptions.aiReview?.score).toContain("review");
    expect(Object.keys(terrenoStatementDescriptions.aiTrace ?? {})).toEqual(["list", "read"]);
  });

  it("mergeMissingResourcePermissions adds actions without removing custom grants", () => {
    const defaults = {
      aiPrompt: [...terrenoStatements.aiPrompt],
      user: [...terrenoStatements.user],
    };
    const merged = mergeMissingResourcePermissions(
      {aiPrompt: ["read"], user: ["read", "impersonate"]},
      defaults,
      ["aiPrompt"]
    );

    expect(merged.aiPrompt?.toSorted()).toEqual([...terrenoStatements.aiPrompt].toSorted());
    expect(merged.user).toEqual(["read", "impersonate"]);
  });
});
