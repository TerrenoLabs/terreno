import {describe, expect, it} from "bun:test";

import {auditComponent} from "../../../ui/benchmarks/renderAudit/auditComponent";
import {componentStat} from "../../../ui/benchmarks/renderAudit/renderAudit";
import {configureAdminModelApiDouble} from "../../src/testing/useAdminModelApiDouble";
import type {AdminHomeWidgetProps, AdminModelConfig} from "../../src/types";
import {RecentActivityWidget} from "../../src/widgets/RecentActivityWidget";

const auditModel = {
  displayName: "Audit log",
  fields: {},
  listFields: [],
  name: "AdminAuditLog",
  routePath: "/admin/audit",
} as unknown as AdminModelConfig;
const config = {customScreens: [], models: [], scripts: []};
const baseline: AdminHomeWidgetProps = {
  apiBase: "/admin",
  auditModel,
  config,
  models: [],
  routeBase: "/admin",
};
const listResult = {
  data: {
    data: Array.from({length: 8}, (_, index) => ({
      _id: `row-${index}`,
      created: "2026-01-01T12:00:00.000Z",
      modelName: "Todo",
      recordLabel: `Todo ${index}`,
      verb: "update",
    })),
    total: 8,
  },
  error: null,
  isError: false,
  isLoading: false,
};

describe("RecentActivityWidget renders", () => {
  it("keeps the audit entries when the parent re-renders", async () => {
    configureAdminModelApiDouble({useListQuery: () => listResult});
    const report = await auditComponent({
      baseline,
      Component: RecentActivityWidget,
      changes: {
        "new auditModel object": {...baseline, auditModel: {...auditModel}},
        "new routeBase": {...baseline, routeBase: "/console"},
      },
      name: "RecentActivityWidget",
    });

    expect(componentStat(report, "mount", "ActivityRow")?.mounts).toBe(8);
    for (const step of ["same props", "new auditModel object", "new routeBase"]) {
      expect(componentStat(report, step, "ActivityRow")).toBeUndefined();
    }
  });
});
