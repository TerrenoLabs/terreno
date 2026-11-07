/**
 * Process-global catalog of modelRouter collections, keyed by routePath
 * (e.g. `/todos`). MCP and Sync read this Map instead of each
 * keeping their own list. `modelRouter` is the writer; surface `register*`
 * / `update*` / `clear*` helpers are wrappers around this module.
 *
 * TerrenoApp later injects `accessControl` into options. That patch goes
 * through replaceCollectionOptions so every surface sees one options
 * object. Surface flags stay sticky (OR) so a later replace cannot drop
 * mcp/sync once enabled. First-time sync enable still runs schema
 * and index guards in registrationSideEffects — not here — so catalog
 * writes stay a Map update.
 */
import type {Model} from "mongoose";

import type {ModelRouterOptions} from "./api";
import {APIError} from "./errors";
import {
  applySyncRegistrationSideEffects,
  clearSyncIndexCreationTasks,
} from "./sync/registrationSideEffects";
import type {SyncConfig} from "./sync/types";

const withAdminBroadcastDefault = (config: SyncConfig): SyncConfig => ({
  ...config,
  adminBroadcast: config.adminBroadcast === true,
});

/** Store `adminBroadcast: false` when the host omitted the flag (default). */
const applyAdminBroadcastDefault = (options: ModelRouterOptions<unknown>): void => {
  if (!options.sync) {
    return;
  }
  options.sync = withAdminBroadcastDefault(options.sync);
};

interface CollectionSurfaces {
  mcp: boolean;
  sync: boolean;
}

export interface CollectionRecord {
  model: Model<unknown>;
  options: ModelRouterOptions<unknown>;
  routePath: string;
  surfaces: CollectionSurfaces;
}

const collectionRegistry = new Map<string, CollectionRecord>();

/** OR new option flags onto existing ones so a patch cannot disable a surface. */
const deriveSurfaces = (
  options: ModelRouterOptions<unknown>,
  existing?: CollectionSurfaces
): CollectionSurfaces => ({
  mcp: Boolean(options.mcp) || (existing?.mcp ?? false),
  sync: Boolean(options.sync) || (existing?.sync ?? false),
});

/** Insert or merge a collection. First sync enable runs schema/index guards. */
export const registerCollection = <T>({
  model,
  options,
  routePath,
}: {
  model: Model<T>;
  options: ModelRouterOptions<T>;
  routePath: string;
}): void => {
  applyAdminBroadcastDefault(options as ModelRouterOptions<unknown>);
  const existing = collectionRegistry.get(routePath);
  const wasSyncEnabled = existing?.surfaces.sync ?? false;

  if (options.sync && wasSyncEnabled) {
    if (existing?.model.modelName === model.modelName) {
      return;
    }
    const collectionTag = routePath.replace(/^\//, "");
    throw new APIError({
      status: 500,
      title:
        `Sync collection tag "${collectionTag}" is already registered (routePath ${routePath}). ` +
        "Each synced model must have a unique route path.",
    });
  }

  if (options.sync && !wasSyncEnabled) {
    applySyncRegistrationSideEffects({
      config: options.sync,
      existingSyncEntries: listCollections()
        .filter((record) => record.surfaces.sync)
        .map((record) => ({
          collectionTag: record.routePath.replace(/^\//, ""),
          modelName: record.model.modelName,
        })),
      model,
      options,
      routePath,
    });
  }

  collectionRegistry.set(routePath, {
    model: model as unknown as Model<unknown>,
    options: options as ModelRouterOptions<unknown>,
    routePath,
    surfaces: deriveSurfaces(options as ModelRouterOptions<unknown>, existing?.surfaces),
  });
};

/** Swap the options pointer after TerrenoApp enriches it. Unknown path is a no-op. */
export const replaceCollectionOptions = (
  routePath: string,
  options: ModelRouterOptions<unknown>
): void => {
  const existing = collectionRegistry.get(routePath);
  if (!existing) {
    return;
  }
  applyAdminBroadcastDefault(options);
  existing.options = options;
};

/** @internal */
export const getCollection = (routePath: string): CollectionRecord | undefined =>
  collectionRegistry.get(routePath);

export const listCollections = (): CollectionRecord[] => Array.from(collectionRegistry.values());

/** Wipe the catalog and queued sync indexes so tests cannot leave a stale surface. */
export const clearCollectionRegistry = (): void => {
  collectionRegistry.clear();
  clearSyncIndexCreationTasks();
};
