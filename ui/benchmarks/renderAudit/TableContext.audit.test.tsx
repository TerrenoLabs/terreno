import {describe, expect, it} from "bun:test";
import type {ReactElement} from "react";

import {Table} from "../../src/table/Table";
import {TableHeader} from "../../src/table/TableHeader";
import {TableHeaderCell} from "../../src/table/TableHeaderCell";
import {TableNumber} from "../../src/table/TableNumber";
import {TableRow} from "../../src/table/TableRow";
import {TableText} from "../../src/table/TableText";
import {renderWithTheme} from "../../src/test-utils";
import {componentStat, createRenderAudit, formatReport} from "./renderAudit";

const ROW_COUNT = 8;
const COLUMNS = [120, 120, 120];

// Built once, the way a caller that memoizes its rows passes them: the cell contents keep their
// identity while the table re-renders.
const ROWS: ReactElement[] = [
  <TableHeader key="header">
    <TableHeaderCell index={0} title="Name" />
    <TableHeaderCell index={1} title="Count" />
    <TableHeaderCell index={2} title="Total" />
  </TableHeader>,
  ...Array.from({length: ROW_COUNT}, (_, index) => (
    <TableRow key={`row-${index}`}>
      <TableText value={`Name ${index}`} />
      <TableNumber value={String(index)} />
      <TableNumber value={String(index * 2)} />
    </TableRow>
  )),
];

const buildTable = (maxHeight?: number): ReactElement => (
  <Table columns={COLUMNS} maxHeight={maxHeight}>
    {ROWS}
  </Table>
);

describe("TableContextProvider renders", () => {
  it("does not re-render memoized cells when the table re-renders with the same context", async () => {
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    let view: ReturnType<typeof renderWithTheme> | undefined;
    await audit.step("mount", (): void => {
      view = renderWithTheme(buildTable());
    });
    await audit.step("same props", (): void => {
      view?.rerender(buildTable());
    });
    await audit.step("maxHeight changes", (): void => {
      view?.rerender(buildTable(400));
    });
    const report = audit.report();
    audit.dispose();
    view?.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## TableContext\n${formatReport(report, {limit: 30})}`);
    }

    expect(componentStat(report, "same props", "TableCell")).toBeUndefined();
    expect(componentStat(report, "maxHeight changes", "TableCell")).toBeUndefined();
  });
});
