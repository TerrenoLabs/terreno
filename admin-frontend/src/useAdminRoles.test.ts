import {describe, expect, it} from "bun:test";

import {normalizeRoles, normalizeStatementDescriptions, normalizeStatements} from "./useAdminRoles";

describe("normalizeRoles", () => {
  it("returns arrays unchanged", () => {
    const rows = [{displayName: "Admin", name: "admin"}];
    expect(normalizeRoles(rows)).toEqual(rows);
  });

  it("unwraps a data envelope and defaults to an empty list", () => {
    expect(normalizeRoles({data: [{displayName: "A", name: "a"}]})).toEqual([
      {displayName: "A", name: "a"},
    ]);
    expect(normalizeRoles(undefined)).toEqual([]);
    expect(normalizeRoles({})).toEqual([]);
  });
});

describe("normalizeStatements", () => {
  it("reads statements from either envelope shape", () => {
    expect(normalizeStatements({statements: {users: ["read"]}})).toEqual({users: ["read"]});
    expect(normalizeStatements({data: {statements: {users: ["write"]}}})).toEqual({
      users: ["write"],
    });
    expect(normalizeStatements(undefined)).toEqual({});
  });
});

describe("normalizeStatementDescriptions", () => {
  it("reads descriptions from either envelope and defaults to empty", () => {
    const descriptions = {todo: {read: "View todos"}};
    expect(normalizeStatementDescriptions({statementDescriptions: descriptions})).toEqual(
      descriptions
    );
    expect(normalizeStatementDescriptions({data: {statementDescriptions: descriptions}})).toEqual(
      descriptions
    );
    expect(normalizeStatementDescriptions(undefined)).toEqual({});
    expect(normalizeStatementDescriptions({statements: {todo: ["read"]}})).toEqual({});
  });
});
