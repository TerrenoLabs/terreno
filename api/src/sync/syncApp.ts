import type express from "express";
import type {TerrenoPlugin} from "../terrenoPlugin";
import {ensureSyncModelIndexes} from "./models";
import {trackSyncIndexCreation} from "./registry";
import {addSyncRoutes, type SyncAppOptions} from "./routes";

const SYNC_APP_OPTIONS_LOCAL_KEY = "terrenoSyncAppOptions";

/** Resolve the SyncApp configuration attached to one Express application. */
export const getSyncAppOptions = (app: express.Application): SyncAppOptions | undefined =>
  app.locals[SYNC_APP_OPTIONS_LOCAL_KEY] as SyncAppOptions | undefined;

/**
 * TerrenoPlugin mounting the SyncDB local-first sync HTTP routes
 * (`GET /sync/snapshot`, `POST /sync/snapshot/batch`, `POST /sync/mutate`, `GET /sync/key`).
 * Models opt in via modelRouter's `sync` option; this plugin serves the registered
 * collections.
 *
 * Registration attaches the plugin's options (notably `getUserScopes`) to this Express
 * application so RealtimeApp's connection handler can install the socket
 * mutation/subscription channel (`sync:subscribe`, `sync:mutate`) with the same
 * configuration — the socket layer requires both plugins: SyncApp for config/routes and
 * RealtimeApp for the Socket.io server and `sync:delta` emission.
 *
 * Registration also enqueues the bookkeeping-model index builds (`SyncCounter`,
 * `SyncMutation`, `SyncScopeMove`, `SyncKey`) for `ensureSyncIndexes()`, which
 * `TerrenoApp.start()` binds the HTTP port first, then awaits `ensureSyncIndexes()`. Those indexes are
 * requirements — the unique `mutationId` index is what makes duplicate mutation deliveries
 * idempotent, and the unique `stream` index is what keeps the counter upsert race from
 * minting duplicate seqs — so an index-build failure fails startup loudly. Apps that build
 * the Express app without `TerrenoApp.start()` should await `ensureSyncIndexes()` themselves.
 * Pass `httpServer` when the process already bound `PORT` (Cloud Run startup probe).
 */
export class SyncApp implements TerrenoPlugin {
  private readonly options: SyncAppOptions;

  constructor(options: SyncAppOptions = {}) {
    this.options = options;
  }

  register(app: express.Application): void {
    app.locals[SYNC_APP_OPTIONS_LOCAL_KEY] = this.options;
    trackSyncIndexCreation(() => ensureSyncModelIndexes());
    addSyncRoutes(app, this.options);
  }
}
