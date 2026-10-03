import {
  type ActionContext,
  type ModelRouterOptions,
  modelRouter,
  type PermissionMethod,
  Permissions,
  z,
} from "@terreno/api";
import type express from "express";

import type {HarnessApprovalDocument} from "../../types/harness";
import {HARNESS_APPROVAL_STATUSES} from "../../types/harness";
import {harnessError} from "../errors";
import type {Harness} from "../harness";
import {registerHarnessApproval} from "../models/harnessApproval";

const approveBody = z
  .object({reason: z.string().trim().min(1).optional()})
  .strict()
  .describe("Optional reason recorded with the approval");

const rejectBody = z
  .object({reason: z.string().trim().min(1)})
  .strict()
  .describe("Why the approval is rejected; required");

/**
 * Mount `/harness/approvals` on `router`: list and read the approvals the caller may
 * decide, and `approve` / `reject` instance actions. Approvers come from `harness`'s
 * registry at request time.
 */
export const addHarnessApprovalRoutes = (
  router: express.Application,
  {basePath, harness, openApi}: {basePath: string; harness: Harness; openApi?: unknown}
): void => {
  const model = registerHarnessApproval();

  // Without a document (the pre-check) defer to the document check, like IsOwner.
  const canApprove: PermissionMethod<HarnessApprovalDocument> = (method, user, approval) =>
    approval ? harness.mayApprove({approval, method, user}) : true;

  const decide =
    (approved: boolean) =>
    async ({
      body,
      doc,
      user,
    }: ActionContext<
      HarnessApprovalDocument,
      unknown,
      unknown
    >): Promise<HarnessApprovalDocument> => {
      // HarnessApprovalConflictError is already a 409 APIError.
      return harness.decideApproval(doc._id, {
        approved,
        // Validated by the action's zod body schema.
        reason: (body as {reason?: string} | undefined)?.reason,
        userId: user?.id,
      });
    };

  router.use(
    `${basePath}/approvals`,
    modelRouter(model, {
      ...(openApi
        ? {openApi: openApi as ModelRouterOptions<HarnessApprovalDocument>["openApi"]}
        : {}),
      instanceActions: {
        approve: {
          body: approveBody,
          description: "Approve a pending approval; wakes the task waiting on it.",
          handler: decide(true),
          method: "POST",
          permissions: [Permissions.IsAuthenticated, canApprove as PermissionMethod<unknown>],
          summary: "Approve a harness approval",
          tag: "harness",
        },
        reject: {
          body: rejectBody,
          description: "Reject a pending approval with a reason; wakes the task waiting on it.",
          handler: decide(false),
          method: "POST",
          permissions: [Permissions.IsAuthenticated, canApprove as PermissionMethod<unknown>],
          summary: "Reject a harness approval",
          tag: "harness",
        },
      },
      permissions: {
        create: [],
        delete: [],
        list: [Permissions.IsAuthenticated],
        read: [Permissions.IsAuthenticated, canApprove],
        update: [],
      },
      queryFields: ["rootTaskId", "taskId"],
      // Approvers are code, so the inbox is filtered in memory; pagination runs after it.
      queryFilter: async (user) => {
        if (!user) {
          return null;
        }
        const approvable = await harness.approvableApprovals({user});
        if (approvable.length === 0) {
          return null;
        }
        return {
          _id: {$in: approvable.map((approval) => approval._id)},
          status: HARNESS_APPROVAL_STATUSES.pending,
        };
      },
      sort: "created _id",
    })
  );
};

export const assertValidBasePath = (basePath: string): string => {
  if (!basePath.startsWith("/") || basePath.endsWith("/")) {
    throw harnessError({
      detail: `HarnessApp basePath must start with "/" and not end with "/": "${basePath}"`,
      kind: "configInvalid",
    });
  }
  return basePath;
};
