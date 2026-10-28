import {describe, expect, it, mock} from "bun:test";
import {fireEvent} from "@testing-library/react-native";

import {SegmentedControl} from "./SegmentedControl";
import {renderWithTheme} from "./test-utils";

describe("SegmentedControl", () => {
  const defaultItems = ["Tab 1", "Tab 2", "Tab 3"];

  it("renders correctly with default props", () => {
    const {toJSON} = renderWithTheme(<SegmentedControl items={defaultItems} selectedIndex={0} />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders all items", () => {
    const {getByText} = renderWithTheme(
      <SegmentedControl items={defaultItems} selectedIndex={0} />
    );
    expect(getByText("Tab 1")).toBeTruthy();
    expect(getByText("Tab 2")).toBeTruthy();
    expect(getByText("Tab 3")).toBeTruthy();
  });

  it("highlights selected item", () => {
    const {toJSON} = renderWithTheme(<SegmentedControl items={defaultItems} selectedIndex={1} />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("calls onChange when item is pressed", () => {
    const handleChange = mock((_index: number) => {});
    const {getByText} = renderWithTheme(
      <SegmentedControl items={defaultItems} onChange={handleChange} selectedIndex={0} />
    );

    fireEvent.press(getByText("Tab 2"));
    expect(handleChange).toHaveBeenCalledWith(1);
  });

  it("renders with medium size (default)", () => {
    const {toJSON} = renderWithTheme(
      <SegmentedControl items={defaultItems} selectedIndex={0} size="md" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders a compact control that hugs its labels", () => {
    const {toJSON} = renderWithTheme(
      <SegmentedControl items={defaultItems} selectedIndex={0} size="sm" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with large size", () => {
    const {toJSON} = renderWithTheme(
      <SegmentedControl items={defaultItems} selectedIndex={0} size="lg" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with badges", () => {
    const badges = [
      {count: 5, status: "info" as const},
      {count: 3, status: "warning" as const},
      {count: 1, status: "error" as const},
    ];
    const {toJSON} = renderWithTheme(
      <SegmentedControl badges={badges} items={defaultItems} selectedIndex={0} />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with maxItems and scroll buttons", () => {
    const manyItems = ["Tab 1", "Tab 2", "Tab 3", "Tab 4", "Tab 5", "Tab 6"];
    const {toJSON} = renderWithTheme(
      <SegmentedControl items={manyItems} maxItems={3} selectedIndex={0} />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("handles scroll navigation", () => {
    const manyItems = ["Tab 1", "Tab 2", "Tab 3", "Tab 4", "Tab 5", "Tab 6"];
    const {getByText, toJSON} = renderWithTheme(
      <SegmentedControl items={manyItems} maxItems={3} selectedIndex={0} />
    );
    // Initially shows first 3 items
    expect(getByText("Tab 1")).toBeTruthy();
    expect(getByText("Tab 2")).toBeTruthy();
    expect(getByText("Tab 3")).toBeTruthy();
    expect(toJSON()).toMatchSnapshot();
  });

  it("invokes handleNext when next scroll button is pressed", () => {
    const manyItems = ["Tab 1", "Tab 2", "Tab 3", "Tab 4", "Tab 5", "Tab 6"];
    const {UNSAFE_getAllByProps, queryByText} = renderWithTheme(
      <SegmentedControl items={manyItems} maxItems={3} selectedIndex={0} />
    );
    // Find the right chevron (next button) by its icon prop
    const nextIcons = UNSAFE_getAllByProps({iconName: "chevron-right"});
    expect(nextIcons.length).toBeGreaterThan(0);
    const pressable = nextIcons[0].parent;
    expect(pressable).toBeTruthy();
    if (pressable) {
      fireEvent.press(pressable);
    }
    // After pressing next, should display items starting at Tab 4
    expect(queryByText("Tab 4")).toBeTruthy();
    expect(queryByText("Tab 1")).toBeNull();
  });

  it("uses the default no-op onChange when none is provided", () => {
    const {getByText} = renderWithTheme(
      <SegmentedControl items={defaultItems} selectedIndex={0} />
    );

    expect(() => fireEvent.press(getByText("Tab 2"))).not.toThrow();
  });

  it("invokes handlePrevious when previous scroll button is pressed", () => {
    const manyItems = ["Tab 1", "Tab 2", "Tab 3", "Tab 4", "Tab 5", "Tab 6"];
    const {UNSAFE_getAllByProps, queryByText} = renderWithTheme(
      <SegmentedControl items={manyItems} maxItems={3} selectedIndex={0} />
    );
    const nextIcons = UNSAFE_getAllByProps({iconName: "chevron-right"});
    const nextPressable = nextIcons[0].parent;
    if (nextPressable) {
      fireEvent.press(nextPressable);
    }
    // Now scrolled forward; press previous to go back
    const prevIcons = UNSAFE_getAllByProps({iconName: "chevron-left"});
    const prevPressable = prevIcons[0].parent;
    if (prevPressable) {
      fireEvent.press(prevPressable);
    }
    // Should be back to Tab 1
    expect(queryByText("Tab 1")).toBeTruthy();
  });
});
