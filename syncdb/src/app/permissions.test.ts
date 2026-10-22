import {describe, expect, it} from "bun:test";

import {ADMIN_PAGE_PERMISSION, canOpenAdminPage, hasPermission} from "./permissions";

describe("canOpenAdminPage", () => {
  it("requires admin:access when a permissions object is present", () => {
    expect(canOpenAdminPage({admin: false, permissions: {admin: ["access"]}})).toBe(true);
    expect(hasPermission({admin: ["access", "runScripts"]}, ADMIN_PAGE_PERMISSION)).toBe(true);
    expect(canOpenAdminPage({admin: true, permissions: {}})).toBe(false);
    expect(
      canOpenAdminPage({
        admin: true,
        permissions: {admin: ["runScripts"], adminTodo: ["read", "write"]},
      })
    ).toBe(false);
  });

  it("falls back to the admin flag when RBAC permissions are absent", () => {
    expect(canOpenAdminPage({admin: true})).toBe(true);
    expect(canOpenAdminPage({admin: false})).toBe(false);
    expect(canOpenAdminPage({})).toBe(false);
  });
});

describe("hasPermission", () => {
  it("returns false when the permission set is missing", () => {
    expect(hasPermission(undefined, {todo: ["read"]})).toBe(false);
  });

  it("treats a missing resource as no grants", () => {
    expect(hasPermission({admin: ["access"]}, {todo: ["read"]})).toBe(false);
  });

  it("requires every requested action across every resource", () => {
    expect(hasPermission({todo: ["read", "write"]}, {todo: ["read", "write"]})).toBe(true);
    expect(hasPermission({todo: ["read"]}, {todo: ["read", "write"]})).toBe(false);
    expect(hasPermission({todo: ["read"], user: []}, {todo: ["read"], user: ["read"]})).toBe(false);
  });

  it("allows an empty action list for a resource", () => {
    expect(hasPermission({todo: ["read"]}, {todo: []})).toBe(true);
    expect(hasPermission({todo: ["read"]}, {todo: undefined as unknown as string[]})).toBe(true);
  });
});
