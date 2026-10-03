import type {TerrenoPlugin} from "@terreno/api";
import type express from "express";

import type {Harness} from "./harness";
import {addHarnessApprovalRoutes, assertValidBasePath} from "./routes/approvals";

export interface HarnessAppOptions {
  /** Prefix for every harness route. Default `/harness`. */
  basePath?: string;
  /** The opened harness whose registry resolves approvers and which wakes tasks. */
  harness: Harness;
}

/**
 * TerrenoPlugin that mounts the harness HTTP API: `GET {basePath}/approvals` (the
 * approvals the caller may decide), `GET {basePath}/approvals/:id`, and the
 * `approve` / `reject` instance actions.
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

  constructor({basePath = "/harness", harness}: HarnessAppOptions) {
    if (!harness) {
      throw new Error("HarnessApp requires an opened Harness");
    }
    this.basePath = assertValidBasePath(basePath);
    this.harness = harness;
  }

  register(app: express.Application, openApi?: unknown): void {
    addHarnessApprovalRoutes(app, {basePath: this.basePath, harness: this.harness, openApi});
  }
}
