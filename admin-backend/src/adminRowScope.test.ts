import {describe, expect, it} from "bun:test";
import type {User} from "@terreno/api";
import mongoose from "mongoose";

import {
  type AdminRowScopeConfig,
  assertAdminRowScopeAfterUpdate,
  buildAdminRowScopePermission,
} from "./adminRowScope";

interface StubModel {
  model: AdminRowScopeConfig["model"];
  queries: Record<string, unknown>[];
}

const tenantSchema = new mongoose.Schema({
  ownerId: {type: String},
  tenantId: {type: String},
});

const softDeleteSchema = new mongoose.Schema({
  deleted: {type: Boolean},
  tenantId: {type: String},
});

const buildStubModel = ({
  schema = tenantSchema,
  isFound = true,
}: {
  schema?: mongoose.Schema;
  isFound?: boolean;
} = {}): StubModel => {
  const queries: Record<string, unknown>[] = [];
  const model = {
    exists: async (query: Record<string, unknown>): Promise<{_id: string} | null> => {
      queries.push(query);
      return isFound ? {_id: "doc"} : null;
    },
    schema,
  } as unknown as AdminRowScopeConfig["model"];
  return {model, queries};
};

const user = {_id: "admin-1"} as unknown as User;

describe("buildAdminRowScopePermission", () => {
  it("allows collection-level checks without an instance", async () => {
    const {model} = buildStubModel();
    const permission = buildAdminRowScopePermission({model, queryFilter: () => null});
    expect(await permission("list", user, undefined)).toBe(true);
    expect(await permission("list", user, null)).toBe(true);
  });

  it("allows every row when no queryFilter is configured", async () => {
    const {model, queries} = buildStubModel();
    const permission = buildAdminRowScopePermission({model});
    expect(await permission("read", user, {_id: "doc"})).toBe(true);
    expect(queries).toHaveLength(0);
  });

  it("denies every row when the queryFilter returns null", async () => {
    const {model, queries} = buildStubModel();
    const permission = buildAdminRowScopePermission({model, queryFilter: () => null});
    expect(await permission("read", user, {_id: "doc"})).toBe(false);
    expect(queries).toHaveLength(0);
  });

  it("allows every row when the queryFilter returns an empty filter", async () => {
    const {model, queries} = buildStubModel();
    const permission = buildAdminRowScopePermission({model, queryFilter: () => ({})});
    expect(await permission("update", user, {_id: "doc"})).toBe(true);
    expect(queries).toHaveLength(0);
  });

  it("denies an instance that has no id", async () => {
    const {model, queries} = buildStubModel();
    const permission = buildAdminRowScopePermission({
      model,
      queryFilter: () => ({tenantId: "t1"}),
    });
    expect(await permission("read", user, {tenantId: "t1"})).toBe(false);
    expect(await permission("read", user, "not-a-document")).toBe(false);
    expect(queries).toHaveLength(0);
  });

  it("checks the stored document against the scope", async () => {
    const inScope = buildStubModel({isFound: true});
    const outOfScope = buildStubModel({isFound: false});
    const queryFilter = (): Record<string, unknown> => ({tenantId: "t1"});

    expect(
      await buildAdminRowScopePermission({model: inScope.model, queryFilter})("read", user, {
        _id: "doc",
      })
    ).toBe(true);
    expect(
      await buildAdminRowScopePermission({model: outOfScope.model, queryFilter})("read", user, {
        _id: "doc",
      })
    ).toBe(false);
    expect(inScope.queries).toEqual([{$and: [{tenantId: "t1"}, {_id: "doc"}]}]);
  });

  it("includes soft-deleted rows when the model has a deleted path", async () => {
    const {model, queries} = buildStubModel({schema: softDeleteSchema});
    const permission = buildAdminRowScopePermission({
      model,
      queryFilter: async () => ({tenantId: "t1"}),
    });
    expect(await permission("delete", user, {_id: "doc"})).toBe(true);
    expect(queries).toEqual([
      {$and: [{tenantId: "t1"}, {_id: "doc"}], deleted: {$in: [true, false]}},
    ]);
  });
});

describe("assertAdminRowScopeAfterUpdate", () => {
  const current = {_id: "doc", ownerId: "o1", tenantId: "t1"};

  it("skips models without a queryFilter", async () => {
    const {model} = buildStubModel();
    await assertAdminRowScopeAfterUpdate({
      config: {model},
      current,
      patch: {tenantId: "t2"},
      user,
    });
  });

  it("skips when there is no current document", async () => {
    const {model} = buildStubModel();
    await assertAdminRowScopeAfterUpdate({
      config: {model, queryFilter: () => null},
      current: undefined,
      patch: {tenantId: "t2"},
      user,
    });
  });

  it("skips an empty patch without resolving the scope", async () => {
    const {model} = buildStubModel();
    let calls = 0;
    await assertAdminRowScopeAfterUpdate({
      config: {
        model,
        queryFilter: () => {
          calls += 1;
          return null;
        },
      },
      current,
      patch: {},
      user,
    });
    expect(calls).toBe(0);
  });

  it("rejects writes when the scope denies every row", async () => {
    const {model} = buildStubModel();
    await expect(
      assertAdminRowScopeAfterUpdate({
        config: {model, queryFilter: () => null},
        current,
        patch: {ownerId: "o2"},
        user,
      })
    ).rejects.toMatchObject({status: 403});
  });

  it("allows writes when the scope is unrestricted", async () => {
    const {model} = buildStubModel();
    await assertAdminRowScopeAfterUpdate({
      config: {model, queryFilter: () => ({})},
      current,
      patch: {tenantId: "t2"},
      user,
    });
  });

  it("allows writes that do not touch a scoped field", async () => {
    const {model} = buildStubModel();
    await assertAdminRowScopeAfterUpdate({
      config: {model, queryFilter: () => ({tenantId: "t1"})},
      current,
      patch: {ownerId: "o2"},
      user,
    });
  });

  it("rejects a write that moves the row out of scope", async () => {
    const {model} = buildStubModel();
    await expect(
      assertAdminRowScopeAfterUpdate({
        config: {model, queryFilter: () => ({tenantId: "t1"})},
        current: {toObject: (): Record<string, unknown> => current},
        patch: {tenantId: "t2"},
        user,
      })
    ).rejects.toMatchObject({status: 403});
  });

  it("treats fields inside $or clauses as scoped", async () => {
    const {model} = buildStubModel();
    await expect(
      assertAdminRowScopeAfterUpdate({
        config: {model, queryFilter: () => ({$or: [{ownerId: "o1"}, {ownerId: "o2"}]})},
        current,
        patch: {ownerId: "o3"},
        user,
      })
    ).rejects.toMatchObject({status: 403});
  });

  it("ignores operators and malformed logical clauses when finding scoped fields", async () => {
    const {model} = buildStubModel();
    await assertAdminRowScopeAfterUpdate({
      config: {
        model,
        queryFilter: () => ({
          $and: [null, "ignored"],
          $comment: "scope",
          $nor: "not-an-array",
        }),
      },
      current,
      patch: {tenantId: "t2"},
      user,
    });
  });
});
