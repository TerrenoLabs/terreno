import {describe, expect, it} from "bun:test";

import {NotificationInbox, type NotificationInboxItem} from "../../src/NotificationInbox";
import {auditComponent} from "./auditComponent";
import {componentStat} from "./renderAudit";

const items: NotificationInboxItem[] = Array.from({length: 8}, (_, index) => ({
  body: `Body ${index}`,
  created: "2026-01-01T00:00:00.000Z",
  id: `n-${index}`,
  readAt: index % 2 === 0 ? null : "2026-01-02T00:00:00.000Z",
  title: `Title ${index}`,
}));
const noop = (): void => {};
const baseline = {
  items,
  onDismiss: noop,
  onMarkRead: noop,
  onMarkUnread: noop,
  onOpen: noop,
};

describe("NotificationInbox renders", () => {
  it("re-renders only the notification that changed", async () => {
    const report = await auditComponent({
      baseline,
      Component: NotificationInbox,
      changes: {
        "equal items, new array": {...baseline, items: [...items]},
        "new handler identities": {
          ...baseline,
          onDismiss: (): void => {},
          onMarkRead: (): void => {},
          onMarkUnread: (): void => {},
          onOpen: (): void => {},
        },
        "one item marked read": {
          ...baseline,
          items: items.map((item, index) =>
            index === 2 ? {...item, readAt: "2026-01-03T00:00:00.000Z"} : item
          ),
        },
      },
      name: "NotificationInbox",
    });

    expect(componentStat(report, "one item marked read", "NotificationInboxRow")?.updates).toBe(1);
    expect(componentStat(report, "equal items, new array", "NotificationInboxRow")).toBeUndefined();
    expect(componentStat(report, "new handler identities", "NotificationInboxRow")).toBeUndefined();
    expect(componentStat(report, "same props", "NotificationInboxRow")).toBeUndefined();
  });
});
