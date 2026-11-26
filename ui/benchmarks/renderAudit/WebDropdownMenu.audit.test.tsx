import {describe, expect, it} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";

import {renderWithTheme} from "../../src/test-utils";
import {WebDropdownMenu, type WebDropdownMenuProps} from "../../src/WebDropdownMenu";
import {auditPropChanges, componentStat, createRenderAudit, formatReport} from "./renderAudit";

const buildOptions = (): WebDropdownMenuProps["options"] =>
  Array.from({length: 12}, (_, index) => ({label: `Option ${index}`, value: `option-${index}`}));
const anchor = {height: 40, width: 200, x: 16, y: 32};
const baseline: WebDropdownMenuProps = {
  anchor,
  onClose: (): void => {},
  onSelect: (): void => {},
  options: buildOptions(),
  selectedValue: "option-1",
  visible: true,
};

describe("WebDropdownMenu renders", () => {
  it("re-renders only the rows a search keystroke or a new selection changes", async () => {
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    let view: ReturnType<typeof renderWithTheme> | undefined;
    await auditPropChanges({
      audit,
      baseline,
      changes: {
        "new anchor object": {...baseline, anchor: {...anchor}},
        "new onClose identity": {...baseline, onClose: (): void => {}},
        "new onSelect identity": {...baseline, onSelect: (): void => {}},
        "new options array": {...baseline, options: buildOptions()},
        "selection changed": {...baseline, selectedValue: "option-2"},
      },
      mount: (props): void => {
        view = renderWithTheme(<WebDropdownMenu {...props} />);
      },
      update: (props): void => {
        view?.rerender(<WebDropdownMenu {...props} />);
      },
    });
    await audit.step("type one search character", () => {
      act(() => {
        fireEvent.changeText(view!.getByTestId("web_dropdown_search"), "O");
      });
    });
    await audit.step("type a second search character", () => {
      act(() => {
        fireEvent.changeText(view!.getByTestId("web_dropdown_search"), "Op");
      });
    });
    const report = audit.report();
    audit.dispose();
    view?.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## WebDropdownMenu\n${formatReport(report, {limit: 14})}`);
    }

    // The row that lost the selection and the row that gained it.
    expect(componentStat(report, "selection changed", "DropdownOption")?.updates).toBe(2);
    // Every option still matches "O" and "Op", so no row changes.
    expect(componentStat(report, "type one search character", "DropdownOption")).toBeUndefined();
    expect(
      componentStat(report, "type a second search character", "DropdownOption")
    ).toBeUndefined();
    expect(componentStat(report, "new onSelect identity", "DropdownOption")).toBeUndefined();
    expect(componentStat(report, "new options array", "DropdownOption")).toBeUndefined();
    expect(componentStat(report, "new anchor object", "DropdownOption")).toBeUndefined();
    expect(componentStat(report, "same props", "DropdownOption")).toBeUndefined();
  });
});
