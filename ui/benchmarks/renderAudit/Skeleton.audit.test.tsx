import {describe, expect, it} from "bun:test";

import {SkeletonList} from "../../src/Skeleton";
import {auditComponent} from "./auditComponent";
import {componentStat} from "./renderAudit";

const baseline = {lines: 2, rows: 8, showAvatar: true, testID: "skeleton-list"};

describe("SkeletonList renders", () => {
  it("leaves existing rows alone when the list re-renders or gains a row", async () => {
    const report = await auditComponent({
      baseline,
      Component: SkeletonList,
      changes: {
        "animation changed": {...baseline, animation: "shimmer" as const},
        "one row added": {...baseline, rows: 9},
      },
      name: "SkeletonList",
    });

    expect(componentStat(report, "mount", "SkeletonRow")?.mounts).toBe(8);
    expect(componentStat(report, "same props", "SkeletonRow")).toBeUndefined();
    expect(componentStat(report, "one row added", "SkeletonRow")?.mounts).toBe(1);
    expect(componentStat(report, "one row added", "SkeletonRow")?.updates).toBe(0);
    expect(componentStat(report, "animation changed", "SkeletonRow")?.updates).toBe(8);
  });
});
