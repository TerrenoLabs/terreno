import {describe, expect, it} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {useWindowDimensions} from "react-native";

import {
  componentStat,
  createRenderAudit,
  formatReport,
} from "../../../ui/benchmarks/renderAudit/renderAudit";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {AdminFilterDrawer} from "../../src/AdminFilterDrawer";

const filters = [
  ...Array.from({length: 5}, (_, index) => ({field: `text${index}`, kind: "text" as const})),
  {field: "active", kind: "boolean" as const},
  {field: "created", kind: "dateRange" as const},
  {
    choices: [
      {label: "A", value: "a"},
      {label: "B", value: "b"},
    ],
    field: "kind",
    kind: "choice" as const,
  },
];
const appliedFilterState = {};
const fields = {};
const handleApply = (): void => {};

const renderDrawer = (): React.ReactElement => (
  <AdminFilterDrawer
    appliedFilterState={appliedFilterState}
    fields={fields}
    filters={filters}
    onApply={handleApply}
  />
);

describe("AdminFilterDrawer renders", () => {
  it("re-renders only the filter being typed in", async () => {
    // The drawer shows its fields inline only on a desktop-width window.
    const dimensions = useWindowDimensions as unknown as {
      mockImplementation: (impl: () => unknown) => void;
    };
    dimensions.mockImplementation(() => ({fontScale: 1, height: 1000, scale: 2, width: 1400}));

    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    let view: ReturnType<typeof renderWithTheme> | undefined;
    await audit.step("mount", async () => {
      view = renderWithTheme(renderDrawer());
      await act(async () => {});
    });
    const mounted = view as ReturnType<typeof renderWithTheme>;
    await audit.step("same props", () => {
      mounted.rerender(renderDrawer());
    });
    await audit.step("type one character", async () => {
      await act(async () => {
        fireEvent.changeText(mounted.getByTestId("admin-filter-text0"), "a");
      });
    });
    const report = audit.report();
    audit.dispose();
    mounted.unmount();
    dimensions.mockImplementation(() => ({fontScale: 1, height: 1000, scale: 2, width: 375}));
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## AdminFilterDrawer\n${formatReport(report, {limit: 20})}`);
    }

    expect(componentStat(report, "mount", "FilterField")?.mounts).toBe(8);
    expect(componentStat(report, "type one character", "FilterField")?.updates).toBe(1);
    expect(componentStat(report, "same props", "FilterField")).toBeUndefined();
  });
});
