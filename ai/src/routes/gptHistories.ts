import {type ModelRouterOptions, modelRouter, Permissions} from "@terreno/api";
import type express from "express";
import {GptHistory} from "../models/gptHistory";
import type {GptHistoryDocument, GptHistoryRouteOptions} from "../types";

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

const mergeFragments = (base: OpenApiFragment, extra: OpenApiFragment = {}): OpenApiFragment => {
  const merged = {...base};
  for (const [key, value] of Object.entries(extra)) {
    const current = merged[key];
    merged[key] = isFragment(current) && isFragment(value) ? mergeFragments(current, value) : value;
  }
  return merged;
};

export const addGptHistoryRoutes = (
  router: express.Router,
  options?: Partial<ModelRouterOptions<GptHistoryDocument>> & GptHistoryRouteOptions
): void => {
  router.use(
    "/gpt/histories",
    modelRouter(GptHistory, {
      ...options,
      openApiOverwrite: {
        ...options?.openApiOverwrite,
        create: mergeFragments(READ_ONLY_PENDING_ASK, options?.openApiOverwrite?.create),
        update: mergeFragments(READ_ONLY_PENDING_ASK, options?.openApiOverwrite?.update),
      },
      permissions: {
        create: [Permissions.IsAuthenticated],
        delete: [Permissions.IsOwner],
        list: [Permissions.IsAuthenticated],
        read: [Permissions.IsOwner],
        update: [Permissions.IsOwner],
      },
      preCreate: (body, req) => {
        return {
          ...withoutPendingAsk(body),
          userId: (req.user as {_id: unknown})?._id,
        } as GptHistoryDocument;
      },
      preUpdate: (body, req) => {
        const update = withoutPendingAsk(body);
        return options?.preUpdate ? options.preUpdate(update, req) : (update as GptHistoryDocument);
      },
      queryFields: ["userId", "projectId"],
      queryFilter: (user) => ({userId: user?.id}),
      sort: "-updated",
    })
  );
};
