import {describe, it} from "bun:test";
import type {TerrenoTheme} from "@terreno/ui";
import {assert} from "chai";
import {DarkTheme, DefaultTheme} from "expo-router";

import {buildNavigationTheme} from "./navigationTheme";

const theme = {
  border: {default: "#B3B3B3"},
  surface: {base: "#353535"},
  text: {link: "#73CAE8", primary: "#FFFFFF"},
} as unknown as TerrenoTheme;

describe("buildNavigationTheme", () => {
  it("paints dark screen containers with the Terreno base surface", () => {
    const navigationTheme = buildNavigationTheme({colorScheme: "dark", theme});
    assert.isTrue(navigationTheme.dark);
    assert.deepEqual(navigationTheme.fonts, DarkTheme.fonts);
    assert.deepInclude(navigationTheme.colors, {
      background: "#353535",
      border: "#B3B3B3",
      card: "#353535",
      notification: DarkTheme.colors.notification,
      primary: "#73CAE8",
      text: "#FFFFFF",
    });
  });

  it("uses an explicit background such as transparent for nested stacks", () => {
    const navigationTheme = buildNavigationTheme({
      background: "transparent",
      colorScheme: "light",
      theme,
    });
    assert.isFalse(navigationTheme.dark);
    assert.equal(navigationTheme.colors.background, "transparent");
    assert.equal(navigationTheme.colors.notification, DefaultTheme.colors.notification);
  });
});
