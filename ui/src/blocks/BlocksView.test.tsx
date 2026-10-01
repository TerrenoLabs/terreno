import {describe, expect, it, mock} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {act, fireEvent, waitFor} from "@testing-library/react-native";

import {sharedResponsiveBreakpointStore} from "../ResponsiveBreakpoint";
import {renderWithTheme} from "../test-utils";
import {BlocksView} from "./BlocksView";

const LAYOUT = `v: 1
blocks:
  - type: heading
    size: lg
    text: Signups this quarter
  - type: text
    markdown: Signups grew 12 percent.
  - type: columns
    children:
      - type: metric
        label: Total
        value: "403"
        delta: "+12%"
        trend: up
      - type: metric
        label: Best month
        value: Feb
  - type: card
    title: Notes
    children:
      - type: badge
        status: info
        text: Draft
      - type: context
        text: February was the strongest month.
      - type: divider
`;

describe("BlocksView", () => {
  it("renders leaf and layout blocks with Terreno components", async () => {
    const {getByText, getByTestId} = renderWithTheme(<BlocksView document={LAYOUT} />);
    expect(getByText("Signups this quarter")).toBeTruthy();
    expect(getByText("Total")).toBeTruthy();
    expect(getByText("403")).toBeTruthy();
    expect(getByText("▲ +12%")).toBeTruthy();
    expect(getByText("Draft")).toBeTruthy();
    expect(getByText("February was the strongest month.")).toBeTruthy();
    expect(getByText("Notes")).toBeTruthy();
    expect(getByTestId("blocks-3-2")).toBeTruthy();
    await waitFor(() => {
      expect(getByText("Signups grew 12 percent.")).toBeTruthy();
    });
  });

  it("stacks columns on sm and lays them out in a row from md", () => {
    const {getByTestId} = renderWithTheme(<BlocksView document={LAYOUT} />);
    act((): void => {
      sharedResponsiveBreakpointStore.updateWidth(320);
    });
    expect(getByTestId("blocks-2").props.style.flexDirection).toBe("column");
    act((): void => {
      sharedResponsiveBreakpointStore.updateWidth(375);
    });
    expect(getByTestId("blocks-2").props.style.flexDirection).toBe("row");
  });

  it("shows a banner and collapsed raw YAML for an invalid document", () => {
    const raw = "v: 1\nblocks:\n  - type: heading\n    color: red\n    text: Hi\n";
    const {getByText, queryByText, getByTestId} = renderWithTheme(
      <BlocksView document={raw} testID="blocks" />
    );
    expect(getByText(/is not a field of blocks\[0\]/)).toBeTruthy();
    expect(queryByText(raw)).toBeNull();
    fireEvent.press(getByTestId("blocks-raw.toggle"));
    expect(getByText(raw)).toBeTruthy();
  });

  it("renders a non-document as one text block", async () => {
    const {getByText} = renderWithTheme(<BlocksView document="Hello from the model" />);
    await waitFor(() => {
      expect(getByText("Hello from the model")).toBeTruthy();
    });
  });

  it("renders a bar chart and a table from an inline dataset, and a donut from points", async () => {
    const document = `v: 1
datasets:
  signups:
    columns:
      - name: month
        type: string
      - name: count
        type: number
    rows:
      - [Jan, 120]
      - [Feb, 180]
blocks:
  - type: chart
    kind: bar
    title: Signups by month
    data: signups
    x: month
    y: count
  - type: chart
    kind: donut
    points:
      - label: Web
        value: 10
      - label: Mobile
        value: 4
  - type: table
    data: signups
    columns: [month, count]
`;
    const {getAllByText, getByText} = renderWithTheme(<BlocksView document={document} />);
    await waitFor(() => {
      expect(getAllByText("Jan").length).toBeGreaterThan(0);
      expect(getByText("Web")).toBeTruthy();
      expect(getAllByText("180").length).toBeGreaterThan(0);
    });
  });

  it("loads a ref dataset through resolveDataset", async () => {
    const document = `v: 1
datasets:
  signups:
    source: ref
    id: ds_signups
blocks:
  - type: chart
    kind: bar
    data: signups
    x: month
    y: count
`;
    const resolveDataset = mock(async () => ({
      columns: [
        {name: "month", type: "string" as const},
        {name: "count", type: "number" as const},
      ],
      rows: [["Mar", 9]],
    }));
    const {getByText} = renderWithTheme(
      <BlocksView document={document} resolveDataset={resolveDataset} />
    );
    await waitFor(() => {
      expect(getByText("Mar")).toBeTruthy();
    });
    expect(resolveDataset).toHaveBeenCalledWith({id: "ds_signups"});
  });

  it("does not use raw react-native views in the blocks folder", () => {
    const dir = import.meta.dir;
    const files = readdirSync(dir).filter(
      (name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx")
    );
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const source = readFileSync(join(dir, name), "utf8");
      expect(source.includes('from "react-native"')).toBe(false);
    }
  });
});
