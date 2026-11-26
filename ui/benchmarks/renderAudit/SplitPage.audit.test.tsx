import {describe, expect, it} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import type {ReactElement} from "react";
import type {ListRenderItemInfo} from "react-native";

import type {SplitPageListItem} from "../../src/Common";
import {SplitPage} from "../../src/SplitPage";
import {Text} from "../../src/Text";
import {renderWithTheme} from "../../src/test-utils";
import {auditPropChanges, componentStat, createRenderAudit, formatReport} from "./renderAudit";

interface Item extends SplitPageListItem {
  name: string;
}

const listViewData: Item[] = Array.from({length: 10}, (_, index) => ({
  id: `item-${index}`,
  name: `Item ${index}`,
}));

const ListRow = ({name}: {name: string}): ReactElement => <Text>{name}</Text>;
const Detail = ({index}: {index?: number}): ReactElement => (
  <Text>{`Detail ${index ?? "none"}`}</Text>
);

const renderListViewItem = ({item}: ListRenderItemInfo<Item>): ReactElement => (
  <ListRow name={item.name} />
);
const renderContent = (index?: number): ReactElement => <Detail index={index} />;
const onSelectionChange = (): void => {};
const baseline = {
  listViewData,
  narrowBelowWidth: 100,
  onSelectionChange,
  renderContent,
  renderListViewItem,
};

describe("SplitPage renders", () => {
  it("keeps the list rows out of a selection change", async () => {
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    let view: ReturnType<typeof renderWithTheme> | undefined;
    await auditPropChanges({
      audit,
      baseline,
      changes: {
        "loading on": {...baseline, loading: true},
        "new listViewData array": {...baseline, listViewData: [...listViewData]},
        "new onSelectionChange identity": {...baseline, onSelectionChange: (): void => {}},
        "new renderListViewItem identity": {
          ...baseline,
          renderListViewItem: ({item}: ListRenderItemInfo<Item>): ReactElement => (
            <ListRow name={item.name} />
          ),
        },
      },
      mount: (props): void => {
        view = renderWithTheme(<SplitPage<Item> {...props} />);
      },
      update: (props): void => {
        view?.rerender(<SplitPage<Item> {...props} />);
      },
    });
    const pressableRows = (): ReturnType<
      ReturnType<typeof renderWithTheme>["getAllByLabelText"]
    > => {
      if (!view) {
        throw new Error("SplitPage did not mount");
      }
      return view.getAllByLabelText("Select");
    };
    await audit.step("select item 2", async () => {
      await act(async () => {
        fireEvent.press(pressableRows()[2]);
      });
    });
    await audit.step("select item 5", async () => {
      await act(async () => {
        fireEvent.press(pressableRows()[5]);
      });
    });
    const report = audit.report();
    audit.dispose();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(formatReport(report, {limit: 25}));
    }
    view?.unmount();

    // Selecting an item changes the detail side only.
    expect(componentStat(report, "select item 2", "Detail")?.updates).toBe(1);
    expect(componentStat(report, "select item 2", "SplitPageListInner")).toBeUndefined();
    expect(componentStat(report, "select item 2", "ListRow")).toBeUndefined();
    expect(componentStat(report, "select item 5", "ListRow")).toBeUndefined();
    // Neither a parent re-render nor an inline onSelectionChange reaches the rows.
    expect(componentStat(report, "same props", "ListRow")).toBeUndefined();
    expect(componentStat(report, "new onSelectionChange identity", "ListRow")).toBeUndefined();
    // A new renderListViewItem can render different rows, so it must reach them.
    expect(componentStat(report, "new renderListViewItem identity", "ListRow")?.updates).toBe(10);
  });
});
