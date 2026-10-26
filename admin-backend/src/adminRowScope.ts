import {APIError, matchesQuery, type PermissionMethod, type User} from "@terreno/api";
import type {Model} from "mongoose";

/**
 * AdminApp row scope: the per-model `queryFilter` (or `adminFilter`, which resolves to it) that
 * limits which rows an admin may see. List and search apply it as a query constraint; the helpers
 * here apply the same scope to routes that resolve one document by id.
 */
export interface AdminRowScopeConfig {
  model: Pick<Model<unknown>, "exists" | "schema">;
  queryFilter?: (
    user?: User,
    query?: Record<string, unknown>
  ) => Record<string, unknown> | null | Promise<Record<string, unknown> | null>;
}

interface ResolvedAdminRowScope {
  denied: boolean;
  filter?: Record<string, unknown>;
}

const resolveAdminRowScope = async (
  config: AdminRowScopeConfig,
  user: User | undefined
): Promise<ResolvedAdminRowScope> => {
  if (!config.queryFilter) {
    return {denied: false};
  }
  const resolved = await config.queryFilter(user, {});
  if (resolved === null) {
    return {denied: true};
  }
  if (Object.keys(resolved).length === 0) {
    return {denied: false};
  }
  return {denied: false, filter: resolved};
};

const documentId = (instance: unknown): unknown => {
  if (!instance || typeof instance !== "object") {
    return undefined;
  }
  return (instance as {_id?: unknown})._id;
};

const toPlainDocument = (instance: unknown): Record<string, unknown> => {
  const withToObject = instance as {toObject?: () => Record<string, unknown>};
  if (typeof withToObject?.toObject === "function") {
    return withToObject.toObject();
  }
  return {...(instance as Record<string, unknown>)};
};

/** Top-level field names a Mongo filter constrains, including those inside `$and` / `$or` / `$nor`. */
const filterRootKeys = (filter: Record<string, unknown>, keys = new Set<string>()): Set<string> => {
  for (const [key, value] of Object.entries(filter)) {
    if (key === "$and" || key === "$or" || key === "$nor") {
      if (Array.isArray(value)) {
        for (const clause of value) {
          if (clause && typeof clause === "object") {
            filterRootKeys(clause as Record<string, unknown>, keys);
          }
        }
      }
      continue;
    }
    if (key.startsWith("$")) {
      continue;
    }
    keys.add(key.split(".")[0] ?? key);
  }
  return keys;
};

/**
 * Whether the stored document is inside the row scope. Evaluated by MongoDB so the scope has the
 * same semantics here as on the list query. Soft-deleted rows are included so admin-window writes
 * on them are judged by scope, not by the deleted flag.
 */
const isStoredDocumentInScope = async (
  config: AdminRowScopeConfig,
  instance: unknown,
  filter: Record<string, unknown>
): Promise<boolean> => {
  const id = documentId(instance);
  if (id == null) {
    return false;
  }
  const query: Record<string, unknown> = {$and: [filter, {_id: id}]};
  if (config.model.schema.path("deleted")) {
    query.deleted = {$in: [true, false]};
  }
  return (await config.model.exists(query)) !== null;
};

/**
 * Permission method that denies read/update/delete of a document outside the admin row scope.
 * Collection-level checks (no instance) pass, so list and the bulk-patch pre-check are unchanged.
 */
export const buildAdminRowScopePermission = (
  config: AdminRowScopeConfig
): PermissionMethod<unknown> => {
  return async (_method, user, instance): Promise<boolean> => {
    if (instance === undefined || instance === null) {
      return true;
    }
    const scope = await resolveAdminRowScope(config, user);
    if (scope.denied) {
      return false;
    }
    if (!scope.filter) {
      return true;
    }
    return isStoredDocumentInScope(config, instance, scope.filter);
  };
};

/**
 * Rejects an update whose result would leave the admin row scope (for example changing the
 * scoped tenant or owner field). Only runs when the patch writes a field the scope constrains.
 */
export const assertAdminRowScopeAfterUpdate = async ({
  config,
  current,
  patch,
  user,
}: {
  config: AdminRowScopeConfig;
  current: unknown;
  patch: Record<string, unknown>;
  user: User | undefined;
}): Promise<void> => {
  if (!config.queryFilter || !current) {
    return;
  }
  const touched = Object.keys(patch).map((key) => key.split(".")[0] ?? key);
  if (touched.length === 0) {
    return;
  }
  const scope = await resolveAdminRowScope(config, user);
  if (scope.denied) {
    throw new APIError({status: 403, title: "Admin write outside row scope"});
  }
  if (!scope.filter) {
    return;
  }
  const scopedKeys = filterRootKeys(scope.filter);
  if (!touched.some((key) => scopedKeys.has(key))) {
    return;
  }
  const nextState = {...toPlainDocument(current), ...patch};
  if (!matchesQuery(nextState, scope.filter)) {
    throw new APIError({status: 403, title: "Admin write outside row scope"});
  }
};
