import {describe, expect, it} from "bun:test";
import {fireEvent} from "@testing-library/react-native";
import {type FC, type ReactElement, useState} from "react";

import type {DataTableColumnFilter} from "../../src/Common";
import {DataTableFilterFields} from "../../src/dataTableFilters";
import {renderWithTheme} from "../../src/test-utils";
import {auditComponent} from "./auditComponent";
import {componentStat, createRenderAudit, formatReport} from "./renderAudit";

const filters: DataTableColumnFilter[] = [
  {field: "name", kind: "text", label: "Name"},
  {field: "email", kind: "text", label: "Email"},
  {field: "city", kind: "text", label: "City"},
  {field: "active", kind: "boolean", label: "Active"},
  {field: "verified", kind: "boolean", label: "Verified"},
  {field: "created", kind: "dateRange", label: "Created"},
  {field: "age", kind: "numberRange", label: "Age"},
  {
    field: "role",
    kind: "choice",
    label: "Role",
    options: Array.from({length: 8}, (_, index) => ({
      label: `Role ${index}`,
      value: `role-${index}`,
    })),
  },
];
const draftValues: Record<string, unknown> = {name: "Ada", role: ["role-1"]};
const handleDraftChange = (): void => {};
const baseline = {draftValues, filters, onDraftChange: handleDraftChange};

const FIELD_COMPONENTS = [
  "BooleanFilterField",
  "ChoiceFilterField",
  "DateRangeFilterField",
  "NumberRangeFilterField",
  "TextFilterField",
];

const Harness: FC = (): ReactElement => {
  const [draft, setDraft] = useState<Record<string, unknown>>(draftValues);
  return <DataTableFilterFields draftValues={draft} filters={filters} onDraftChange={setDraft} />;
};

describe("DataTableFilterFields renders", () => {
  it("skips every field when only identities change", async () => {
    const report = await auditComponent({
      baseline,
      Component: DataTableFilterFields,
      changes: {
        "new filters array": {...baseline, filters: [...filters]},
        "new onDraftChange identity": {...baseline, onDraftChange: (): void => {}},
        "one text draft changed": {...baseline, draftValues: {...draftValues, name: "Adam"}},
      },
      name: "DataTableFilterFields",
    });
    for (const step of ["same props", "new filters array", "new onDraftChange identity"]) {
      for (const name of FIELD_COMPONENTS) {
        expect(componentStat(report, step, name)).toBeUndefined();
      }
    }
    expect(componentStat(report, "one text draft changed", "TextFilterField")?.updates).toBe(1);
    expect(componentStat(report, "one text draft changed", "ChoiceFilterField")).toBeUndefined();
  });

  it("re-renders only the filter being typed in", async () => {
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    // Mounted inside a step so the collector knows every fiber before the interaction.
    let mounted: ReturnType<typeof renderWithTheme> | undefined;
    await audit.step("mount", (): void => {
      mounted = renderWithTheme(<Harness />);
    });
    const view = mounted as ReturnType<typeof renderWithTheme>;
    await audit.step("type one character", (): void => {
      fireEvent.changeText(view.getByTestId("data-table-filter-email"), "a");
    });
    const report = audit.report();
    audit.dispose();
    view.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(formatReport(report));
    }
    expect(componentStat(report, "type one character", "TextFilterField")?.updates).toBe(1);
    for (const name of FIELD_COMPONENTS.filter((item) => item !== "TextFilterField")) {
      expect(componentStat(report, "type one character", name)).toBeUndefined();
    }
  });
});
