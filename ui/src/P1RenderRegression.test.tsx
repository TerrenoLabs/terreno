import {describe, it} from "bun:test";
import {act, render} from "@testing-library/react-native";
import {assert} from "chai";
import type React from "react";
import {useEffect} from "react";
import {View} from "react-native";

import type {CustomIconProps, DataTableCellData, DataTableColumn, IconRegistryMap} from "./Common";
import {DataTable} from "./DataTable";
import {Icon} from "./Icon";
import {IconRegistryProvider} from "./IconRegistry";
import {ThemeProvider, useTheme} from "./Theme";

interface ThemeMutationProps {
  textPrimary: "neutral900" | "error100";
}

const ThemeMutation: React.FC<ThemeMutationProps> = ({textPrimary}) => {
  const {setTheme, theme} = useTheme();

  // Drive the theme from props so memoized icons must still follow context updates.
  useEffect((): void => {
    const desiredColor = textPrimary === "neutral900" ? "#1C1C1C" : "#D33232";
    if (theme.text.primary === desiredColor) {
      return;
    }
    setTheme({text: {primary: textPrimary}});
  }, [setTheme, textPrimary, theme.text.primary]);

  return null;
};

describe("P1 component rerender regression coverage", () => {
  it("skips equivalent DataTable renders and preserves changed cell values", () => {
    const columns: DataTableColumn[] = [{columnType: "counted", title: "Value", width: 120}];
    const baselineData: DataTableCellData[][] = [[{value: "first"}]];
    const changedData: DataTableCellData[][] = [[{value: "second"}]];
    let renderCount = 0;
    const CountedCell: React.FC<{cellData: DataTableCellData}> = ({cellData}) => {
      renderCount += 1;
      return <View accessibilityLabel={String(cellData.value)} />;
    };
    const customColumnComponentMap = {counted: CountedCell};
    const result = render(
      <ThemeProvider>
        <DataTable
          columns={columns}
          customColumnComponentMap={customColumnComponentMap}
          data={baselineData}
        />
      </ThemeProvider>
    );

    assert.equal(renderCount, 1);
    result.rerender(
      <ThemeProvider>
        <DataTable
          columns={columns}
          customColumnComponentMap={customColumnComponentMap}
          data={baselineData}
        />
      </ThemeProvider>
    );
    assert.equal(renderCount, 1);

    result.rerender(
      <ThemeProvider>
        <DataTable
          columns={columns}
          customColumnComponentMap={customColumnComponentMap}
          data={changedData}
        />
      </ThemeProvider>
    );
    assert.equal(renderCount, 2);
    assert.exists(result.getByLabelText("second"));
    assert.isNull(result.queryByLabelText("first"));
  });

  it("skips equivalent Icon renders and preserves changed icon props", () => {
    let renderCount = 0;
    const CountedIcon: React.FC<CustomIconProps> = ({color, size, testID}) => {
      renderCount += 1;
      return <View accessibilityLabel={`${color}:${size}`} testID={testID} />;
    };
    const icons: IconRegistryMap = {testCustomIcon: CountedIcon};
    const result = render(
      <ThemeProvider>
        <IconRegistryProvider icons={icons}>
          <Icon iconName="testCustomIcon" size="md" testID="counted-icon" />
        </IconRegistryProvider>
      </ThemeProvider>
    );

    assert.equal(renderCount, 1);
    result.rerender(
      <ThemeProvider>
        <IconRegistryProvider icons={icons}>
          <Icon iconName="testCustomIcon" size="md" testID="counted-icon" />
        </IconRegistryProvider>
      </ThemeProvider>
    );
    assert.equal(renderCount, 1);

    result.rerender(
      <ThemeProvider>
        <IconRegistryProvider icons={icons}>
          <Icon iconName="testCustomIcon" size="lg" testID="counted-icon" />
        </IconRegistryProvider>
      </ThemeProvider>
    );
    assert.equal(renderCount, 2);
    assert.equal(result.getByTestId("counted-icon").props.accessibilityLabel, "#1C1C1C:20");
  });

  it("propagates theme changes through the memoized Icon boundary", async () => {
    const ThemeAwareIcon: React.FC<CustomIconProps> = ({color, testID}) => {
      return <View accessibilityLabel={color} testID={testID} />;
    };
    const icons: IconRegistryMap = {testCustomIcon: ThemeAwareIcon};
    const result = render(
      <ThemeProvider>
        <ThemeMutation textPrimary="neutral900" />
        <IconRegistryProvider icons={icons}>
          <Icon iconName="testCustomIcon" testID="themed-icon" />
        </IconRegistryProvider>
      </ThemeProvider>
    );

    result.rerender(
      <ThemeProvider>
        <ThemeMutation textPrimary="error100" />
        <IconRegistryProvider icons={icons}>
          <Icon iconName="testCustomIcon" testID="themed-icon" />
        </IconRegistryProvider>
      </ThemeProvider>
    );
    await act(async (): Promise<void> => {});

    assert.equal(result.getByTestId("themed-icon").props.accessibilityLabel, "#D33232");
  });
});
