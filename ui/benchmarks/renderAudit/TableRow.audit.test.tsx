import {describe, expect, it, type mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import type {ReactElement} from "react";

import {IconButton} from "../../src/IconButton";
import {Text} from "../../src/Text";
import {Table} from "../../src/table/Table";
import {TableBoolean} from "../../src/table/TableBoolean";
import {TableDate} from "../../src/table/TableDate";
import {TableHeader} from "../../src/table/TableHeader";
import {TableHeaderCell} from "../../src/table/TableHeaderCell";
import {TableIconButton} from "../../src/table/TableIconButton";
import {TableNumber} from "../../src/table/TableNumber";
import {TableRow} from "../../src/table/TableRow";
import {TableText} from "../../src/table/TableText";
import {renderWithTheme} from "../../src/test-utils";
import {componentStat, createRenderAudit, formatReport} from "./renderAudit";

const ROW_COUNT = 8;
const COLUMNS = [120, 120, 120, 120, 80];
const handleSortChange = (): void => {};
const handleEdit = (): void => {};

const buildTable = (): ReactElement => (
  <Table columns={COLUMNS}>
    <TableHeader>
      <TableHeaderCell index={0} onSortChange={handleSortChange} sortable title="Name" />
      <TableHeaderCell index={1} title="Count" />
      <TableHeaderCell index={2} title="Active" />
      <TableHeaderCell index={3} title="Created" />
      <TableHeaderCell index={4} title="Edit" />
    </TableHeader>
    {Array.from({length: ROW_COUNT}, (_, index) => (
      <TableRow drawerContents={<Text>{`Drawer ${index}`}</Text>} key={`row-${index}`}>
        <TableText value={`Name ${index}`} />
        <TableNumber value={String(index)} />
        <TableBoolean value={index % 2 === 0} />
        <TableDate value="2026-01-15T12:00:00.000Z" />
        <TableIconButton onClick={handleEdit} tableIconButtonName="edit" />
      </TableRow>
    ))}
  </Table>
);

describe("TableRow renders", () => {
  it("expanding a row re-renders that row, not its cells", async () => {
    const iconButtonMock = IconButton as unknown as ReturnType<typeof mock>;
    iconButtonMock.mockClear();
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    let view: ReturnType<typeof renderWithTheme> | undefined;
    await audit.step("mount", (): void => {
      view = renderWithTheme(buildTable());
    });
    await audit.step("same props", (): void => {
      view?.rerender(buildTable());
    });
    await audit.step("expand one row", (): void => {
      // bunSetup mocks IconButton, so press the expand button through its recorded props.
      const expandCalls = iconButtonMock.mock.calls.filter(
        (call) => call[0].accessibilityLabel === "expand"
      );
      act((): void => {
        expandCalls[expandCalls.length - ROW_COUNT + 2][0].onClick();
      });
    });
    await audit.step("sort by first column", async (): Promise<void> => {
      const header = view?.getAllByLabelText("sort") ?? [];
      await act(async (): Promise<void> => {
        fireEvent.press(header[0]);
      });
    });
    const report = audit.report();
    audit.dispose();
    view?.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## TableRow\n${formatReport(report, {limit: 30})}`);
    }

    expect(componentStat(report, "expand one row", "TableRow")?.updates).toBe(1);
    // Only the expand cell updates: its chevron icon flips.
    expect(componentStat(report, "expand one row", "TableCell")?.updates).toBe(1);
    expect(componentStat(report, "expand one row", "TableCell")?.wasted).toBe(0);
  });
});
