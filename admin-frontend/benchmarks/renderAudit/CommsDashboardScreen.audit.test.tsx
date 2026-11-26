import {afterAll, describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {useState} from "react";

mock.module("expo-router", () => ({
  router: {push: mock((): void => {}), replace: mock((): void => {})},
  useLocalSearchParams: (): Record<string, string> => ({}),
}));

import {
  componentStat,
  createRenderAudit,
  formatReport,
} from "../../../ui/benchmarks/renderAudit/renderAudit";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {AdminProvider} from "../../src/AdminProvider";
import {CommsDashboardScreen} from "../../src/comms/CommsDashboardScreen";
import type {CommsDashboardFilters} from "../../src/comms/commsDashboardParams";

const ROW_COUNT = 10;
const listBody = {
  data: Array.from({length: ROW_COUNT}, (_, index) => ({
    _id: `m${index}`,
    attemptCount: 1,
    channel: "mail",
    created: "2026-08-20T00:00:00.000Z",
    errorCode: index % 2 === 0 ? "timeout" : undefined,
    provider: "sendgrid",
    retryable: index % 2 === 0,
    status: index % 2 === 0 ? "failed" : "delivered",
    subject: `Subject ${index}`,
    to: "a***@example.com",
  })),
  limit: 20,
  more: true,
  page: 1,
  total: 60,
};
const statsBody = {
  buckets: [],
  byProvider: [
    {
      bounced: 0,
      delivered: 5,
      failed: 5,
      failureRate: 0.5,
      provider: "sendgrid",
      sent: 0,
      total: 10,
    },
    {bounced: 0, delivered: 9, failed: 0, failureRate: 0, provider: "twilio", sent: 0, total: 9},
  ],
  totals: {
    bounced: 0,
    cancelled: 0,
    delivered: 14,
    failed: 5,
    failureRate: 0.26,
    sent: 0,
    total: 19,
  },
};
const FIXED_DATES = {endDate: "2026-08-21T00:00:00.000Z", startDate: "2026-08-14T00:00:00.000Z"};

const originalFetch = globalThis.fetch;

const settle = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
};

// Holds the filters the way the URL-backed widget does: every change is a new object.
const Host: React.FC<{tick: number}> = () => {
  const [filters, setFilters] = useState<CommsDashboardFilters>(FIXED_DATES);
  return <CommsDashboardScreen filters={filters} onFiltersChange={setFilters} />;
};

describe("CommsDashboardScreen renders", () => {
  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("keeps the delivery log rows idle while the screen re-renders", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> =>
      new Response(JSON.stringify(String(input).includes("/comms/stats") ? statsBody : listBody), {
        headers: {"Content-Type": "application/json"},
        status: 200,
      })) as unknown as typeof fetch;
    const audit = createRenderAudit({
      ignore: /^(ThemeProvider|TerrenoFontProvider|AdminProvider|Host)$/,
    });
    const element = (tick: number): React.ReactElement => (
      <AdminProvider apiBase="/admin" credentials="same-origin" routeBase="/admin">
        <Host tick={tick} />
      </AdminProvider>
    );
    let mounted: ReturnType<typeof renderWithTheme> | undefined;
    await audit.step("mount", async () => {
      mounted = renderWithTheme(element(0));
      await settle();
    });
    const view = mounted as ReturnType<typeof renderWithTheme>;
    await audit.step("parent re-render", () => view.rerender(element(1)));
    await audit.step("open retry-matching modal", async () => {
      await act(async () => {
        fireEvent.press(view.getByTestId("comms-retry-many"));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    });
    await audit.step("type in provider filter", async () => {
      await act(async () => {
        fireEvent.changeText(view.getByTestId("comms-filter-provider"), "s");
      });
    });
    const report = audit.report();
    audit.dispose();
    view.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## CommsDashboardScreen\n${formatReport(report, {limit: 30})}`);
    }
    expect(componentStat(report, "mount", "DataTableRow")?.mounts).toBe(ROW_COUNT);
    // Changing a filter refetches and remounts the table, so only the steps that keep the same
    // page of data are budgeted.
    for (const step of ["parent re-render", "open retry-matching modal"]) {
      expect(componentStat(report, step, "DataTable")).toBeUndefined();
      expect(componentStat(report, step, "DataTableRow")).toBeUndefined();
      expect(componentStat(report, step, "DataTableCellComponent")).toBeUndefined();
      expect(componentStat(report, step, "CommsStatusBadge")).toBeUndefined();
    }
  });
});
