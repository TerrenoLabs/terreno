import {describe, it} from "bun:test";
import {assert} from "chai";

import {canManageUserSecurity} from "./userSecurityAccess";

describe("canManageUserSecurity", () => {
  it("needs user:manageSecurity when RBAC permissions are present", () => {
    assert.isTrue(
      canManageUserSecurity({permissions: {admin: ["access"], user: ["read", "manageSecurity"]}})
    );
    assert.isFalse(
      canManageUserSecurity({admin: true, permissions: {admin: ["access"], user: ["read"]}})
    );
  });

  it("falls back to the admin flag without RBAC", () => {
    assert.isTrue(canManageUserSecurity({admin: true}));
    assert.isFalse(canManageUserSecurity({admin: false}));
    assert.isFalse(canManageUserSecurity({}));
  });
});
