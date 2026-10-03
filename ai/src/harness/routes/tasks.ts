import {
  type ActionContext,
  ConflictError,
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

const conflict = (code: string, title: string, detail: string): ConflictError =>
  new ConflictError({code, detail, title});

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
      // The harness refuses a task that already ended (perhaps after the router loaded it).
      const current = await model.findOneOrNone({_id: doc._id});
      if (!current || !HARNESS_TERMINAL_STATUSES.has(current.status)) {
        throw error;
      }
      throw conflict("harness-task-terminal", "Task already ended", `Task is ${current.status}`);
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
      // The harness refuses a task that is not interrupted (perhaps resolved meanwhile).
      const current = await model.findOneOrNone({_id: doc._id});
      if (current && current.status !== HARNESS_TASK_STATUSES.interrupted) {
        throw conflict(
          "harness-task-not-interrupted",
          "Task is not interrupted",
          `Task is ${current.status}`
        );
      }
      if (current?.abortRequested?.at && action === HARNESS_RESOLVE_ACTIONS.retry) {
        throw conflict(
          "harness-task-aborting",
          "Task is being aborted",
          "Resolve a task that is being aborted with abort, not retry"
        );
      }
      throw error;
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
