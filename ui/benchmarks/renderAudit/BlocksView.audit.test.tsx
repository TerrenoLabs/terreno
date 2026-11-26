import {describe, expect, it} from "bun:test";
import type {BlocksDocument} from "@terreno/blocks";
import {act, fireEvent} from "@testing-library/react-native";

import {BlocksView} from "../../src/blocks/BlocksView";
import {renderWithTheme} from "../../src/test-utils";
import {auditComponent} from "./auditComponent";
import {componentStat, createRenderAudit, formatReport} from "./renderAudit";

const DATASETS = {
  signups: {
    columns: [
      {name: "month", type: "string"},
      {name: "count", type: "number"},
    ],
    rows: Array.from({length: 8}, (_, index) => [`M${index}`, index * 10]),
  },
};

const buildDocument = (): BlocksDocument =>
  ({
    blocks: [
      {size: "md", text: "Morning plan", type: "heading"},
      {markdown: "Here is **today**.", type: "text"},
      {label: "Signups", type: "metric", value: "120"},
      {
        id: "tasks",
        items: Array.from({length: 8}, (_, index) => ({
          detail: `Detail ${index}`,
          id: `item_${index}`,
          meta: `0${index}:00`,
          text: `Task ${index}`,
        })),
        title: "Tasks",
        type: "checklist",
      },
      {
        items: Array.from({length: 8}, (_, index) => ({
          meta: `Meta ${index}`,
          text: `Text ${index}`,
          title: `Title ${index}`,
        })),
        type: "list",
      },
      {data: "signups", id: "signups_table", title: "Signups", type: "table"},
      {data: "signups", id: "signups_chart", kind: "bar", type: "chart", x: "month", y: "count"},
      {
        id: "photos",
        images: Array.from({length: 6}, (_, index) => ({
          alt: `Photo ${index}`,
          caption: `Caption ${index}`,
          src: "file:photo",
        })),
        type: "gallery",
      },
      {
        elements: [
          {action: {kind: "reply", text: "Thanks"}, id: "reply_btn", text: "Reply", type: "button"},
          {action: {kind: "copy", text: "hello"}, id: "copy_btn", text: "Copy", type: "button"},
        ],
        id: "actions",
        type: "actions",
      },
    ],
    datasets: DATASETS,
    v: 1,
  }) as unknown as BlocksDocument;

const document = buildDocument();
const documentString = JSON.stringify(document);
const handleAction = (): void => {};
const baseline = {
  document: document as BlocksDocument | string,
  onAction: handleAction,
  streaming: false,
};

describe("BlocksView renders", () => {
  it("skips unchanged blocks when the parent re-renders with an object document", async () => {
    const report = await auditComponent({
      baseline,
      Component: BlocksView,
      changes: {
        "new equal document": {...baseline, document: buildDocument()},
        "new onAction identity": {...baseline, onAction: (): void => {}},
        "one item pending": {...baseline, pendingElementIds: ["reply_btn"]} as typeof baseline,
      },
      name: "BlocksView",
    });
    for (const step of ["same props", "new onAction identity"]) {
      expect(componentStat(report, step, "ChecklistRowContent")).toBeUndefined();
      expect(componentStat(report, step, "GalleryTile")).toBeUndefined();
      expect(componentStat(report, step, "TableBlockView")).toBeUndefined();
      expect(componentStat(report, step, "ChartBlockView")).toBeUndefined();
    }
  });

  it("skips unchanged blocks when the parent re-renders with a string document", async () => {
    const stringBaseline = {...baseline, document: documentString};
    const report = await auditComponent({
      baseline: stringBaseline,
      Component: BlocksView,
      changes: {
        "new onAction identity": {...stringBaseline, onAction: (): void => {}},
      },
      name: "BlocksViewString",
    });
    for (const step of ["same props", "new onAction identity"]) {
      expect(componentStat(report, step, "ChecklistRowContent")).toBeUndefined();
      expect(componentStat(report, step, "TableBlockView")).toBeUndefined();
      expect(componentStat(report, step, "ChartBlockView")).toBeUndefined();
    }
  });

  it("re-renders only the ticked checklist row", async () => {
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    // Mounted inside a step so the collector knows every fiber before the interaction.
    let mounted: ReturnType<typeof renderWithTheme> | undefined;
    await audit.step("mount", async (): Promise<void> => {
      mounted = renderWithTheme(<BlocksView document={document} testID="doc" />);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    });
    const view = mounted as ReturnType<typeof renderWithTheme>;
    const row = await view.findByTestId("blocks-3-tasks_item_2-row-clickable");
    await audit.step("tick one item", async (): Promise<void> => {
      await act(async () => {
        fireEvent.press(row);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    });
    const report = audit.report();
    audit.dispose();
    view.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(formatReport(report, {limit: 40}));
    }
    expect(componentStat(report, "tick one item", "ChecklistRowContent")?.updates).toBe(1);
    expect(componentStat(report, "tick one item", "TableBlockView")).toBeUndefined();
    expect(componentStat(report, "tick one item", "ChartBlockView")).toBeUndefined();
    expect(componentStat(report, "tick one item", "GalleryTile")).toBeUndefined();
  });
});
