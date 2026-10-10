import {afterEach, describe, expect, it, jest, mock} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import type {Block} from "@terreno/blocks";
import {act, fireEvent, waitFor} from "@testing-library/react-native";
import {setStringAsync} from "expo-clipboard";
import {ActivityIndicator, Image as NativeImage, ScrollView, StyleSheet} from "react-native";

import {IconButton} from "../IconButton";
import {Image} from "../Image";
import {MarkdownView} from "../MarkdownView";
import {sharedResponsiveBreakpointStore} from "../ResponsiveBreakpoint";
import {renderWithTheme} from "../test-utils";
import {BlocksView} from "./BlocksView";
import {renderBlock} from "./blockRenderers";

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

const STEPPER = `v: 1
blocks:
  - type: card
    children:
      - type: stepper
        id: guests
        label: Number of people
        unit: People
        value: 5
        min: 1
        max: 20
        callback:
          name: scaleStepper
          payload:
            recipe: roast
        itemsTitle: Your shopping quantities
        items:
          - label: Bone-in leg of lamb
            amount: 2
            unit: kg
            decimals: 1
          - label: Carrots
            amount: 8
            round: up
        note: Generous portions, with a little extra.
`;

const CHECKLIST_ITEMS = `    items:
      - {id: oven, meta: "1:00 pm", text: Preheat the oven, detail: "220 C, fan off.", checked: true}
      - {id: lamb_in, meta: "1:30 pm", text: Put the lamb in}
      - {id: veg, text: Peel the vegetables}
      - {id: parsnips, text: Par-boil the parsnips}
      - {id: potatoes, text: Roast the potatoes}
      - {id: gravy, text: Make the gravy}
      - {id: rest, text: Rest the lamb}
      - {id: carve, text: Carve and serve}
`;

const CHECKLIST = `v: 1
blocks:
  - type: checklist
    id: cooking
    title: Cooking checklist
    callback:
      name: toggleChecklist
      payload:
        recipe: roast
${CHECKLIST_ITEMS}`;

const LOCAL_CHECKLIST = `v: 1
blocks:
  - type: checklist
    id: cooking
    title: Cooking checklist
${CHECKLIST_ITEMS}`;

const CHECKLIST_ITEM_IDS = [
  "oven",
  "lamb_in",
  "veg",
  "parsnips",
  "potatoes",
  "gravy",
  "rest",
  "carve",
] as const;

// Button presses await a haptic call before running onClick.
const press = async (element: Parameters<typeof fireEvent.press>[0]): Promise<void> => {
  await act(async () => {
    fireEvent.press(element);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

type RenderedView = ReturnType<typeof renderWithTheme>;

// bunSetup replaces IconButton with a null mock, so stepper buttons are found by their props.
const iconButton = (
  view: RenderedView,
  label: string
): {props: {disabled?: boolean; onClick: () => Promise<void> | void}} => {
  const found = view
    .UNSAFE_getAllByType(IconButton)
    .find((node) => node.props.accessibilityLabel === label);
  if (found === undefined) {
    throw new Error(`No IconButton labelled ${label}`);
  }
  return found as unknown as {props: {disabled?: boolean; onClick: () => Promise<void> | void}};
};

const tap = async (view: RenderedView, label: string): Promise<void> => {
  await act(async () => {
    await iconButton(view, label).props.onClick();
  });
};

describe("BlocksView card eyebrow", () => {
  const eyebrowDoc = (lines: string): string => `v: 1
blocks:
  - type: card
${lines}    children:
      - type: context
        text: Serves six.
`;

  it("draws a small muted eyebrow above the card title", () => {
    const view = renderWithTheme(
      <BlocksView
        document={eyebrowDoc("    eyebrow: Your dinner plan\n    title: Sunday roast\n")}
      />
    );
    const eyebrow = view.getByTestId("blocks-0-eyebrow");
    expect(eyebrow.props.children).toBe("Your dinner plan");
    const flat = StyleSheet.flatten(eyebrow.props.style);
    const label = StyleSheet.flatten(view.getByText("Your dinner plan").props.style);
    expect(flat.color).toBe(label.color);
    const json = JSON.stringify(view.toJSON());
    expect(json.indexOf("Your dinner plan")).toBeLessThan(json.indexOf("Sunday roast"));
    expect(json.indexOf("Sunday roast")).toBeLessThan(json.indexOf("Serves six."));
  });

  it("draws an eyebrow on a card with no title, above the children", () => {
    const view = renderWithTheme(<BlocksView document={eyebrowDoc("    eyebrow: Tonight\n")} />);
    expect(view.getByTestId("blocks-0-eyebrow")).toBeTruthy();
    const json = JSON.stringify(view.toJSON());
    expect(json.indexOf("Tonight")).toBeLessThan(json.indexOf("Serves six."));
  });

  it("draws no eyebrow when the card has none", () => {
    const view = renderWithTheme(<BlocksView document={eyebrowDoc("    title: Sunday roast\n")} />);
    expect(view.queryByTestId("blocks-0-eyebrow")).toBeNull();
    expect(view.getByText("Sunday roast")).toBeTruthy();
  });
});

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

  it("renders every column when a table does not list them", async () => {
    const document = `v: 1
datasets:
  signups:
    columns:
      - name: month
        type: string
    rows:
      - [Jan]
blocks:
  - type: table
    data: signups
`;
    const {getByText} = renderWithTheme(<BlocksView document={document} />);
    expect(getByText("month")).toBeTruthy();
    expect(getByText("Jan")).toBeTruthy();
  });

  describe("typed table columns", () => {
    const LAMB = `v: 1
datasets:
  lamb:
    columns:
      - name: guests
        type: number
      - name: lamb_kg
        type: number
      - name: served
        type: date
      - name: cut
        type: string
    rows:
      - [6, 2.4, "2026-03-14", shoulder]
blocks:
  - type: table
    title: How much lamb?
    data: lamb
`;
    type StyledNode = {parent: StyledNode | null; props: {style?: unknown}};
    const flatStyle = (node: StyledNode): {textAlign?: string; width?: number} =>
      (StyleSheet.flatten(node.props.style as never) ?? {}) as {
        textAlign?: string;
        width?: number;
      };
    const cellWidth = (node: StyledNode): number | undefined => {
      let current: StyledNode | null = node;
      while (current) {
        const width = flatStyle(current).width;
        if (typeof width === "number") {
          return width;
        }
        current = current.parent;
      }
      return undefined;
    };
    const layout = async (view: RenderedView, width: number): Promise<void> => {
      await act(async () => {
        fireEvent(view.getByTestId("blocks-0"), "layout", {
          nativeEvent: {layout: {height: 200, width, x: 0, y: 0}},
        });
      });
    };

    it("sizes the table to its rows so it never spills past the block", () => {
      const view = renderWithTheme(<BlocksView document={LAMB} />);
      const frame = view.getByTestId("blocks-0-table-frame");
      // One header row plus one data row, 54 each, plus the 2px border.
      expect(flatStyle(frame as unknown as StyledNode).height).toBe(110);
    });

    it("caps a long table at ten visible rows and lets it scroll", () => {
      const rows = Array.from(
        {length: 30},
        (_, index) => `      - [${index}, 2.4, "2026-03-14", shoulder]`
      ).join("\n");
      const long = LAMB.replace('      - [6, 2.4, "2026-03-14", shoulder]', rows);
      const view = renderWithTheme(<BlocksView document={long} />);
      const frame = view.getByTestId("blocks-0-table-frame");
      expect(flatStyle(frame as unknown as StyledNode).height).toBe(11 * 54 + 2);
    });

    it("shows column names with underscores as spaced headers", () => {
      const view = renderWithTheme(<BlocksView document={LAMB} />);
      expect(view.getByText("lamb kg")).toBeTruthy();
      expect(view.queryByText("lamb_kg")).toBeNull();
    });
    it("maps number columns to right-aligned cells and date columns to DATE_MED", () => {
      const {getByText, queryByText} = renderWithTheme(<BlocksView document={LAMB} />);
      expect(flatStyle(getByText("6") as unknown as StyledNode).textAlign).toBe("right");
      expect(flatStyle(getByText("2.4") as unknown as StyledNode).textAlign).toBe("right");
      expect(getByText("Mar 14, 2026")).toBeTruthy();
      expect(queryByText("2026-03-14")).toBeNull();
      expect(flatStyle(getByText("shoulder") as unknown as StyledNode).textAlign).not.toBe("right");
    });

    it("uses 120 per column until the table is measured", () => {
      const {getByText} = renderWithTheme(<BlocksView document={LAMB} />);
      expect(cellWidth(getByText("shoulder") as unknown as StyledNode)).toBe(120);
    });

    it("splits the measured width evenly across columns", async () => {
      const view = renderWithTheme(<BlocksView document={LAMB} />);
      await layout(view, 600);
      expect(cellWidth(view.getByText("shoulder") as unknown as StyledNode)).toBe(150);
      expect(cellWidth(view.getByText("6") as unknown as StyledNode)).toBe(150);
    });

    it("keeps each column at least 96 wide when the container is narrow", async () => {
      const view = renderWithTheme(<BlocksView document={LAMB} />);
      await layout(view, 200);
      expect(cellWidth(view.getByText("shoulder") as unknown as StyledNode)).toBe(96);
    });

    it("keeps each listed column's type when the table picks a subset", () => {
      const document = LAMB.replace(
        "    data: lamb\n",
        "    data: lamb\n    columns: [cut, guests]\n"
      );
      const {getByText, queryByText} = renderWithTheme(<BlocksView document={document} />);
      expect(flatStyle(getByText("6") as unknown as StyledNode).textAlign).toBe("right");
      expect(queryByText("Mar 14, 2026")).toBeNull();
    });
  });

  it("uses the default selection setter when a select button has no host context", async () => {
    const view = renderBlock(
      {
        elements: [
          {
            action: {data: "weekly", kind: "select", target: "signups_chart"},
            id: "weekly",
            text: "Weekly",
            type: "button",
          },
        ],
        id: "row",
        type: "actions",
      },
      "blocks-0"
    );
    const {getByText} = renderWithTheme(view);
    await press(getByText("Weekly"));
  });

  it("highlights the segment that matches the chart and switches a table", async () => {
    const document = `v: 1
datasets:
  signups:
    columns:
      - name: month
        type: string
      - name: count
        type: number
    rows:
      - [Jan, 12]
  weekly:
    columns:
      - name: month
        type: string
      - name: count
        type: number
    rows:
      - [W1, 4]
blocks:
  - type: chart
    id: signups_chart
    kind: bar
    data: weekly
    x: month
    y: count
  - type: table
    id: signups_table
    data: signups
  - type: actions
    id: row
    elements:
      - type: segmented
        id: grain
        target: signups_chart
        options:
          - label: Month
            data: signups
          - label: Week
            data: weekly
      - type: button
        id: show_week
        text: Show week
        action:
          kind: select
          target: signups_table
          data: weekly
`;
    const {getAllByText, getByText, queryByText} = renderWithTheme(
      <BlocksView document={document} />
    );
    const segmentStyle = (label: string): {backgroundColor?: string} | undefined => {
      let node = getByText(label).parent;
      for (let depth = 0; depth < 4 && node; depth += 1) {
        const style = node.props?.style as {backgroundColor?: string} | undefined;
        if (style && "backgroundColor" in style) {
          return style;
        }
        node = node.parent;
      }
      return undefined;
    };
    expect(segmentStyle("Week")?.backgroundColor).toBeTruthy();
    expect(segmentStyle("Month")?.backgroundColor).toBeUndefined();
    expect(getByText("Jan")).toBeTruthy();
    await press(getByText("Show week"));
    expect(queryByText("Jan")).toBeNull();
    expect(getAllByText("W1").length).toBe(2);
  });

  it("clears a ref spinner when the host fetch fails", async () => {
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
    const resolveDataset = mock(async () => {
      throw new Error("offline");
    });
    const {UNSAFE_queryAllByType} = renderWithTheme(
      <BlocksView document={document} resolveDataset={resolveDataset} />
    );
    await waitFor(() => {
      expect(UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
    });
  });

  it("keeps a file ref off Image until resolveImage returns a url", async () => {
    const document = `v: 1
blocks:
  - type: image
    alt: Receipt
    src: file:6710c2a4f1
`;
    const unresolved = renderWithTheme(<BlocksView document={document} />);
    expect(unresolved.getByText("Receipt")).toBeTruthy();
    expect(unresolved.UNSAFE_queryAllByType(NativeImage)).toHaveLength(0);
    unresolved.unmount();

    const resolveImage = mock(async () => "https://cdn.example/receipt.png");
    const loaded = renderWithTheme(<BlocksView document={document} resolveImage={resolveImage} />);
    await waitFor(() => {
      expect(loaded.UNSAFE_getAllByType(NativeImage)[0]?.props.source.uri).toBe(
        "https://cdn.example/receipt.png"
      );
    });
    expect(resolveImage).toHaveBeenCalledWith("6710c2a4f1");
  });

  it("keeps the alt text when resolveImage fails", async () => {
    const document = `v: 1
blocks:
  - type: card
    children:
      - type: image
        alt: Receipt
        src: file:6710c2a4f1
`;
    const resolveImage = mock(async () => {
      throw new Error("offline");
    });
    const view = renderWithTheme(<BlocksView document={document} resolveImage={resolveImage} />);
    await waitFor(() => {
      expect(resolveImage).toHaveBeenCalledWith("6710c2a4f1");
    });
    expect(view.getByText("Receipt")).toBeTruthy();
    expect(view.UNSAFE_queryAllByType(NativeImage)).toHaveLength(0);
  });

  it("drops a file url that arrives after the view unmounts", async () => {
    const document = `v: 1
blocks:
  - type: image
    alt: Receipt
    src: file:6710c2a4f1
`;
    let finish: (url: string) => void = () => {};
    const resolveImage = mock(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        })
    );
    const view = renderWithTheme(<BlocksView document={document} resolveImage={resolveImage} />);
    view.unmount();
    finish("https://cdn.example/late.png");
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
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

  it("hides a nested layout error while the reply is still streaming", () => {
    const document = `v: 1
blocks:
  - type: heading
    text: Plans
  - type: text
    markdown: Compare the options.
  - type: columns
    children:
      - type: card
        title: Team
        children:
          - type: text
            markdown: Twenty dollars
      - type: text
        markdown: Starter is free.
`;
    const streaming = renderWithTheme(<BlocksView document={document} streaming />);
    expect(
      streaming.queryByText(
        "blocks[2].children[0]: A columns or card block is nested inside another columns or card block."
      )
    ).toBeNull();

    const finished = renderWithTheme(<BlocksView document={document} />);
    expect(
      finished.getByText(
        "blocks[2].children[0]: A columns or card block is nested inside another columns or card block."
      )
    ).toBeTruthy();
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
    expect(streaming.queryByText("Invoice #1042")).toBeNull();
    expect(streaming.queryByTestId("html-frame-native")).toBeNull();

    const on = renderWithTheme(<BlocksView allowHtml document={document} />);
    expect(on.getByText("Agent-generated preview")).toBeTruthy();
    expect(on.getByText("Invoice preview")).toBeTruthy();
    expect(on.getByTestId("html-frame-native")).toBeTruthy();
    expect(off.queryByTestId("html-frame-native")).toBeNull();
  });

  it("renders a callout, an image, and a details block", () => {
    const callout: Record<string, string> = {};
    callout.type = "callout";
    callout.status = "warning";
    callout.text = "Seats renew on Friday.";
    const picture: Record<string, string> = {};
    picture.type = "image";
    picture.alt = "Receipt";
    picture.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    const details: Record<string, string> = {};
    details.type = "details";
    details.title = "Invoice notes";
    details.text = "Twelve seats, billed monthly.";
    const document: Record<string, unknown> = {};
    document.v = 1;
    document.blocks = [callout, picture, details];

    const {getByText} = renderWithTheme(<BlocksView document={document} />);

    expect(getByText("Seats renew on Friday.")).toBeTruthy();
    expect(getByText("Receipt")).toBeTruthy();
    expect(getByText("Invoice notes")).toBeTruthy();
    expect(getByText("Twelve seats, billed monthly.")).toBeTruthy();
  });

  it("rejects an https image whose host is not allowed", () => {
    const block: Record<string, string> = {};
    block.type = "image";
    block.alt = "Pixel";
    block.src = "https://evil.test/pixel.png";
    const document: Record<string, unknown> = {};
    document.v = 1;
    document.blocks = [block];

    const blocked = renderWithTheme(<BlocksView document={document} />);
    expect(blocked.getByText(/IMAGE_HOST_NOT_ALLOWED|allowed host/)).toBeTruthy();

    const allowed = renderWithTheme(<BlocksView document={document} imageHosts={["evil.test"]} />);
    expect(allowed.getByText("Pixel")).toBeTruthy();
  });

  it("renders a stepper with its unit, items grid, and note", () => {
    const {getByText, getByTestId} = renderWithTheme(<BlocksView document={STEPPER} />);
    expect(getByText("Number of people")).toBeTruthy();
    expect(getByTestId("blocks-0-0-value").props.children).toBe("5");
    expect(getByText("People")).toBeTruthy();
    expect(getByText("Your shopping quantities")).toBeTruthy();
    expect(getByText("Bone-in leg of lamb")).toBeTruthy();
    expect(getByText("2.0 kg")).toBeTruthy();
    expect(getByText("8")).toBeTruthy();
    expect(getByText("Generous portions, with a little extra.")).toBeTruthy();
  });

  it("emits a stepper callback with the agent payload and the next value", async () => {
    const onAction = mock(() => undefined);
    const view = renderWithTheme(
      <BlocksView document={STEPPER} hostActions={["scaleStepper"]} onAction={onAction} />
    );
    expect(view.getByTestId("blocks-0-0")).toBeTruthy();
    await tap(view, "Increase Number of people");
    await tap(view, "Decrease Number of people");
    expect(onAction).toHaveBeenNthCalledWith(1, {
      action: {kind: "callback", name: "scaleStepper", payload: {recipe: "roast", value: 6}},
      blockId: "guests",
      elementId: "guests_increase",
    });
    expect(onAction).toHaveBeenNthCalledWith(2, {
      action: {kind: "callback", name: "scaleStepper", payload: {recipe: "roast", value: 4}},
      blockId: "guests",
      elementId: "guests_decrease",
    });
  });

  it("disables stepper buttons at the bounds, while pending, and for an unregistered callback", async () => {
    const onAction = mock(() => undefined);
    const disabled = (view: RenderedView, label: string): boolean =>
      iconButton(view, `${label} Number of people`).props.disabled === true;

    const atMin = renderWithTheme(
      <BlocksView document={STEPPER.replace("value: 5", "value: 1")} onAction={onAction} />
    );
    expect(disabled(atMin, "Decrease")).toBe(true);
    expect(disabled(atMin, "Increase")).toBe(false);
    await tap(atMin, "Decrease Number of people");
    expect(onAction).not.toHaveBeenCalled();

    const atMax = renderWithTheme(
      <BlocksView document={STEPPER.replace("value: 5", "value: 20")} />
    );
    expect(disabled(atMax, "Increase")).toBe(true);
    expect(disabled(atMax, "Decrease")).toBe(false);

    // With step 2, a value one partial step from a bound would step past it, so that button is off.
    const nearBounds = (value: number): string =>
      STEPPER.replace("value: 5", `value: ${value}\n        step: 2`);
    const nearMax = renderWithTheme(<BlocksView document={nearBounds(19)} onAction={onAction} />);
    expect(disabled(nearMax, "Increase")).toBe(true);
    expect(disabled(nearMax, "Decrease")).toBe(false);
    await tap(nearMax, "Increase Number of people");
    expect(onAction).not.toHaveBeenCalled();
    const nearMin = renderWithTheme(<BlocksView document={nearBounds(2)} onAction={onAction} />);
    expect(disabled(nearMin, "Decrease")).toBe(true);
    expect(disabled(nearMin, "Increase")).toBe(false);
    await tap(nearMin, "Decrease Number of people");
    expect(onAction).not.toHaveBeenCalled();
    const fullStep = renderWithTheme(<BlocksView document={nearBounds(18)} />);
    expect(disabled(fullStep, "Increase")).toBe(false);
    const fullStepDown = renderWithTheme(<BlocksView document={nearBounds(3)} />);
    expect(disabled(fullStepDown, "Decrease")).toBe(false);

    const pending = renderWithTheme(
      <BlocksView document={STEPPER} onAction={onAction} pendingElementIds={["guests_increase"]} />
    );
    expect(disabled(pending, "Increase")).toBe(true);
    expect(disabled(pending, "Decrease")).toBe(true);
    await tap(pending, "Decrease Number of people");
    expect(onAction).not.toHaveBeenCalled();

    const unregistered = renderWithTheme(
      <BlocksView document={STEPPER} hostActions={["other"]} onAction={onAction} />
    );
    expect(disabled(unregistered, "Increase")).toBe(true);
    expect(disabled(unregistered, "Decrease")).toBe(true);
  });

  it("renders a stepper override with the new value and amounts", () => {
    const {getByTestId, getByText, queryByText} = renderWithTheme(
      <BlocksView
        document={STEPPER}
        overrides={{
          guests: {
            callback: {name: "scaleStepper"},
            id: "guests",
            items: [
              {amount: 2.4, decimals: 1, label: "Bone-in leg of lamb", unit: "kg"},
              {amount: 10, label: "Carrots", round: "up"},
            ],
            label: "Number of people",
            max: 20,
            min: 1,
            type: "stepper",
            unit: "People",
            value: 6,
          },
        }}
      />
    );
    expect(getByTestId("blocks-0-0-value").props.children).toBe("6");
    expect(getByText("2.4 kg")).toBeTruthy();
    expect(getByText("10")).toBeTruthy();
    expect(queryByText("2.0 kg")).toBeNull();
  });

  describe("checklist", () => {
    const counter = (view: RenderedView): string =>
      String(view.getByTestId("blocks-0-counter").props.children);
    const tick = async (view: RenderedView, itemId: string): Promise<void> => {
      await press(view.getByTestId(`blocks-0-cooking_${itemId}-row-clickable`));
    };
    const isTicked = (view: RenderedView, itemId: string): boolean =>
      view.getByTestId(`blocks-0-cooking_${itemId}-checkbox`).props.style.backgroundColor !==
      "transparent";
    const rowState = (view: RenderedView, itemId: string): unknown =>
      view.getByTestId(`blocks-0-cooking_${itemId}-row-clickable`).props.accessibilityState;
    const overrideWith = (checkedIds: readonly string[]): Record<string, Block> => ({
      cooking: {
        callback: {name: "toggleChecklist", payload: {recipe: "roast"}},
        id: "cooking",
        items: CHECKLIST_ITEM_IDS.map((id) => ({
          checked: checkedIds.includes(id),
          id,
          text: `Step ${id}`,
        })),
        title: "Cooking checklist",
        type: "checklist",
      },
    });

    it("renders the title, the n of m counter, and a row per item", () => {
      const view = renderWithTheme(<BlocksView document={CHECKLIST} />);
      expect(view.getByText("Cooking checklist")).toBeTruthy();
      expect(counter(view)).toBe("1 of 8");
      expect(view.getByText("1:00 pm")).toBeTruthy();
      expect(view.getByText("Preheat the oven")).toBeTruthy();
      expect(view.getByText("220 C, fan off.")).toBeTruthy();
      expect(view.getByText("Carve and serve")).toBeTruthy();
      expect(isTicked(view, "oven")).toBe(true);
      expect(isTicked(view, "lamb_in")).toBe(false);
      expect(view.getByTestId("blocks-0-cooking_lamb_in-row-clickable").props["aria-label"]).toBe(
        "Put the lamb in"
      );
    });

    it("shows each row's bold text first, then the small muted meta, then the muted detail", () => {
      const view = renderWithTheme(<BlocksView document={CHECKLIST} />);
      const rowPath = "blocks-0-cooking_oven";
      const ids = [
        ...new Set(
          view
            .getByTestId(rowPath)
            .findAll((node) => typeof node.props.testID === "string")
            .map((node) => String(node.props.testID))
            .filter((id) => /-(text|meta|detail)$/.test(id))
        ),
      ];
      expect(ids).toEqual([`${rowPath}-text`, `${rowPath}-meta`, `${rowPath}-detail`]);
      const propsOf = (testID: string): Record<string, unknown> => {
        const [node] = view.UNSAFE_root.findAll((candidate) => candidate.props.testID === testID);
        return node?.props ?? {};
      };
      expect(propsOf(`${rowPath}-text`)).toMatchObject({bold: true, children: "Preheat the oven"});
      expect(propsOf(`${rowPath}-meta`)).toMatchObject({
        children: "1:00 pm",
        color: "secondaryLight",
        size: "sm",
      });
      expect(propsOf(`${rowPath}-detail`)).toMatchObject({
        children: "220 C, fan off.",
        color: "secondaryLight",
      });
      expect(view.queryByTestId("blocks-0-cooking_veg-meta")).toBeNull();
      expect(view.queryByTestId("blocks-0-cooking_veg-detail")).toBeNull();
    });

    it("exposes each row as a labelled checkbox with its checked state, kept while locked", () => {
      const props = {document: CHECKLIST, hostActions: ["toggleChecklist"], onAction: () => {}};
      const view = renderWithTheme(<BlocksView {...props} />);
      const row = (itemId: string): {props: Record<string, unknown>} =>
        view.getByTestId(`blocks-0-cooking_${itemId}-row-clickable`);
      expect(row("oven").props.accessibilityRole).toBe("checkbox");
      expect(row("oven").props["aria-label"]).toBe("Preheat the oven");
      expect(row("oven").props["aria-checked"]).toBe(true);
      expect(rowState(view, "oven")).toEqual({checked: true, disabled: false});
      expect(row("lamb_in").props["aria-checked"]).toBe(false);
      expect(rowState(view, "lamb_in")).toEqual({checked: false, disabled: false});

      view.rerender(<BlocksView {...props} pendingElementIds={["cooking_oven"]} />);
      expect(row("lamb_in").props.accessibilityRole).toBe("checkbox");
      expect(row("lamb_in").props["aria-label"]).toBe("Put the lamb in");
      expect(row("lamb_in").props["aria-disabled"]).toBe(true);
      expect(rowState(view, "oven")).toEqual({checked: true, disabled: true});
    });

    it("ticks items on the device when the checklist has no callback", async () => {
      const onAction = mock(() => undefined);
      const view = renderWithTheme(
        <BlocksView
          document={LOCAL_CHECKLIST}
          hostActions={["toggleChecklist"]}
          onAction={onAction}
        />
      );
      await tick(view, "lamb_in");
      expect(counter(view)).toBe("2 of 8");
      expect(isTicked(view, "lamb_in")).toBe(true);
      await tick(view, "oven");
      expect(counter(view)).toBe("1 of 8");
      expect(isTicked(view, "oven")).toBe(false);
      expect(onAction).not.toHaveBeenCalled();
    });

    it("keeps ticks local to each rendered document", async () => {
      const first = renderWithTheme(<BlocksView document={LOCAL_CHECKLIST} />);
      await tick(first, "veg");
      // Testing Library ignores presses outside the latest render, so the second view mounts after.
      const second = renderWithTheme(<BlocksView document={LOCAL_CHECKLIST} />);
      expect(counter(first)).toBe("2 of 8");
      expect(counter(second)).toBe("1 of 8");
    });

    it("ticks locally when the callback is not a registered host action", async () => {
      const onAction = mock(() => undefined);
      const view = renderWithTheme(
        <BlocksView document={CHECKLIST} hostActions={["other"]} onAction={onAction} />
      );
      await tick(view, "lamb_in");
      expect(counter(view)).toBe("2 of 8");
      expect(onAction).not.toHaveBeenCalled();
    });

    it("emits the tick with the full state and waits for the override", async () => {
      const onAction = mock(() => undefined);
      const view = renderWithTheme(
        <BlocksView document={CHECKLIST} hostActions={["toggleChecklist"]} onAction={onAction} />
      );
      await tick(view, "lamb_in");
      expect(onAction).toHaveBeenCalledTimes(1);
      expect(onAction).toHaveBeenCalledWith({
        action: {
          kind: "callback",
          name: "toggleChecklist",
          payload: {
            checked: true,
            itemId: "lamb_in",
            recipe: "roast",
            state: {
              carve: false,
              gravy: false,
              lamb_in: true,
              oven: true,
              parsnips: false,
              potatoes: false,
              rest: false,
              veg: false,
            },
          },
        },
        blockId: "cooking",
        elementId: "cooking_lamb_in",
      });
      expect(counter(view)).toBe("1 of 8");
      expect(isTicked(view, "lamb_in")).toBe(false);

      view.rerender(
        <BlocksView
          document={CHECKLIST}
          hostActions={["toggleChecklist"]}
          onAction={onAction}
          pendingElementIds={["cooking_lamb_in"]}
        />
      );
      expect(rowState(view, "lamb_in")).toEqual({checked: false, disabled: true});
      expect(counter(view)).toBe("1 of 8");

      view.rerender(
        <BlocksView
          document={CHECKLIST}
          hostActions={["toggleChecklist"]}
          onAction={onAction}
          overrides={overrideWith(["oven", "lamb_in"])}
        />
      );
      expect(counter(view)).toBe("2 of 8");
      expect(isTicked(view, "lamb_in")).toBe(true);
    });

    it("disables the whole checklist while a tick is pending", async () => {
      const onAction = mock(() => undefined);
      const props = {document: CHECKLIST, hostActions: ["toggleChecklist"], onAction};
      const view = renderWithTheme(<BlocksView {...props} />);
      await tick(view, "lamb_in");
      view.rerender(<BlocksView {...props} pendingElementIds={["cooking_lamb_in"]} />);
      expect(rowState(view, "veg")).toEqual({checked: false, disabled: true});
      await tick(view, "veg");
      expect(onAction).toHaveBeenCalledTimes(1);

      view.rerender(<BlocksView {...props} overrides={overrideWith(["oven", "lamb_in"])} />);
      await tick(view, "veg");
      expect(onAction).toHaveBeenCalledTimes(2);
      const [event] = onAction.mock.calls[1] as unknown as [
        {action: {payload: {itemId: string; state: Record<string, boolean>}}},
      ];
      expect(event.action.payload.itemId).toBe("veg");
      expect(event.action.payload.state).toMatchObject({lamb_in: true, oven: true, veg: true});
    });

    it("emits the tick when hostActions is omitted, like the stepper", async () => {
      const onAction = mock(() => undefined);
      const view = renderWithTheme(<BlocksView document={CHECKLIST} onAction={onAction} />);
      await tick(view, "oven");
      expect(onAction).toHaveBeenCalledTimes(1);
      const [event] = onAction.mock.calls[0] as unknown as [
        {action: {payload: {checked: boolean; itemId: string}}},
      ];
      expect(event.action.payload.itemId).toBe("oven");
      expect(event.action.payload.checked).toBe(false);
      expect(counter(view)).toBe("1 of 8");
    });

    it("drops local ticks when an override for the checklist arrives", async () => {
      const view = renderWithTheme(<BlocksView document={LOCAL_CHECKLIST} />);
      await tick(view, "veg");
      expect(counter(view)).toBe("2 of 8");
      view.rerender(
        <BlocksView
          document={LOCAL_CHECKLIST}
          overrides={overrideWith(["gravy", "rest", "carve"])}
        />
      );
      expect(counter(view)).toBe("3 of 8");
      expect(isTicked(view, "veg")).toBe(false);
      expect(isTicked(view, "gravy")).toBe(true);
    });
  });

  describe("gallery", () => {
    const PIXEL = "data:image/png;base64,iVBORw0KGgo=";
    const galleryOf = (count: number): string =>
      `v: 1
blocks:
  - type: gallery
    id: roast_photos
    images:
${Array.from({length: count}, (_, index) => {
  const caption = index === 0 ? "\n        caption: Roast lamb" : "";
  return `      - src: "${PIXEL}"\n        alt: Photo ${index + 1}${caption}`;
}).join("\n")}
`;
    const measure = async (view: RenderedView, testID: string, width: number): Promise<void> => {
      await act(async () => {
        fireEvent(view.getByTestId(testID), "layout", {
          nativeEvent: {layout: {height: 300, width, x: 0, y: 0}},
        });
      });
    };
    const imageSizes = (view: RenderedView): {height?: number; width?: number}[] =>
      view
        .UNSAFE_getAllByType(NativeImage)
        .map((node) => StyleSheet.flatten(node.props.style) as {height?: number; width?: number})
        .map(({height, width}) => ({height, width}));
    // Composite and host nodes share a testID, so ids are deduplicated in render order.
    const tileIdsIn = (view: RenderedView, rowTestID: string): string[] => [
      ...new Set(
        view
          .getByTestId(rowTestID)
          .findAll((node) => typeof node.props.testID === "string")
          .map((node) => String(node.props.testID))
          .filter((id) => /^blocks-0-image-\d+$/.test(id))
      ),
    ];

    it("draws up to three @terreno/ui Image tiles in one 4:3 row with alt as the accessible label", async () => {
      const view = renderWithTheme(<BlocksView document={galleryOf(3)} />);
      await measure(view, "blocks-0", 600);
      expect(view.UNSAFE_getAllByType(Image)).toHaveLength(3);
      const images = view.UNSAFE_getAllByType(NativeImage);
      expect(images.map((node) => node.props.accessibilityLabel)).toEqual([
        "Photo 1",
        "Photo 2",
        "Photo 3",
      ]);
      expect(images.every((node) => node.props.source.uri === PIXEL)).toBe(true);
      // (600 - 2 gaps of 8) / 3 = 194.67, floored; 194 * 3 / 4 = 145.5, rounded.
      expect(imageSizes(view)).toEqual([
        {height: 146, width: 194},
        {height: 146, width: 194},
        {height: 146, width: 194},
      ]);
      expect(tileIdsIn(view, "blocks-0-row-0")).toEqual([
        "blocks-0-image-0",
        "blocks-0-image-1",
        "blocks-0-image-2",
      ]);
      expect(view.queryByTestId("blocks-0-row-1")).toBeNull();
      expect(view.queryByTestId("blocks-0-scroll")).toBeNull();
    });

    it("gives each loaded tile image the <tile>-image test ID, like list thumbnails", () => {
      const view = renderWithTheme(<BlocksView document={galleryOf(3)} />);
      for (const index of [0, 1, 2]) {
        const frame = view.getByTestId(`blocks-0-image-${index}-image`);
        expect(frame.findAllByType(NativeImage)).toHaveLength(1);
        expect(frame.findByType(NativeImage).props.accessibilityLabel).toBe(`Photo ${index + 1}`);
      }
      expect(view.queryByTestId("blocks-0-image-0-placeholder")).toBeNull();
    });

    it("shows a caption as small muted text under its tile", () => {
      const view = renderWithTheme(<BlocksView document={galleryOf(2)} />);
      const caption = view.getByTestId("blocks-0-image-0-caption");
      expect(caption.props.children).toBe("Roast lamb");
      expect(view.queryByTestId("blocks-0-image-1-caption")).toBeNull();
    });

    it("splits two images across the row as equal halves", async () => {
      const view = renderWithTheme(<BlocksView document={galleryOf(2)} />);
      await measure(view, "blocks-0", 408);
      expect(imageSizes(view)).toEqual([
        {height: 150, width: 200},
        {height: 150, width: 200},
      ]);
    });

    it("wraps more than three images into a three-column grid", async () => {
      const view = renderWithTheme(<BlocksView document={galleryOf(5)} />);
      await measure(view, "blocks-0", 600);
      expect(tileIdsIn(view, "blocks-0-row-0")).toEqual([
        "blocks-0-image-0",
        "blocks-0-image-1",
        "blocks-0-image-2",
      ]);
      expect(tileIdsIn(view, "blocks-0-row-1")).toEqual(["blocks-0-image-3", "blocks-0-image-4"]);
      expect(imageSizes(view).every(({width}) => width === 194)).toBe(true);
    });

    it("uses 160 wide tiles until the gallery is measured", () => {
      const view = renderWithTheme(<BlocksView document={galleryOf(3)} />);
      expect(imageSizes(view)[0]).toEqual({height: 120, width: 160});
      expect(view.getByTestId("blocks-0-row-0")).toBeTruthy();
    });

    it("scrolls one row sideways when tiles would be narrower than 160", async () => {
      const view = renderWithTheme(<BlocksView document={galleryOf(5)} />);
      await measure(view, "blocks-0", 320);
      expect(view.queryByTestId("blocks-0-row-0")).toBeNull();
      expect(tileIdsIn(view, "blocks-0-scroll")).toHaveLength(5);
      expect(view.UNSAFE_getAllByType(ScrollView).some((node) => node.props.horizontal)).toBe(true);
      expect(imageSizes(view).every(({height, width}) => width === 160 && height === 120)).toBe(
        true
      );
    });

    it("loads file: tiles inside a card through resolveImage and keeps an unresolved tile as a labelled placeholder", async () => {
      const document = `v: 1
blocks:
  - type: card
    children:
      - type: gallery
        images:
          - src: file:table-setting
            alt: A table set for six
          - src: file:flowers
            alt: A jug of spring flowers
`;
      const resolveImage = mock(async (id: string) =>
        id === "table-setting" ? "https://cdn.example/table.png" : undefined
      );
      const view = renderWithTheme(<BlocksView document={document} resolveImage={resolveImage} />);
      await waitFor(() => {
        expect(view.UNSAFE_getAllByType(NativeImage)).toHaveLength(1);
      });
      expect(resolveImage).toHaveBeenCalledWith("table-setting");
      expect(resolveImage).toHaveBeenCalledWith("flowers");
      const [loaded] = view.UNSAFE_getAllByType(NativeImage);
      expect(loaded?.props.source.uri).toBe("https://cdn.example/table.png");
      expect(loaded?.props.accessibilityLabel).toBe("A table set for six");
      const placeholder = view.getByTestId("blocks-0-0-image-1-placeholder");
      expect(placeholder.props.accessibilityLabel).toBe("A jug of spring flowers");
      expect(view.getByText("A jug of spring flowers")).toBeTruthy();
    });
  });

  describe("list", () => {
    const PIXEL = "data:image/png;base64,iVBORw0KGgo=";
    const MENU = `v: 1
blocks:
  - type: list
    id: menu
    items:
      - title: Roast leg of lamb
        text: Rubbed with garlic and rosemary.
        meta: Main
        image: {src: "${PIXEL}", alt: Roast leg of lamb on a carving board}
      - title: Crisp potatoes
        image: {src: "${PIXEL}", alt: Crisp roast potatoes in a tray}
`;
    const textProps = (
      view: RenderedView,
      testID: string
    ): {bold?: boolean; children?: unknown; color?: string; size?: string} => {
      // `Text` is memoized, so the outermost node with the testID carries the props the renderer passed.
      const [node] = view.UNSAFE_root.findAll((candidate) => candidate.props.testID === testID);
      if (node === undefined) {
        throw new Error(`No Text with testID ${testID}`);
      }
      return node.props;
    };
    // Composite and host nodes share a testID, so ids are deduplicated in render order.
    const idsIn = (view: RenderedView, testID: string, pattern: RegExp): string[] => [
      ...new Set(
        view
          .getByTestId(testID)
          .findAll((node) => typeof node.props.testID === "string")
          .map((node) => String(node.props.testID))
          .filter((id) => pattern.test(id))
      ),
    ];

    it("draws each item as a 112 by 149 (3:4) @terreno/ui Image left of the title, with alt as the accessible label", () => {
      const view = renderWithTheme(<BlocksView document={MENU} />);
      expect(view.UNSAFE_getAllByType(Image)).toHaveLength(2);
      const images = view.UNSAFE_getAllByType(NativeImage);
      expect(images.map((node) => node.props.accessibilityLabel)).toEqual([
        "Roast leg of lamb on a carving board",
        "Crisp roast potatoes in a tray",
      ]);
      expect(images.every((node) => node.props.source.uri === PIXEL)).toBe(true);
      expect(
        images.map((node) => {
          const {height, width} = StyleSheet.flatten(node.props.style) as {
            height?: number;
            width?: number;
          };
          return {height, width};
        })
      ).toEqual([
        {height: 149, width: 112},
        {height: 149, width: 112},
      ]);
      expect(idsIn(view, "blocks-0-item-0", /^blocks-0-item-0-(image|body)$/)).toEqual([
        "blocks-0-item-0-image",
        "blocks-0-item-0-body",
      ]);
    });

    it("shows the meta small and muted above a bold title, then muted plain text", () => {
      const view = renderWithTheme(<BlocksView document={MENU} />);
      expect(idsIn(view, "blocks-0-item-0-body", /^blocks-0-item-0-(meta|title|text)$/)).toEqual([
        "blocks-0-item-0-meta",
        "blocks-0-item-0-title",
        "blocks-0-item-0-text",
      ]);
      expect(textProps(view, "blocks-0-item-0-meta")).toMatchObject({
        children: "Main",
        color: "secondaryLight",
        size: "sm",
      });
      expect(textProps(view, "blocks-0-item-0-title")).toMatchObject({
        bold: true,
        children: "Roast leg of lamb",
      });
      expect(textProps(view, "blocks-0-item-0-text")).toMatchObject({
        children: "Rubbed with garlic and rosemary.",
        color: "secondaryLight",
      });
      expect(view.queryByTestId("blocks-0-item-1-meta")).toBeNull();
      expect(view.queryByTestId("blocks-0-item-1-text")).toBeNull();
    });

    it("draws item text as plain text, not markdown", () => {
      const document = `v: 1
blocks:
  - type: list
    items:
      - title: Mint sauce
        text: "**Fresh** mint, sugar, and vinegar"
`;
      const view = renderWithTheme(<BlocksView document={document} />);
      expect(textProps(view, "blocks-0-item-0-text").children).toBe(
        "**Fresh** mint, sugar, and vinegar"
      );
      expect(view.UNSAFE_queryAllByType(MarkdownView)).toHaveLength(0);
    });

    it("keeps a 112 wide gutter for an item without an image when another item has one, so titles line up", () => {
      const document = `v: 1
blocks:
  - type: list
    items:
      - title: Roast leg of lamb
        image: {src: "${PIXEL}", alt: Roast leg of lamb}
      - title: Mint sauce
`;
      const view = renderWithTheme(<BlocksView document={document} />);
      expect(view.queryByTestId("blocks-0-item-1-image")).toBeNull();
      const gutter = view.getByTestId("blocks-0-item-1-gutter");
      expect(StyleSheet.flatten(gutter.props.style)).toMatchObject({width: 112});
      expect(view.queryByTestId("blocks-0-item-0-gutter")).toBeNull();
    });

    it("draws a list with no images as text only, with no gutter", () => {
      const document = `v: 1
blocks:
  - type: list
    items:
      - title: Mint sauce
      - title: Redcurrant jelly
`;
      const view = renderWithTheme(<BlocksView document={document} />);
      expect(view.UNSAFE_queryAllByType(Image)).toHaveLength(0);
      expect(view.queryByTestId("blocks-0-item-0-gutter")).toBeNull();
      expect(view.queryByTestId("blocks-0-item-1-gutter")).toBeNull();
      expect(textProps(view, "blocks-0-item-1-title").children).toBe("Redcurrant jelly");
    });

    it("loads file: thumbnails inside a card through resolveImage and keeps an unresolved one as a labelled 3:4 placeholder", async () => {
      const document = `v: 1
blocks:
  - type: card
    children:
      - type: list
        items:
          - title: Roast leg of lamb
            image: {src: "file:roast-lamb", alt: Roast leg of lamb on a carving board}
          - title: Apple crumble
            image: {src: "file:crumble", alt: Apple crumble with custard}
`;
      const resolveImage = mock(async (id: string) =>
        id === "roast-lamb" ? "https://cdn.example/lamb.png" : undefined
      );
      const view = renderWithTheme(<BlocksView document={document} resolveImage={resolveImage} />);
      await waitFor(() => {
        expect(view.UNSAFE_getAllByType(NativeImage)).toHaveLength(1);
      });
      expect(resolveImage).toHaveBeenCalledWith("roast-lamb");
      expect(resolveImage).toHaveBeenCalledWith("crumble");
      const [loaded] = view.UNSAFE_getAllByType(NativeImage);
      expect(loaded?.props.source.uri).toBe("https://cdn.example/lamb.png");
      expect(loaded?.props.accessibilityLabel).toBe("Roast leg of lamb on a carving board");
      const placeholder = view.getByTestId("blocks-0-0-item-1-placeholder");
      expect(placeholder.props.accessibilityLabel).toBe("Apple crumble with custard");
      expect(StyleSheet.flatten(placeholder.props.style)).toMatchObject({height: 149, width: 112});
      expect(view.getByText("Apple crumble with custard")).toBeTruthy();
    });
  });

  describe("copy", () => {
    const mockedSetStringAsync = setStringAsync as unknown as ReturnType<typeof mock>;
    const COPY_DOC = `v: 1
datasets:
  cuts:
    columns:
      - {name: cut, type: string}
      - {name: kg, type: number}
    rows:
      - [Leg, 2.4]
      - [Shoulder, 2]
  prices:
    source: ref
    id: ds_prices
blocks:
${STEPPER.split("blocks:\n")[1]}  - type: checklist
    id: cooking
    items:
      - {id: oven, text: Preheat the oven, checked: true}
      - {id: lamb_in, text: Put the lamb in}
  - type: table
    id: cuts_table
    data: cuts
  - type: table
    id: price_table
    data: prices
  - type: actions
    id: copy_actions
    elements:
      - {type: button, id: copy_list, text: Copy shopping list, action: {kind: copy, target: guests}}
      - {type: button, id: copy_note, text: Copy note, action: {kind: copy, text: Bring a bottle of red}}
      - {type: button, id: copy_steps, text: Copy steps, action: {kind: copy, target: cooking}}
      - {type: button, id: copy_cuts, text: Copy cuts, action: {kind: copy, target: cuts_table}}
      - {type: button, id: copy_prices, text: Copy prices, action: {kind: copy, target: price_table}}
`;
    const SIX_GUESTS: Block = {
      callback: {name: "scaleStepper"},
      id: "guests",
      items: [
        {amount: 2.4, decimals: 1, label: "Bone-in leg of lamb", unit: "kg"},
        {amount: 10, label: "Carrots", round: "up"},
      ],
      label: "Number of people",
      max: 20,
      min: 1,
      type: "stepper",
      unit: "People",
      value: 6,
    };
    const status = (view: RenderedView, elementId: string): string | undefined => {
      const text = view.queryByTestId(`blocks-4-${elementId}-status-text`);
      return text === null ? undefined : String(text.props.children);
    };
    // Flushes the haptic and clipboard promises without real timers, so fake timers can run.
    const pressCopy = async (view: RenderedView, elementId: string): Promise<void> => {
      await act(async () => {
        fireEvent.press(view.getByTestId(`blocks-4-${elementId}`));
        for (let index = 0; index < 50; index += 1) {
          await Promise.resolve();
        }
      });
    };

    afterEach(() => {
      jest.useRealTimers();
      mockedSetStringAsync.mockClear();
    });

    it("copies the scaled shopping list from a stepper at 6 and shows Copied, without calling onAction", async () => {
      const onAction = mock(() => undefined);
      const view = renderWithTheme(
        <BlocksView
          document={COPY_DOC}
          hostActions={["scaleStepper"]}
          onAction={onAction}
          overrides={{guests: SIX_GUESTS}}
        />
      );
      expect(status(view, "copy_list")).toBeUndefined();
      await pressCopy(view, "copy_list");
      expect(mockedSetStringAsync).toHaveBeenCalledTimes(1);
      expect(mockedSetStringAsync).toHaveBeenCalledWith(
        "Number of people: 6 People\nBone-in leg of lamb: 2.4 kg\nCarrots: 10"
      );
      expect(status(view, "copy_list")).toBe("Copied");
      expect(onAction).not.toHaveBeenCalled();
    });

    it("copies the override that arrived after the first render", async () => {
      const view = renderWithTheme(
        <BlocksView document={COPY_DOC} hostActions={["scaleStepper"]} />
      );
      view.rerender(
        <BlocksView
          document={COPY_DOC}
          hostActions={["scaleStepper"]}
          overrides={{guests: SIX_GUESTS}}
        />
      );
      await pressCopy(view, "copy_list");
      expect(mockedSetStringAsync).toHaveBeenCalledWith(
        "Number of people: 6 People\nBone-in leg of lamb: 2.4 kg\nCarrots: 10"
      );
    });

    it("announces the status in a polite live region", async () => {
      const view = renderWithTheme(<BlocksView document={COPY_DOC} />);
      expect(view.getByTestId("blocks-4-copy_note-status").props["aria-live"]).toBe("polite");
      await pressCopy(view, "copy_note");
      expect(status(view, "copy_note")).toBe("Copied");
      expect(view.getByTestId("blocks-4-copy_note-status").props["aria-live"]).toBe("polite");
    });

    it("copies literal text", async () => {
      const view = renderWithTheme(<BlocksView document={COPY_DOC} />);
      await pressCopy(view, "copy_note");
      expect(mockedSetStringAsync).toHaveBeenCalledWith("Bring a bottle of red");
    });

    it("copies a checklist with the ticks made on the device", async () => {
      const view = renderWithTheme(<BlocksView document={COPY_DOC} />);
      await press(view.getByTestId("blocks-1-cooking_lamb_in-row-clickable"));
      await press(view.getByTestId("blocks-1-cooking_oven-row-clickable"));
      await pressCopy(view, "copy_steps");
      expect(mockedSetStringAsync).toHaveBeenCalledWith(
        "[ ] Preheat the oven\n[x] Put the lamb in"
      );
    });

    it("copies an inline table and a ref table once resolveDataset returns its rows", async () => {
      const resolveDataset = mock(async () => ({
        columns: [
          {name: "cut", type: "string" as const},
          {name: "price", type: "number" as const},
        ],
        rows: [["Leg", 32]],
      }));
      const view = renderWithTheme(
        <BlocksView document={COPY_DOC} resolveDataset={resolveDataset} />
      );
      await waitFor(() => {
        expect(view.getByText("32")).toBeTruthy();
      });
      await pressCopy(view, "copy_cuts");
      expect(mockedSetStringAsync).toHaveBeenLastCalledWith("cut\tkg\nLeg\t2.4\nShoulder\t2");
      await pressCopy(view, "copy_prices");
      expect(mockedSetStringAsync).toHaveBeenLastCalledWith("cut\tprice\nLeg\t32");
    });

    it("shows Couldn't copy when the clipboard write fails, and does not throw", async () => {
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      mockedSetStringAsync.mockImplementationOnce(() => Promise.reject(new Error("denied")));
      const view = renderWithTheme(<BlocksView document={COPY_DOC} />);
      await pressCopy(view, "copy_note");
      expect(status(view, "copy_note")).toBe("Couldn't copy");
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it("shows Couldn't copy without writing when a ref table has no rows yet", async () => {
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      const view = renderWithTheme(<BlocksView document={COPY_DOC} />);
      await pressCopy(view, "copy_prices");
      expect(mockedSetStringAsync).not.toHaveBeenCalled();
      expect(status(view, "copy_prices")).toBe("Couldn't copy");
      warn.mockRestore();
    });

    it("clears Copied after 2 seconds and cancels the timer on unmount", async () => {
      jest.useFakeTimers();
      const view = renderWithTheme(<BlocksView document={COPY_DOC} />);
      await pressCopy(view, "copy_note");
      expect(status(view, "copy_note")).toBe("Copied");
      act(() => {
        jest.advanceTimersByTime(1999);
      });
      expect(status(view, "copy_note")).toBe("Copied");
      act(() => {
        jest.advanceTimersByTime(1);
      });
      expect(status(view, "copy_note")).toBeUndefined();
      view.unmount();

      // A fresh view: the Button press cooldown reads Date.now, which fake timers do not move.
      const setTimeoutSpy = jest.spyOn(globalThis, "setTimeout");
      const clearTimeoutSpy = jest.spyOn(globalThis, "clearTimeout");
      const unmounted = renderWithTheme(<BlocksView document={COPY_DOC} />);
      await pressCopy(unmounted, "copy_note");
      expect(status(unmounted, "copy_note")).toBe("Copied");
      // The status timer is the 2 second one; other components may hold their own timers.
      const statusTimerIndex = setTimeoutSpy.mock.calls.findIndex(([, delay]) => delay === 2000);
      expect(statusTimerIndex).toBeGreaterThanOrEqual(0);
      const statusTimer = setTimeoutSpy.mock.results[statusTimerIndex]?.value;
      unmounted.unmount();
      expect(clearTimeoutSpy.mock.calls.some(([id]) => id === statusTimer)).toBe(true);
      setTimeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
    });

    it("keeps copy buttons enabled when hostActions is passed", () => {
      const view = renderWithTheme(<BlocksView document={COPY_DOC} hostActions={[]} />);
      expect(view.getByTestId("blocks-4-copy_list").props.accessibilityState.disabled).toBe(false);
    });
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
