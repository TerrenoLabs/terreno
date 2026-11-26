import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import type React from "react";

import {
  componentStat,
  createRenderAudit,
  formatReport,
} from "../../../ui/benchmarks/renderAudit/renderAudit";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {AdminObjectPicker} from "../../src/AdminObjectPicker";

const items = Array.from({length: 40}, (_, index) => ({
  _id: `id-${index}`,
  email: `user${index}@example.com`,
  name: `User ${index}`,
}));
const listResult = {data: {data: items}, isFetching: false, isLoading: false};
const emptyResult = {data: undefined, isFetching: false, isLoading: false};

mock.module("../../src/useAdminRpc", () => ({
  unwrapAdminEnvelope: (value: unknown): unknown => value,
  useAdminRpc: (): (() => void) => (): void => {},
  useAdminRpcQuery: ({skip, url}: {skip?: boolean; url: string}): unknown => {
    if (skip || !url.includes("limit=")) {
      return emptyResult;
    }
    return listResult;
  },
}));

describe("AdminObjectPicker renders", () => {
  it("keeps result rows still while the search text changes", async () => {
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    const element = (onChange: () => void): React.ReactElement => (
      <AdminObjectPicker
        onChange={onChange}
        refModelName="User"
        routePath="/admin/users"
        title="Owner"
        value=""
      />
    );
    const handleChange = (): void => {};
    const view = await audit.step("mount", () => renderWithTheme(element(handleChange)));
    await audit.step("open list", async () => {
      await act(async () => {
        fireEvent(view.getByTestId("admin-picker-User-search"), "focus");
      });
    });
    await audit.step("same props, list open", () => view.rerender(element(handleChange)));
    await audit.step("new onChange identity, list open", () =>
      view.rerender(element((): void => {}))
    );
    await audit.step("type one character", async () => {
      await act(async () => {
        fireEvent.changeText(view.getByTestId("admin-picker-User-search"), "u");
      });
    });
    const report = audit.report();
    audit.dispose();
    view.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(formatReport(report, {limit: 40}));
    }

    expect(componentStat(report, "open list", "PickerResultRow")?.mounts).toBe(40);
    expect(componentStat(report, "type one character", "PickerResultRow")).toBeUndefined();
    expect(componentStat(report, "same props, list open", "PickerResultRow")).toBeUndefined();
    expect(
      componentStat(report, "new onChange identity, list open", "PickerResultRow")
    ).toBeUndefined();
  });
});
