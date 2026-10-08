import {describe, expect, it, mock} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {act, fireEvent, waitFor} from "@testing-library/react-native";
import {ActivityIndicator, Image as NativeImage, StyleSheet} from "react-native";

import {IconButton} from "../IconButton";
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
