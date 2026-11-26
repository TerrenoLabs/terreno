import {describe, expect, it} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";

import type {DateTimeFieldProps} from "../../src/Common";
import {DateTimeField} from "../../src/DateTimeField";
import {renderWithTheme} from "../../src/test-utils";
import {componentStat, createRenderAudit, formatReport} from "./renderAudit";

const onChange = (): void => {};
const baseline: DateTimeFieldProps = {
  onChange,
  testID: "dt",
  timezone: "America/New_York",
  title: "When",
  type: "datetime",
  value: "2024-01-15T15:30:00.000Z",
};

describe("DateTimeField renders", () => {
  it("does not re-render the dropdowns or the hidden picker while typing in a segment", async () => {
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    const view = await audit.step("mount", () => renderWithTheme(<DateTimeField {...baseline} />));
    await audit.step("same props", () => view.rerender(<DateTimeField {...baseline} />));
    await audit.step("new onChange identity", () =>
      view.rerender(<DateTimeField {...baseline} onChange={(): void => {}} />)
    );
    view.rerender(<DateTimeField {...baseline} />);
    await audit.step("new value", () =>
      view.rerender(<DateTimeField {...baseline} value="2024-01-16T15:30:00.000Z" />)
    );
    view.rerender(<DateTimeField {...baseline} />);
    await audit.step("type day digit", async () => {
      await act(async () => {
        fireEvent.changeText(view.getByPlaceholderText("DD"), "2");
      });
    });
    await audit.step("type minute digit", async () => {
      await act(async () => {
        fireEvent.changeText(view.getByPlaceholderText("mm"), "4");
      });
    });
    const report = audit.report();
    audit.dispose();
    view.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## DateTimeField\n${formatReport(report, {limit: 30})}`);
    }

    expect(componentStat(report, "mount", "DesktopTimeSelectors")?.mounts).toBe(1);
    for (const step of ["same props", "type day digit", "type minute digit"]) {
      expect(componentStat(report, step, "DesktopTimeSelectors")).toBeUndefined();
      expect(componentStat(report, step, "SelectField")).toBeUndefined();
      expect(componentStat(report, step, "TimezonePicker")).toBeUndefined();
    }
    expect(componentStat(report, "type day digit", "DateTimeSegment")?.updates).toBe(5);
  });
});
