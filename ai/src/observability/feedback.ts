import {APIError} from "@terreno/api";

import {registerObsTrace} from "./local/models/obsTrace";
import {LocalTraceStore} from "./local/traceStore";
import {getObservabilityApp} from "./observabilityAppRegistry";
import type {ScoreRecord, ScoreSink} from "./types";

/** Passive signals a product can record about what a user did with an AI output. */
export const FEEDBACK_SIGNALS = [
  "accepted",
  "dismissed",
  "copied",
  "edited",
  "regenerated",
] as const;
export type FeedbackSignal = (typeof FEEDBACK_SIGNALS)[number];

export const FEEDBACK_COMMENT_MAX_LENGTH = 2000;

/** Score name for explicit thumbs; `true` is up. */
export const THUMBS_SCORE_NAME = "thumbs_up";

export interface TraceFeedbackInput {
  comment?: string;
  flagDataset?: boolean;
  outcome?: "fn" | "fp" | "tn" | "tp";
  signal?: FeedbackSignal;
  thumbs?: "down" | "up" | null;
}

export interface TraceFeedbackResult {
  flaggedForDataset: boolean;
  reviewItemId?: string;
  scores: ScoreRecord[];
  traceId: string;
}

const TRACE_ID_PATTERN = /^[0-9a-f]{24}$/i;
const KNOWN_FIELDS = new Set(["comment", "flagDataset", "outcome", "signal", "thumbs"]);
const NOT_YET_SUPPORTED: Array<keyof TraceFeedbackInput> = ["outcome", "signal", "flagDataset"];

const badRequest = (title: string): APIError => {
  return new APIError({status: 400, title});
};

/** Validates the request body and returns the trimmed comment, if any. */
const parseInput = (input: unknown): {comment?: string; thumbs?: "down" | "up" | null} => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw badRequest("feedback body must be an object");
  }
  const body = input as Record<string, unknown>;
  const keys = Object.keys(body).filter((key) => body[key] !== undefined);
  if (keys.length === 0) {
    throw badRequest("feedback needs thumbs, comment, outcome, signal, or flagDataset");
  }
  const unknownKey = keys.find((key) => !KNOWN_FIELDS.has(key));
  if (unknownKey) {
    throw badRequest(`Unknown feedback field "${unknownKey}"`);
  }
  for (const key of NOT_YET_SUPPORTED) {
    if (body[key] !== undefined) {
      throw badRequest("not supported yet");
    }
  }

  const thumbs = body.thumbs;
  if (thumbs !== undefined && thumbs !== null && thumbs !== "up" && thumbs !== "down") {
    throw badRequest("thumbs must be 'up', 'down', or null");
  }

  if (body.comment === undefined) {
    return {thumbs: thumbs as "down" | "up" | null | undefined};
  }
  if (typeof body.comment !== "string") {
    throw badRequest("comment must be a string");
  }
  const comment = body.comment.trim();
  if (!comment) {
    throw badRequest("comment must not be empty");
  }
  if (comment.length > FEEDBACK_COMMENT_MAX_LENGTH) {
    throw badRequest(`comment must be at most ${FEEDBACK_COMMENT_MAX_LENGTH} characters`);
  }
  if (thumbs !== "up" && thumbs !== "down") {
    throw badRequest("comment needs thumbs or outcome");
  }
  return {comment, thumbs};
};

/** Sends a score to every registered sink; the local sink upserts feedback scores. */
const exportToSinks = async (score: ScoreRecord, store: LocalTraceStore): Promise<void> => {
  const sinks: ScoreSink[] = getObservabilityApp()?.scoreSinks ?? [];
  if (sinks.length === 0) {
    await store.exportScore(score);
    return;
  }
  const results = await Promise.allSettled(
    sinks.map((sink) => {
      return sink.export(score);
    })
  );
  for (const result of results) {
    if (result.status === "rejected") {
      throw result.reason;
    }
  }
};

/**
 * Records an end user's feedback on a trace they own. Only the trace's own user may call it:
 * admins score traces through `POST /traces/:id/scores`, so `user-feedback` always means the
 * user said it.
 */
export const recordTraceFeedback = async (args: {
  input: TraceFeedbackInput;
  traceId: string;
  user: {admin?: boolean; id: string};
}): Promise<TraceFeedbackResult> => {
  if (!TRACE_ID_PATTERN.test(args.traceId)) {
    throw badRequest("trace id must be an object id");
  }
  const input = parseInput(args.input);
  const trace = await registerObsTrace().findOneOrNone({_id: args.traceId});
  if (!trace) {
    throw new APIError({status: 404, title: "Trace not found"});
  }
  if (!trace.userId || String(trace.userId) !== args.user.id) {
    throw new APIError({status: 403, title: "Only the trace's user can give feedback on it"});
  }

  const store = new LocalTraceStore();
  const scores: ScoreRecord[] = [];

  if (input.thumbs === null) {
    await store.deleteFeedbackScore({
      name: THUMBS_SCORE_NAME,
      source: "user-feedback",
      traceId: args.traceId,
    });
  } else if (input.thumbs) {
    const score: ScoreRecord = {
      dataType: "boolean",
      name: THUMBS_SCORE_NAME,
      source: "user-feedback",
      traceId: args.traceId,
      value: input.thumbs === "up",
      ...(input.comment ? {comment: input.comment} : {}),
    };
    await exportToSinks(score, store);
    scores.push(score);
  }

  return {
    flaggedForDataset: Boolean(trace.flaggedForDataset),
    scores,
    traceId: args.traceId,
  };
};
