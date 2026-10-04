import {describe, expect, it, mock} from "bun:test";
import {Box, Button} from "@terreno/ui";
import {act, fireEvent, within} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {View, type ViewStyle} from "react-native";
import {renderWithTheme} from "../../../../../ui/src/test-utils";
import {ObservabilityTable} from "./ObservabilityTable";

const flattenStyle = (style: ViewStyle | ViewStyle[] | undefined): ViewStyle => {
  if (!style) {
    return {};
  }
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map((entry) => flattenStyle(entry)));
  }
  return style;
};

describe("ObservabilityTable", () => {
  it("renders headers, string cells, and node cells in flow-height rows", () => {
    const longInput = `{"question":"${"a".repeat(120)}"}`;
    const {getByTestId} = renderWithTheme(
      <ObservabilityTable
        columns={[
          {minWidth: 200, title: "Input"},
          {minWidth: 110, title: "Trace"},
        ]}
        rows={[
          {cells: [longInput, <Button key="open" size="sm" text="Open trace" />], key: "item-1"},
          {cells: ["short", "—"], key: "item-2"},
        ]}
        testID="observability-table"
      />
    );
    const table = within(getByTestId("observability-table"));
    expect(table.getByText("Input")).toBeTruthy();
    expect(table.getByText("Trace")).toBeTruthy();
    expect(table.getByText("Open trace")).toBeTruthy();

    // Long values stay intact in the tree; the cell truncates visually instead of clipping the row.
    const longCell = table.getByText(longInput);
    assert.equal(longCell.props.numberOfLines, 3);
    expect(table.getByText("short")).toBeTruthy();
    expect(table.getByText("—")).toBeTruthy();
  });

  it("shrink-wraps the bordered shell and avoids flex-grow display flex on cells", () => {
    let tableHeight = 0;
    const {getByTestId, UNSAFE_root} = renderWithTheme(
      <Box direction="column" height={240}>
        <Box flex="grow" gap={2}>
          <Box
            onLayout={(event) => {
              tableHeight = event.nativeEvent.layout.height;
            }}
          >
            <ObservabilityTable
              columns={[
                {title: "KEY"},
                {title: "DATA TYPE"},
                {title: "RANGE"},
                {title: "REQUIRED"},
              ]}
              rows={[{cells: ["correct", "boolean", "—", "Yes"], key: "dimension"}]}
              testID="observability-table"
            />
          </Box>
        </Box>
      </Box>
    );

    const table = getByTestId("observability-table");
    const tableStyle = flattenStyle(table.props.style as ViewStyle);
    expect(tableStyle.alignSelf).toBe("flex-start");
    expect(tableStyle.width).toBe("100%");

    const headerCellElement = table.props.children[0].props.children[0];
    expect(headerCellElement.props.flex).toBeUndefined();
    const headerCellInputStyle = flattenStyle(headerCellElement.props.style as ViewStyle);
    expect(headerCellInputStyle.flexGrow).toBe(1);
    expect(headerCellInputStyle.flexBasis).toBe(0);
    expect(headerCellInputStyle.minWidth).toBe(120);

    const renderedFlexGrowCells = UNSAFE_root.findAllByType(View).filter(
      (view) => flattenStyle(view.props.style as ViewStyle).flexGrow === 1
    );
    assert.isAtLeast(renderedFlexGrowCells.length, 1);
    assert.isBelow(tableHeight, 120);
  });

  it("weights columns and opens clickable rows", async () => {
    const onClick = mock(() => undefined);
    const {getByTestId} = renderWithTheme(
      <ObservabilityTable
        columns={[
          {grow: 2.5, minWidth: 220, title: "Input"},
          {grow: 1, minWidth: 100, title: "Metadata"},
        ]}
        rows={[
          {
            accessibilityLabel: "Open dataset item item-1",
            cells: ["full input", "manual"],
            key: "item-1",
            onClick,
          },
        ]}
        testID="weighted-table"
      />
    );
    const table = getByTestId("weighted-table");
    const inputCellStyle = flattenStyle(table.props.children[0].props.children[0].props.style);
    assert.equal(inputCellStyle.flexGrow, 2.5);

    await act(async () => {
      fireEvent.press(getByTestId("weighted-table-row-item-1-clickable"));
      await Promise.resolve();
    });
    assert.equal(onClick.mock.calls.length, 1);
  });
});
