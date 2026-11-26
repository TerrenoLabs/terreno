import {describe, expect, it} from "bun:test";

import {AIRequestExplorer, type AIRequestExplorerProps} from "../../src/AIRequestExplorer";
import {auditComponent} from "./auditComponent";
import {componentStat} from "./renderAudit";

const makeData = (): AIRequestExplorerProps["data"] =>
  Array.from({length: 8}, (_, index) => ({
    aiModel: "model-x",
    created: "2026-01-01T10:00:00.000Z",
    prompt: `Prompt ${index}`,
    requestType: "general",
    response: `Response ${index}`,
    responseTime: 100 + index,
    tokensUsed: 10 * index,
    user: {name: `User ${index}`},
  }));
const data = makeData();
const filter = ["general"];
const noop = (): void => {};
const baseline: AIRequestExplorerProps = {
  data,
  endDate: "2026-01-02T10:00:00.000Z",
  onEndDateChange: noop,
  onPageChange: noop,
  onRequestTypeFilterChange: noop,
  onStartDateChange: noop,
  page: 1,
  requestTypeFilter: filter,
  startDate: "2026-01-01T10:00:00.000Z",
  totalCount: 80,
  totalPages: 10,
};

describe("AIRequestExplorer renders", () => {
  it("leaves the table alone when only filters, callbacks, or the page change", async () => {
    const report = await auditComponent({
      baseline,
      Component: AIRequestExplorer,
      changes: {
        "filter changed": {...baseline, requestTypeFilter: ["general", "remix"]},
        "new callback identities": {
          ...baseline,
          onEndDateChange: (): void => {},
          onPageChange: (): void => {},
          onRequestTypeFilterChange: (): void => {},
          onStartDateChange: (): void => {},
        },
        "new equal data": {...baseline, data: makeData()},
        "page 1 to 2": {...baseline, page: 2},
      },
      name: "AIRequestExplorer",
    });

    // The table is the multiplying subtree: 8 rows x 9 cells. It re-renders only for new rows.
    for (const step of ["same props", "filter changed", "new callback identities", "page 1 to 2"]) {
      expect(componentStat(report, step, "DataTable")).toBeUndefined();
      expect(componentStat(report, step, "DataTableRow")).toBeUndefined();
    }
  });
});
