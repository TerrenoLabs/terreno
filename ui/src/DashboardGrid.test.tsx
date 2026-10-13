import {describe, expect, it} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import {memo} from "react";

import {Box} from "./Box";
import {getSpacing} from "./Common";
import {DashboardGrid, DashboardGridItem} from "./DashboardGrid";
import {getDashboardCellWidth} from "./dashboardGridLayout";
import {sharedResponsiveBreakpointStore} from "./ResponsiveBreakpoint";
import {renderWithTheme} from "./test-utils";

const MemoDashboardGridItem = memo(DashboardGridItem);

describe("DashboardGrid", () => {
  it("keeps child testIDs", () => {
    const {getByTestId} = renderWithTheme(
      <DashboardGrid testID="grid">
        <Box testID="tile-a">A</Box>
        <Box testID="tile-b">B</Box>
      </DashboardGrid>
    );

    expect(getByTestId("grid")).toBeTruthy();
    expect(getByTestId("tile-a")).toBeTruthy();
    expect(getByTestId("tile-b")).toBeTruthy();
  });

  it("renders custom gap without dropping children", () => {
    const {getByTestId} = renderWithTheme(
      <DashboardGrid columns={{lg: 3, md: 2, sm: 1}} gap={2} testID="grid">
        <Box testID="only">One</Box>
      </DashboardGrid>
    );

    expect(getByTestId("only")).toBeTruthy();
  });

  it("omits falsy conditional children instead of reserving empty cells", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <DashboardGrid testID="grid">
        {false}
        {null}
        {undefined}
        <Box testID="tile-a">A</Box>
        <Box testID="tile-b">B</Box>
      </DashboardGrid>
    );

    expect(getByTestId("grid.cell.0")).toBeTruthy();
    expect(getByTestId("grid.cell.1")).toBeTruthy();
    expect(queryByTestId("grid.cell.2")).toBeNull();
  });

  it("sizes cells so column widths plus gap fit the measured row", async () => {
    const {getByTestId} = renderWithTheme(
      <DashboardGrid columns={{lg: 3, md: 3, sm: 3}} gap={4} testID="grid">
        <Box testID="tile-a">A</Box>
        <Box testID="tile-b">B</Box>
        <Box testID="tile-c">C</Box>
      </DashboardGrid>
    );

    await act(async () => {
      fireEvent(getByTestId("grid"), "layout", {
        nativeEvent: {layout: {height: 80, width: 332}},
      });
    });

    const expectedWidth = getDashboardCellWidth({
      columnCount: 3,
      gapPx: getSpacing(4),
      rowWidth: 332,
    });
    expect(getByTestId("grid.cell.0").props.style).toMatchObject({
      maxWidth: expectedWidth,
      width: expectedWidth,
    });
  });

  it("lets an item span responsive column units without changing plain children", async () => {
    const {getByTestId} = renderWithTheme(
      <DashboardGrid columns={{lg: 4, md: 4, sm: 4}} gap={4} testID="grid">
        <DashboardGridItem span={{lg: 2, md: 2, sm: 2}} testID="wide-item">
          <Box>Wide</Box>
        </DashboardGridItem>
        <Box testID="plain-item">Plain</Box>
      </DashboardGrid>
    );

    await act(async () => {
      fireEvent(getByTestId("grid"), "layout", {
        nativeEvent: {layout: {height: 80, width: 332}},
      });
    });

    const baseWidth = getDashboardCellWidth({
      columnCount: 4,
      gapPx: getSpacing(4),
      rowWidth: 332,
    });
    assert.include(getByTestId("grid.cell.0").props.style, {
      width: baseWidth * 2 + getSpacing(4),
    });
    assert.include(getByTestId("grid.cell.1").props.style, {width: baseWidth});
    assert.exists(getByTestId("wide-item"));
    assert.exists(getByTestId("plain-item"));
  });

  it("resolves asymmetric spans at each responsive breakpoint", async () => {
    const result = renderWithTheme(
      <DashboardGrid columns={{lg: 4, md: 4, sm: 4}} gap={4} testID="grid">
        <DashboardGridItem span={{lg: 3, md: 2, sm: 1}}>
          <Box>Responsive</Box>
        </DashboardGridItem>
      </DashboardGrid>
    );
    await act(async () => {
      fireEvent(result.getByTestId("grid"), "layout", {
        nativeEvent: {layout: {height: 80, width: 332}},
      });
      sharedResponsiveBreakpointStore.updateWidth(319);
    });
    const baseWidth = getDashboardCellWidth({
      columnCount: 4,
      gapPx: getSpacing(4),
      rowWidth: 332,
    });
    assert.equal(result.getByTestId("grid.cell.0").props.style.width, baseWidth);

    act((): void => {
      sharedResponsiveBreakpointStore.updateWidth(375);
    });
    assert.equal(
      result.getByTestId("grid.cell.0").props.style.width,
      baseWidth * 2 + getSpacing(4)
    );

    act((): void => {
      sharedResponsiveBreakpointStore.updateWidth(600);
    });
    assert.equal(
      result.getByTestId("grid.cell.0").props.style.width,
      baseWidth * 3 + getSpacing(4) * 2
    );

    result.unmount();
    sharedResponsiveBreakpointStore.updateWidth(375);
  });

  it("keeps span metadata through React memo wrappers", async () => {
    const {getByTestId} = renderWithTheme(
      <DashboardGrid columns={{lg: 4, md: 4, sm: 4}} gap={4} testID="grid">
        <MemoDashboardGridItem span={{lg: 2, md: 2, sm: 2}}>
          <Box>Memo item</Box>
        </MemoDashboardGridItem>
      </DashboardGrid>
    );
    await act(async () => {
      fireEvent(getByTestId("grid"), "layout", {
        nativeEvent: {layout: {height: 80, width: 332}},
      });
    });
    const baseWidth = getDashboardCellWidth({
      columnCount: 4,
      gapPx: getSpacing(4),
      rowWidth: 332,
    });

    assert.equal(getByTestId("grid.cell.0").props.style.width, baseWidth * 2 + getSpacing(4));
  });
});
