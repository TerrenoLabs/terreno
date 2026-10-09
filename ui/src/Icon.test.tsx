import {describe, expect, it} from "bun:test";
import {Platform} from "react-native";

import {Icon, iconPlaceholderCommitsForTests, resetIconStaticHydrationForTests} from "./Icon";
import {renderWithIcons, renderWithTheme, TEST_CUSTOM_ICON_TEST_ID} from "./test-utils";

describe("Icon", () => {
  it("renders correctly with default props", () => {
    const {toJSON} = renderWithTheme(<Icon iconName="check" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with testID", () => {
    const {toJSON} = renderWithTheme(<Icon iconName="check" testID="test-icon" />);
    // FontAwesome6 component receives testID prop
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with different sizes", () => {
    const sizes = ["xs", "sm", "md", "lg", "xl", "2xl"] as const;
    sizes.forEach((size) => {
      const {toJSON} = renderWithTheme(<Icon iconName="check" size={size} />);
      expect(toJSON()).toMatchSnapshot();
    });
  });

  it("renders with different colors", () => {
    const colors = ["primary", "secondary", "accent", "inverted", "error"] as const;
    colors.forEach((color) => {
      const {toJSON} = renderWithTheme(<Icon color={color} iconName="star" />);
      expect(toJSON()).toMatchSnapshot();
    });
  });

  it("renders with solid type (default)", () => {
    const {toJSON} = renderWithTheme(<Icon iconName="heart" type="solid" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with regular type", () => {
    const {toJSON} = renderWithTheme(<Icon iconName="heart" type="regular" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with light type", () => {
    const {toJSON} = renderWithTheme(<Icon iconName="heart" type="light" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with brand type", () => {
    const {toJSON} = renderWithTheme(<Icon iconName="github" type="brand" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders different icon names", () => {
    const icons = ["check", "x", "star", "heart", "user", "search"] as const;
    icons.forEach((iconName) => {
      const {toJSON} = renderWithTheme(<Icon iconName={iconName} />);
      expect(toJSON()).toMatchSnapshot();
    });
  });

  describe("custom icons", () => {
    it("renders a registered custom icon by name", () => {
      const {queryByTestId} = renderWithIcons(<Icon iconName="testCustomIcon" />);
      expect(queryByTestId(TEST_CUSTOM_ICON_TEST_ID)).not.toBeNull();
    });

    it("falls back to FontAwesome for unregistered names", () => {
      const {queryByTestId} = renderWithIcons(<Icon iconName="check" />);
      expect(queryByTestId(TEST_CUSTOM_ICON_TEST_ID)).toBeNull();
    });

    it("passes the resolved pixel size to the custom icon", () => {
      const {getByTestId} = renderWithIcons(<Icon iconName="testCustomIcon" size="lg" />);
      expect(getByTestId(TEST_CUSTOM_ICON_TEST_ID).props.accessibilityLabel).toBe("size:20");
    });

    it("forwards testID to the custom icon", () => {
      const {queryByTestId} = renderWithIcons(<Icon iconName="testCustomIcon" testID="my-icon" />);
      expect(queryByTestId("my-icon")).not.toBeNull();
    });
  });

  it("paints the sized placeholder only on the first static hydration commit", () => {
    const originalOS = Platform.OS;
    const globalHydrate = globalThis as {__EXPO_ROUTER_HYDRATE__?: boolean; document?: object};
    const previousHydrate = globalHydrate.__EXPO_ROUTER_HYDRATE__;
    const previousDocument = globalHydrate.document;
    Platform.OS = "web";
    globalHydrate.document = previousDocument ?? {};
    globalHydrate.__EXPO_ROUTER_HYDRATE__ = true;
    resetIconStaticHydrationForTests();
    try {
      renderWithTheme(<Icon iconName="check" testID="during-hydrate" />);
      const firstPassCommits = iconPlaceholderCommitsForTests();
      expect(firstPassCommits).toBeGreaterThan(0);

      renderWithTheme(<Icon iconName="check" testID="after-hydrate" />);
      expect(iconPlaceholderCommitsForTests()).toBe(firstPassCommits);

      resetIconStaticHydrationForTests();
      globalHydrate.__EXPO_ROUTER_HYDRATE__ = false;
      renderWithTheme(<Icon iconName="check" testID="client-web" />);
      expect(iconPlaceholderCommitsForTests()).toBe(0);
    } finally {
      Platform.OS = originalOS;
      if (previousHydrate === undefined) {
        delete globalHydrate.__EXPO_ROUTER_HYDRATE__;
      } else {
        globalHydrate.__EXPO_ROUTER_HYDRATE__ = previousHydrate;
      }
      if (previousDocument === undefined) {
        delete globalHydrate.document;
      } else {
        globalHydrate.document = previousDocument;
      }
      resetIconStaticHydrationForTests();
    }
  });

  it("paints Font Awesome on the first native commit", () => {
    const originalOS = Platform.OS;
    Platform.OS = "ios";
    resetIconStaticHydrationForTests();
    try {
      renderWithTheme(<Icon iconName="check" testID="native-glyph" />);
      expect(iconPlaceholderCommitsForTests()).toBe(0);
    } finally {
      Platform.OS = originalOS;
      resetIconStaticHydrationForTests();
    }
  });
});
