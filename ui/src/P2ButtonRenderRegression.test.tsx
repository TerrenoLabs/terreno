import {describe, it} from "bun:test";
import {act, fireEvent, render} from "@testing-library/react-native";
import {assert} from "chai";
import type React from "react";
import {useEffect} from "react";
import {View} from "react-native";

import {Button} from "./Button";
import type {CustomIconProps, IconRegistryMap} from "./Common";
import {IconRegistryProvider} from "./IconRegistry";
import {ThemeProvider, useTheme} from "./Theme";

interface ThemeMutationProps {
  surfaceSecondaryDark: "secondary800" | "error100";
}

const handlePress = async (): Promise<void> => {};

const ThemeMutation: React.FC<ThemeMutationProps> = ({surfaceSecondaryDark}) => {
  const {setTheme, theme} = useTheme();

  // Drive the theme from props so memoized buttons must still follow context updates.
  useEffect((): void => {
    const desiredColor = surfaceSecondaryDark === "secondary800" ? "#092E3A" : "#D33232";
    if (theme.surface.secondaryDark === desiredColor) {
      return;
    }
    setTheme({surface: {secondaryDark: surfaceSecondaryDark}});
  }, [setTheme, surfaceSecondaryDark, theme.surface.secondaryDark]);

  return null;
};

describe("P2 Button rerender regression coverage", () => {
  it("skips equivalent renders and preserves changed button props", () => {
    let renderCount = 0;
    const CountedIcon: React.FC<CustomIconProps> = ({color, size, testID}) => {
      renderCount += 1;
      return <View accessibilityLabel={`${color}:${size}`} testID={testID} />;
    };
    const icons: IconRegistryMap = {testCustomIcon: CountedIcon};
    const result = render(
      <ThemeProvider>
        <IconRegistryProvider icons={icons}>
          <Button
            iconName="testCustomIcon"
            onClick={handlePress}
            testID="counted-button"
            text="Initial"
          />
        </IconRegistryProvider>
      </ThemeProvider>
    );

    assert.equal(renderCount, 1);
    result.rerender(
      <ThemeProvider>
        <IconRegistryProvider icons={icons}>
          <Button
            iconName="testCustomIcon"
            onClick={handlePress}
            testID="counted-button"
            text="Initial"
          />
        </IconRegistryProvider>
      </ThemeProvider>
    );
    assert.equal(renderCount, 1);

    result.rerender(
      <ThemeProvider>
        <IconRegistryProvider icons={icons}>
          <Button
            iconName="testCustomIcon"
            onClick={handlePress}
            testID="counted-button"
            text="Changed"
          />
        </IconRegistryProvider>
      </ThemeProvider>
    );
    assert.equal(renderCount, 2);
    assert.exists(result.getByText("Changed"));
    assert.isNull(result.queryByText("Initial"));
  });

  it("propagates theme changes through the memoized Button boundary", async () => {
    const ThemeAwareIcon: React.FC<CustomIconProps> = ({color, testID}) => {
      return <View accessibilityLabel={color} testID={testID} />;
    };
    const icons: IconRegistryMap = {testCustomIcon: ThemeAwareIcon};
    const result = render(
      <ThemeProvider>
        <ThemeMutation surfaceSecondaryDark="secondary800" />
        <IconRegistryProvider icons={icons}>
          <Button
            iconName="testCustomIcon"
            onClick={handlePress}
            testID="themed-button"
            text="Themed"
            variant="ghost"
          />
        </IconRegistryProvider>
      </ThemeProvider>
    );
    const initialColor = result.UNSAFE_getByType(ThemeAwareIcon).props.color;

    result.rerender(
      <ThemeProvider>
        <ThemeMutation surfaceSecondaryDark="error100" />
        <IconRegistryProvider icons={icons}>
          <Button
            iconName="testCustomIcon"
            onClick={handlePress}
            testID="themed-button"
            text="Themed"
            variant="ghost"
          />
        </IconRegistryProvider>
      </ThemeProvider>
    );
    await act(async (): Promise<void> => {});

    const changedColor = result.UNSAFE_getByType(ThemeAwareIcon).props.color;
    assert.notEqual(changedColor, initialColor);
    assert.equal(changedColor, "#D33232");
  });

  it("uses the latest confirmation props after a changed-prop update", async () => {
    const result = render(
      <ThemeProvider>
        <Button
          confirmationText="Initial confirmation"
          onClick={handlePress}
          text="Confirm"
          withConfirmation
        />
      </ThemeProvider>
    );

    result.rerender(
      <ThemeProvider>
        <Button
          confirmationText="Changed confirmation"
          onClick={handlePress}
          text="Confirm"
          withConfirmation
        />
      </ThemeProvider>
    );
    await act(async () => {
      fireEvent.press(result.getByText("Confirm"));
      await Promise.resolve();
    });

    assert.exists(await result.findByText("Changed confirmation"));
    assert.isNull(result.queryByText("Initial confirmation"));
  });
});
