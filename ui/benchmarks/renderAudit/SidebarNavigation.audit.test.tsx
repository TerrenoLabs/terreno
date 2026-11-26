import {describe, expect, it} from "bun:test";

import type {SidebarNavigationItem, SidebarNavigationPanelProps} from "../../src/Common";
import {SidebarNavigationPanel} from "../../src/SidebarNavigation";
import {auditComponent} from "./auditComponent";
import {componentStat} from "./renderAudit";

const buildTopItems = (): SidebarNavigationItem[] =>
  Array.from({length: 8}, (_unused, index) => ({
    iconName: "house" as const,
    label: `Item ${index}`,
    route: `route-${index}`,
  }));
const buildBottomItems = (): SidebarNavigationItem[] => [
  {iconName: "gear", label: "Settings", route: "settings"},
  {badge: 3, iconName: "bell", label: "Alerts", route: "alerts"},
];
const topItems = buildTopItems();
const bottomItems = buildBottomItems();
const handleNavigate = (): void => {};
const baseline: SidebarNavigationPanelProps = {
  activeRoute: "route-0",
  bottomItems,
  children: null,
  onNavigate: handleNavigate,
  topItems,
};

describe("SidebarNavigationPanel renders", () => {
  it("re-renders only the items whose active state changed", async () => {
    const report = await auditComponent({
      baseline,
      Component: SidebarNavigationPanel,
      changes: {
        "active route changed": {...baseline, activeRoute: "route-3"},
        "new items arrays": {
          ...baseline,
          bottomItems: buildBottomItems(),
          topItems: buildTopItems(),
        },
        "new onNavigate identity": {...baseline, onNavigate: (): void => {}},
      },
      name: "SidebarNavigationPanel",
    });

    expect(componentStat(report, "mount", "SidebarItem")?.mounts).toBe(10);
    expect(componentStat(report, "active route changed", "SidebarItem")?.updates).toBe(2);
    expect(componentStat(report, "same props", "SidebarItem")).toBeUndefined();
    expect(componentStat(report, "new items arrays", "SidebarItem")).toBeUndefined();
    expect(componentStat(report, "new onNavigate identity", "SidebarItem")).toBeUndefined();
  });
});
