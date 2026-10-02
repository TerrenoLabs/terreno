import {describe, expect, it, mock} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {act, fireEvent, waitFor} from "@testing-library/react-native";
import {ActivityIndicator} from "react-native";

import {sharedResponsiveBreakpointStore} from "../ResponsiveBreakpoint";
import {renderWithTheme} from "../test-utils";
import {BlocksView} from "./BlocksView";

const ACTIONS = `v: 1
datasets:
  signups:
    columns:
      - name: month
        type: string
      - name: count
        type: number
    rows:
      - [Jan, 120]
  signups_weekly:
    columns:
      - name: month
        type: string
      - name: count
        type: number
    rows:
      - [W1, 40]
blocks:
  - type: chart
    id: signups_chart
    kind: bar
    data: signups
    x: month
    y: count
  - type: actions
    id: chart_actions
    elements:
      - type: segmented
        id: grain
        target: signups_chart
        options:
          - label: Month
            data: signups
          - label: Week
            data: signups_weekly
      - type: button
        id: reply_btn
        text: Reply
        action:
          kind: reply
          text: Thanks
      - type: button
        id: open_btn
        text: Open
        action:
          kind: open
          url: https://example.com
      - type: button
        id: run_btn
        text: Run
        action:
          kind: callback
          name: export_csv
`;

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

// Button presses await a haptic call before running onClick.
const press = async (element: Parameters<typeof fireEvent.press>[0]): Promise<void> => {
  await act(async () => {
    fireEvent.press(element);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

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

  it("switches the chart dataset from a segmented control and reports select", async () => {
    const onAction = mock(() => undefined);
    const {getByText, queryByText} = renderWithTheme(
      <BlocksView document={ACTIONS} onAction={onAction} />
    );
    await waitFor(() => {
      expect(getByText("Jan")).toBeTruthy();
    });
    fireEvent.press(getByText("Week"));
    await waitFor(() => {
      expect(getByText("W1")).toBeTruthy();
    });
    expect(queryByText("Jan")).toBeNull();
    expect(onAction).toHaveBeenCalledWith({
      action: {data: "signups_weekly", kind: "select", target: "signups_chart"},
      blockId: "chart_actions",
      elementId: "grain",
    });
  });

  it("reports reply and open actions", async () => {
    const onAction = mock(() => undefined);
    const {getByText} = renderWithTheme(<BlocksView document={ACTIONS} onAction={onAction} />);
    await press(getByText("Reply"));
    await press(getByText("Open"));
    expect(onAction).toHaveBeenNthCalledWith(1, {
      action: {kind: "reply", text: "Thanks"},
      blockId: "chart_actions",
      elementId: "reply_btn",
    });
    expect(onAction).toHaveBeenNthCalledWith(2, {
      action: {kind: "open", url: "https://example.com"},
      blockId: "chart_actions",
      elementId: "open_btn",
    });
  });

  it("disables a callback the host did not register", async () => {
    const onAction = mock(() => undefined);
    const {getByTestId, getByText} = renderWithTheme(
      <BlocksView document={ACTIONS} hostActions={["approve"]} onAction={onAction} />
    );
    expect(getByTestId("blocks-1-run_btn").props.accessibilityState.disabled).toBe(true);
    await press(getByText("Run"));
    expect(onAction).not.toHaveBeenCalled();
  });

  it("runs a callback the host registered", async () => {
    const onAction = mock(() => undefined);
    const {getByText} = renderWithTheme(
      <BlocksView document={ACTIONS} hostActions={["export_csv"]} onAction={onAction} />
    );
    await press(getByText("Run"));
    expect(onAction).toHaveBeenCalledWith({
      action: {kind: "callback", name: "export_csv"},
      blockId: "chart_actions",
      elementId: "run_btn",
    });
  });

  it("shows a loading state for a pending element", () => {
    const {getByTestId, UNSAFE_getAllByType} = renderWithTheme(
      <BlocksView document={ACTIONS} pendingElementIds={["run_btn"]} />
    );
    expect(getByTestId("blocks-1-run_btn").props.accessibilityState.disabled).toBe(true);
    expect(UNSAFE_getAllByType(ActivityIndicator).length).toBeGreaterThan(0);
  });

  it("replaces a block from overrides", () => {
    const document = `v: 1
blocks:
  - type: heading
    id: title
    text: Original
`;
    const {getByText, queryByText} = renderWithTheme(
      <BlocksView
        document={document}
        overrides={{title: {id: "title", text: "Replaced", type: "heading"}}}
      />
    );
    expect(getByText("Replaced")).toBeTruthy();
    expect(queryByText("Original")).toBeNull();
  });

  it("keeps html as a placeholder until the host allows it and the reply finishes", () => {
    const block: Record<string, string> = {};
    block.type = "html";
    block.title = "Invoice preview";
    block.html = "<h1>Invoice #1042</h1>";
    const document: Record<string, unknown> = {};
    document.v = 1;
    document.blocks = [block];

    const off = renderWithTheme(<BlocksView document={document} />);
    expect(off.getByText("HTML preview is turned off.")).toBeTruthy();
    expect(off.queryByText("Invoice #1042")).toBeNull();

    const streaming = renderWithTheme(<BlocksView allowHtml document={document} streaming />);
    expect(streaming.getByText("The preview appears when this reply finishes.")).toBeTruthy();

    const on = renderWithTheme(<BlocksView allowHtml document={document} />);
    expect(on.getByText("Agent-generated preview")).toBeTruthy();
    expect(on.getByText("Invoice preview")).toBeTruthy();
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
