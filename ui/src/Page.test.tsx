import {afterAll, describe, expect, it, mock} from "bun:test";
import {act, fireEvent, waitFor} from "@testing-library/react-native";
import React, {type ReactNode} from "react";
import {Pressable, Text as RNText} from "react-native";
import {SafeAreaView} from "react-native-safe-area-context";

// Override the IconButton mock so the inline onClick arrows fire when pressed.
mock.module("./IconButton", () => ({
  IconButton: ({
    accessibilityLabel,
    accessibilityHint,
    iconName,
    onClick,
  }: {
    accessibilityLabel?: string;
    accessibilityHint?: string;
    iconName: string;
    onClick?: () => void;
  }) => (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      onPress={onClick}
      testID={`icon-button-${iconName}`}
    >
      <RNText>{iconName}</RNText>
    </Pressable>
  ),
}));

// Override the expo-router mock so we can observe router.back() calls, but
// preserve the full shape provided by bunSetup.ts (Link, Stack, Tabs, hooks,
// and the rest of the router object) so other components that import from
// "expo-router" don't see `undefined` for those exports.
const routerBack = mock(() => {});
interface MockChildrenProps {
  children?: ReactNode;
}
mock.module("expo-router", () => ({
  Link: ({children, ...props}: MockChildrenProps) => React.createElement("Link", props, children),
  router: {
    back: routerBack,
    canGoBack: mock(() => true),
    navigate: mock(() => {}),
    push: mock(() => {}),
    replace: mock(() => {}),
  },
  Stack: ({children, ...props}: MockChildrenProps) => React.createElement("Stack", props, children),
  Tabs: ({children, ...props}: MockChildrenProps) => React.createElement("Tabs", props, children),
  useLocalSearchParams: mock(() => ({})),
  useRouter: mock(() => ({
    back: mock(() => {}),
    canGoBack: mock(() => true),
    navigate: mock(() => {}),
    push: mock(() => {}),
    replace: mock(() => {}),
  })),
  useSegments: mock(() => []),
}));

import {Page} from "./Page";
import {SkeletonList} from "./Skeleton";
import {Text} from "./Text";
import {renderWithTheme} from "./test-utils";

// Skeletons are hidden from assistive tech, so queries opt in to hidden elements.
const HIDDEN = {includeHiddenElements: true};

// Restore the global mocks set up by bunSetup.ts after this file finishes so
// that other test files (e.g. IconButton.test.tsx, ConsentFormScreen.test.tsx)
// are not affected by the overrides above.
afterAll(() => {
  mock.module("./IconButton", () => ({
    IconButton: mock(() => null),
  }));
  mock.module("expo-router", () => ({
    Link: ({children, ...props}: MockChildrenProps) => React.createElement("Link", props, children),
    router: {
      back: mock(() => {}),
      canGoBack: mock(() => true),
      navigate: mock(() => {}),
      push: mock(() => {}),
      replace: mock(() => {}),
    },
    Stack: ({children, ...props}: MockChildrenProps) =>
      React.createElement("Stack", props, children),
    Tabs: ({children, ...props}: MockChildrenProps) => React.createElement("Tabs", props, children),
    useLocalSearchParams: mock(() => ({})),
    useRouter: mock(() => ({
      back: mock(() => {}),
      canGoBack: mock(() => true),
      navigate: mock(() => {}),
      push: mock(() => {}),
      replace: mock(() => {}),
    })),
    useSegments: mock(() => []),
  }));
});

describe("Page", () => {
  const mockNavigation = {
    goBack: mock(() => {}),
  };

  it("renders correctly with default props", () => {
    const {toJSON} = renderWithTheme(
      <Page navigation={mockNavigation}>
        <Text>Page content</Text>
      </Page>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders children correctly", () => {
    const {getByText} = renderWithTheme(
      <Page navigation={mockNavigation}>
        <Text>Test content</Text>
      </Page>
    );
    expect(getByText("Test content")).toBeTruthy();
  });

  it("renders with title", () => {
    const {getByText, toJSON} = renderWithTheme(
      <Page navigation={mockNavigation} title="Page Title">
        <Text>Content</Text>
      </Page>
    );
    expect(getByText("Page Title")).toBeTruthy();
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with back button", () => {
    const {toJSON} = renderWithTheme(
      <Page backButton navigation={mockNavigation} title="Page">
        <Text>Content</Text>
      </Page>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with close button", () => {
    const {toJSON} = renderWithTheme(
      <Page closeButton navigation={mockNavigation} title="Page">
        <Text>Content</Text>
      </Page>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with right button", () => {
    const handleRightClick = mock(() => {});
    const {getByText, toJSON} = renderWithTheme(
      <Page
        navigation={mockNavigation}
        rightButton="Save"
        rightButtonOnClick={handleRightClick}
        title="Page"
      >
        <Text>Content</Text>
      </Page>
    );
    expect(getByText("Save")).toBeTruthy();
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders loading state", () => {
    const {toJSON} = renderWithTheme(
      <Page loading navigation={mockNavigation}>
        <Text>Content</Text>
      </Page>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with footer", () => {
    const {getByText, toJSON} = renderWithTheme(
      <Page footer={<Text>Footer content</Text>} navigation={mockNavigation}>
        <Text>Content</Text>
      </Page>
    );
    expect(getByText("Footer content")).toBeTruthy();
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with custom padding", () => {
    const {toJSON} = renderWithTheme(
      <Page navigation={mockNavigation} padding={5}>
        <Text>Content</Text>
      </Page>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with custom color", () => {
    const {toJSON} = renderWithTheme(
      <Page color="secondaryDark" navigation={mockNavigation}>
        <Text>Content</Text>
      </Page>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with scroll disabled", () => {
    const {toJSON} = renderWithTheme(
      <Page navigation={mockNavigation} scroll={false}>
        <Text>Content</Text>
      </Page>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with custom maxWidth", () => {
    const {toJSON} = renderWithTheme(
      <Page maxWidth={600} navigation={mockNavigation}>
        <Text>Content</Text>
      </Page>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("invokes rightButtonOnClick when right button is pressed", async () => {
    const handleRightClick = mock(() => {});
    const {getByText} = renderWithTheme(
      <Page
        navigation={mockNavigation}
        rightButton="Save"
        rightButtonOnClick={handleRightClick}
        title="Page"
      >
        <Text>Content</Text>
      </Page>
    );
    await act(async () => {
      fireEvent.press(getByText("Save"));
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    await waitFor(() => expect(handleRightClick).toHaveBeenCalled());
  });

  it("renders without header when title and backButton are both absent", () => {
    const {queryByText} = renderWithTheme(
      <Page navigation={mockNavigation}>
        <Text>Plain page</Text>
      </Page>
    );
    expect(queryByText("Plain page")).toBeTruthy();
  });

  it("renders loading state with loadingText", () => {
    const {getByText} = renderWithTheme(
      <Page loading loadingText="Loading data..." navigation={mockNavigation}>
        <Text>Content</Text>
      </Page>
    );
    expect(getByText("Loading data...")).toBeTruthy();
  });

  it("invokes router.back when the back button is pressed", () => {
    routerBack.mockClear();
    const {getByTestId} = renderWithTheme(
      <Page backButton navigation={mockNavigation} title="Page">
        <Text>Content</Text>
      </Page>
    );
    fireEvent.press(getByTestId("icon-button-chevron-left"));
    expect(routerBack).toHaveBeenCalled();
  });

  it("invokes onBack instead of router.back when provided", () => {
    const onBack = mock(() => {});
    routerBack.mockClear();
    const {getByTestId} = renderWithTheme(
      <Page backButton navigation={mockNavigation} onBack={onBack} title="Page">
        <Text>Content</Text>
      </Page>
    );
    fireEvent.press(getByTestId("icon-button-chevron-left"));
    expect(onBack).toHaveBeenCalled();
    expect(routerBack).not.toHaveBeenCalled();
  });

  it("invokes router.back when the close button is pressed", () => {
    routerBack.mockClear();
    const {getByTestId} = renderWithTheme(
      <Page closeButton navigation={mockNavigation} title="Page">
        <Text>Content</Text>
      </Page>
    );
    fireEvent.press(getByTestId("icon-button-xmark"));
    expect(routerBack).toHaveBeenCalled();
  });

  it("wraps content in SafeAreaView when safeArea is true", () => {
    const {UNSAFE_root} = renderWithTheme(
      <Page navigation={mockNavigation} safeArea>
        <Text>Content</Text>
      </Page>
    );
    expect(UNSAFE_root.findAllByType(SafeAreaView).length).toBeGreaterThan(0);
  });

  it("does not wrap content in SafeAreaView when safeArea is omitted", () => {
    const {UNSAFE_root} = renderWithTheme(
      <Page navigation={mockNavigation}>
        <Text>Content</Text>
      </Page>
    );
    expect(UNSAFE_root.findAllByType(SafeAreaView)).toHaveLength(0);
  });

  it("does not wrap content in SafeAreaView when safeArea is false", () => {
    const {UNSAFE_root} = renderWithTheme(
      <Page navigation={mockNavigation} safeArea={false}>
        <Text>Content</Text>
      </Page>
    );
    expect(UNSAFE_root.findAllByType(SafeAreaView)).toHaveLength(0);
  });

  it("safely handles a missing rightButtonOnClick callback", async () => {
    const {getByText} = renderWithTheme(
      <Page navigation={mockNavigation} rightButton="Go" title="Page">
        <Text>Content</Text>
      </Page>
    );
    await act(async () => {
      fireEvent.press(getByText("Go"));
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    // No crash; the optional-chained call handles the missing prop.
    expect(getByText("Go")).toBeTruthy();
  });

  it("renders loadingComponent instead of the spinner when provided", () => {
    const {getByTestId, queryByText} = renderWithTheme(
      <Page
        loading
        loadingComponent={<SkeletonList testID="page-skeleton" />}
        navigation={mockNavigation}
        testID="page"
      >
        <Text>Content</Text>
      </Page>
    );
    expect(getByTestId("page-skeleton", HIDDEN)).toBeTruthy();
    expect(getByTestId("page-loading").props["aria-busy"]).toBe(true);
    expect(queryByText("Content")).toBeNull();
  });

  it("announces loadingLabel and is busy while showing the default spinner", () => {
    const {getByTestId, getByText} = renderWithTheme(
      <Page
        loading
        loadingLabel="Loading patients"
        loadingText="Fetching..."
        navigation={mockNavigation}
        testID="page"
      >
        <Text>Content</Text>
      </Page>
    );
    const region = getByTestId("page-loading");
    expect(region.props["aria-busy"]).toBe(true);
    expect(region.props.accessibilityLabel).toBe("Loading patients");
    expect(getByText("Fetching...", HIDDEN)).toBeTruthy();
  });
});
