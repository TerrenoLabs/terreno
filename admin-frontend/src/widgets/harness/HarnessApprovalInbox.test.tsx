import {beforeEach, describe, expect, it} from "bun:test";
import {act, fireEvent, waitFor} from "@testing-library/react-native";
import {DateTime} from "luxon";
import React from "react";
import {renderWithTheme} from "../../../../ui/src/test-utils";
import {AdminWidgetContext} from "../../adminContext";
import {AdminAPIError, type AdminRequestArgs} from "../../adminRequest";
import type {AdminProviderValue} from "../../types";
import {HarnessApprovalInbox} from "./HarnessApprovalInbox";
import type {HarnessApprovalRow} from "./harnessApprovalTypes";

// The UI test preload freezes Date.now, so build times inside each test, not at import.
const makeFirst = (): HarnessApprovalRow => ({
  _id: "a1",
  created: DateTime.now().minus({minutes: 5}).toISO() ?? "",
  definitionKey: "demo.approvalDemo@1:demo-signoff",
  expiresAt: DateTime.now().plus({days: 1}).toISO() ?? "",
  id: "a1",
  payload: {patientId: "p-1"},
  summary: "## Sign off\n\n- **Approve** files the note",
  title: "Sign off intake summary",
});

const makeSecond = (): HarnessApprovalRow => ({
  _id: "a2",
  created: DateTime.now().minus({minutes: 5}).toISO() ?? "",
  definitionKey: "clinic.intake@2:review",
  id: "a2",
  summary: "Plain summary text",
  title: "Second approval",
});

let SECOND: HarnessApprovalRow;

type Responder = (args: AdminRequestArgs) => Promise<unknown>;

let calls: AdminRequestArgs[];
let pending: HarnessApprovalRow[];
let onDecide: Responder | undefined;

let more: boolean;

// A fresh client per test: useAdminRpc keys refetch listeners by client, so a shared one
// would let a leaked view from one test refetch during another.
const makeRequest =
  () =>
  async (args: AdminRequestArgs): Promise<unknown> => {
    calls.push(args);
    if (args.method === "GET") {
      return {data: pending, limit: 100, more, page: 1, total: pending.length};
    }
    if (onDecide) {
      return onDecide(args);
    }
    const id = args.url.split("/")[3];
    pending = pending.filter((approval) => approval.id !== id);
    return {id, status: args.url.endsWith("/approve") ? "approved" : "rejected"};
  };

let request: ReturnType<typeof makeRequest>;

const getCalls = (): AdminRequestArgs[] => calls.filter(({method}) => method === "GET");
const postCalls = (): AdminRequestArgs[] => calls.filter(({method}) => method === "POST");

const renderInbox = () => renderWithTheme(<HarnessApprovalInbox request={request} />);

const openFirst = async (view: ReturnType<typeof renderInbox>): Promise<void> => {
  await waitFor(() => {
    expect(view.getByTestId("harness-approval-row-a1-clickable")).toBeTruthy();
  });
  await act(async () => {
    fireEvent.press(view.getByTestId("harness-approval-row-a1-clickable"));
  });
};

describe("HarnessApprovalInbox", () => {
  beforeEach(() => {
    calls = [];
    SECOND = makeSecond();
    more = false;
    request = makeRequest();
    pending = [makeFirst(), SECOND];
    onDecide = undefined;
  });

  it("lists pending approvals with title, task, age, and expiry", async () => {
    const view = renderInbox();
    expect(view.getByTestId("harness-approvals-loading")).toBeTruthy();
    await waitFor(() => {
      expect(view.getByTestId("harness-approvals-list")).toBeTruthy();
    });
    expect(getCalls()[0]?.url).toBe("/harness/approvals?limit=100");
    expect(view.getByText("Sign off intake summary")).toBeTruthy();
    expect(view.getByText("demo.approvalDemo@1 · requested 5 minutes ago")).toBeTruthy();
    expect(view.getByText(/^Expires /)).toBeTruthy();
    expect(view.getByText("clinic.intake@2 · requested 5 minutes ago")).toBeTruthy();
    expect(view.getByText("No expiry")).toBeTruthy();
  });

  it("shows the empty state when nothing is pending", async () => {
    pending = [];
    const view = renderInbox();
    await waitFor(() => {
      expect(view.getByTestId("harness-approvals-empty")).toBeTruthy();
    });
    expect(view.getByText("Nothing to approve.")).toBeTruthy();
  });

  it("shows the API error title and retries", async () => {
    let fail = true;
    const failingRequest = async (args: AdminRequestArgs): Promise<unknown> => {
      calls.push(args);
      if (fail) {
        throw new AdminAPIError({status: 500, title: "Harness unavailable"});
      }
      return {data: []};
    };
    const view = renderWithTheme(<HarnessApprovalInbox request={failingRequest} />);
    await waitFor(() => {
      expect(view.getByTestId("harness-approvals-error")).toBeTruthy();
    });
    expect(view.getByText("Harness unavailable")).toBeTruthy();
    fail = false;
    await act(async () => {
      fireEvent.press(view.getByText("Try again"));
    });
    await waitFor(() => {
      expect(view.getByTestId("harness-approvals-empty")).toBeTruthy();
    });
  });

  it("shows the detail with markdown summary and pretty JSON payload", async () => {
    const view = renderInbox();
    await openFirst(view);
    expect(view.getByTestId("harness-approval-detail")).toBeTruthy();
    expect(view.getByTestId("harness-approval-title")).toBeTruthy();
    expect(view.getByText("Sign off")).toBeTruthy();
    expect(view.queryByText(/## Sign off/)).toBeNull();
    expect(view.getByText(JSON.stringify({patientId: "p-1"}, null, 2))).toBeTruthy();

    await act(async () => {
      fireEvent.press(view.getByTestId("harness-approval-back"));
    });
    expect(view.getByTestId("harness-approvals-list")).toBeTruthy();
  });

  it("renders a plain summary as text and omits an absent payload", async () => {
    const view = renderInbox();
    await waitFor(() => {
      expect(view.getByTestId("harness-approval-row-a2-clickable")).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("harness-approval-row-a2-clickable"));
    });
    expect(view.getByText("Plain summary text")).toBeTruthy();
    expect(view.queryByTestId("harness-approval-payload")).toBeNull();
    expect(view.getByText("No expiry")).toBeTruthy();
  });

  it("approves without a reason, returns to the refreshed list, and confirms", async () => {
    const view = renderInbox();
    await openFirst(view);
    await act(async () => {
      fireEvent.changeText(view.getByTestId("harness-approval-reason"), "   ");
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("harness-approval-approve"));
    });
    await waitFor(() => {
      expect(view.getByTestId("harness-approvals-notice")).toBeTruthy();
    });
    expect(postCalls()).toEqual([{body: {}, method: "POST", url: "/harness/approvals/a1/approve"}]);
    expect(view.getByText('Approved "Sign off intake summary".')).toBeTruthy();
    await waitFor(() => {
      expect(view.queryByTestId("harness-approval-row-a1-clickable")).toBeNull();
    });
    expect(getCalls().length).toBe(2);
    expect(view.getByTestId("harness-approval-row-a2-clickable")).toBeTruthy();
  });

  it("requires a reason to reject, then sends it trimmed", async () => {
    const view = renderInbox();
    await openFirst(view);
    await act(async () => {
      fireEvent.press(view.getByTestId("harness-approval-reject"));
    });
    expect(view.getByText("A reason is required to reject.")).toBeTruthy();
    expect(postCalls()).toEqual([]);

    await act(async () => {
      fireEvent.changeText(view.getByTestId("harness-approval-reason"), "  Wrong patient  ");
    });
    expect(view.queryByText("A reason is required to reject.")).toBeNull();
    await act(async () => {
      fireEvent.press(view.getByTestId("harness-approval-reject"));
    });
    await waitFor(() => {
      expect(view.getByText('Rejected "Sign off intake summary".')).toBeTruthy();
    });
    expect(postCalls()).toEqual([
      {body: {reason: "Wrong patient"}, method: "POST", url: "/harness/approvals/a1/reject"},
    ]);
  });

  it("treats 409 as already decided: back to the list with a notice and a refresh", async () => {
    onDecide = async () => {
      pending = [SECOND];
      throw new AdminAPIError({
        detail: "Approval a1 is already approved",
        status: 409,
        title: "Approval can no longer be decided",
      });
    };
    const view = renderInbox();
    await openFirst(view);
    await act(async () => {
      fireEvent.press(view.getByTestId("harness-approval-approve"));
    });
    await waitFor(() => {
      expect(view.getByTestId("harness-approvals-notice")).toBeTruthy();
    });
    expect(view.getByText(/already decided, expired, or its task ended/)).toBeTruthy();
    await waitFor(() => {
      expect(view.queryByTestId("harness-approval-row-a1-clickable")).toBeNull();
    });
    expect(getCalls().length).toBe(2);
  });

  it("keeps the detail open and shows the API error title on other failures", async () => {
    onDecide = async () => {
      throw new AdminAPIError({status: 403, title: "Access denied"});
    };
    const view = renderInbox();
    await openFirst(view);
    await act(async () => {
      fireEvent.press(view.getByTestId("harness-approval-approve"));
    });
    await waitFor(() => {
      expect(view.getByTestId("harness-approval-error")).toBeTruthy();
    });
    expect(view.getByText("Access denied")).toBeTruthy();
    expect(view.getByTestId("harness-approval-detail")).toBeTruthy();
  });

  it("refreshes the list on demand", async () => {
    const view = renderInbox();
    await waitFor(() => {
      expect(view.getByTestId("harness-approvals-list")).toBeTruthy();
    });
    pending = [];
    await act(async () => {
      fireEvent.press(view.getByTestId("harness-approvals-refresh"));
    });
    await waitFor(() => {
      expect(view.getByTestId("harness-approvals-empty")).toBeTruthy();
    });
  });

  it("uses the AdminProvider request client and a custom baseUrl", async () => {
    const value = {adminRpc: request} as unknown as AdminProviderValue;
    const view = renderWithTheme(
      <AdminWidgetContext.Provider value={value}>
        <HarnessApprovalInbox baseUrl="/ops/harness/" />
      </AdminWidgetContext.Provider>
    );
    await waitFor(() => {
      expect(view.getByTestId("harness-approvals-list")).toBeTruthy();
    });
    expect(getCalls()[0]?.url).toBe("/ops/harness/approvals?limit=100");
  });

  it("shows the heading unless the host page already titles the screen", async () => {
    const titled = renderInbox();
    expect(titled.getByText("Approvals")).toBeTruthy();
    const untitled = renderWithTheme(
      <HarnessApprovalInbox request={request} showHeading={false} />
    );
    expect(untitled.queryByText("Approvals")).toBeNull();
    await waitFor(() => {
      expect(untitled.getByTestId("harness-approvals-list")).toBeTruthy();
      expect(titled.getByTestId("harness-approvals-list")).toBeTruthy();
    });
    titled.unmount();
    untitled.unmount();
  });

  it("says when more approvals exist than the first page shows", async () => {
    more = true;
    const view = renderInbox();
    await waitFor(() => {
      expect(view.getByTestId("harness-approvals-more")).toBeTruthy();
    });
    expect(view.getByText("Showing the oldest 100. Decide some to see the rest.")).toBeTruthy();
  });

  it("disables both buttons while a decision is in flight, so it is sent once", async () => {
    let settle: (value: unknown) => void = () => {};
    onDecide = () =>
      new Promise((resolve) => {
        settle = resolve;
      });
    const view = renderInbox();
    await openFirst(view);
    await act(async () => {
      fireEvent.press(view.getByTestId("harness-approval-approve"));
    });
    const approve = view.getByTestId("harness-approval-approve");
    const reject = view.getByTestId("harness-approval-reject");
    expect(approve.props.accessibilityState?.disabled ?? approve.props.disabled).toBe(true);
    expect(reject.props.accessibilityState?.disabled ?? reject.props.disabled).toBe(true);
    await act(async () => {
      fireEvent.press(view.getByTestId("harness-approval-reject"));
    });
    expect(postCalls()).toHaveLength(1);
    await act(async () => {
      settle({id: "a1", status: "approved"});
    });
    await waitFor(() => {
      expect(view.getByTestId("harness-approvals-notice")).toBeTruthy();
    });
  });

  it("renders a markdown string payload as markdown", async () => {
    pending = [{...SECOND, payload: "**Chart** for `p-2`"}];
    const view = renderInbox();
    await waitFor(() => {
      expect(view.getByTestId("harness-approval-row-a2-clickable")).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("harness-approval-row-a2-clickable"));
    });
    expect(view.getByText("Chart")).toBeTruthy();
    expect(view.queryByText("**Chart** for `p-2`")).toBeNull();
  });

  it("explains a missing request client", () => {
    const view = renderWithTheme(<HarnessApprovalInbox />);
    expect(view.getByTestId("harness-approvals-unavailable")).toBeTruthy();
  });
});
