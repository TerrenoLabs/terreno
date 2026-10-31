import {describe, expect, it, mock} from "bun:test";
import mongoose from "mongoose";

import type {User} from "../auth";
import {setupDb} from "../tests";
import {membershipOrgAdminPermissionSource} from "./membershipOrgAdminSource";
import {createPermissionResolver} from "./resolve";
import {createRbacRoleModel} from "./roleModel";
import {terrenoStatements} from "./statements";
import type {PermissionSource} from "./types";

const appStatements = {
  ...terrenoStatements,
  todo: ["create", "read", "update", "delete", "list"],
} as const;

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

describe("createPermissionResolver", () => {
  it("caches resolved permissions until invalidated", async () => {
    await setupDb();
    const RbacRole = createRbacRoleModel(mongoose.connection);
    await RbacRole.seedDefaults({statements: appStatements});
    await RbacRole.findOneAndUpdate(
      {name: "reader"},
      {
        $set: {
          displayName: "Reader",
          name: "reader",
          permissions: {todo: ["read"]},
        },
      },
      {upsert: true}
    );

    const resolver = createPermissionResolver({
      cacheTtlMs: 60_000,
      rbacRoleModel: RbacRole,
      statements: appStatements,
    });

    const user = createTestUser({roles: ["reader"]});
    const first = await resolver.resolvePermissionsForUser(user);
    expect(first.todo).toEqual(["read"]);

    await RbacRole.findOneAndUpdate({name: "reader"}, {$set: {permissions: {todo: ["create"]}}});
    const cached = await resolver.resolvePermissionsForUser(user);
    expect(cached.todo).toEqual(["read"]);

    resolver.invalidateCache({userId: user.id});
    const refreshed = await resolver.resolvePermissionsForUser(user);
    expect(refreshed.todo).toEqual(["create"]);
  });

  it("does not reuse cached permissions after the user's roles change", async () => {
    await setupDb();
    const RbacRole = createRbacRoleModel(mongoose.connection);
    await RbacRole.seedDefaults({statements: appStatements});
    await RbacRole.findOneAndUpdate(
      {name: "reader"},
      {
        $set: {
          displayName: "Reader",
          name: "reader",
          permissions: {todo: ["read"]},
        },
      },
      {upsert: true}
    );

    const resolver = createPermissionResolver({
      cacheTtlMs: 60_000,
      rbacRoleModel: RbacRole,
      statements: appStatements,
    });

    const user = createTestUser({roles: ["reader"]});
    const first = await resolver.resolvePermissionsForUser(user);
    expect(first.todo).toEqual(["read"]);
    expect(first.admin).toBeUndefined();

    user.roles = ["superadmin"];
    const promoted = await resolver.resolvePermissionsForUser(user);
    expect(promoted.admin).toEqual(expect.arrayContaining(["access"]));
  });

  it("clears all cached permissions when invalidateCache is called without userId", async () => {
    await setupDb();
    const RbacRole = createRbacRoleModel(mongoose.connection);
    await RbacRole.seedDefaults({statements: appStatements});

    const resolver = createPermissionResolver({
      cacheTtlMs: 60_000,
      rbacRoleModel: RbacRole,
      statements: appStatements,
    });

    const userA = createTestUser({roles: ["member"]});
    const userB = createTestUser({roles: ["member"]});
    await resolver.resolvePermissionsForUser(userA);
    await resolver.resolvePermissionsForUser(userB);

    resolver.invalidateCache();
    userA.roles = ["superadmin"];
    const refreshed = await resolver.resolvePermissionsForUser(userA);
    expect(refreshed.todo).toEqual(expect.arrayContaining(["read", "update"]));
  });

  it("merges permission source grants and applies deny rules", async () => {
    await setupDb();
    const RbacRole = createRbacRoleModel(mongoose.connection);
    await RbacRole.seedDefaults({statements: appStatements});

    const source: PermissionSource = {
      getGrants: async () => ({
        deny: {todo: ["update"]},
        permissions: {todo: ["read", "update"]},
        roles: ["member"],
      }),
      name: "test-source",
    };

    const resolver = createPermissionResolver({
      rbacRoleModel: RbacRole,
      sources: [source],
      statements: appStatements,
    });

    const user = createTestUser();
    const permissions = await resolver.resolvePermissionsForUser(user);
    expect(permissions.todo).toEqual(["read"]);
  });

  it("uses resolvePermissions callback for custom grants", async () => {
    await setupDb();
    const RbacRole = createRbacRoleModel(mongoose.connection);
    await RbacRole.seedDefaults({statements: appStatements});

    const resolver = createPermissionResolver({
      rbacRoleModel: RbacRole,
      resolvePermissions: async () => ({todo: ["create"]}),
      statements: appStatements,
    });

    const user = createTestUser();
    const permissions = await resolver.resolvePermissionsForUser(user);
    expect(permissions.todo).toEqual(["create"]);
  });

  it("authorizes and denies permission requests", async () => {
    await setupDb();
    const RbacRole = createRbacRoleModel(mongoose.connection);
    await RbacRole.seedDefaults({statements: appStatements});

    const resolver = createPermissionResolver({
      rbacRoleModel: RbacRole,
      statements: appStatements,
    });

    const allowed = resolver.authorizePermissions({todo: ["read"]}, {todo: ["read"]});
    expect(allowed.success).toBe(true);

    const denied = resolver.authorizePermissions({todo: ["read"]}, {todo: ["delete"]});
    expect(denied.success).toBe(false);
    expect(denied.error).toBeDefined();
  });

  it("honors staleOnFailure during uncached resolution without writing caches", async () => {
    await setupDb();
    const RbacRole = createRbacRoleModel(mongoose.connection);
    await RbacRole.seedDefaults({statements: appStatements});

    let shouldFail = false;
    const source: PermissionSource = {
      getGrants: async () => {
        if (shouldFail) {
          throw new Error("source unavailable");
        }
        return {permissions: {todo: ["read"]}};
      },
      name: "uncached-flaky-source",
      staleOnFailure: "use-stale",
    };

    const resolver = createPermissionResolver({
      cacheTtlMs: 60_000,
      rbacRoleModel: RbacRole,
      sources: [source],
      statements: appStatements,
    });

    const user = createTestUser();
    const fresh = await resolver.resolvePermissionsForUser(user);
    expect(fresh.todo).toEqual(["read"]);

    shouldFail = true;
    user.roles = ["member"];
    const preview = await resolver.resolvePermissionsForUserUncached(user);
    expect(preview.todo).toEqual(expect.arrayContaining(["read"]));

    user.roles = [];
    const live = await resolver.resolvePermissionsForUser(user);
    expect(live.todo).toEqual(["read"]);
  });

  it("returns stale grants when a source fails with use-stale policy", async () => {
    await setupDb();
    const RbacRole = createRbacRoleModel(mongoose.connection);
    await RbacRole.seedDefaults({statements: appStatements});

    let shouldFail = false;
    const source: PermissionSource = {
      getGrants: async () => {
        if (shouldFail) {
          throw new Error("source unavailable");
        }
        return {permissions: {todo: ["read"]}};
      },
      name: "flaky-source",
      staleOnFailure: "use-stale",
    };

    const resolver = createPermissionResolver({
      cacheTtlMs: 0,
      rbacRoleModel: RbacRole,
      sources: [source],
      statements: appStatements,
    });

    const user = createTestUser();
    const fresh = await resolver.resolvePermissionsForUser(user);
    expect(fresh.todo).toEqual(["read"]);

    shouldFail = true;
    const stale = await resolver.resolvePermissionsForUser(user);
    expect(stale.todo).toEqual(["read"]);
  });

  it("returns stale grants within bounded age when use-stale-bounded is configured", async () => {
    await setupDb();
    const RbacRole = createRbacRoleModel(mongoose.connection);
    await RbacRole.seedDefaults({statements: appStatements});

    let shouldFail = false;
    const source: PermissionSource = {
      getGrants: async () => {
        if (shouldFail) {
          throw new Error("source unavailable");
        }
        return {permissions: {todo: ["list"]}};
      },
      name: "bounded-source",
      staleMaxAgeMs: 60_000,
      staleOnFailure: "use-stale-bounded",
    };

    const resolver = createPermissionResolver({
      cacheTtlMs: 0,
      rbacRoleModel: RbacRole,
      sources: [source],
      statements: appStatements,
    });

    const user = createTestUser();
    const fresh = await resolver.resolvePermissionsForUser(user);
    expect(fresh.todo).toEqual(["list"]);

    shouldFail = true;
    const stale = await resolver.resolvePermissionsForUser(user);
    expect(stale.todo).toEqual(["list"]);
  });

  it("keeps last-known deny grants when a source fails with deny policy", async () => {
    await setupDb();
    const RbacRole = createRbacRoleModel(mongoose.connection);
    await RbacRole.seedDefaults({statements: appStatements});
    await RbacRole.findOneAndUpdate(
      {name: "writer"},
      {
        $set: {
          displayName: "Writer",
          name: "writer",
          permissions: {todo: ["read", "update"]},
        },
      },
      {upsert: true}
    );

    let shouldFail = false;
    const source: PermissionSource = {
      getGrants: async () => {
        if (shouldFail) {
          throw new Error("source unavailable");
        }
        return {
          deny: {todo: ["update"]},
          permissions: {todo: ["list"]},
        };
      },
      name: "idp-deny-source",
      staleOnFailure: "deny",
    };

    const resolver = createPermissionResolver({
      cacheTtlMs: 0,
      rbacRoleModel: RbacRole,
      sources: [source],
      statements: appStatements,
    });

    const user = createTestUser({roles: ["writer"]});
    const fresh = await resolver.resolvePermissionsForUser(user);
    expect(fresh.todo ?? []).toEqual(expect.arrayContaining(["read", "list"]));
    expect(fresh.todo ?? []).not.toContain("update");

    shouldFail = true;
    const afterFailure = await resolver.resolvePermissionsForUser(user);
    expect(afterFailure.todo).toEqual(["read"]);
    expect(afterFailure.todo ?? []).not.toContain("list");
  });

  it("skips failed additive-only sources when stale policy is deny", async () => {
    await setupDb();
    const RbacRole = createRbacRoleModel(mongoose.connection);
    await RbacRole.seedDefaults({statements: appStatements});

    const source: PermissionSource = {
      failClosedWhenDenyUnknown: false,
      getGrants: mock(async () => {
        throw new Error("source unavailable");
      }),
      name: "deny-source",
      staleOnFailure: "deny",
    };

    const resolver = createPermissionResolver({
      rbacRoleModel: RbacRole,
      sources: [source],
      statements: appStatements,
    });

    const user = createTestUser({roles: ["member"]});
    const permissions = await resolver.resolvePermissionsForUser(user);
    expect(permissions.todo).toBeUndefined();
  });

  it("evicts the oldest permission cache entry when over maxCacheEntries", async () => {
    await setupDb();
    const RbacRole = createRbacRoleModel(mongoose.connection);
    await RbacRole.seedDefaults({statements: appStatements});

    const resolver = createPermissionResolver({
      cacheTtlMs: 60_000,
      maxCacheEntries: 2,
      rbacRoleModel: RbacRole,
      statements: appStatements,
    });

    const userA = createTestUser({roles: ["member"]});
    const userB = createTestUser({roles: ["member"]});
    const userC = createTestUser({roles: ["member"]});
    await resolver.resolvePermissionsForUser(userA);
    await resolver.resolvePermissionsForUser(userB);
    await resolver.resolvePermissionsForUser(userC);

    await RbacRole.findOneAndUpdate(
      {name: "cache-evict-reader"},
      {
        $set: {
          displayName: "Cache Evict Reader",
          name: "cache-evict-reader",
          permissions: {todo: ["read"]},
        },
      },
      {upsert: true}
    );
    userA.roles = ["cache-evict-reader"];
    const refreshed = await resolver.resolvePermissionsForUser(userA);
    expect(refreshed.todo).toEqual(["read"]);
  });

  describe("deny-capable sources during an outage", () => {
    const seedWriter = async () => {
      await setupDb();
      const RbacRole = createRbacRoleModel(mongoose.connection);
      await RbacRole.seedDefaults({statements: appStatements});
      await RbacRole.findOneAndUpdate(
        {name: "writer"},
        {$set: {displayName: "Writer", name: "writer", permissions: {todo: ["read", "update"]}}},
        {upsert: true}
      );
      return RbacRole;
    };

    const flakyDenySource = (
      overrides: Partial<PermissionSource> = {}
    ): {source: PermissionSource; setDown: (down: boolean) => void} => {
      let down = false;
      return {
        setDown: (next: boolean): void => {
          down = next;
        },
        source: {
          getGrants: async () => {
            if (down) {
              throw new Error("idp down");
            }
            return {deny: {todo: ["update"]}};
          },
          name: "idp-deny",
          staleOnFailure: "deny",
          ...overrides,
        },
      };
    };

    it("keeps the last-known deny after invalidateCache during an outage", async () => {
      const RbacRole = await seedWriter();
      const {source, setDown} = flakyDenySource();
      const resolver = createPermissionResolver({
        cacheTtlMs: 0,
        rbacRoleModel: RbacRole,
        sources: [source],
        statements: appStatements,
      });
      const user = createTestUser({roles: ["writer"]});
      expect((await resolver.resolvePermissionsForUser(user)).todo).toEqual(["read"]);

      setDown(true);
      resolver.invalidateCache();
      expect((await resolver.resolvePermissionsForUser(user)).todo).toEqual(["read"]);
      resolver.invalidateCache({userId: user.id});
      expect((await resolver.resolvePermissionsForUser(user)).todo).toEqual(["read"]);
      expect((await resolver.resolvePermissionsForUserUncached(user)).todo).toEqual(["read"]);
    });

    it("keeps the last-known deny when other users churn the cache", async () => {
      const RbacRole = await seedWriter();
      const {source, setDown} = flakyDenySource();
      const resolver = createPermissionResolver({
        cacheTtlMs: 0,
        maxCacheEntries: 1,
        rbacRoleModel: RbacRole,
        sources: [source],
        statements: appStatements,
      });
      const userA = createTestUser({roles: ["writer"]});
      expect((await resolver.resolvePermissionsForUser(userA)).todo).toEqual(["read"]);

      setDown(true);
      await expect(
        resolver.resolvePermissionsForUser(createTestUser({roles: ["writer"]}))
      ).rejects.toMatchObject({status: 503});
      expect((await resolver.resolvePermissionsForUser(userA)).todo).toEqual(["read"]);
    });

    it("does not cache a set computed while a source was failing", async () => {
      const RbacRole = await seedWriter();
      const {source, setDown} = flakyDenySource({failClosedWhenDenyUnknown: false});
      const resolver = createPermissionResolver({
        cacheTtlMs: 60_000,
        rbacRoleModel: RbacRole,
        sources: [{...source, ttlMs: 0}],
        statements: appStatements,
      });
      const user = createTestUser({roles: ["writer"]});

      setDown(true);
      expect((await resolver.resolvePermissionsForUser(user)).todo).toEqual(["read", "update"]);
      setDown(false);
      expect((await resolver.resolvePermissionsForUser(user)).todo).toEqual(["read"]);
    });

    it("fails closed on a cold failure by default", async () => {
      const RbacRole = await seedWriter();
      const {source, setDown} = flakyDenySource();
      const resolver = createPermissionResolver({
        cacheTtlMs: 0,
        rbacRoleModel: RbacRole,
        sources: [source],
        statements: appStatements,
      });
      setDown(true);
      await expect(
        resolver.resolvePermissionsForUser(createTestUser({roles: ["writer"]}))
      ).rejects.toMatchObject({status: 503, title: "Permission source unavailable"});
      await expect(
        resolver.resolvePermissionsForUserUncached(createTestUser({roles: ["writer"]}))
      ).rejects.toMatchObject({status: 503, title: "Permission source unavailable"});
    });

    it("resolves local roles on a cold failure when the source opts out", async () => {
      const RbacRole = await seedWriter();
      const {source, setDown} = flakyDenySource({failClosedWhenDenyUnknown: false});
      const resolver = createPermissionResolver({
        cacheTtlMs: 0,
        rbacRoleModel: RbacRole,
        sources: [source],
        statements: appStatements,
      });
      setDown(true);
      expect(
        (await resolver.resolvePermissionsForUser(createTestUser({roles: ["writer"]}))).todo
      ).toEqual(["read", "update"]);
    });

    it("throws 503 with requireComplete when a failed source's grants were dropped", async () => {
      const RbacRole = await seedWriter();
      let isDown = false;
      const source: PermissionSource = {
        failClosedWhenDenyUnknown: false,
        getGrants: async () => {
          if (isDown) {
            throw new Error("idp down");
          }
          return {permissions: {todo: ["delete"]}};
        },
        name: "idp-grants",
        staleOnFailure: "deny",
        ttlMs: 0,
      };
      const resolver = createPermissionResolver({
        cacheTtlMs: 0,
        rbacRoleModel: RbacRole,
        sources: [source],
        statements: appStatements,
      });
      const user = createTestUser({roles: ["writer"]});
      expect(
        (await resolver.resolvePermissionsForUser(user, {requireComplete: true})).todo
      ).toContain("delete");

      isDown = true;

      // Without requireComplete the source's grants drop out; with it the set is refused.
      expect((await resolver.resolvePermissionsForUser(user)).todo).toEqual(["read", "update"]);
      await expect(
        resolver.resolvePermissionsForUser(user, {requireComplete: true})
      ).rejects.toMatchObject({status: 503, title: "Permission source unavailable"});
    });

    it("accepts stale grants with requireComplete when the source serves them", async () => {
      const RbacRole = await seedWriter();
      let isDown = false;
      const source: PermissionSource = {
        getGrants: async () => {
          if (isDown) {
            throw new Error("idp down");
          }
          return {permissions: {todo: ["delete"]}};
        },
        name: "idp-stale",
        staleOnFailure: "use-stale",
        ttlMs: 0,
      };
      const resolver = createPermissionResolver({
        cacheTtlMs: 0,
        rbacRoleModel: RbacRole,
        sources: [source],
        statements: appStatements,
      });
      const user = createTestUser({roles: ["writer"]});
      await resolver.resolvePermissionsForUser(user);

      isDown = true;

      expect(
        (await resolver.resolvePermissionsForUser(user, {requireComplete: true})).todo
      ).toContain("delete");
    });

    it("keeps the built-in membership source open on a cold failure", () => {
      expect(membershipOrgAdminPermissionSource().failClosedWhenDenyUnknown).toBe(false);
    });

    it("fails closed on a cold failure when the source opts in", async () => {
      const RbacRole = await seedWriter();
      const {source, setDown} = flakyDenySource({failClosedWhenDenyUnknown: true});
      const resolver = createPermissionResolver({
        cacheTtlMs: 0,
        rbacRoleModel: RbacRole,
        sources: [source],
        statements: appStatements,
      });
      setDown(true);
      await expect(
        resolver.resolvePermissionsForUser(createTestUser({roles: ["writer"]}))
      ).rejects.toMatchObject({status: 503, title: "Permission source unavailable"});
    });

    it("lifts the deny once the source stops returning it, and keeps additive-only sources open", async () => {
      const RbacRole = await seedWriter();
      let deny = true;
      let down = false;
      const source: PermissionSource = {
        getGrants: async () => {
          if (down) {
            throw new Error("idp down");
          }
          return deny ? {deny: {todo: ["update"]}} : {permissions: {todo: ["list"]}};
        },
        name: "idp-changing",
        staleOnFailure: "deny",
      };
      const resolver = createPermissionResolver({
        cacheTtlMs: 0,
        rbacRoleModel: RbacRole,
        sources: [{...source, ttlMs: 0}],
        statements: appStatements,
      });
      const user = createTestUser({roles: ["writer"]});
      expect((await resolver.resolvePermissionsForUser(user)).todo).toEqual(["read"]);
      deny = false;
      expect((await resolver.resolvePermissionsForUser(user)).todo).toEqual(
        expect.arrayContaining(["read", "update", "list"])
      );
      down = true;
      resolver.invalidateCache();
      expect((await resolver.resolvePermissionsForUser(user)).todo).toEqual(["read", "update"]);
    });
  });
});
