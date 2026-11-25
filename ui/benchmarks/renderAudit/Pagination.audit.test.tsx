import {describe, expect, it} from "bun:test";

import {Pagination} from "../../src/Pagination";
import {auditComponent} from "./auditComponent";
import {componentStat} from "./renderAudit";

const handleSetPage = (): void => {};
const baseline = {page: 1, setPage: handleSetPage, totalPages: 20};

describe("Pagination renders", () => {
  it("re-renders only the page numbers whose highlight moved", async () => {
    const report = await auditComponent({
      baseline,
      Component: Pagination,
      changes: {
        "new setPage identity": {...baseline, setPage: (): void => {}},
        "page 1 to 2": {...baseline, page: 2},
      },
      name: "Pagination",
    });

    expect(componentStat(report, "page 1 to 2", "PaginationNumber")?.updates).toBe(2);
    expect(componentStat(report, "new setPage identity", "PaginationNumber")).toBeUndefined();
    expect(componentStat(report, "same props", "PaginationNumber")).toBeUndefined();
  });
});
