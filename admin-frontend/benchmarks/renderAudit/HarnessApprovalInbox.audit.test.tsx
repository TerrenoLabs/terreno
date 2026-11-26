import {describe, expect, it} from "bun:test";
import {act, fireEvent, waitFor} from "@testing-library/react-native";

import {
  componentStat,
  createRenderAudit,
  formatReport,
} from "../../../ui/benchmarks/renderAudit/renderAudit";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminRequestArgs} from "../../src/adminRequest";
import {HarnessApprovalInbox} from "../../src/widgets/harness/HarnessApprovalInbox";
import type {HarnessApprovalRow} from "../../src/widgets/harness/harnessApprovalTypes";

const approvals: HarnessApprovalRow[] = Array.from(
  {length: 10},
  (_, index): HarnessApprovalRow => ({
    _id: `a${index}`,
    created: "2026-01-01T00:00:00.000Z",
    definitionKey: "demo.approvalDemo@1:demo-signoff",
    id: `a${index}`,
    payload: {patientId: `p-${index}`},
    summary: "## Sign off\n\n- **Approve** files the note\n- **Reject** sends it back",
    title: `Approval ${index}`,
  })
);

describe("HarnessApprovalInbox renders", () => {
  it("re-renders the pending rows once per refetch, not on every inbox state change", async () => {
    const request = async (args: AdminRequestArgs): Promise<unknown> => {
      if (args.method === "GET") {
        // A real refetch parses new JSON, so every row object is a new identity.
        return {
          data: approvals.map((row) => ({...row})),
          limit: 100,
          more: false,
          page: 1,
          total: approvals.length,
        };
      }
      return {};
    };
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    let mounted: ReturnType<typeof renderWithTheme> | undefined;
    await audit.step("mount", async () => {
      mounted = renderWithTheme(<HarnessApprovalInbox request={request} />);
      await waitFor(() => {
        expect(mounted?.getByTestId("harness-approval-row-a1-clickable")).toBeTruthy();
      });
    });
    const view = mounted as ReturnType<typeof renderWithTheme>;
    await audit.step("same props", () => {
      view.rerender(<HarnessApprovalInbox request={request} />);
    });
    await audit.step("refresh", async () => {
      await act(async () => {
        fireEvent.press(view.getByTestId("harness-approvals-refresh"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    });
    await audit.step("open approval", async () => {
      await act(async () => {
        fireEvent.press(view.getByTestId("harness-approval-row-a1-clickable"));
      });
    });
    for (const text of ["n", "no", "not"]) {
      await audit.step(`type reason ${text}`, async () => {
        await act(async () => {
          fireEvent.changeText(view.getByTestId("harness-approval-reason"), text);
        });
      });
    }
    await audit.step("back to list", async () => {
      await act(async () => {
        fireEvent.press(view.getByTestId("harness-approval-back"));
      });
    });
    const report = audit.report();
    audit.dispose();
    view.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## HarnessApprovalInbox\n${formatReport(report, {limit: 25})}`);
    }
    expect(componentStat(report, "mount", "ApprovalRow")?.mounts).toBe(10);
    expect(componentStat(report, "same props", "ApprovalRow")).toBeUndefined();
    // Three commits (fetching on, notice, data in); only the one that brings new rows may reach them.
    expect(componentStat(report, "refresh", "ApprovalRow")?.updates ?? 0).toBeLessThanOrEqual(10);
  });
});
