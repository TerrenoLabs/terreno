import {
  type ActionContext,
  type ModelRouterOptions,
  modelRouter,
  type PermissionMethod,
  Permissions,
  type User,
  z,
} from "@terreno/api";
import type express from "express";

import type {HarnessConversationDocument, HarnessSubmitResult} from "../../types/harness";
import {HARNESS_WHEN_BUSY} from "../../types/harness";
import type {Harness} from "../harness";
import {registerHarnessConversation} from "../models/harnessConversation";
import {isOwnerOrAdmin} from "./events";

const submitBody = z
  .object({
    content: z.string().trim().min(1),
    requestId: z.string().trim().min(1),
    whenBusy: z
      .enum([HARNESS_WHEN_BUSY.queue, HARNESS_WHEN_BUSY.steer])
      .default(HARNESS_WHEN_BUSY.queue),
  })
  .strict()
  .describe(
    "A user message. requestId makes the submit idempotent; whenBusy (default queue) says what happens while a turn runs"
  );

// Without a document (the pre-check) defer to the document check, like IsOwner.
const ownerOrAdmin: PermissionMethod<HarnessConversationDocument> = (
  _method,
  user,
  conversation
) => (conversation ? isOwnerOrAdmin(user, conversation) : true);

const ownerOnly: PermissionMethod<HarnessConversationDocument> = (_method, user, conversation) => {
  if (!conversation) {
    return true;
  }
  return Boolean(
    user && conversation.userId && String(conversation.userId) === String(user.id ?? user._id)
  );
};

/**
 * Mount `{basePath}/conversations`: read (owner or admin), list your own, and the
 * `submit` instance action (owner only: messages are sent as the conversation's user).
 */
export const addHarnessConversationRoutes = (
  router: express.Application,
  {basePath, harness, openApi}: {basePath: string; harness: Harness; openApi?: unknown}
): void => {
  const model = registerHarnessConversation();

  const submit = async ({
    body,
    doc,
  }: ActionContext<
    HarnessConversationDocument,
    unknown,
    unknown
  >): Promise<HarnessSubmitResult> => {
    // Validated by the action's zod body schema.
    const {content, requestId, whenBusy} = body as z.infer<typeof submitBody>;
    // HarnessConversationOwnedError is already a 409 APIError.
    const conversation = await harness.conversation(doc._id);
    return conversation.send({content, requestId, whenBusy});
  };

  router.use(
    `${basePath}/conversations`,
    modelRouter(model, {
      ...(openApi
        ? {openApi: openApi as ModelRouterOptions<HarnessConversationDocument>["openApi"]}
        : {}),
      instanceActions: {
        submit: {
          body: submitBody,
          description:
            "Send a user message. Idle: starts a turn. Busy: queue runs it as a later turn; steer adds it to the active turn's next model request. Idempotent on requestId.",
          handler: submit,
          method: "POST",
          permissions: [Permissions.IsAuthenticated, ownerOnly as PermissionMethod<unknown>],
          summary: "Submit a message to a harness conversation",
          tag: "harnessconversations",
        },
      },
      permissions: {
        create: [],
        delete: [],
        list: [Permissions.IsAuthenticated],
        read: [Permissions.IsAuthenticated, ownerOrAdmin],
        update: [],
      },
      // Lists are always the caller's own conversations, admins included.
      queryFilter: (user?: User) => (user ? {userId: user.id ?? user._id} : null),
      sort: "-created",
    })
  );
};
