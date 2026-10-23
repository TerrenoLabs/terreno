import {createAccessControl} from "better-auth/plugins/access";
import {DateTime} from "luxon";

import type {User} from "../auth";
import {APIError} from "../errors";
import {logger} from "../logger";
import {getOrgContext} from "../orgs/orgContext";
import {unionPermissionSets} from "./permissionUtils";
import type {RbacRoleModel} from "./roleModel";
import type {PermissionSet, Statements} from "./statements";
import type {PermissionSource, PermissionSourceGrants} from "./types";

interface CacheEntry {
  permissions: PermissionSet;
  expiresAt: number;
}

interface SourceCacheEntry {
  grants: PermissionSourceGrants | null;
  fetchedAt: number;
}

interface SourceFetchResult {
  grants: PermissionSourceGrants | null;
  failed: boolean;
}

const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_MAX_CACHE_ENTRIES = 10_000;

const getUserRoles = (user: User): string[] => {
  const withRoles = user as User & {roles?: string[]};
  return withRoles.roles ?? [];
};

/** Include org context and roles so tenant switches and Mongo promotions are not stuck behind TTL. */
const permissionCacheKey = (user: User): string => {
  const ctx = getOrgContext();
  const organizationId = ctx?.organization?._id?.toString() ?? "";
  const membershipRole = ctx?.membership?.roleName ?? "";
  const roles = [...getUserRoles(user)].sort().join(",");
  return `${user.id}::org=${organizationId}::role=${membershipRole}::roles=${roles}`;
};

const deletePermissionCacheForUser = (cache: Map<string, CacheEntry>, userId: string): void => {
  for (const key of [...cache.keys()]) {
    if (key === userId || key.startsWith(`${userId}:`) || key.startsWith(`${userId}::`)) {
      cache.delete(key);
    }
  }
};

export const createPermissionResolver = <S extends Statements>(args: {
  statements: S;
  rbacRoleModel: RbacRoleModel;
  sources?: PermissionSource[];
  cacheTtlMs?: number;
  maxCacheEntries?: number;
  resolvePermissions?: (args: {user: User}) => Promise<PermissionSet | null>;
}) => {
  const {
    statements,
    rbacRoleModel,
    sources = [],
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    maxCacheEntries = DEFAULT_MAX_CACHE_ENTRIES,
    resolvePermissions,
  } = args;

  const ac = createAccessControl(statements);
  const permissionCache = new Map<string, CacheEntry>();
  const sourceCache = new Map<string, Map<string, SourceCacheEntry>>();
  // Last-known deny set per user and source from the last successful fetch. Kept apart from the
  // grant caches so role edits (invalidateCache) and permission-cache eviction cannot lift an
  // IdP/ABAC restriction while its source is down. Only users with a deny set (or a source that
  // opts into failClosedWhenDenyUnknown, which needs a "no deny" marker) take an entry.
  const denyPosture = new Map<string, Map<string, PermissionSet | null>>();

  const enforceCacheBound = (): void => {
    const now = DateTime.now().toMillis();
    for (const [userId, entry] of permissionCache) {
      if (entry.expiresAt <= now) {
        permissionCache.delete(userId);
      }
    }
    while (permissionCache.size > maxCacheEntries) {
      const oldestUserId = permissionCache.keys().next().value;
      if (oldestUserId === undefined) {
        break;
      }
      permissionCache.delete(oldestUserId);
      sourceCache.delete(oldestUserId);
    }
    while (sourceCache.size > maxCacheEntries) {
      const oldestUserId = sourceCache.keys().next().value;
      if (oldestUserId === undefined) {
        break;
      }
      sourceCache.delete(oldestUserId);
    }
  };

  const rememberPermissions = (cacheKey: string, entry: CacheEntry): void => {
    permissionCache.delete(cacheKey);
    permissionCache.set(cacheKey, entry);
    enforceCacheBound();
  };

  const recordDenyPosture = (
    userId: string,
    source: PermissionSource,
    grants: PermissionSourceGrants | null
  ): void => {
    const deny = grants?.deny && Object.keys(grants.deny).length > 0 ? grants.deny : null;
    const userPosture = denyPosture.get(userId);
    if (!deny && !source.failClosedWhenDenyUnknown) {
      userPosture?.delete(source.name);
      if (userPosture?.size === 0) {
        denyPosture.delete(userId);
      }
      return;
    }
    const next = userPosture ?? new Map<string, PermissionSet | null>();
    next.set(source.name, deny);
    denyPosture.delete(userId);
    denyPosture.set(userId, next);
    while (denyPosture.size > maxCacheEntries) {
      const oldestUserId = denyPosture.keys().next().value;
      if (oldestUserId === undefined) {
        break;
      }
      denyPosture.delete(oldestUserId);
    }
  };

  const invalidateCache = (invalidateArgs?: {userId?: string}): void => {
    if (invalidateArgs?.userId) {
      deletePermissionCacheForUser(permissionCache, invalidateArgs.userId);
      sourceCache.delete(invalidateArgs.userId);
      return;
    }
    permissionCache.clear();
    sourceCache.clear();
  };

  const loadRolePermissions = async (roleNames: string[]): Promise<PermissionSet[]> => {
    if (roleNames.length === 0) {
      return [];
    }

    const roleDocs = await rbacRoleModel.find({name: {$in: roleNames}});
    return roleDocs.map((roleDoc) => roleDoc.permissions ?? {});
  };

  const applyDenyGrants = (permissions: PermissionSet, deny?: PermissionSet): PermissionSet => {
    if (!deny) {
      return permissions;
    }

    const result: Record<string, string[]> = {};
    for (const [resource, actions] of Object.entries(permissions)) {
      const denied = new Set(deny[resource] ?? []);
      const remaining = actions.filter((action) => !denied.has(action));
      if (remaining.length > 0) {
        result[resource] = remaining;
      }
    }
    return result;
  };

  const grantsFromStaleCache = (
    source: PermissionSource,
    cached: SourceCacheEntry | undefined,
    now: number
  ): PermissionSourceGrants | null => {
    if (
      source.staleOnFailure === "use-stale-bounded" &&
      cached &&
      source.staleMaxAgeMs &&
      now - cached.fetchedAt < source.staleMaxAgeMs
    ) {
      return cached.grants;
    }

    if (source.staleOnFailure === "use-stale" && cached) {
      return cached.grants;
    }

    return null;
  };

  const denyOnlyFromCache = (
    cached: SourceCacheEntry | undefined
  ): PermissionSourceGrants | null => {
    const deny = cached?.grants?.deny;
    if (!deny) {
      return null;
    }
    return {deny};
  };

  const grantsAfterSourceFailure = (
    user: User,
    source: PermissionSource,
    cached: SourceCacheEntry | undefined,
    now: number
  ): PermissionSourceGrants | null => {
    const stale = grantsFromStaleCache(source, cached, now);
    if (stale) {
      return stale;
    }
    if (cached) {
      return denyOnlyFromCache(cached);
    }
    const userPosture = denyPosture.get(user.id);
    if (userPosture?.has(source.name)) {
      const deny = userPosture.get(source.name);
      return deny ? {deny} : null;
    }
    if (source.failClosedWhenDenyUnknown) {
      throw new APIError({
        detail: `Permission source ${source.name} failed before its deny set was known`,
        status: 503,
        title: "Permission source unavailable",
      });
    }
    return null;
  };

  const fetchSourceGrants = async (
    user: User,
    source: PermissionSource,
    shouldCache = true
  ): Promise<SourceFetchResult> => {
    const now = DateTime.now().toMillis();
    const cached = sourceCache.get(user.id)?.get(source.name);

    if (!shouldCache) {
      try {
        const grants = await source.getGrants({user});
        recordDenyPosture(user.id, source, grants);
        return {failed: false, grants};
      } catch (error) {
        logger.warn("Permission source refresh failed during uncached resolution", {
          error: error instanceof Error ? error.message : String(error),
          policy: source.staleOnFailure ?? "deny",
          source: source.name,
        });
        return {failed: true, grants: grantsAfterSourceFailure(user, source, cached, now)};
      }
    }

    const userSources = sourceCache.get(user.id) ?? new Map<string, SourceCacheEntry>();
    sourceCache.delete(user.id);
    sourceCache.set(user.id, userSources);

    const ttlMs = source.ttlMs ?? cacheTtlMs;
    const cachedAfterTouch = userSources.get(source.name);

    if (cachedAfterTouch && now - cachedAfterTouch.fetchedAt < ttlMs) {
      return {failed: false, grants: cachedAfterTouch.grants};
    }

    try {
      const grants = await source.getGrants({user});
      userSources.set(source.name, {fetchedAt: now, grants});
      recordDenyPosture(user.id, source, grants);
      return {failed: false, grants};
    } catch (error) {
      logger.warn("Permission source refresh failed", {
        error: error instanceof Error ? error.message : String(error),
        policy: source.staleOnFailure ?? "deny",
        source: source.name,
      });
      return {
        failed: true,
        grants: grantsAfterSourceFailure(user, source, cachedAfterTouch, now),
      };
    }
  };

  const resolveEffectivePermissions = async (
    user: User,
    shouldCache: boolean
  ): Promise<PermissionSet> => {
    const cacheKey = permissionCacheKey(user);
    if (shouldCache) {
      const cached = permissionCache.get(cacheKey);
      if (cached && cached.expiresAt > DateTime.now().toMillis()) {
        rememberPermissions(cacheKey, cached);
        return cached.permissions;
      }
    }

    const roleNames = [...getUserRoles(user)];
    const permissionSets: PermissionSet[] = [];
    const sourceResults = new Map<string, PermissionSourceGrants | null>();
    let anySourceFailed = false;

    for (const source of sources) {
      const {failed, grants} = await fetchSourceGrants(user, source, shouldCache);
      anySourceFailed = anySourceFailed || failed;
      sourceResults.set(source.name, grants);
      if (!grants) {
        continue;
      }
      if (grants.roles?.length) {
        roleNames.push(...grants.roles);
      }
      if (grants.permissions) {
        permissionSets.push(grants.permissions);
      }
    }

    const uniqueRoleNames = [...new Set(roleNames)];
    permissionSets.push(...(await loadRolePermissions(uniqueRoleNames)));

    if (resolvePermissions) {
      const custom = await resolvePermissions({user});
      if (custom) {
        permissionSets.push(custom);
      }
    }

    let permissions = unionPermissionSets(...permissionSets);

    for (const source of sources) {
      const grants = sourceResults.get(source.name);
      if (grants?.deny) {
        permissions = applyDenyGrants(permissions, grants.deny);
      }
    }

    // A set computed during a source outage is not cached, so recovery takes effect at once.
    if (shouldCache && !anySourceFailed) {
      rememberPermissions(cacheKey, {
        expiresAt: DateTime.now().plus({milliseconds: cacheTtlMs}).toMillis(),
        permissions,
      });
    }

    return permissions;
  };

  const resolvePermissionsForUser = async (user: User): Promise<PermissionSet> => {
    return resolveEffectivePermissions(user, true);
  };

  const resolvePermissionsForUserUncached = async (user: User): Promise<PermissionSet> => {
    return resolveEffectivePermissions(user, false);
  };

  const authorizePermissions = (
    permissions: PermissionSet,
    request: PermissionSet
  ): {success: boolean; error?: string} => {
    const role = ac.newRole(permissions as never);
    return role.authorize(request as never);
  };

  return {
    ac,
    authorizePermissions,
    invalidateCache,
    resolvePermissionsForUser,
    resolvePermissionsForUserUncached,
  };
};
