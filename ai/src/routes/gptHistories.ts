import {
  APIError,
  defaultResponseHandler,
  getOpenApiSpecForModel,
  type JSONValue,
  type ModelRouterOptions,
  modelRouter,
  Permissions,
} from "@terreno/api";
import {
  type PendingAskListItem,
  pendingAskListSchema,
  resolveButtonAnswer,
  type TurnRequest,
  type TurnResult,
  turnRequestSchema,
  turnResultSchema,
} from "@terreno/blocks";
import type express from "express";
import {DateTime} from "luxon";
import type mongoose from "mongoose";

import {GptHistory} from "../models/gptHistory";
import {assertNoReservedToolNames, resolveAskKinds} from "../service/asks";
import {runBufferedChatTurn, staleAskError} from "../service/chatTurn";
import type {GptHistoryDocument, GptHistoryRouteOptions, GptRouteOptions} from "../types";

type HistoryRouterOptions = Partial<ModelRouterOptions<GptHistoryDocument>>;

/**
 * Only the chat turn writes `pendingAsk`: it holds messages replayed verbatim to the model, so a
 * client must not be able to plant or edit one, including through dotted paths.
 */
const withoutPendingAsk = (body: unknown): Partial<GptHistoryDocument> =>
  Object.fromEntries(
    Object.entries(body ?? {}).filter(
      ([key]) => key !== "pendingAsk" && !key.startsWith("pendingAsk.")
    )
  );

type OpenApiFragment = Record<string, unknown>;

/** Generated SDKs leave `readOnly` properties out of request types, so clients never send it. */
const READ_ONLY_PENDING_ASK: OpenApiFragment = {
  requestBody: {
    content: {"application/json": {schema: {properties: {pendingAsk: {readOnly: true}}}}},
  },
};

const isFragment = (value: unknown): value is OpenApiFragment =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A content part without its `gcsKey`, unless the history already stores that key. */
const withKnownGcsKey = (part: unknown, knownKeys: Set<string>): unknown => {
  if (!isFragment(part) || !("gcsKey" in part)) {
    return part;
  }
  if (typeof part.gcsKey === "string" && knownKeys.has(part.gcsKey)) {
    return part;
  }
  const {gcsKey: _dropped, ...rest} = part;
  return rest;
};

const withKnownGcsKeys = (parts: unknown, knownKeys: Set<string>): unknown =>
  Array.isArray(parts) ? parts.map((part) => withKnownGcsKey(part, knownKeys)) : parts;

const promptWithKnownGcsKeys = (prompt: unknown, knownKeys: Set<string>): unknown =>
  isFragment(prompt) && Array.isArray(prompt.content)
    ? {...prompt, content: withKnownGcsKeys(prompt.content, knownKeys)}
    : prompt;

/**
 * One body entry with client-written attachment keys removed. `key` is `prompts` or a dotted path
 * into it, such as `prompts.0.content.1` or `prompts.0.content.1.gcsKey`. Returns undefined to
 * drop the entry.
 */
const promptsEntryWithKnownGcsKeys = (
  key: string,
  value: unknown,
  knownKeys: Set<string>
): unknown => {
  const [, , contentSegment, , field] = key.split(".");
  const depth = key.split(".").length;
  if (depth === 1) {
    return Array.isArray(value)
      ? value.map((prompt) => promptWithKnownGcsKeys(prompt, knownKeys))
      : value;
  }
  if (depth === 2) {
    return promptWithKnownGcsKeys(value, knownKeys);
  }
  if (contentSegment !== "content") {
    return value;
  }
  if (depth === 3) {
    return withKnownGcsKeys(value, knownKeys);
  }
  if (depth === 4) {
    return withKnownGcsKey(value, knownKeys);
  }
  if (depth === 5 && field === "gcsKey") {
    return typeof value === "string" && knownKeys.has(value) ? value : undefined;
  }
  return value;
};

const isPromptsKey = (key: string): boolean => key === "prompts" || key.startsWith("prompts.");

/** The attachment keys the chat turn stored on a history. */
const storedGcsKeys = async (historyId: unknown): Promise<Set<string>> => {
  if (typeof historyId !== "string") {
    return new Set();
  }
  const history = await GptHistory.findById(historyId).select({"prompts.content": 1}).lean();
  return new Set(
    (history?.prompts ?? []).flatMap((prompt) =>
      (prompt.content ?? []).flatMap((part) =>
        part.type !== "text" && part.gcsKey ? [part.gcsKey] : []
      )
    )
  );
};

/**
 * Only the chat turn writes `gcsKey`: a stored key is signed for the model on later turns, so a
 * client may send back keys the history already holds but cannot add new ones.
 */
const withoutClientGcsKeys = async (
  body: Partial<GptHistoryDocument>,
  historyId?: unknown
): Promise<Partial<GptHistoryDocument>> => {
  const entries = Object.entries(body);
  if (!entries.some(([key]) => isPromptsKey(key))) {
    return body;
  }
  const knownKeys = await storedGcsKeys(historyId);
  return Object.fromEntries(
    entries.flatMap(([key, value]) => {
      if (!isPromptsKey(key)) {
        return [[key, value]];
      }
      const kept = promptsEntryWithKnownGcsKeys(key, value, knownKeys);
      return kept === undefined ? [] : [[key, kept]];
    })
  ) as Partial<GptHistoryDocument>;
};

/** Server-only fields of `pendingAsk`: the paused turn's messages, replayed only to the model. */
const SERVER_ONLY_PENDING_ASK_FIELDS = ["promptIndex", "responseMessages"];

const withoutServerOnlyFields = (pendingAsk: OpenApiFragment): OpenApiFragment =>
  Object.fromEntries(
    Object.entries(pendingAsk).filter(([key]) => !SERVER_ONLY_PENDING_ASK_FIELDS.includes(key))
  );

/** A serialized history as clients receive it: its pending ask without the server-only fields. */
const withClientPendingAsk = (history: unknown): unknown => {
  if (!isFragment(history) || !isFragment(history.pendingAsk)) {
    return history;
  }
  return {...history, pendingAsk: withoutServerOnlyFields(history.pendingAsk)};
};

/** The model's `pendingAsk` schema without the server-only fields, for the OpenAPI spec. */
const clientPendingAskSchema = (): OpenApiFragment => {
  const {properties} = getOpenApiSpecForModel(GptHistory);
  const schema = isFragment(properties.pendingAsk) ? properties.pendingAsk : {};
  const {properties: fields, required, ...rest} = schema;
  return {
    ...rest,
    ...(isFragment(fields) ? {properties: withoutServerOnlyFields(fields)} : {}),
    ...(Array.isArray(required)
      ? {required: required.filter((field) => !SERVER_ONLY_PENDING_ASK_FIELDS.includes(field))}
      : {}),
  };
};

const mergeFragments = (base: OpenApiFragment, extra: OpenApiFragment = {}): OpenApiFragment => {
  const merged = {...base};
  for (const [key, value] of Object.entries(extra)) {
    const current = merged[key];
    merged[key] = isFragment(current) && isFragment(value) ? mergeFragments(current, value) : value;
  }
  return merged;
};

/**
 * preCreate sets `userId` to the caller, so a client such as a watch creates a history with `{}`
 * even when the host validates request bodies against the model. A host's `validation: false`
 * stays off.
 */
const withCallerUserId = (
  validation: HistoryRouterOptions["validation"]
): HistoryRouterOptions["validation"] => {
  if (validation === false) {
    return false;
  }
  const hostValidation = typeof validation === "object" ? validation : {};
  return {
    ...hostValidation,
    excludeFromCreate: [...(hostValidation.excludeFromCreate ?? []), "userId"],
  };
};

const userIdOf = (req: express.Request): mongoose.Types.ObjectId | undefined =>
  (req.user as {_id?: mongoose.Types.ObjectId} | undefined)?._id;

/** The caller's pending asks, newest first, without the stored messages of the paused turns. */
const listPendingAsks = async (req: express.Request): Promise<PendingAskListItem[]> => {
  const userId = userIdOf(req);
  if (!userId) {
    throw new APIError({status: 401, title: "Authentication required"});
  }
  const histories = await GptHistory.find({pendingAsk: {$ne: null}, userId})
    .select({
      "pendingAsk.created": 1,
      "pendingAsk.kind": 1,
      "pendingAsk.simple": 1,
      "pendingAsk.toolCallId": 1,
      title: 1,
    })
    .sort({"pendingAsk.created": -1})
    .lean();
  return histories.flatMap(({_id, pendingAsk, title}) =>
    pendingAsk
      ? [
          {
            created: DateTime.fromJSDate(pendingAsk.created).toUTC().toISO() ?? "",
            historyId: _id.toString(),
            kind: pendingAsk.kind,
            simple: pendingAsk.simple,
            ...(title ? {title} : {}),
            toolCallId: pendingAsk.toolCallId,
          },
        ]
      : []
  );
};

/**
 * Runs one turn of the history. A `buttonId` sends the answer stored on that button of the
 * pending ask's simple card, so a small client never builds an answer itself.
 */
const runHeadlessTurn = async ({
  body,
  chat,
  history,
  req,
}: {
  body: TurnRequest;
  chat: GptRouteOptions;
  history: GptHistoryDocument;
  req: express.Request;
}): Promise<TurnResult> => {
  // Admins pass IsOwner, but a turn speaks as the conversation's owner.
  if (history.userId.toString() !== userIdOf(req)?.toString()) {
    throw new APIError({status: 403, title: "Not authorized to access this history"});
  }
  const {askResponse, buttonId, prompt, surface, toolCallId} = body;
  const historyId = history._id.toString();
  if (buttonId === undefined || toolCallId === undefined) {
    return runBufferedChatTurn({
      body: {askResponse, historyId, prompt, surface},
      options: chat,
      req,
    });
  }
  const {pendingAsk} = history;
  if (pendingAsk?.toolCallId !== toolCallId) {
    throw staleAskError(toolCallId);
  }
  const {errors, response} = resolveButtonAnswer({buttonId, card: pendingAsk.simple});
  if (!response) {
    throw new APIError({
      code: "UNKNOWN_BUTTON",
      detail: "The button is not on the pending ask's simple card. See fields.",
      meta: {fields: errors},
      status: 400,
      title: "Unknown buttonId",
    });
  }
  return runBufferedChatTurn({
    body: {askResponse: {...response, toolCallId}, historyId, surface},
    options: chat,
    req,
  });
};

/** The headless actions, next to any actions the host adds to `/gpt/histories`. */
const headlessActions = ({
  chat,
  routerOptions,
}: {
  chat: GptRouteOptions;
  routerOptions: HistoryRouterOptions;
}): Pick<HistoryRouterOptions, "collectionActions" | "instanceActions"> => ({
  collectionActions: {
    ...routerOptions.collectionActions,
    pendingAsks: {
      description:
        "The asks the caller's conversations are waiting on, newest first, each with its simple card. Answer one with POST /gpt/histories/{id}/turn.",
      handler: ({req}) => listPendingAsks(req),
      method: "GET",
      permissions: [Permissions.IsAuthenticated],
      response: pendingAskListSchema,
      summary: "List the caller's pending asks",
    },
  },
  instanceActions: {
    ...routerOptions.instanceActions,
    turn: {
      body: turnRequestSchema,
      description:
        "Runs one chat turn to completion and returns the reply as JSON, for clients that do not read server-sent events. The turn finishes and is saved even if the client disconnects.",
      handler: ({body, doc, req}) =>
        runHeadlessTurn({body: body as TurnRequest, chat, history: doc, req}),
      method: "POST",
      permissions: [Permissions.IsOwner],
      response: turnResultSchema,
      summary: "Run a chat turn and return the reply as JSON",
    },
  },
});

export const addGptHistoryRoutes = (
  router: express.Router,
  options?: HistoryRouterOptions & GptHistoryRouteOptions
): void => {
  const {chat, openApiOptions, ...routerOptions} = options ?? {};
  const headlessChat = resolveAskKinds(chat?.asks).length > 0 ? chat : undefined;
  if (headlessChat) {
    assertNoReservedToolNames(headlessChat.tools);
  }
  router.use(
    "/gpt/histories",
    modelRouter(GptHistory, {
      ...openApiOptions,
      ...routerOptions,
      ...(headlessChat ? headlessActions({chat: headlessChat, routerOptions}) : {}),
      openApiExtraModelProperties: {
        ...routerOptions.openApiExtraModelProperties,
        pendingAsk: clientPendingAskSchema(),
      },
      openApiOverwrite: {
        ...routerOptions.openApiOverwrite,
        create: mergeFragments(READ_ONLY_PENDING_ASK, routerOptions.openApiOverwrite?.create),
        update: mergeFragments(READ_ONLY_PENDING_ASK, routerOptions.openApiOverwrite?.update),
      },
      permissions: {
        create: [Permissions.IsAuthenticated],
        delete: [Permissions.IsOwner],
        list: [Permissions.IsAuthenticated],
        read: [Permissions.IsOwner],
        update: [Permissions.IsOwner],
      },
      preCreate: async (body, req): Promise<GptHistoryDocument> => {
        return {
          ...(await withoutClientGcsKeys(withoutPendingAsk(body))),
          userId: (req.user as {_id: unknown})?._id,
        } as GptHistoryDocument;
      },
      preUpdate: async (body, req): Promise<GptHistoryDocument> => {
        const update = await withoutClientGcsKeys(withoutPendingAsk(body), req.params.id);
        // A host hook that returns null still refuses the update; modelRouter checks the value.
        return (
          routerOptions.preUpdate ? await routerOptions.preUpdate(update, req) : update
        ) as GptHistoryDocument;
      },
      queryFields: ["userId", "projectId"],
      queryFilter: (user) => ({userId: user?.id}),
      responseHandler: async (value, method, req, handlerOptions) => {
        const hostHandler = routerOptions.responseHandler ?? defaultResponseHandler;
        const serialized = await hostHandler(
          value,
          method as Parameters<typeof defaultResponseHandler>[1],
          req,
          handlerOptions
        );
        return (
          Array.isArray(serialized)
            ? serialized.map(withClientPendingAsk)
            : withClientPendingAsk(serialized)
        ) as JSONValue;
      },
      sort: "-updated",
      validation: withCallerUserId(routerOptions.validation),
    })
  );
};
