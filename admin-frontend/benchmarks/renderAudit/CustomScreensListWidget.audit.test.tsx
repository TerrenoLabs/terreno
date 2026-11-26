import {describe, expect, it} from "bun:test";

import {auditComponent} from "../../../ui/benchmarks/renderAudit/auditComponent";
import {componentStat} from "../../../ui/benchmarks/renderAudit/renderAudit";
import type {AdminConfigResponse, AdminHomeWidgetProps} from "../../src/types";
import {CustomScreensListWidget} from "../../src/widgets/CustomScreensListWidget";

const buildConfig = (): AdminConfigResponse => ({
  customScreens: Array.from({length: 8}, (_, index) => ({
    description: `Description ${index}`,
    displayName: `Screen ${index}`,
    name: `screen-${index}`,
  })),
  models: [],
  scripts: [],
});
const config = buildConfig();
const baseline: AdminHomeWidgetProps = {apiBase: "/admin", config, models: [], routeBase: "/admin"};

describe("CustomScreensListWidget renders", () => {
  it("keeps the screen cards when the parent re-renders", async () => {
    const report = await auditComponent({
      baseline,
      Component: CustomScreensListWidget,
      changes: {
        "new config object, same screens": {
          ...baseline,
          config: {...config, customScreens: [...(config.customScreens ?? [])]},
        },
        "new routeBase": {...baseline, routeBase: "/console"},
      },
      name: "CustomScreensListWidget",
    });

    expect(componentStat(report, "same props", "CustomScreenCard")).toBeUndefined();
    expect(
      componentStat(report, "new config object, same screens", "CustomScreenCard")
    ).toBeUndefined();
  });
});
