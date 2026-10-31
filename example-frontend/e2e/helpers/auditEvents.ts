import {type APIRequestContext, expect} from "@playwright/test";

export interface AuditEventRow {
  _id: string;
  after?: Record<string, unknown>;
  before?: Record<string, unknown>;
  modelName: string;
  operation?: string;
  recordId?: string;
  recordLabel?: string;
  source: "admin" | "modelRouter" | "rbac" | "security";
  verb: "created" | "deleted" | "updated";
}

const apiUrl = (): string => process.env.BACKEND_URL ?? "http://localhost:4000";

export const listAuditEvents = async ({
  query = {},
  request,
  token,
}: {
  query?: Record<string, string>;
  request: APIRequestContext;
  token: string;
}): Promise<AuditEventRow[]> => {
  const params = new URLSearchParams({limit: "50", sort: "-created", ...query});
  const response = await request.get(`${apiUrl()}/audit-events?${params.toString()}`, {
    headers: {authorization: `Bearer ${token}`},
  });
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as {data?: AuditEventRow[]};
  return Array.isArray(body.data) ? body.data : [];
};

export interface AuditEventMatch {
  modelName?: string;
  recordId?: string;
  recordLabel?: string;
  source: AuditEventRow["source"];
  verb: AuditEventRow["verb"];
}

const matchesAuditEvent = (event: AuditEventRow, match: AuditEventMatch): boolean => {
  if (event.verb !== match.verb) {
    return false;
  }
  if (event.source !== match.source) {
    return false;
  }
  if (match.modelName && event.modelName !== match.modelName) {
    return false;
  }
  if (match.recordId && event.recordId !== match.recordId) {
    return false;
  }
  if (match.recordLabel && event.recordLabel !== match.recordLabel) {
    return false;
  }
  return true;
};

/** Poll until an AuditApp row matching `match` exists (audit writes are fire-and-forget). */
export const waitForAuditEvent = async ({
  match,
  request,
  timeout = 15_000,
  token,
}: {
  match: AuditEventMatch;
  request: APIRequestContext;
  timeout?: number;
  token: string;
}): Promise<AuditEventRow> => {
  let found: AuditEventRow | undefined;
  await expect
    .poll(
      async () => {
        const events = await listAuditEvents({
          query: {
            ...(match.modelName ? {modelName: match.modelName} : {}),
            ...(match.recordId ? {recordId: match.recordId} : {}),
          },
          request,
          token,
        });
        found = events.find((event) => matchesAuditEvent(event, match));
        return found !== undefined;
      },
      {timeout}
    )
    .toBe(true);
  if (!found) {
    throw new Error(`Audit event not found: ${JSON.stringify(match)}`);
  }
  return found;
};

export const listAuditEventsForRecord = async ({
  recordId,
  request,
  token,
}: {
  recordId: string;
  request: APIRequestContext;
  token: string;
}): Promise<AuditEventRow[]> => {
  return listAuditEvents({
    query: {modelName: "Todo", recordId},
    request,
    token,
  });
};
