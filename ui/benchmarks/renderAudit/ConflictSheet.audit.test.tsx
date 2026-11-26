import {describe, expect, it} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";

import {
  ConflictSheet,
  type ConflictSheetProps,
  type SyncConflictItem,
} from "../../src/ConflictSheet";
import {renderWithTheme} from "../../src/test-utils";
import {auditPropChanges, componentStat, createRenderAudit, formatReport} from "./renderAudit";

const buildConflicts = (): SyncConflictItem[] =>
  Array.from({length: 8}, (_, index) => ({
    collection: "todos",
    entityId: `todo-${index}`,
    localData: JSON.stringify({title: `Mine ${index}`, updated: "2026-01-02T15:04:00.000Z"}),
    mutationId: `m-${index}`,
    serverData: JSON.stringify({title: `Theirs ${index}`, updated: "2026-01-02T16:05:00.000Z"}),
  }));

const conflicts = buildConflicts();
const baseline: ConflictSheetProps = {
  conflicts,
  onDismiss: (): void => {},
  onResolve: (): void => {},
  visible: true,
};

describe("ConflictSheet renders", () => {
  it("re-renders only the conflict that changed", async () => {
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    let view: ReturnType<typeof renderWithTheme> | undefined;
    await auditPropChanges({
      audit,
      baseline,
      changes: {
        "new conflicts array": {...baseline, conflicts: [...conflicts]},
        "new onDismiss identity": {...baseline, onDismiss: (): void => {}},
        "new onResolve identity": {...baseline, onResolve: (): void => {}},
        "one conflict resolved": {...baseline, conflicts: conflicts.slice(1)},
      },
      mount: (props): void => {
        view = renderWithTheme(<ConflictSheet {...props} />);
      },
      update: (props): void => {
        view?.rerender(<ConflictSheet {...props} />);
      },
    });
    await audit.step("toggle one diff", async () => {
      await act(async () => {
        fireEvent.press(view!.getByTestId("conflict-diff-toggle-todo-3"));
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    });
    const report = audit.report();
    audit.dispose();
    view?.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## ConflictSheet\n${formatReport(report, {limit: 14})}`);
    }
    expect(componentStat(report, "mount", "ConflictItem")?.mounts).toBe(8);
    expect(componentStat(report, "same props", "ConflictItem")).toBeUndefined();
    expect(componentStat(report, "new conflicts array", "ConflictItem")).toBeUndefined();
    expect(componentStat(report, "new onResolve identity", "ConflictItem")).toBeUndefined();
    expect(componentStat(report, "one conflict resolved", "ConflictItem")).toBeUndefined();
    expect(componentStat(report, "toggle one diff", "ConflictItem")?.updates).toBe(1);
  });
});
