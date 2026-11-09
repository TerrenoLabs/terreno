import {DateTime} from "luxon";

export interface JobAttemptRow {
  at?: string;
  error?: string;
  errorClass?: string;
}

export interface JobScheduleRow {
  _id?: string;
  cron?: string;
  enabled?: boolean;
  handlerName?: string;
  id?: string;
  name: string;
  nextRunAt?: string;
  timezone?: string;
}

export interface JobRow {
  _id?: string;
  attemptCount?: number;
  attempts?: JobAttemptRow[];
  created?: string;
  id?: string;
  lastError?: string;
  lockedAt?: string;
  lockedBy?: string;
  name: string;
  payload?: unknown;
  payloadRedacted?: boolean;
  retriedById?: string;
  retriedFromId?: string;
  runAt?: string;
  scheduleId?: string;
  status: string;
  updated?: string;
}

export interface JobsListResponse {
  data: JobRow[];
  limit: number;
  more: boolean;
  page: number;
  total: number;
}

/** Unwrapped stats payload from `useStatsQuery` after `unwrapAdminEnvelope` strips `{data}`. */
export interface JobsStats {
  byStatus: Record<string, number>;
  total: number;
}

/**
 * Reads a job row out of a dashboard response.
 *
 * Hosts differ in how they unwrap responses: the example app's Better Auth base query
 * strips `{data}` envelopes unless the body carries `more`, so detail and mutation hooks
 * yield the row itself while list responses stay wrapped. Accept both shapes.
 */
export const unwrapJobRow = (payload: unknown): JobRow | undefined => {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  if (record.data && typeof record.data === "object" && !Array.isArray(record.data)) {
    return unwrapJobRow(record.data);
  }
  const rawId = record._id ?? record.id;
  const id = typeof rawId === "string" ? rawId : rawId != null ? String(rawId) : "";
  if (id.length === 0) {
    return undefined;
  }
  return {...record, _id: id} as JobRow;
};

export const jobRowId = (row: JobRow): string => {
  return row._id ?? row.id ?? "";
};

export const formatJobTimestamp = ({
  empty = "",
  value,
}: {
  empty?: string;
  value?: string;
}): string => {
  if (!value) {
    return empty;
  }
  const parsed = DateTime.fromISO(value);
  if (!parsed.isValid) {
    return value;
  }
  return parsed.toLocal().toLocaleString(DateTime.DATETIME_MED);
};

export const canRetryJob = (job: JobRow): boolean => {
  if (job.retriedById) {
    return false;
  }
  return job.status === "dead" || job.status === "failed";
};

export const canRequeueJob = (job: JobRow): boolean => {
  if (job.retriedById) {
    return false;
  }
  return job.status === "dead" || job.status === "failed" || job.status === "cancelled";
};

export const canCancelJob = (job: JobRow): boolean => {
  return job.status === "pending" || job.status === "scheduled" || job.status === "running";
};
