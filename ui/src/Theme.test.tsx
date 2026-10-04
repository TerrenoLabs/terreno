import {describe, expect, it} from "bun:test";
import {act, render} from "@testing-library/react-native";
import {assert} from "chai";
import {Text, useColorScheme, View} from "react-native";

import {
  darkThemeConfig,
  defaultThemePrimitives,
  lightThemeConfig,
  resolveThemeColorScheme,
  type ThemeColorScheme,
  ThemeProvider,
  themeColorSchemeOptions,
  useTheme,
} from "./Theme";

type ThemeContextValue = ReturnType<typeof useTheme>;
type ThemeValue = ThemeContextValue["theme"];

const ThemeConsumer = () => {
  const {colorScheme, colorSchemeSetting, theme} = useTheme();
  return (
    <View>
      <Text testID="color-scheme">{colorScheme}</Text>
      <Text testID="color-scheme-setting">{colorSchemeSetting}</Text>
      <Text testID="border-ai">{theme.border.ai}</Text>
      <Text testID="surface-base">{theme.surface?.base}</Text>
      <Text testID="surface-ai">{theme.surface.ai}</Text>
      <Text testID="text-primary">{theme.text?.primary}</Text>
    </View>
  );
};

describe("Theme", () => {
  describe("ThemeProvider", () => {
    it("renders children", () => {
      const {getByText} = render(
        <ThemeProvider>
          <Text>Child content</Text>
        </ThemeProvider>
      );
      expect(getByText("Child content")).toBeTruthy();
    });

    it("provides default theme values", () => {
      const {getByTestId} = render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      );
      // Default surface.base is neutral000 which maps to #FFFFFF
      expect(getByTestId("surface-base").children[0]).toBe("#FFFFFF");
      // Default text.primary is neutral900 which maps to #1C1C1C
      expect(getByTestId("text-primary").children[0]).toBe("#1C1C1C");
      assert.equal(getByTestId("surface-ai").children[0], "#EBFAFF");
      assert.equal(getByTestId("border-ai").children[0], "#90D8F0");
      assert.equal(getByTestId("color-scheme").children[0], "light");
    });

    it("provides the Figma dark mode values", () => {
      const {getByTestId} = render(
        <ThemeProvider colorScheme="dark">
          <ThemeConsumer />
        </ThemeProvider>
      );

      assert.equal(getByTestId("surface-base").children[0], "#353535");
      assert.equal(getByTestId("surface-ai").children[0], "#035D7E");
      assert.equal(getByTestId("border-ai").children[0], "#0086B3");
      assert.equal(getByTestId("text-primary").children[0], "#FFFFFF");
      assert.equal(getByTestId("color-scheme").children[0], "dark");
      assert.equal(getByTestId("color-scheme-setting").children[0], "dark");
    });

    it("follows the system scheme and accepts a later choice", () => {
      const colorSchemeMock = useColorScheme as unknown as {
        mockReturnValue: (value: string | null) => void;
      };
      let setColorScheme: ((nextColorScheme: ThemeColorScheme) => void) | undefined;
      const Capture = (): null => {
        setColorScheme = useTheme().setColorScheme;
        return null;
      };

      colorSchemeMock.mockReturnValue("dark");
      const view = render(
        <ThemeProvider colorScheme="system">
          <Capture />
          <ThemeConsumer />
        </ThemeProvider>
      );

      assert.equal(view.getByTestId("color-scheme-setting").children[0], "system");
      assert.equal(view.getByTestId("color-scheme").children[0], "dark");
      assert.equal(view.getByTestId("surface-base").children[0], "#353535");

      act(() => {
        setColorScheme?.("light");
      });
      assert.equal(view.getByTestId("color-scheme-setting").children[0], "light");
      assert.equal(view.getByTestId("surface-base").children[0], "#FFFFFF");

      view.rerender(
        <ThemeProvider colorScheme="dark">
          <Capture />
          <ThemeConsumer />
        </ThemeProvider>
      );
      assert.equal(view.getByTestId("color-scheme-setting").children[0], "dark");
      assert.equal(view.getByTestId("color-scheme").children[0], "dark");
      colorSchemeMock.mockReturnValue("light");
    });

    it("lists light, dark, and follow system", () => {
      assert.deepEqual(
        themeColorSchemeOptions.map((option) => option.value),
        ["light", "dark", "system"]
      );
      assert.equal(
        themeColorSchemeOptions.find((option) => option.value === "system")?.label,
        "Follow system"
      );
      assert.equal(resolveThemeColorScheme("system", null), "light");
      assert.equal(resolveThemeColorScheme("system", "dark"), "dark");
      assert.equal(resolveThemeColorScheme("light", "dark"), "light");
    });

    it("maps semantic tokens to the supplied Figma modes", () => {
      assert.deepInclude(lightThemeConfig.text, {
        accent: "accent700",
        error: "error200",
        extraLight: "neutral500",
        inverted: "neutral000",
        link: "primary600",
        linkLight: "primary400",
        primary: "neutral900",
        secondaryDark: "secondary800",
        secondaryLight: "neutral600",
        success: "success200",
        warning: "warning200",
      });
      assert.deepInclude(lightThemeConfig.surface, {
        ai: "primary000",
        base: "neutral000",
        baseAlternate: "neutral050",
        baseHover: "secondary000",
        disabled: "neutral500",
        error: "error200",
        errorLight: "error000",
        neutral: "neutral600",
        neutralDark: "neutral800",
        neutralExtraLight: "neutral200",
        neutralLight: "neutral300",
        primary: "primary400",
        secondaryDark: "secondary500",
        secondaryExtraDark: "secondary800",
        secondaryLight: "secondary100",
        success: "success200",
        successLight: "success000",
        warning: "warning100",
        warningLight: "warning000",
      });
      assert.deepEqual(lightThemeConfig.border, {
        activeAccent: "accent500",
        activeNeutral: "neutral700",
        ai: "primary100",
        dark: "neutral500",
        default: "neutral300",
        error: "error100",
        focus: "primary200",
        hover: "neutral200",
        success: "success100",
        warning: "warning100",
      });
      assert.deepEqual(lightThemeConfig.status, {
        active: "success100",
        away: "neutral500",
        doNotDisturb: "error100",
      });
      assert.deepEqual(lightThemeConfig.radius, {
        default: "radiusMd",
        full: "radiusLg",
        minimal: "radiusSm",
        rounded: "radius3xl",
      });
      assert.deepEqual(lightThemeConfig.spacing, {
        "2xl": "spacing8",
        "3xl": "spacing12",
        lg: "spacing5",
        md: "spacing4",
        none: "spacing0",
        sm: "spacing2",
        xl: "spacing6",
        xs: "spacing1",
      });
      assert.deepInclude(darkThemeConfig.text, {
        accent: "accent400",
        error: "error000",
        extraLight: "neutral300",
        inverted: "neutral800",
        link: "primary200",
        linkLight: "primary300",
        primary: "neutral000",
        secondaryDark: "secondary050",
        secondaryLight: "neutral200",
        success: "success000",
        warning: "warning000",
      });
      assert.deepInclude(darkThemeConfig.surface, {
        ai: "primary700",
        base: "neutral800",
        baseAlternate: "neutral800",
        baseHover: "secondary600",
        disabled: "neutral300",
        error: "error050",
        errorLight: "error200",
        neutral: "neutral200",
        neutralDark: "neutral050",
        neutralExtraLight: "neutral600",
        neutralLight: "neutral600",
        primary: "primary300",
        secondaryDark: "secondary300",
        secondaryExtraDark: "secondary050",
        secondaryLight: "secondary600",
        success: "success050",
        successLight: "success200",
        warning: "warning050",
        warningLight: "warning100",
      });
      assert.deepEqual(darkThemeConfig.border, {
        activeAccent: "accent200",
        activeNeutral: "neutral100",
        ai: "primary500",
        dark: "neutral300",
        default: "neutral400",
        error: "error050",
        focus: "primary200",
        hover: "neutral600",
        success: "success050",
        warning: "warning050",
      });
      assert.deepEqual(darkThemeConfig.status, {
        active: "success050",
        away: "neutral300",
        doNotDisturb: "error050",
      });
      assert.equal(defaultThemePrimitives.error050, "#EDA1A1");
      assert.equal(defaultThemePrimitives.success050, "#9BE7B2");
      assert.equal(defaultThemePrimitives.warning050, "#FAA372");
    });

    it("keeps context actions stable across parent rerenders", () => {
      const capturedValues: ThemeContextValue[] = [];
      const Capture = (): null => {
        capturedValues.push(useTheme());
        return null;
      };
      const result = render(
        <ThemeProvider>
          <Capture />
        </ThemeProvider>
      );
      const initialValue = capturedValues.at(-1);

      result.rerender(
        <ThemeProvider>
          <Capture />
        </ThemeProvider>
      );
      const rerenderedValue = capturedValues.at(-1);

      assert.strictEqual(rerenderedValue?.setColorScheme, initialValue?.setColorScheme);
      assert.strictEqual(rerenderedValue?.resetTheme, initialValue?.resetTheme);
      assert.strictEqual(rerenderedValue?.setPrimitives, initialValue?.setPrimitives);
      assert.strictEqual(rerenderedValue?.setTheme, initialValue?.setTheme);
      assert.strictEqual(rerenderedValue?.theme, initialValue?.theme);
    });
  });

  describe("useTheme", () => {
    it("returns theme object", () => {
      let capturedTheme: ThemeContextValue | undefined;
      const Capture = () => {
        capturedTheme = useTheme();
        return null;
      };

      render(
        <ThemeProvider>
          <Capture />
        </ThemeProvider>
      );

      expect(capturedTheme?.theme).toBeDefined();
      expect(capturedTheme?.setTheme).toBeDefined();
      expect(capturedTheme?.setPrimitives).toBeDefined();
      expect(capturedTheme?.resetTheme).toBeDefined();
    });

    it("provides surface colors", () => {
      let theme: ThemeValue | undefined;
      const Capture = () => {
        theme = useTheme().theme;
        return null;
      };

      render(
        <ThemeProvider>
          <Capture />
        </ThemeProvider>
      );

      expect(theme?.surface).toBeDefined();
      expect(theme?.surface?.base).toBeDefined();
      expect(theme?.surface?.primary).toBeDefined();
      expect(theme?.surface?.error).toBeDefined();
    });

    it("provides text colors", () => {
      let theme: ThemeValue | undefined;
      const Capture = () => {
        theme = useTheme().theme;
        return null;
      };

      render(
        <ThemeProvider>
          <Capture />
        </ThemeProvider>
      );

      expect(theme?.text).toBeDefined();
      expect(theme?.text?.primary).toBeDefined();
      expect(theme?.text?.inverted).toBeDefined();
      expect(theme?.text?.error).toBeDefined();
    });

    it("provides border colors", () => {
      let theme: ThemeValue | undefined;
      const Capture = () => {
        theme = useTheme().theme;
        return null;
      };

      render(
        <ThemeProvider>
          <Capture />
        </ThemeProvider>
      );

      expect(theme?.border).toBeDefined();
      expect(theme?.border?.default).toBeDefined();
    });

    it("provides spacing values", () => {
      let theme: ThemeValue | undefined;
      const Capture = () => {
        theme = useTheme().theme;
        return null;
      };

      render(
        <ThemeProvider>
          <Capture />
        </ThemeProvider>
      );

      expect(theme?.spacing).toBeDefined();
      expect(theme?.spacing?.sm).toBeDefined();
      expect(theme?.spacing?.md).toBeDefined();
      expect(theme?.spacing?.lg).toBeDefined();
    });

    it("provides radius values", () => {
      let theme: ThemeValue | undefined;
      const Capture = () => {
        theme = useTheme().theme;
        return null;
      };

      render(
        <ThemeProvider>
          <Capture />
        </ThemeProvider>
      );

      expect(theme?.radius).toBeDefined();
      expect(theme?.radius?.default).toBeDefined();
      expect(theme?.radius?.rounded).toBeDefined();
    });

    it("updates theme when setTheme is called", () => {
      let captured: ThemeContextValue | undefined;
      const Capture = () => {
        captured = useTheme();
        return null;
      };
      render(
        <ThemeProvider>
          <Capture />
        </ThemeProvider>
      );
      act(() => {
        captured?.setTheme({surface: {base: "error100"}});
      });
      expect(captured?.theme.surface.base).toBe("#D33232");
    });

    it("updates primitives when setPrimitives is called", () => {
      let captured: ThemeContextValue | undefined;
      const Capture = () => {
        captured = useTheme();
        return null;
      };
      render(
        <ThemeProvider>
          <Capture />
        </ThemeProvider>
      );
      act(() => {
        captured?.setPrimitives({neutral000: "#AABBCC"});
      });
      expect(captured?.theme.surface.base).toBe("#AABBCC");
    });

    it("resets theme to default when resetTheme is called", () => {
      let captured: ThemeContextValue | undefined;
      const Capture = () => {
        captured = useTheme();
        return null;
      };
      render(
        <ThemeProvider>
          <Capture />
        </ThemeProvider>
      );
      act(() => {
        captured?.setTheme({surface: {base: "error100"}});
        captured?.setPrimitives({neutral000: "#123456"});
      });
      act(() => {
        captured?.resetTheme();
      });
      expect(captured?.theme.surface.base).toBe("#FFFFFF");
    });

    it("supports non-object top-level values when setTheme is called", () => {
      let captured: ThemeContextValue | undefined;
      const Capture = () => {
        captured = useTheme();
        return null;
      };
      render(
        <ThemeProvider>
          <Capture />
        </ThemeProvider>
      );
      act(() => {
        captured?.setTheme({primitives: undefined});
      });
      expect(captured?.theme).toBeDefined();
    });

    it("invokes the no-op default context setters when rendered without a provider", () => {
      let captured: ThemeContextValue | undefined;
      const Capture = () => {
        captured = useTheme();
        return null;
      };
      render(<Capture />);
      // Exercise the default no-op callbacks on the context.
      expect(() => {
        captured?.resetTheme();
        captured?.setPrimitives({neutral000: "#000000"});
        captured?.setTheme({surface: {base: "neutral000"}});
      }).not.toThrow();
    });
  });
});
