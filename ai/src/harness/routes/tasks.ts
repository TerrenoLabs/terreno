import {
  type ActionContext,
  type ModelRouterOptions,
  modelRouter,
  type PermissionMethod,
  Permissions,
  z,
} from "@terreno/api";
import type express from "express";

import type {HarnessTaskDocument} from "../../types/harness";
import {
  HARNESS_RESOLVE_ACTIONS,
  HARNESS_TASK_STATUSES,
  HARNESS_TERMINAL_STATUSES,
} from "../../types/harness";
import {HarnessCommitConflictError} from "../commit";
import {harnessError} from "../errors";
import type {Harness} from "../harness";
import {registerHarnessTask} from "../models/harnessTask";
import {isOwnerOrAdmin} from "./events";

const abortBody = z
  .object({reason: z.string().trim().min(1)})
  .strict()
  .describe("Why the task is aborted; required and audited");

const resolveBody = z
  .object({
    action: z.enum([
      HARNESS_RESOLVE_ACTIONS.abort,
      HARNESS_RESOLVE_ACTIONS.complete,
      HARNESS_RESOLVE_ACTIONS.retry,
    ]),
    reason: z.string().trim().min(1),
    result: z.unknown().optional(),
  })
  .strict()
  .describe("What to do with an interrupted task, why, and (for complete) its result");

// Without a document (the pre-check) defer to the document check, like IsOwner.
const ownerOrAdmin: PermissionMethod<HarnessTaskDocument> = (_method, user, task) =>
  task ? isOwnerOrAdmin(user, task) : true;

// Checked against the document so a non-admin gets 403, not the pre-document 405.
const adminOnly: PermissionMethod<HarnessTaskDocument> = (_method, user, task) =>
  task ? Boolean(user?.admin) : true;

const isCommitConflict = (error: unknown): boolean => error instanceof HarnessCommitConflictError;

/**
 * Mount `{basePath}/tasks`: read (owner or admin), plus the `abort` (owner or admin) and
 * `resolveInterrupted` (admin) instance actions. Tasks are not listed or edited over HTTP.
 */
export const addHarnessTaskRoutes = (
  router: express.Application,
  {basePath, harness, openApi}: {basePath: string; harness: Harness; openApi?: unknown}
): void => {
  const model = registerHarnessTask();

  const abort = async ({
    body,
    doc,
    user,
  }: ActionContext<HarnessTaskDocument, unknown, unknown>): Promise<HarnessTaskDocument> => {
    const {reason} = body as z.infer<typeof abortBody>;
    try {
      return await harness.abort(doc._id, {reason, userId: user?.id});
    } catch (error: unknown) {
      // The harness throws coded APIErrors itself; only a lost race (the task finished on
      // its own between the check and the abort) needs restating as "already ended".
      const current = await model.findOneOrNone({_id: doc._id});
      if (!isCommitConflict(error) || !current || !HARNESS_TERMINAL_STATUSES.has(current.status)) {
        throw error;
      }
      throw harnessError({
        cause: error,
        detail: `Task ${String(doc._id)} is already ${current.status}`,
        kind: "taskTerminal",
      });
    }
  };

  const resolveInterrupted = async ({
    body,
    doc,
    user,
  }: ActionContext<HarnessTaskDocument, unknown, unknown>): Promise<HarnessTaskDocument> => {
    const {action, reason, result} = body as z.infer<typeof resolveBody>;
    try {
      return await harness.resolveInterrupted(doc._id, {action, reason, result, userId: user?.id});
    } catch (error: unknown) {
      // The harness throws coded APIErrors itself; only a lost race (another resolution won)
      // needs restating as "not interrupted".
      const current = await model.findOneOrNone({_id: doc._id});
      if (
        !isCommitConflict(error) ||
        !current ||
        current.status === HARNESS_TASK_STATUSES.interrupted
      ) {
        throw error;
      }
      throw harnessError({
        cause: error,
        detail: `Task ${String(doc._id)} is ${current.status}, not interrupted`,
        kind: "taskNotInterrupted",
      });
    }
  };

  router.use(
    `${basePath}/tasks`,
    modelRouter(model, {
      ...(openApi ? {openApi: openApi as ModelRouterOptions<HarnessTaskDocument>["openApi"]} : {}),
      instanceActions: {
        abort: {
          body: abortBody,
          description:
            "Abort the task and every task it owns, deepest first; each runs its abort handler.",
          handler: abort,
          method: "POST",
          permissions: [Permissions.IsAuthenticated, ownerOrAdmin as PermissionMethod<unknown>],
          summary: "Abort a harness task",
          tag: "harness",
        },
        resolveInterrupted: {
          body: resolveBody,
          description:
            "Decide an interrupted task: retry its phase, abort it, or complete it with a result.",
          handler: resolveInterrupted,
          method: "POST",
          permissions: [Permissions.IsAuthenticated, adminOnly as PermissionMethod<unknown>],
          summary: "Resolve an interrupted harness task",
          tag: "harness",
        },
      },
      permissions: {
        create: [],
        delete: [],
        list: [],
        read: [Permissions.IsAuthenticated, ownerOrAdmin],
        update: [],
      },
    })
  );
};
