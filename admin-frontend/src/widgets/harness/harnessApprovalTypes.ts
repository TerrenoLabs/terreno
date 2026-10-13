import {DateTime} from "luxon";

/** A pending approval as `GET /harness/approvals` returns it (JSON of `HarnessApproval`). */
export interface HarnessApprovalRow {
  _id?: string;
  created?: string;
  definitionKey?: string;
  expiresAt?: string;
  id?: string;
  key?: string;
  payload?: unknown;
  status?: string;
  summary?: string;
  taskId?: string;
  title: string;
}

/** Default mount path of `HarnessApp` routes. */
export const DEFAULT_HARNESS_BASE_URL = "/harness";

export const approvalId = (approval: HarnessApprovalRow): string =>
  String(approval.id ?? approval._id ?? "");

/** Accepts the list envelope `{data: [...]}` or a bare array (custom base queries). */
export const unwrapApprovalList = (raw: unknown): HarnessApprovalRow[] => {
  if (Array.isArray(raw)) {
    return raw as HarnessApprovalRow[];
  }
  if (raw && typeof raw === "object" && Array.isArray((raw as {data?: unknown}).data)) {
    return (raw as {data: HarnessApprovalRow[]}).data;
  }
  return [];
};

/**
 * `definitionKey` is `name@version:key`; the task label is `name@version`. Falls back to the
 * whole key when it does not have that shape.
 */
export const taskLabel = (definitionKey?: string): string => {
  if (!definitionKey) {
    return "Unknown task";
  }
  const match = /^(.+@\d+):.+$/.exec(definitionKey);
  return match ? match[1] : definitionKey;
};

/** "3 minutes ago" for an ISO time; empty when missing or invalid. */
export const relativeTime = (iso?: string): string => {
  if (!iso) {
    return "";
  }
  const time = DateTime.fromISO(iso);
  if (!time.isValid) {
    return "";
  }
  return time.toRelative() ?? "";
};

/** Absolute local date and time for an ISO time; empty when missing or invalid. */
export const formatDateTime = (iso?: string): string => {
  if (!iso) {
    return "";
  }
  const time = DateTime.fromISO(iso);
  if (!time.isValid) {
    return "";
  }
  return time.toLocaleString(DateTime.DATETIME_MED);
};

const MARKDOWN_PATTERNS = [
  /^#{1,6}\s/m,
  /^\s*[-*+]\s+\S/m,
  /^\s*\d+\.\s+\S/m,
  /\*\*[^*]+\*\*/,
  /`[^`]+`/,
  /\[[^\]]+\]\([^)]+\)/,
];

/** Whether a summary reads as markdown (headings, lists, emphasis, code, or links). */
export const looksLikeMarkdown = (text: string): boolean =>
  MARKDOWN_PATTERNS.some((pattern) => pattern.test(text));

/** Pretty JSON for the payload panel; strings render as they are. */
export const formatPayload = (payload: unknown): string => {
  if (typeof payload === "string") {
    return payload;
  }
  try {
    return JSON.stringify(payload, null, 2) ?? "";
  } catch {
    return String(payload);
  }
};

export const hasPayload = (payload: unknown): boolean => {
  if (payload === undefined || payload === null) {
    return false;
  }
  if (typeof payload === "object" && Object.keys(payload as object).length === 0) {
    return false;
  }
  return true;
};

/** The status and title of a failed admin request (`AdminAPIError` shape). */
export const describeRequestError = (error: unknown): {status?: number; title: string} => {
  if (error && typeof error === "object") {
    const status = (error as {status?: unknown}).status;
    const title = (error as {data?: {title?: unknown}}).data?.title;
    if (typeof title === "string" && title.length > 0) {
      return {status: typeof status === "number" ? status : undefined, title};
    }
    if (error instanceof Error && error.message) {
      return {status: typeof status === "number" ? status : undefined, title: error.message};
    }
  }
  return {title: "Something went wrong"};
};
