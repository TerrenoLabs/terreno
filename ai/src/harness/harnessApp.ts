import type {AdminContribution, TerrenoPlugin} from "@terreno/api";
import type express from "express";
import type {DurationLike} from "luxon";

import {harnessAdminScreens} from "./adminScreens";
import {harnessError} from "./errors";
import {HarnessEventHub} from "./eventHub";
import type {Harness} from "./harness";
import {addHarnessApprovalRoutes, assertValidBasePath} from "./routes/approvals";
import {addHarnessConversationRoutes} from "./routes/conversations";
import {addHarnessEventRoutes} from "./routes/events";
import {addHarnessTaskRoutes} from "./routes/tasks";

export interface HarnessAppOptions {
  /** Prefix for every harness route. Default `/harness`. */
  basePath?: string;
  /** The opened harness whose registry resolves approvers and which wakes tasks. */
  harness: Harness;
  /** How often an idle SSE stream sends a heartbeat comment. Default 15 seconds. */
  heartbeatInterval?: DurationLike;
}

/**
 * TerrenoPlugin that mounts the harness HTTP API under `basePath`:
 *
 * - `GET /conversations`, `GET /conversations/:id`, `POST /conversations/:id/submit`
 * - `GET /conversations/:id/events` and `GET /tasks/:id/events` (SSE)
 * - `GET /tasks/:id`, `POST /tasks/:id/abort`, `POST /tasks/:id/resolveInterrupted`
 * - `GET /approvals`, `GET /approvals/:id`, `POST /approvals/:id/approve` and `/reject`
 *
 * The SSE routes only read Mongo, so any instance serves any stream. All of an app's SSE
 * connections share one change stream (`eventHub`), so viewers cost no pooled connections.
 *
 * With `AdminApp` registered on the same app, it adds the approvals inbox custom screen
 * (`harness-approvals`, group "AI Harness") to the admin sidebar.
 *
 * @example
 * ```typescript
 * const harness = await Harness.open({registry: [intakeSummary]});
 * await harness.start();
 * new TerrenoApp({userModel: User}).register(new HarnessApp({harness})).start();
 * ```
 */
export class HarnessApp implements TerrenoPlugin {
  private readonly basePath: string;
  private readonly harness: Harness;
  private readonly heartbeatInterval: DurationLike | undefined;
  /** The one change stream every SSE connection of this app shares. */
  readonly eventHub = new HarnessEventHub();

  constructor({basePath = "/harness", harness, heartbeatInterval}: HarnessAppOptions) {
    if (!harness) {
      throw harnessError({detail: "HarnessApp requires an opened Harness", kind: "configInvalid"});
    }
    this.basePath = assertValidBasePath(basePath);
    this.harness = harness;
    this.heartbeatInterval = heartbeatInterval;
  }

  register(app: express.Application, openApi?: unknown): void {
    const {basePath, harness} = this;
    // Before the routers, so `/:id/events` is never taken for a document route.
    addHarnessEventRoutes(app, {
      basePath,
      heartbeatInterval: this.heartbeatInterval,
      hub: this.eventHub,
    });
    addHarnessConversationRoutes(app, {basePath, harness, openApi});
    addHarnessTaskRoutes(app, {basePath, harness, openApi});
    addHarnessApprovalRoutes(app, {basePath, harness, openApi});
  }

  adminContribution(): AdminContribution {
    return {customScreens: harnessAdminScreens()};
  }
}
