import {describe, expect, it, mock} from "bun:test";
import type {ScaledSize} from "react-native";
import {Text, useWindowDimensions} from "react-native";

import {auditComponent} from "../../../ui/benchmarks/renderAudit/auditComponent";
import {componentStat} from "../../../ui/benchmarks/renderAudit/renderAudit";
import type {AdminConfigResponse} from "../../src/types";

mock.module("expo-router", () => ({
  router: {push: (): void => {}},
}));

const MODEL_COUNT = 12;
const config = {
  customScreens: [{displayName: "Reports", name: "reports"}],
  models: Array.from({length: MODEL_COUNT}, (_, index) => ({
    defaultSort: "-created",
    displayName: `Model ${index}`,
    fields: {title: {required: true, type: "string"}},
    listFields: ["title"],
    name: `Model${index}`,
    routePath: `/admin/model${index}`,
  })),
  scripts: [{description: "Seed", name: "seed"}],
} as unknown as AdminConfigResponse;
const configResult = {config, error: null, isLoading: false};

mock.module("../../src/useAdminConfig", () => ({
  useAdminConfig: () => configResult,
}));

import {AdminShell, type AdminShellProps} from "../../src/AdminShell";

type WindowDimensionsImpl = () => ScaledSize;
const desktopDimensions: WindowDimensionsImpl = () => ({
  fontScale: 1,
  height: 1000,
  scale: 2,
  width: 1440,
});
(
  useWindowDimensions as WindowDimensionsImpl & {
    mockImplementation?: (impl: WindowDimensionsImpl) => void;
  }
).mockImplementation?.(desktopDimensions);

const breadcrumbs = [{label: "Admin"}, {label: "Model 3"}];
const baseline: AdminShellProps = {
  apiBase: "/admin",
  breadcrumbs,
  children: <Text>Screen one</Text>,
  configurationPath: "/configuration",
  rolesPath: "/roles",
  routeBase: "/admin",
};

describe("AdminShell renders", () => {
  it("keeps the sidebar links when the routed screen or breadcrumbs change", async () => {
    const report = await auditComponent({
      baseline,
      Component: AdminShell,
      changes: {
        "navigate: new children": {...baseline, children: <Text>Screen two</Text>},
        "new breadcrumbs": {...baseline, breadcrumbs: [{label: "Admin"}, {label: "Model 4"}]},
        "new equal breadcrumbs array": {...baseline, breadcrumbs: [...breadcrumbs]},
      },
      name: "AdminShell",
    });
    expect(componentStat(report, "mount", "AdminShell")?.mounts).toBe(1);
    expect(componentStat(report, "mount", "NavButton")?.mounts).toBeGreaterThanOrEqual(MODEL_COUNT);
    for (const step of [
      "same props",
      "navigate: new children",
      "new breadcrumbs",
      "new equal breadcrumbs array",
    ]) {
      expect(componentStat(report, step, "NavButton")).toBeUndefined();
      expect(componentStat(report, step, "AdminShellSidebarNav")).toBeUndefined();
      expect(componentStat(report, step, "AdminShellSidebarNavComponent")).toBeUndefined();
    }
  });
});
