import {APIError, logger} from "@terreno/api";
import {LocalEvaluatorStore} from "./local/evaluatorStore";
import {registerObsTrace} from "./local/models/obsTrace";
import {LocalReviewStore} from "./local/reviewStore";
import {LocalScoreSink, LocalTraceStore} from "./local/traceStore";
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
const THUMBS_SCORE_NAME = "thumbs_up";

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
const OUTCOMES = ["tp", "fp", "tn", "fn"] as const;

/** Score name for outcome class feedback (`tp` / `fp` / `tn` / `fn`). */
const OUTCOME_SCORE_NAME = "outcome";

interface ParsedFeedback {
  comment?: string;
  flagDataset?: boolean;
  outcome?: TraceFeedbackInput["outcome"];
  signal?: FeedbackSignal;
  thumbs?: "down" | "up" | null;
}

const badRequest = (title: string): APIError => {
  return new APIError({status: 400, title});
};

/** Validates the request body; the comment comes back trimmed. */
const parseInput = (input: unknown): ParsedFeedback => {
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

  const {flagDataset, outcome, signal, thumbs} = body;
  if (thumbs !== undefined && thumbs !== null && thumbs !== "up" && thumbs !== "down") {
    throw badRequest("thumbs must be 'up', 'down', or null");
  }
  if (outcome !== undefined && !(OUTCOMES as readonly unknown[]).includes(outcome)) {
    throw badRequest(`outcome must be one of ${OUTCOMES.join(", ")}`);
  }
  if (signal !== undefined && !(FEEDBACK_SIGNALS as readonly unknown[]).includes(signal)) {
    throw badRequest(`signal must be one of ${FEEDBACK_SIGNALS.join(", ")}`);
  }
  if (flagDataset !== undefined && typeof flagDataset !== "boolean") {
    throw badRequest("flagDataset must be a boolean");
  }
  const parsed: ParsedFeedback = {
    flagDataset: flagDataset as boolean | undefined,
    outcome: outcome as ParsedFeedback["outcome"],
    signal: signal as FeedbackSignal | undefined,
    thumbs: thumbs as ParsedFeedback["thumbs"],
  };

  if (body.comment === undefined) {
    return parsed;
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
  if (thumbs !== "up" && thumbs !== "down" && parsed.outcome === undefined) {
    throw badRequest("comment needs thumbs or outcome");
  }
  return {...parsed, comment};
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
  // The local store is the record the app reads, so its failure fails the request. Other sinks
  // are best-effort, like trace export: a vendor outage must not stop review queueing.
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      return;
    }
    if (sinks[index] instanceof LocalScoreSink) {
      throw result.reason;
    }
    logger.error("Feedback ScoreSink.export failed", {error: result.reason, name: score.name});
  });
};

/**
 * Queues a thumbs-down trace for human review against `feedbackReview.evaluatorName`, reusing an
 * open item. Never fails the feedback request: a bad evaluator is logged and skipped.
 */
const enqueueFeedbackReview = async (traceId: string): Promise<string | undefined> => {
  const evaluatorName = getObservabilityApp()?.feedbackReview?.evaluatorName;
  if (!evaluatorName) {
    return undefined;
  }
  try {
    const evaluator = await new LocalEvaluatorStore().getByName(evaluatorName);
    if (!evaluator) {
      logger.error("feedbackReview evaluator not found; thumbs down not queued", {evaluatorName});
      return undefined;
    }
    const reviewStore = new LocalReviewStore();
    const open = await reviewStore.findOpen({evaluatorId: evaluator.id, traceId});
    if (open) {
      return open.id;
    }
    const [item] = await reviewStore.enqueue({
      evaluatorId: evaluator.id,
      reason: "feedback",
      traceIds: [traceId],
    });
    return item?.id;
  } catch (error) {
    logger.error("Failed to queue thumbs-down trace for review", {error, evaluatorName, traceId});
    return undefined;
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
  const commentFields = input.comment ? {comment: input.comment} : {};

  if (input.thumbs === null) {
    await store.deleteFeedbackScore({
      name: THUMBS_SCORE_NAME,
      source: "user-feedback",
      traceId: args.traceId,
    });
  } else if (input.thumbs) {
    scores.push({
      dataType: "boolean",
      name: THUMBS_SCORE_NAME,
      source: "user-feedback",
      traceId: args.traceId,
      value: input.thumbs === "up",
      ...commentFields,
    });
  }
  if (input.outcome) {
    scores.push({
      dataType: "categorical",
      name: OUTCOME_SCORE_NAME,
      source: "user-feedback",
      traceId: args.traceId,
      value: input.outcome,
      ...commentFields,
    });
  }
  if (input.signal) {
    scores.push({
      dataType: "boolean",
      name: input.signal,
      source: "user-signal",
      traceId: args.traceId,
      value: true,
    });
  }
  for (const score of scores) {
    await exportToSinks(score, store);
  }

  let flaggedForDataset = Boolean(trace.flaggedForDataset);
  if (input.flagDataset !== undefined) {
    await registerObsTrace().updateOne(
      {_id: trace._id},
      {$set: {flaggedForDataset: input.flagDataset}}
    );
    flaggedForDataset = input.flagDataset;
  }

  const reviewItemId =
    input.thumbs === "down" ? await enqueueFeedbackReview(args.traceId) : undefined;

  return {
    flaggedForDataset,
    ...(reviewItemId ? {reviewItemId} : {}),
    scores,
    traceId: args.traceId,
  };
};
