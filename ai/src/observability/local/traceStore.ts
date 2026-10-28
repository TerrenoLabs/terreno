import {APIError} from "@terreno/api";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import type {ScoreRecord, ScoreSink, TraceRecord, TraceSink} from "../types";
import {registerObsScore} from "./models/obsScore";
import {registerObsSpan} from "./models/obsSpan";
import {registerObsTrace} from "./models/obsTrace";

export interface TraceListQuery {
  flaggedForDataset?: boolean;
  from?: string;
  hasScore?: boolean;
  limit?: number;
  page?: number;
  prompt?: string;
  promptVersion?: number;
  scope?: string;
  sensitive?: boolean;
  sessionId?: string;
  status?: "error" | "ok";
  to?: string;
  userId?: string;
}

export interface TraceSpanNode {
  children: TraceSpanNode[];
  durationMs?: number;
  endedAt?: string;
  error?: string;
  id: string;
  input?: unknown;
  kind: TraceRecord["spans"][number]["kind"];
  name: string;
  output?: unknown;
  parentSpanId?: string;
  sensitive?: boolean;
  startedAt: string;
  startOffsetMs?: number;
  status: "error" | "ok";
  usage?: TraceRecord["usage"];
}

export interface TraceDetail {
  endedAt?: string;
  errorSummary?: string;
  flaggedForDataset: boolean;
  id: string;
  input?: unknown;
  name: string;
  output?: unknown;
  prompts: TraceRecord["prompts"];
  scope?: string;
  scores: ScoreRecord[];
  sensitive: boolean;
  sessionId?: string;
  spans: TraceSpanNode[];
  startedAt: string;
  status: "error" | "ok";
  tags: string[];
  usage?: TraceRecord["usage"];
  userId?: string;
}

export interface TraceListItem {
  endedAt?: string;
  errorSummary?: string;
  flaggedForDataset: boolean;
  id: string;
  name: string;
  prompts: TraceRecord["prompts"];
  scope?: string;
  scoreCount: number;
  sensitive: boolean;
  sessionId?: string;
  spanCount: number;
  startedAt: string;
  status: "error" | "ok";
  tags: string[];
  usage?: TraceRecord["usage"];
  userId?: string;
}

const toIso = (value?: Date): string | undefined => {
  if (!value) {
    return undefined;
  }
  return DateTime.fromJSDate(value).toUTC().toISO() ?? undefined;
};

const parseDate = (value?: string): Date | undefined => {
  if (!value) {
    return undefined;
  }
  const parsed = DateTime.fromISO(value, {zone: "utc"});
  if (!parsed.isValid) {
    throw new APIError({status: 400, title: `Invalid datetime "${value}"`});
  }
  return parsed.toJSDate();
};

const objectIdOrUndefined = (value?: string): mongoose.Types.ObjectId | undefined => {
  if (!value || !mongoose.Types.ObjectId.isValid(value)) {
    return undefined;
  }
  return new mongoose.Types.ObjectId(value);
};

const firstErrorSummary = (trace: TraceRecord): string | undefined => {
  if (trace.errorSummary) {
    return trace.errorSummary;
  }
  const failed = trace.spans.find((span) => {
    return span.status === "error";
  });
  return failed?.error;
};

const usageWithoutUndefinedCost = (
  usage?: TraceRecord["usage"]
): TraceRecord["usage"] | undefined => {
  if (!usage) {
    return undefined;
  }
  const {costUsd, ...rest} = usage;
  if (costUsd === undefined) {
    return rest;
  }
  return usage;
};

const countByTraceId = async (
  model: mongoose.Model<mongoose.Document>,
  ids: mongoose.Types.ObjectId[]
): Promise<Map<string, number>> => {
  const counts = new Map<string, number>();
  if (ids.length === 0) {
    return counts;
  }
  const grouped = (await model.aggregate([
    {$match: {traceId: {$in: ids}}},
    {$group: {_id: "$traceId", n: {$sum: 1}}},
  ])) as Array<{_id: mongoose.Types.ObjectId; n: number}>;
  for (const row of grouped) {
    counts.set(String(row._id), row.n);
  }
  return counts;
};

export class LocalTraceStore {
  async exportTrace(trace: TraceRecord): Promise<{id: string}> {
    const ObsTrace = registerObsTrace();
    const ObsSpan = registerObsSpan();
    const userId = objectIdOrUndefined(trace.userId);
    const created = await ObsTrace.create({
      endedAt: parseDate(trace.endedAt),
      errorSummary: firstErrorSummary(trace),
      flaggedForDataset: trace.flaggedForDataset ?? false,
      input: trace.input,
      name: trace.name,
      output: trace.output,
      prompts: trace.prompts,
      sensitive: trace.sensitive,
      sessionId: trace.sessionId,
      startedAt: parseDate(trace.startedAt) ?? DateTime.utc().toJSDate(),
      status: trace.status,
      usage: usageWithoutUndefinedCost(trace.usage),
      ...(userId ? {userId} : {}),
    });
    const spanIds = new Map<string, mongoose.Types.ObjectId>();
    for (const span of trace.spans) {
      spanIds.set(span.id, new mongoose.Types.ObjectId());
    }
    for (const span of trace.spans) {
      const parentId = span.parentSpanId ? spanIds.get(span.parentSpanId) : undefined;
      await ObsSpan.create({
        durationMs: span.durationMs,
        endedAt: parseDate(span.endedAt),
        error: span.error,
        input: span.input,
        kind: span.kind,
        name: span.name,
        output: span.output,
        sensitive: span.sensitive,
        startedAt: parseDate(span.startedAt) ?? created.startedAt,
        startOffsetMs: span.startOffsetMs,
        status: span.status,
        traceId: created._id,
        usage: usageWithoutUndefinedCost(span.usage),
        ...(parentId ? {parentSpanId: parentId} : {}),
        _id: spanIds.get(span.id),
      });
    }
    return {id: String(created._id)};
  }

  async exportScore(score: ScoreRecord): Promise<void> {
    const traceId = objectIdOrUndefined(score.traceId);
    if (!traceId) {
      throw new APIError({status: 400, title: "score.traceId must be a trace id"});
    }
    const spanId = objectIdOrUndefined(score.spanId);
    const evaluatorId = objectIdOrUndefined(score.evaluatorId);
    await registerObsScore().create({
      comment: score.comment,
      confidence: score.confidence,
      dataType: score.dataType,
      name: score.name,
      source: score.source,
      traceId,
      value: score.value,
      ...(spanId ? {spanId} : {}),
      ...(evaluatorId ? {evaluatorId} : {}),
    });
  }

  async list(
    query: TraceListQuery
  ): Promise<{data: TraceListItem[]; meta: {limit: number; page: number; total: number}}> {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 100) : 20;
    const filter: Record<string, unknown> = {};
    if (query.status) {
      filter.status = query.status;
    }
    if (query.sessionId) {
      filter.sessionId = query.sessionId;
    }
    if (query.scope) {
      filter.scope = query.scope;
    }
    if (query.promptVersion !== undefined && !query.prompt) {
      throw new APIError({status: 400, title: "prompt is required when promptVersion is set"});
    }
    if (query.prompt && query.promptVersion !== undefined) {
      filter.prompts = {
        $elemMatch: {name: query.prompt, version: query.promptVersion},
      };
    } else if (query.prompt) {
      filter["prompts.name"] = query.prompt;
    }
    if (query.sensitive !== undefined) {
      filter.sensitive = query.sensitive;
    }
    if (query.flaggedForDataset !== undefined) {
      filter.flaggedForDataset = query.flaggedForDataset;
    }
    const userId = objectIdOrUndefined(query.userId);
    if (query.userId) {
      if (!userId) {
        throw new APIError({status: 400, title: "userId must be an object id"});
      }
      filter.userId = userId;
    }
    const from = parseDate(query.from);
    const to = parseDate(query.to);
    if (from || to) {
      filter.startedAt = {
        ...(from ? {$gte: from} : {}),
        ...(to ? {$lte: to} : {}),
      };
    }
    if (query.hasScore !== undefined) {
      const scoredIds = await registerObsScore().distinct("traceId");
      if (query.hasScore) {
        filter._id = {$in: scoredIds};
      } else {
        filter._id = {$nin: scoredIds};
      }
    }
    const ObsTrace = registerObsTrace();
    const total = await ObsTrace.countDocuments(filter);
    const rows = await ObsTrace.find(filter)
      .sort({created: -1})
      .skip((page - 1) * limit)
      .limit(limit);
    const ids = rows.map((row) => row._id);
    const spanCountById = await countByTraceId(registerObsSpan(), ids);
    const scoreCountById = await countByTraceId(registerObsScore(), ids);
    return {
      data: rows.map((row) => {
        const id = String(row._id);
        return this.toListItem(row, {
          scoreCount: scoreCountById.get(id) ?? 0,
          spanCount: spanCountById.get(id) ?? 0,
        });
      }),
      meta: {limit, page, total},
    };
  }

  async getDetail(id: string): Promise<TraceDetail> {
    const objectId = objectIdOrUndefined(id);
    if (!objectId) {
      throw new APIError({status: 404, title: `Unknown trace "${id}"`});
    }
    const trace = await registerObsTrace().findOneOrNone({_id: objectId});
    if (!trace) {
      throw new APIError({status: 404, title: `Unknown trace "${id}"`});
    }
    const spans = await registerObsSpan().find({traceId: trace._id}).sort({startOffsetMs: 1});
    const scores = await registerObsScore().find({traceId: trace._id}).sort({created: 1});
    return {
      ...this.toListItem(trace, {
        scoreCount: scores.length,
        spanCount: spans.length,
      }),
      input: trace.input,
      output: trace.output,
      scores: scores.map((score) => {
        return {
          comment: score.comment,
          confidence: score.confidence,
          dataType: score.dataType,
          evaluatorId: score.evaluatorId ? String(score.evaluatorId) : undefined,
          name: score.name,
          source: score.source,
          spanId: score.spanId ? String(score.spanId) : undefined,
          traceId: String(score.traceId),
          value: score.value,
        };
      }),
      spans: this.buildTree(spans),
    };
  }

  private toListItem(
    row: {
      _id: mongoose.Types.ObjectId;
      endedAt?: Date;
      errorSummary?: string;
      flaggedForDataset: boolean;
      name: string;
      prompts: TraceRecord["prompts"];
      scope?: string;
      sensitive: boolean;
      sessionId?: string;
      startedAt: Date;
      status: "error" | "ok";
      tags?: string[];
      usage?: TraceRecord["usage"];
      userId?: mongoose.Types.ObjectId;
    },
    counts: {scoreCount: number; spanCount: number}
  ): TraceListItem {
    return {
      endedAt: toIso(row.endedAt),
      errorSummary: row.errorSummary,
      flaggedForDataset: row.flaggedForDataset,
      id: String(row._id),
      name: row.name,
      prompts: row.prompts,
      scope: row.scope,
      scoreCount: counts.scoreCount,
      sensitive: row.sensitive,
      sessionId: row.sessionId,
      spanCount: counts.spanCount,
      startedAt: toIso(row.startedAt) ?? "",
      status: row.status,
      tags: row.tags ?? [],
      usage: usageWithoutUndefinedCost(row.usage),
      userId: row.userId ? String(row.userId) : undefined,
    };
  }

  private buildTree(
    spans: Array<{
      _id: mongoose.Types.ObjectId;
      durationMs?: number;
      endedAt?: Date;
      error?: string;
      input?: unknown;
      kind: TraceSpanNode["kind"];
      name: string;
      output?: unknown;
      parentSpanId?: mongoose.Types.ObjectId;
      sensitive?: boolean;
      startedAt: Date;
      startOffsetMs?: number;
      status: "error" | "ok";
      usage?: TraceRecord["usage"];
    }>
  ): TraceSpanNode[] {
    const nodes = new Map<string, TraceSpanNode>();
    for (const span of spans) {
      nodes.set(String(span._id), {
        children: [],
        durationMs: span.durationMs,
        endedAt: toIso(span.endedAt),
        error: span.error,
        id: String(span._id),
        input: span.input,
        kind: span.kind,
        name: span.name,
        output: span.output,
        parentSpanId: span.parentSpanId ? String(span.parentSpanId) : undefined,
        sensitive: span.sensitive,
        startedAt: toIso(span.startedAt) ?? "",
        startOffsetMs: span.startOffsetMs,
        status: span.status,
        usage: usageWithoutUndefinedCost(span.usage),
      });
    }
    const roots: TraceSpanNode[] = [];
    for (const node of nodes.values()) {
      if (node.parentSpanId && nodes.has(node.parentSpanId)) {
        nodes.get(node.parentSpanId)?.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }
}

export class LocalTraceSink implements TraceSink {
  readonly store: LocalTraceStore;

  constructor(store: LocalTraceStore = new LocalTraceStore()) {
    this.store = store;
  }

  export = async (trace: TraceRecord): Promise<{id: string}> => {
    return this.store.exportTrace(trace);
  };
}

export class LocalScoreSink implements ScoreSink {
  constructor(private readonly store: LocalTraceStore = new LocalTraceStore()) {}

  export = async (score: ScoreRecord): Promise<void> => {
    await this.store.exportScore(score);
  };
}

export class MemoryTraceSink implements TraceSink {
  readonly traces: TraceRecord[] = [];

  export(trace: TraceRecord): Promise<undefined> {
    this.traces.push(trace);
    return Promise.resolve(undefined);
  }
}

export class MemoryScoreSink implements ScoreSink {
  readonly scores: ScoreRecord[] = [];

  export(score: ScoreRecord): Promise<void> {
    this.scores.push(score);
    return Promise.resolve();
  }
}
