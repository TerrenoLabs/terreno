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
import {JobsDashboardScreen} from "../../src/jobs/JobsDashboardScreen";
import type {JobsDashboardFilters} from "../../src/jobs/jobsDashboardParams";

const ROW_COUNT = 10;
const SCHEDULE_COUNT = 8;
const listBody = {
  data: Array.from({length: ROW_COUNT}, (_, index) => ({
    _id: `j${index}`,
    attemptCount: index,
    created: "2026-08-20T00:00:00.000Z",
    lastError: index % 2 === 0 ? "boom" : undefined,
    name: `job-${index}`,
    runAt: "2026-08-20T00:00:00.000Z",
    status: index % 2 === 0 ? "dead" : "completed",
  })),
  more: true,
  page: 1,
  total: 60,
};
const statsBody = {data: {byStatus: {dead: 5, failed: 1, pending: 2, running: 3}, total: 11}};
const schedulesBody = {
  data: Array.from({length: SCHEDULE_COUNT}, (_, index) => ({
    _id: `s${index}`,
    cron: "0 * * * *",
    enabled: index % 2 === 0,
    name: `schedule-${index}`,
    nextRunAt: "2026-08-21T00:00:00.000Z",
    timezone: "UTC",
  })),
};

const originalFetch = globalThis.fetch;

const bodyFor = (url: string): unknown => {
  if (url.includes("/jobs/stats")) {
    return statsBody;
  }
  if (url.includes("/jobs/schedules")) {
    return schedulesBody;
  }
  return listBody;
};

const settle = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
};

// Holds the filters the way the URL-backed widget does: every change is a new object.
const Host: React.FC<{tick: number}> = () => {
  const [filters, setFilters] = useState<JobsDashboardFilters>({});
  return (
    <JobsDashboardScreen filters={filters} onFiltersChange={(next): void => setFilters(next)} />
  );
};

describe("JobsDashboardScreen renders", () => {
  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("keeps the job rows and schedules idle while the screen re-renders", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> =>
      new Response(JSON.stringify(bodyFor(String(input))), {
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
    await audit.step("type in name filter", async () => {
      await act(async () => {
        fireEvent.changeText(view.getByTestId("jobs-filter-name"), "d");
      });
      await settle();
    });
    const report = audit.report();
    audit.dispose();
    view.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## JobsDashboardScreen\n${formatReport(report, {limit: 200})}`);
    }
    expect(componentStat(report, "mount", "DataTableRow")?.mounts).toBe(ROW_COUNT);
    expect(componentStat(report, "mount", "ScheduleRowComponent")?.mounts).toBe(SCHEDULE_COUNT);
    // The host passes a new `onFiltersChange` on every render, the way an inline handler does.
    expect(componentStat(report, "parent re-render", "ScheduleRowComponent")).toBeUndefined();
    expect(componentStat(report, "parent re-render", "DataTable")).toBeUndefined();
    expect(componentStat(report, "parent re-render", "DataTableRow")).toBeUndefined();
    // Typing refetches the job list (the table remounts with the new page), but the schedules
    // did not change and must stay idle.
    expect(componentStat(report, "type in name filter", "ScheduleRowComponent")).toBeUndefined();
  });
});
