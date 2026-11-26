import {describe, expect, it} from "bun:test";

import {NotificationPreferences} from "../../src/NotificationPreferences";
import {auditComponent} from "./auditComponent";
import {componentStat} from "./renderAudit";

const preferences = {inapp: true, mail: true, push: false, sms: false};
const baseline = {onChange: (): void => {}, preferences};

describe("NotificationPreferences renders", () => {
  it("re-renders only the channel that was toggled", async () => {
    const report = await auditComponent({
      baseline,
      Component: NotificationPreferences,
      changes: {
        "equal preferences, new object": {...baseline, preferences: {...preferences}},
        "new onChange identity": {...baseline, onChange: (): void => {}},
        "one channel toggled": {...baseline, preferences: {...preferences, push: true}},
      },
      name: "NotificationPreferences",
    });

    expect(componentStat(report, "one channel toggled", "NotificationChannelRow")?.updates).toBe(1);
    expect(componentStat(report, "one channel toggled", "BooleanField")?.updates).toBe(1);
    expect(
      componentStat(report, "new onChange identity", "NotificationChannelRow")
    ).toBeUndefined();
    expect(
      componentStat(report, "equal preferences, new object", "NotificationChannelRow")
    ).toBeUndefined();
    expect(componentStat(report, "same props", "NotificationChannelRow")).toBeUndefined();
  });
});
