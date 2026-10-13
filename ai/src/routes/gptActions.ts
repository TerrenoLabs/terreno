import {
  APIError,
  asyncHandler,
  authenticateMiddleware,
  createOpenApiBuilder,
  logger,
} from "@terreno/api";
import {type BlocksDocument, validateBlocks} from "@terreno/blocks";
import type express from "express";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import {AIRequest} from "../models/aiRequest";
import {GptHistory} from "../models/gptHistory";
import type {GptRouteOptions, HostActionResult} from "../types";

/**
 * Host callbacks give up after this long unless `uiBlocks.actionTimeoutMs` sets another cap.
 * @internal Test seam. Production reads it only inside this module.
 */
export const HOST_ACTION_TIMEOUT_MS = 10_000;

const requestUserId = (req: express.Request): mongoose.Types.ObjectId | undefined =>
  (req.user as {_id?: mongoose.Types.ObjectId} | undefined)?._id;

const requiredString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const payloadFields = (
  issues: {message: string; path: PropertyKey[]}[]
): Record<string, string> => {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const path = issue.path.map(String).join(".") || "payload";
    fields[path] = issue.message;
  }
  return fields;
};

/** With `logResponse: false`, only a numeric `payload.value` joins the ids in the log. */
const loggedValue = (payload: unknown): {value?: number} => {
  const value = (payload as {value?: unknown} | undefined)?.value;
  return typeof value === "number" ? {value} : {};
};

const withTimeout = async <T>(work: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new APIError({status: 504, title: "Action timed out"}));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
};

const assertReturnedBlocks = (blocks: unknown): void => {
  let validated: ReturnType<typeof validateBlocks>;
  try {
    validated = validateBlocks(blocks as BlocksDocument);
  } catch (error) {
    throw new APIError({
      detail: error instanceof Error ? error.message : String(error),
      status: 500,
      title: "Action returned an invalid document",
    });
  }
  if (!validated.ok) {
    throw new APIError({
      meta: {
        fields: Object.fromEntries(
          validated.errors.map((error) => [error.path, `${error.code} ${error.message}`])
        ),
      },
      status: 500,
      title: "Action returned an invalid document",
    });
  }
};

const logAction = async ({
  error,
  prompt,
  response,
  responseTime,
  userId,
}: {
  error?: string;
  prompt: string;
  response?: string;
  responseTime: number;
  userId: mongoose.Types.ObjectId | undefined;
}): Promise<void> => {
  try {
    await AIRequest.logRequest({
      aiModel: "host-action",
      error,
      prompt,
      requestType: "ui_action",
      response,
      responseTime,
      userId,
    });
  } catch (logError) {
    logger.warn("Failed to log ui_action", {
      error: logError instanceof Error ? logError.message : String(logError),
    });
  }
};

/** Owner callback route. Mounted only when `uiBlocks` is on, under `/gpt` with the other chat routes. */
export const addGptActionRoutes = (router: express.Router, options: GptRouteOptions): void => {
  const uiBlocks = options.uiBlocks === true || !options.uiBlocks ? {} : options.uiBlocks;
  const timeoutMs = uiBlocks.actionTimeoutMs ?? HOST_ACTION_TIMEOUT_MS;

  router.post(
    "/gpt/actions",
    [
      authenticateMiddleware(),
      createOpenApiBuilder(options.openApiOptions ?? {})
        .withTags(["gpt"])
        .withSummary("Run a host callback from a block button")
        .withRequestBody({
          blockId: {type: "string"},
          elementId: {type: "string"},
          historyId: {type: "string"},
          messageId: {type: "string"},
          name: {type: "string"},
          payload: {type: "object"},
        })
        .withResponse(200, {
          blocks: {type: "object"},
          replace: {type: "string"},
          text: {type: "string"},
        })
        .build(),
    ],
    asyncHandler(async (req: express.Request, res: express.Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const {blockId, elementId, historyId, messageId, name, payload} = body;
      if (
        !requiredString(historyId) ||
        !requiredString(messageId) ||
        !requiredString(blockId) ||
        !requiredString(elementId) ||
        !requiredString(name)
      ) {
        throw new APIError({
          status: 400,
          title: "historyId, messageId, blockId, elementId, and name are required",
        });
      }

      if (!mongoose.Types.ObjectId.isValid(historyId)) {
        throw new APIError({status: 400, title: "historyId is not valid"});
      }
      const userId = requestUserId(req);
      const history = await GptHistory.findOneOrNone({_id: historyId, deleted: false});
      if (!history) {
        throw new APIError({status: 404, title: "History not found"});
      }
      if (history.userId.toString() !== userId?.toString()) {
        throw new APIError({status: 403, title: "Not authorized to access this history"});
      }

      const action = uiBlocks.hostActions?.[name];
      if (!action?.handler) {
        throw new APIError({status: 404, title: "Unknown action"});
      }

      let parsedPayload: unknown = payload ?? {};
      if (action.payload) {
        const parsed = action.payload.safeParse(parsedPayload);
        if (!parsed.success) {
          throw new APIError({
            meta: {fields: payloadFields(parsed.error.issues)},
            status: 400,
            title: "Invalid payload",
          });
        }
        parsedPayload = parsed.data;
      }

      const started = DateTime.now();
      const isResponseLogged = action.logResponse !== false;
      const prompt = JSON.stringify({
        blockId,
        elementId,
        historyId,
        messageId,
        name,
        ...(isResponseLogged ? {} : loggedValue(parsedPayload)),
      });
      let result: HostActionResult | undefined;
      try {
        result = await withTimeout(
          Promise.resolve(
            action.handler({
              blockId,
              elementId,
              history,
              messageId,
              payload: parsedPayload,
              user: {_id: userId},
            })
          ),
          timeoutMs
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await logAction({
          error: message,
          prompt,
          responseTime: DateTime.now().toMillis() - started.toMillis(),
          userId,
        });
        throw error;
      }

      if (
        result?.replace !== undefined &&
        result.replace !== "block" &&
        result.replace !== "message"
      ) {
        await logAction({
          error: "Action returned an unknown replace value",
          prompt,
          responseTime: DateTime.now().toMillis() - started.toMillis(),
          userId,
        });
        throw new APIError({status: 500, title: "Action returned an unknown replace value"});
      }
      if (result?.blocks !== undefined) {
        try {
          assertReturnedBlocks(result.blocks);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await logAction({
            error: message,
            prompt,
            responseTime: DateTime.now().toMillis() - started.toMillis(),
            userId,
          });
          throw error;
        }
      }

      const data = {
        ...(result?.blocks !== undefined ? {blocks: result.blocks} : {}),
        ...(result?.replace !== undefined ? {replace: result.replace} : {}),
        ...(result?.text !== undefined ? {text: result.text} : {}),
      };
      await logAction({
        prompt,
        response: isResponseLogged ? JSON.stringify(data) : undefined,
        responseTime: DateTime.now().toMillis() - started.toMillis(),
        userId,
      });
      return res.json({data});
    })
  );
};
