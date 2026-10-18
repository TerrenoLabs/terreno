import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";

const pushMock = mock(() => {});
mock.module("expo-router", () => ({
  router: {push: pushMock, replace: mock(() => {})},
}));

interface FakeResponse {
  body?: unknown;
  pending?: boolean;
  status?: number;
}

interface FakeRequest {
  body: unknown;
  method: string;
  path: string;
}

interface DetailState {
  /** Either the `{data}` envelope or a bare row. */
  data?: Record<string, unknown>;
  error?: unknown;
  isLoading: boolean;
}

const detailState: DetailState = {isLoading: false};
let retryImpl = mock((): FakeResponse => ({body: {data: {_id: "new-row"}}}));
const requests: FakeRequest[] = [];
const originalFetch = globalThis.fetch;

/** Serves the message detail and retry routes; AdminRefField lookups get a 404. */
const route = (request: FakeRequest): FakeResponse => {
  if (request.method === "GET" && /^\/comms\/messages\/[^/]+$/.test(request.path)) {
    if (detailState.isLoading) {
      return {pending: true};
    }
    if (detailState.error) {
      return {body: {title: "Server error"}, status: 500};
    }
    return {body: detailState.data ?? null};
  }
  if (request.method === "POST" && /^\/comms\/messages\/[^/]+\/retry$/.test(request.path)) {
    return retryImpl();
  }
  return {body: {title: "Not found"}, status: 404};
};

const installFetch = (): void => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const request: FakeRequest = {
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      method: init?.method ?? "GET",
      path: url.split("?")[0] ?? url,
    };
    requests.push(request);
    const response = route(request);
    if (response.pending) {
      return new Promise<Response>(() => undefined);
    }
    return new Response(JSON.stringify(response.body ?? {}), {
      headers: {"Content-Type": "application/json"},
      status: response.status ?? 200,
    });
  }) as typeof fetch;
};

const flush = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
};

import {AdminProvider} from "../AdminProvider";
import {CommsMessageDetail} from "./CommsMessageDetail";
import {formatCommsTimestamp} from "./commsMessagePayload";

const renderDetail = async (
  messageId = "m1",
  routeBase?: string
): Promise<ReturnType<typeof renderWithTheme>> => {
  const utils = renderWithTheme(
    <AdminProvider apiBase="/admin" credentials="same-origin" routeBase="/admin">
      <CommsMessageDetail messageId={messageId} routeBase={routeBase} />
    </AdminProvider>
  );
  await flush();
  return utils;
};

const confirmRetry = async (utils: Awaited<ReturnType<typeof renderDetail>>): Promise<void> => {
  await act(async () => {
    fireEvent.press(utils.getByTestId("comms-detail-retry"));
  });
  await act(async () => {
    const confirms = utils.getAllByText("Confirm");
    fireEvent.press(confirms[confirms.length - 1]);
  });
  await flush();
};

describe("CommsMessageDetail", () => {
  beforeEach(() => {
    installFetch();
    requests.length = 0;
    detailState.data = undefined;
    detailState.error = undefined;
    detailState.isLoading = false;
    pushMock.mockClear();
    retryImpl = mock((): FakeResponse => ({body: {data: {_id: "new-row"}}}));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("renders loading and error states", async () => {
    detailState.isLoading = true;
    const loading = await renderDetail();
    expect(loading.getByTestId("comms-detail-loading")).toBeTruthy();
    loading.unmount();

    detailState.isLoading = false;
    detailState.error = {status: 500};
    const errored = await renderDetail();
    expect(errored.getByTestId("comms-detail-error")).toBeTruthy();
  });

  it("shows the specific non-retryable reason on the retry control", async () => {
    detailState.data = {
      data: {
        _id: "m1",
        attempts: [
          {
            at: "2026-08-20T00:00:00.000Z",
            error: "invalid",
            errorCode: "550",
            provider: "sendgrid",
            providerMessageId: "sg-1",
          },
        ],
        channel: "mail",
        created: "2026-08-20T00:00:00.000Z",
        metadata: {consoleUrl: "https://sendgrid.example/activity/sg-1"},
        payload: {subject: "Hi"},
        provider: "sendgrid",
        retryable: false,
        retryDisabledReason: "Permanent failures cannot be retried",
        status: "failed",
        to: "a***@example.com",
      },
    };
    const {getByTestId, getByText} = await renderDetail();
    expect(requests[0]).toMatchObject({method: "GET", path: "/comms/messages/m1"});
    expect(getByTestId("comms-detail-retry").props.accessibilityState?.disabled).toBe(true);
    expect(getByTestId("comms-attempt-0")).toBeTruthy();
    expect(getByTestId("comms-detail-payload")).toBeTruthy();
    expect(
      getByText(`Created ${formatCommsTimestamp({empty: "—", value: "2026-08-20T00:00:00.000Z"})}`)
    ).toBeTruthy();
    expect(
      getByText(formatCommsTimestamp({empty: "—", value: "2026-08-20T00:00:00.000Z"}))
    ).toBeTruthy();
  });

  it("renders an unwrapped detail payload", async () => {
    detailState.data = {
      _id: "m1",
      attempts: [{at: "2026-08-20T00:00:00.000Z", provider: "sendgrid"}],
      channel: "mail",
      provider: "sendgrid",
      retryable: true,
      status: "failed",
      to: "a***@example.com",
    };
    const {getByTestId} = await renderDetail();
    expect(getByTestId("comms-detail-retry")).toBeTruthy();
    expect(getByTestId("comms-attempt-0")).toBeTruthy();
  });

  it("reports a missing message rather than an empty shell", async () => {
    detailState.data = undefined;
    const {getByTestId} = await renderDetail();
    expect(getByTestId("comms-detail-empty")).toBeTruthy();
  });

  it("links the retry chain, the user, and the provider console", async () => {
    detailState.data = {
      _id: "m2",
      attempts: [
        {
          at: "not-a-timestamp",
          provider: "sendgrid",
          providerMessageId: "sg-9",
        },
        {provider: "sendgrid"},
      ],
      channel: "mail",
      metadata: {consoleUrl: "https://sendgrid.example/activity/sg-9"},
      provider: "sendgrid",
      retriedById: "m3",
      retriedFromId: "m0",
      retryable: false,
      status: "bounced",
      to: "a***@example.com",
      userId: "user-1",
    };
    const {getByTestId} = await renderDetail("m2", "/admin");

    // An unparseable attempt timestamp is shown verbatim instead of crashing the timeline.
    expect(getByTestId("comms-attempt-0-console")).toBeTruthy();
    expect(getByTestId("comms-detail-user-card")).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByTestId("comms-detail-retried-from"));
    });
    expect(String(pushMock.mock.calls.at(-1)?.[0])).toBe("/admin/comms/m0");

    await act(async () => {
      fireEvent.press(getByTestId("comms-detail-retried-by"));
    });
    expect(String(pushMock.mock.calls.at(-1)?.[0])).toBe("/admin/comms/m3");
  });

  it("surfaces a rejected retry without navigating", async () => {
    detailState.data = {
      _id: "m1",
      channel: "mail",
      provider: "sendgrid",
      retryable: true,
      status: "failed",
      to: "a***@example.com",
    };
    retryImpl = mock(
      (): FakeResponse => ({body: {title: "Retained payload is missing or expired"}, status: 400})
    );
    const utils = await renderDetail();
    await confirmRetry(utils);
    expect(retryImpl).toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("treats a retry response without a row as a failure", async () => {
    detailState.data = {
      _id: "m1",
      channel: "mail",
      provider: "sendgrid",
      retryable: true,
      status: "failed",
      to: "a***@example.com",
    };
    retryImpl = mock((): FakeResponse => ({body: {}}));
    const utils = await renderDetail();
    await confirmRetry(utils);
    expect(retryImpl).toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("navigates to the new row after a confirmed retry", async () => {
    detailState.data = {
      data: {
        _id: "m1",
        channel: "mail",
        provider: "sendgrid",
        retryable: true,
        status: "failed",
        to: "a***@example.com",
      },
    };
    const utils = await renderDetail();
    await confirmRetry(utils);
    expect(requests.some((r) => r.method === "POST" && r.path === "/comms/messages/m1/retry")).toBe(
      true
    );
    expect(pushMock).toHaveBeenCalled();
    const href = String((pushMock.mock.calls[0] as unknown as [string])[0]);
    expect(href).toContain("/admin/comms/new-row");
  });
});
