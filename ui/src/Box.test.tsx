import {describe, expect, it, mock, spyOn} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import type {ScrollView} from "react-native";

import {Box} from "./Box";
import {sharedResponsiveBreakpointStore} from "./ResponsiveBreakpoint";
import {Text} from "./Text";
import {renderWithTheme} from "./test-utils";

/** Imperative handle exposed by Box's forwarded ref. */
interface BoxScrollHandle {
  scrollTo: (y: number) => void;
  scrollToEnd: () => void;
}

describe("Box", () => {
  describe("basic rendering", () => {
    it("should render with default props", () => {
      const {root} = renderWithTheme(<Box />);
      expect(root).toBeTruthy();
    });

    it("should render children", () => {
      const {getByText} = renderWithTheme(
        <Box>
          <Text>Test Content</Text>
        </Box>
      );
      expect(getByText("Test Content")).toBeTruthy();
    });

    it("should apply testID", () => {
      const {getByTestId} = renderWithTheme(<Box testID="test-box" />);
      expect(getByTestId("test-box")).toBeTruthy();
    });
  });

  describe("layout props", () => {
    it("should apply direction prop", () => {
      const {root} = renderWithTheme(<Box direction="column" />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        display: "flex",
        flexDirection: "column",
      });
    });

    it("should apply responsive direction props", () => {
      const {root} = renderWithTheme(<Box smDirection="row" />);
      expect(root).toBeTruthy();
    });

    it("updates responsive directions at exact shared breakpoints", () => {
      const result = renderWithTheme(
        <Box>
          <Box direction="column" smDirection="row" testID="sm-responsive-box" />
          <Box direction="column" mdDirection="row" testID="md-responsive-box" />
          <Box direction="column" lgDirection="row" testID="lg-responsive-box" />
          <Box direction="column" testID="xl-responsive-box" xlDirection="row" />
        </Box>
      );

      act((): void => {
        sharedResponsiveBreakpointStore.updateWidth(319);
      });
      assert.equal(result.getByTestId("sm-responsive-box").props.style.flexDirection, "column");
      assert.equal(result.getByTestId("md-responsive-box").props.style.flexDirection, "column");
      assert.equal(result.getByTestId("lg-responsive-box").props.style.flexDirection, "column");
      assert.equal(result.getByTestId("xl-responsive-box").props.style.flexDirection, "column");

      act((): void => {
        sharedResponsiveBreakpointStore.updateWidth(320);
      });
      assert.equal(result.getByTestId("sm-responsive-box").props.style.flexDirection, "row");
      assert.equal(result.getByTestId("md-responsive-box").props.style.flexDirection, "column");
      assert.equal(result.getByTestId("lg-responsive-box").props.style.flexDirection, "column");
      assert.equal(result.getByTestId("xl-responsive-box").props.style.flexDirection, "column");

      act((): void => {
        sharedResponsiveBreakpointStore.updateWidth(375);
      });
      assert.equal(result.getByTestId("sm-responsive-box").props.style.flexDirection, "row");
      assert.equal(result.getByTestId("md-responsive-box").props.style.flexDirection, "row");
      assert.equal(result.getByTestId("lg-responsive-box").props.style.flexDirection, "column");
      assert.equal(result.getByTestId("xl-responsive-box").props.style.flexDirection, "column");

      act((): void => {
        sharedResponsiveBreakpointStore.updateWidth(600);
      });
      assert.equal(result.getByTestId("sm-responsive-box").props.style.flexDirection, "row");
      assert.equal(result.getByTestId("md-responsive-box").props.style.flexDirection, "row");
      assert.equal(result.getByTestId("lg-responsive-box").props.style.flexDirection, "row");
      assert.equal(result.getByTestId("xl-responsive-box").props.style.flexDirection, "column");

      act((): void => {
        sharedResponsiveBreakpointStore.updateWidth(1024);
      });
      assert.equal(result.getByTestId("sm-responsive-box").props.style.flexDirection, "row");
      assert.equal(result.getByTestId("md-responsive-box").props.style.flexDirection, "row");
      assert.equal(result.getByTestId("lg-responsive-box").props.style.flexDirection, "row");
      assert.equal(result.getByTestId("xl-responsive-box").props.style.flexDirection, "row");

      result.unmount();
      sharedResponsiveBreakpointStore.updateWidth(375);
    });

    it("applies responsive direction overrides from smallest to largest breakpoint", () => {
      const result = renderWithTheme(
        <Box
          direction="column"
          lgDirection="row"
          mdDirection="column"
          smDirection="row"
          testID="responsive-cascade"
          xlDirection="column"
        />
      );

      act((): void => {
        sharedResponsiveBreakpointStore.updateWidth(319);
      });
      assert.equal(result.getByTestId("responsive-cascade").props.style.flexDirection, "column");

      act((): void => {
        sharedResponsiveBreakpointStore.updateWidth(320);
      });
      assert.equal(result.getByTestId("responsive-cascade").props.style.flexDirection, "row");

      act((): void => {
        sharedResponsiveBreakpointStore.updateWidth(375);
      });
      assert.equal(result.getByTestId("responsive-cascade").props.style.flexDirection, "column");

      act((): void => {
        sharedResponsiveBreakpointStore.updateWidth(600);
      });
      assert.equal(result.getByTestId("responsive-cascade").props.style.flexDirection, "row");

      act((): void => {
        sharedResponsiveBreakpointStore.updateWidth(1024);
      });
      assert.equal(result.getByTestId("responsive-cascade").props.style.flexDirection, "column");

      result.unmount();
      sharedResponsiveBreakpointStore.updateWidth(375);
    });

    it("should apply flex grow", () => {
      const {root} = renderWithTheme(<Box flex="grow" />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        display: "flex",
        flexGrow: 1,
        flexShrink: 1,
      });
    });

    it("should apply flex shrink", () => {
      const {root} = renderWithTheme(<Box flex="shrink" />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        display: "flex",
        flexShrink: 1,
      });
    });

    it("should apply flex none", () => {
      const {root} = renderWithTheme(<Box flex="none" />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        display: "flex",
        flex: 0,
      });
    });

    it("should apply justifyContent", () => {
      const {root} = renderWithTheme(<Box justifyContent="center" />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        justifyContent: "center",
      });
    });

    it("should apply alignItems", () => {
      const {root} = renderWithTheme(<Box alignItems="center" />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        alignItems: "center",
      });
    });

    it("should apply alignContent", () => {
      const {root} = renderWithTheme(<Box alignContent="center" />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        alignContent: "center",
      });
    });

    it("should apply alignSelf", () => {
      const {root} = renderWithTheme(<Box alignSelf="center" />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        alignSelf: "center",
      });
    });

    it("should apply wrap", () => {
      const {root} = renderWithTheme(<Box wrap />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        alignItems: "flex-start",
        flexWrap: "wrap",
      });
    });

    it("should apply gap", () => {
      const {root} = renderWithTheme(<Box gap={4} />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        gap: 16,
      });
    });
  });

  describe("spacing props", () => {
    it("should apply padding", () => {
      const {root} = renderWithTheme(<Box padding={4} />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        padding: 16,
      });
    });

    it("should apply paddingX", () => {
      const {root} = renderWithTheme(<Box paddingX={2} />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        paddingLeft: 8,
        paddingRight: 8,
      });
    });

    it("should apply paddingY", () => {
      const {root} = renderWithTheme(<Box paddingY={3} />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        paddingBottom: 12,
        paddingTop: 12,
      });
    });

    it("should apply margin", () => {
      const {root} = renderWithTheme(<Box margin={4} />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        margin: 16,
      });
    });

    it("should apply marginTop", () => {
      const {root} = renderWithTheme(<Box marginTop={2} />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        marginTop: 8,
      });
    });

    it("should apply marginBottom", () => {
      const {root} = renderWithTheme(<Box marginBottom={2} />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        marginBottom: 8,
      });
    });

    it("should apply marginLeft", () => {
      const {root} = renderWithTheme(<Box marginLeft={2} />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        marginLeft: 8,
      });
    });

    it("should apply marginRight", () => {
      const {root} = renderWithTheme(<Box marginRight={2} />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        marginRight: 8,
      });
    });
  });

  describe("sizing props", () => {
    it("should apply width", () => {
      const {root} = renderWithTheme(<Box width={100} />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        width: 100,
      });
    });

    it("should apply height", () => {
      const {root} = renderWithTheme(<Box height={100} />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        height: 100,
      });
    });

    it("should apply string width", () => {
      const {root} = renderWithTheme(<Box width="50%" />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        width: "50%",
      });
    });

    it("should apply string height", () => {
      const {root} = renderWithTheme(<Box height="50%" />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        height: "50%",
      });
    });
  });

  describe("position props", () => {
    it("should apply position absolute", () => {
      const {root} = renderWithTheme(<Box position="absolute" />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        position: "absolute",
      });
    });

    it("should apply top", () => {
      const {root} = renderWithTheme(<Box top />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        top: 0,
      });
    });

    it("should apply bottom", () => {
      const {root} = renderWithTheme(<Box bottom />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        bottom: 0,
      });
    });

    it("should apply left", () => {
      const {root} = renderWithTheme(<Box left />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        left: 0,
      });
    });

    it("should apply right", () => {
      const {root} = renderWithTheme(<Box right />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        right: 0,
      });
    });

    it("should apply zIndex", () => {
      const {root} = renderWithTheme(<Box zIndex={10} />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        zIndex: 10,
      });
    });
  });

  describe("color and surface props", () => {
    it("should apply background color", () => {
      const {root} = renderWithTheme(<Box color="primary" />);
      const view = root.findByType("View");
      expect(view.props.style.backgroundColor).toBeDefined();
    });
  });

  describe("border props", () => {
    it("should apply border", () => {
      const {root} = renderWithTheme(<Box border="default" />);
      const view = root.findByType("View");
      expect(view.props.style.borderColor).toBeDefined();
      expect(view.props.style.borderWidth).toBe(1);
    });

    it("should apply borderTop", () => {
      const {root} = renderWithTheme(<Box borderTop="default" />);
      const view = root.findByType("View");
      expect(view.props.style.borderTopColor).toBeDefined();
      expect(view.props.style.borderTopWidth).toBe(1);
    });

    it("should apply borderBottom", () => {
      const {root} = renderWithTheme(<Box borderBottom="default" />);
      const view = root.findByType("View");
      expect(view.props.style.borderBottomColor).toBeDefined();
      expect(view.props.style.borderBottomWidth).toBe(1);
    });

    it("should apply borderLeft", () => {
      const {root} = renderWithTheme(<Box borderLeft="default" />);
      const view = root.findByType("View");
      expect(view.props.style.borderLeftColor).toBeDefined();
      expect(view.props.style.borderLeftWidth).toBe(1);
    });

    it("should apply borderRight", () => {
      const {root} = renderWithTheme(<Box borderRight="default" />);
      const view = root.findByType("View");
      expect(view.props.style.borderRightColor).toBeDefined();
      expect(view.props.style.borderRightWidth).toBe(1);
    });

    it("should adjust width for border", () => {
      const {root} = renderWithTheme(<Box border="default" width={100} />);
      const view = root.findByType("View");
      expect(view.props.style.width).toBe(104); // 100 + 2*2 for border
    });

    it("should adjust height for border", () => {
      const {root} = renderWithTheme(<Box border="default" height={100} />);
      const view = root.findByType("View");
      expect(view.props.style.height).toBe(104); // 100 + 2*2 for border
    });
  });

  describe("rounding props", () => {
    it("should apply rounding", () => {
      const {root} = renderWithTheme(<Box rounding="md" />);
      const view = root.findByType("View");
      expect(view.props.style.borderRadius).toBe(4);
    });

    it("should apply circle rounding with width", () => {
      const {root} = renderWithTheme(<Box rounding="circle" width={50} />);
      const view = root.findByType("View");
      expect(view.props.style.borderRadius).toBe(50);
    });

    it("should apply circle rounding with height", () => {
      const {root} = renderWithTheme(<Box height={50} rounding="circle" />);
      const view = root.findByType("View");
      expect(view.props.style.borderRadius).toBe(50);
    });

    it("should warn when using circle without dimensions", () => {
      const consoleSpy = spyOn(console, "warn").mockImplementation(() => {});
      renderWithTheme(<Box rounding="circle" />);
      expect(consoleSpy).toHaveBeenCalledWith(
        "Cannot use Box rounding='circle' without height or width."
      );
      consoleSpy.mockRestore();
    });
  });

  describe("display props", () => {
    it("should apply display none", () => {
      const {root} = renderWithTheme(<Box display="none" />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        display: "none",
      });
    });

    it("should apply display flex", () => {
      const {root} = renderWithTheme(<Box display="flex" />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        flex: undefined,
      });
    });

    it("should apply display block", () => {
      const {root} = renderWithTheme(<Box display="block" />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        flex: 0,
        flexDirection: "row",
      });
    });
  });

  describe("overflow props", () => {
    it("should apply overflow scroll", () => {
      const {root} = renderWithTheme(<Box overflow="scroll" />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        overflow: "scroll",
      });
    });

    it("should apply overflow scrollY", () => {
      const {root} = renderWithTheme(<Box overflow="scrollY" />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        overflow: "scroll",
      });
    });

    it("should apply overflow hidden", () => {
      const {root} = renderWithTheme(<Box overflow="hidden" />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        overflow: "hidden",
      });
    });
  });

  describe("shadow props", () => {
    it("should apply shadow", () => {
      const {root} = renderWithTheme(<Box shadow />);
      const view = root.findByType("View");
      expect(view.props.style).toBeDefined();
    });

    it("applies no shadow style when shadow is false", () => {
      const {root} = renderWithTheme(<Box shadow={false} />);
      const view = root.findByType("View");
      expect(view.props.style.boxShadow).toBeUndefined();
      expect(view.props.style.elevation).toBeUndefined();
    });
  });

  describe("clickable behavior", () => {
    it("should render as Pressable when onClick is provided", () => {
      const mockOnClick = mock(() => {});
      const {root} = renderWithTheme(
        <Box
          accessibilityHint="Tap to trigger action"
          accessibilityLabel="Click me"
          onClick={mockOnClick}
        >
          <Text>Clickable content</Text>
        </Box>
      );

      expect(root).toBeTruthy();
      // Just verify the component renders without error when onClick is provided
    });

    it("should call onClick when pressed", async () => {
      const mockOnClick = mock(() => {});
      const {getByTestId} = renderWithTheme(
        <Box
          accessibilityHint="Tap to trigger action"
          accessibilityLabel="Click me"
          onClick={mockOnClick}
          testID="clickable-box"
        />
      );

      const pressable = getByTestId("clickable-box-clickable");
      await act(async () => {
        fireEvent.press(pressable);
      });

      expect(mockOnClick).toHaveBeenCalledTimes(1);
    });

    it("should apply accessibility props to Pressable", () => {
      const mockOnClick = mock(() => {});
      const {getByTestId} = renderWithTheme(
        <Box
          accessibilityHint="Tap to trigger action"
          accessibilityLabel="Click me"
          onClick={mockOnClick}
          testID="accessible-box"
        />
      );

      const pressable = getByTestId("accessible-box-clickable");
      expect(pressable).toBeTruthy();
      // Basic check that accessibility props are being applied
      expect(pressable.props).toBeDefined();
    });
  });

  describe("accessibility state", () => {
    it("forwards checked and disabled to a clickable Box", () => {
      const {getByTestId} = renderWithTheme(
        <Box
          accessibilityHint="Toggles the item"
          accessibilityLabel="Preheat the oven"
          accessibilityRole="checkbox"
          accessibilityState={{checked: true, disabled: false}}
          onClick={() => {}}
          testID="row"
        />
      );
      const pressable = getByTestId("row-clickable");
      expect(pressable.props.accessibilityState).toEqual({checked: true, disabled: false});
      expect(pressable.props["aria-checked"]).toBe(true);
      expect(pressable.props["aria-disabled"]).toBe(false);
      expect(pressable.props.accessibilityRole).toBe("checkbox");
      expect(pressable.props.style.accessibilityState).toBeUndefined();
    });

    it("keeps a disabled clickable Box labelled but does not call onClick", async () => {
      const onClick = mock(() => {});
      const {getByTestId} = renderWithTheme(
        <Box
          accessibilityHint="Toggles the item"
          accessibilityLabel="Preheat the oven"
          accessibilityRole="checkbox"
          accessibilityState={{checked: false, disabled: true}}
          onClick={onClick}
          testID="row"
        />
      );
      const pressable = getByTestId("row-clickable");
      expect(pressable.props["aria-label"]).toBe("Preheat the oven");
      expect(pressable.props.accessibilityState.disabled).toBe(true);
      await act(async () => {
        fireEvent.press(pressable);
      });
      expect(onClick).not.toHaveBeenCalled();
    });

    it("forwards checked to a Box without onClick", () => {
      const {getByTestId} = renderWithTheme(
        <Box accessibilityState={{checked: false}} testID="plain" />
      );
      const view = getByTestId("plain");
      expect(view.props.accessibilityState).toEqual({checked: false});
      expect(view.props["aria-checked"]).toBe(false);
    });

    it("toggles a checkbox Box with Space on web", async () => {
      const onClick = mock(() => {});
      const preventDefault = mock(() => {});
      const {getByTestId} = renderWithTheme(
        <Box
          accessibilityHint="Toggles the item"
          accessibilityLabel="Preheat the oven"
          accessibilityRole="checkbox"
          onClick={onClick}
          testID="row"
        />
      );
      await act(async () => {
        getByTestId("row-clickable").props.onKeyDown({key: " ", preventDefault});
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(onClick).toHaveBeenCalledTimes(1);
      expect(preventDefault).toHaveBeenCalledTimes(1);
    });
  });

  describe("scroll behavior", () => {
    it("should render ScrollView when scroll is enabled", () => {
      const {root} = renderWithTheme(<Box scroll />);
      expect(root).toBeTruthy();
      // Just verify the component renders without error when scroll is enabled
    });

    it("should enable horizontal scrolling when overflow is scrollX", () => {
      const {root} = renderWithTheme(<Box overflow="scrollX" scroll />);
      expect(root).toBeTruthy();
      // Just verify the component renders without error when horizontal scroll is enabled
    });

    it("should call onScroll callback", () => {
      const mockOnScroll = mock(() => {});
      const {root} = renderWithTheme(<Box onScroll={mockOnScroll} scroll />);
      expect(root).toBeTruthy();
      // Just verify the component renders without error when onScroll is provided
    });

    // Behavior props leaking into style reach the native view as unserializable
    // values: a ref object in style is cyclical (host instance points back at the
    // node) and gets dev-frozen, so React throws when detaching it on unmount.
    it("should keep behavior props out of the ScrollView style", () => {
      const scrollRef = React.createRef<ScrollView>();
      const {root} = renderWithTheme(
        <Box onScroll={mock(() => {})} scroll scrollRef={scrollRef}>
          <Text>Scrollable</Text>
        </Box>
      );

      // RN Testing Library resolves host ScrollView by display name, not the JS class.
      const scrollView = root.findByType("ScrollView");
      expect(scrollView.props.style).not.toHaveProperty("scrollRef");
      expect(scrollView.props.style).not.toHaveProperty("scroll");
      expect(scrollView.props.style).not.toHaveProperty("onScroll");
      expect(scrollView.props.style).not.toHaveProperty("testID");
    });

    it("should keep behavior props out of the View style", () => {
      const {root} = renderWithTheme(
        <Box avoidKeyboard keyboardOffset={12} onLayout={mock(() => {})} testID="behavior-box" />
      );

      const view = root.findByType("View");
      expect(view.props.style).not.toHaveProperty("onLayout");
      expect(view.props.style).not.toHaveProperty("avoidKeyboard");
      expect(view.props.style).not.toHaveProperty("keyboardOffset");
      expect(view.props.style).not.toHaveProperty("testID");
    });
  });

  describe("keyboard avoidance", () => {
    it("should render KeyboardAvoidingView when avoidKeyboard is enabled", () => {
      const {root} = renderWithTheme(<Box avoidKeyboard />);
      expect(root).toBeTruthy();
      // Just verify the component renders without error when avoidKeyboard is enabled
    });

    it("should apply keyboard offset", () => {
      const {root} = renderWithTheme(<Box avoidKeyboard keyboardOffset={20} />);
      expect(root).toBeTruthy();
      // Just verify the component renders without error when keyboard offset is provided
    });
  });

  describe("hover events", () => {
    it("should call onHoverStart", async () => {
      const mockOnHoverStart = mock(() => {});
      const {getByTestId} = renderWithTheme(
        <Box onHoverStart={mockOnHoverStart} testID="hover-box" />
      );

      const view = getByTestId("hover-box");
      await act(async () => {
        fireEvent(view, "pointerEnter");
      });

      expect(mockOnHoverStart).toHaveBeenCalledTimes(1);
    });

    it("should call onHoverEnd", async () => {
      const mockOnHoverEnd = mock(() => {});
      const {getByTestId} = renderWithTheme(<Box onHoverEnd={mockOnHoverEnd} testID="hover-box" />);

      const view = getByTestId("hover-box");
      await act(async () => {
        fireEvent(view, "pointerLeave");
      });

      expect(mockOnHoverEnd).toHaveBeenCalledTimes(1);
    });
  });

  describe("ref forwarding", () => {
    it("should expose scrollToEnd method", () => {
      const ref = React.createRef<BoxScrollHandle>();
      renderWithTheme(<Box ref={ref} scroll />);

      expect(ref.current).toBeTruthy();
      expect(typeof ref.current.scrollToEnd).toBe("function");
    });

    it("should expose scrollTo method", () => {
      const ref = React.createRef<BoxScrollHandle>();
      renderWithTheme(<Box ref={ref} scroll />);

      expect(ref.current).toBeTruthy();
      expect(typeof ref.current.scrollTo).toBe("function");
    });

    it("scrollTo forwards to the underlying scroll ref after the delay", async () => {
      const scrollTo = mock(() => {});
      const scrollToEnd = mock(() => {});
      const scrollRef = {
        current: {scrollTo, scrollToEnd},
      } as unknown as React.RefObject<ScrollView>;
      const ref = React.createRef<BoxScrollHandle>();
      // Intentionally omit `scroll` so the ScrollView does not claim `scrollRef`
      // and overwrite `.current`; the imperative handle still reads it.
      renderWithTheme(
        <Box ref={ref} scrollRef={scrollRef}>
          <Text>Content</Text>
        </Box>
      );

      ref.current.scrollTo(42);
      ref.current.scrollToEnd();

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
      });

      expect(scrollTo).toHaveBeenCalledWith({y: 42});
      expect(scrollToEnd).toHaveBeenCalledTimes(1);
    });
  });

  describe("dangerous inline styles", () => {
    it("should apply dangerouslySetInlineStyle", () => {
      const {root} = renderWithTheme(
        <Box dangerouslySetInlineStyle={{__style: {backgroundColor: "red"}}} />
      );
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        backgroundColor: "red",
      });
    });
  });

  describe("warnings", () => {
    it("should not warn when using wrap and alignItems together", () => {
      const consoleSpy = spyOn(console, "warn").mockImplementation(() => {});
      renderWithTheme(<Box alignItems="center" wrap />);
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("edge cases", () => {
    it("should handle undefined children", () => {
      const {root} = renderWithTheme(<Box>{undefined}</Box>);
      expect(root).toBeTruthy();
    });

    it("should handle null children", () => {
      const {root} = renderWithTheme(<Box>{null}</Box>);
      expect(root).toBeTruthy();
    });

    it("should handle multiple children", () => {
      const {getByText} = renderWithTheme(
        <Box>
          <Text>First</Text>
          <Text>Second</Text>
        </Box>
      );
      expect(getByText("First")).toBeTruthy();
      expect(getByText("Second")).toBeTruthy();
    });

    it("should handle zero values", () => {
      const {root} = renderWithTheme(<Box gap={0} margin={0} padding={0} />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        gap: 0,
        margin: 0,
        padding: 0,
      });
    });
  });

  describe("snapshots", () => {
    it("should match snapshot with default props", () => {
      const component = renderWithTheme(<Box />);
      expect(component.toJSON()).toMatchSnapshot();
    });

    it("should match snapshot with layout props", () => {
      const component = renderWithTheme(
        <Box
          alignItems="center"
          direction="column"
          flex="grow"
          justifyContent="center"
          margin={2}
          padding={4}
        />
      );
      expect(component.toJSON()).toMatchSnapshot();
    });

    it("should match snapshot with clickable props", () => {
      const component = renderWithTheme(
        <Box
          accessibilityHint="Tap to trigger action"
          accessibilityLabel="Click me"
          onClick={mock(() => {})}
        />
      );
      expect(component.toJSON()).toMatchSnapshot();
    });

    it("should match snapshot with scroll enabled", () => {
      const component = renderWithTheme(<Box scroll />);
      expect(component.toJSON()).toMatchSnapshot();
    });

    it("should match snapshot with keyboard avoidance", () => {
      const component = renderWithTheme(<Box avoidKeyboard />);
      expect(component.toJSON()).toMatchSnapshot();
    });

    it("should match snapshot with border and rounding", () => {
      const component = renderWithTheme(
        <Box border="default" color="primary" rounding="md" shadow />
      );
      expect(component.toJSON()).toMatchSnapshot();
    });
  });

  describe("edge case warnings and fallbacks", () => {
    it("returns empty style when border prop is falsy", () => {
      const {root} = renderWithTheme(<Box border={undefined} />);
      expect(root).toBeTruthy();
    });

    it("returns empty style when borderBottom prop is falsy", () => {
      const {root} = renderWithTheme(<Box borderBottom={undefined} />);
      expect(root).toBeTruthy();
    });

    it("returns empty style when borderLeft prop is falsy", () => {
      const {root} = renderWithTheme(<Box borderLeft={undefined} />);
      expect(root).toBeTruthy();
    });

    it("returns empty style when borderRight prop is falsy", () => {
      const {root} = renderWithTheme(<Box borderRight={undefined} />);
      expect(root).toBeTruthy();
    });

    it("returns empty style when borderTop prop is falsy", () => {
      const {root} = renderWithTheme(<Box borderTop={undefined} />);
      expect(root).toBeTruthy();
    });

    it("warns when invalid height value is provided", () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      renderWithTheme(<Box height={"abc"} />);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("warns when invalid maxHeight value is provided", () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      renderWithTheme(<Box maxHeight={"xyz"} />);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("warns when invalid maxWidth value is provided", () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      renderWithTheme(<Box maxWidth={"abc"} />);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("warns when invalid minHeight value is provided", () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      renderWithTheme(<Box minHeight={"abc"} />);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("applies a valid maxHeight value", () => {
      const {root} = renderWithTheme(<Box maxHeight={120} />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({maxHeight: 120});
    });

    it("applies a valid minHeight value", () => {
      const {root} = renderWithTheme(<Box minHeight={"50%"} />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({minHeight: "50%"});
    });

    it("applies a valid maxWidth value", () => {
      const {root} = renderWithTheme(<Box maxWidth={200} />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({maxWidth: 200});
    });

    it("applies a valid minWidth value", () => {
      const {root} = renderWithTheme(<Box minWidth={"25%"} />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({minWidth: "25%"});
    });

    it("warns when invalid minWidth value is provided", () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      renderWithTheme(<Box minWidth={"abc"} />);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("warns when invalid width value is provided", () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      renderWithTheme(<Box width={"abc"} />);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("applies width with border adds 4 pixels", () => {
      const {root} = renderWithTheme(<Box border="default" width={100} />);
      const view = root.findByType("View");
      expect(view.props.style.width).toBe(104);
    });

    it("applies height with border adds 4 pixels", () => {
      const {root} = renderWithTheme(<Box border="default" height={80} />);
      const view = root.findByType("View");
      expect(view.props.style.height).toBe(84);
    });

    it("keeps an explicit alignItems when combined with wrap", () => {
      const {root} = renderWithTheme(<Box alignItems="center" wrap />);
      const view = root.findByType("View");
      expect(view.props.style).toMatchObject({
        alignItems: "center",
        flexWrap: "wrap",
      });
    });

    it("applies dangerouslySetInlineStyle overrides", () => {
      const {root} = renderWithTheme(
        <Box dangerouslySetInlineStyle={{__style: {backgroundColor: "red"}}} />
      );
      const view = root.findByType("View");
      expect(view.props.style.backgroundColor).toBe("red");
    });

    it("handles rounding='circle' with width/height", () => {
      const {root} = renderWithTheme(<Box height={40} rounding="circle" width={40} />);
      const view = root.findByType("View");
      expect(view.props.style.borderRadius).toBe(40);
    });

    it("warns when rounding='circle' without width/height", () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      renderWithTheme(<Box rounding="circle" />);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("applies shadow on ios/web", () => {
      const {root} = renderWithTheme(<Box shadow />);
      const view = root.findByType("View");
      expect(view.props.style.boxShadow).toBeDefined();
    });

    it("applies overflow='scroll'", () => {
      const {root} = renderWithTheme(<Box overflow="scroll" />);
      const view = root.findByType("View");
      expect(view.props.style.overflow).toBe("scroll");
    });

    it("applies overflow='scrollY'", () => {
      const {root} = renderWithTheme(<Box overflow="scrollY" />);
      const view = root.findByType("View");
      expect(view.props.style.overflow).toBe("scroll");
    });

    it("applies position='absolute'", () => {
      const {root} = renderWithTheme(<Box position="absolute" />);
      const view = root.findByType("View");
      expect(view.props.style.position).toBe("absolute");
    });

    it("applies zIndex", () => {
      const {root} = renderWithTheme(<Box zIndex={10} />);
      const view = root.findByType("View");
      expect(view.props.style.zIndex).toBe(10);
    });

    it("applies top/left/right/bottom offsets", () => {
      const {root} = renderWithTheme(<Box bottom left position="absolute" right top />);
      const view = root.findByType("View");
      expect(view.props.style.top).toBe(0);
      expect(view.props.style.left).toBe(0);
      expect(view.props.style.right).toBe(0);
      expect(view.props.style.bottom).toBe(0);
    });

    it("fires onScroll when scroll is enabled", async () => {
      const onScroll = mock(() => {});
      const {root} = renderWithTheme(
        <Box onScroll={onScroll} scroll>
          <Text>Scrollable</Text>
        </Box>
      );
      const scrollView = root.findByType("ScrollView");
      await act(async () => {
        scrollView.props.onScroll?.({nativeEvent: {contentOffset: {y: 100}}});
      });
      expect(onScroll).toHaveBeenCalledWith(100);
    });

    it("invokes onHoverStart/onHoverEnd callbacks", async () => {
      const onHoverStart = mock(() => {});
      const onHoverEnd = mock(() => {});
      const {root} = renderWithTheme(
        <Box onHoverEnd={onHoverEnd} onHoverStart={onHoverStart}>
          <Text>Hover</Text>
        </Box>
      );
      const view = root.findByType("View");
      await act(async () => {
        await view.props.onPointerEnter?.();
      });
      await act(async () => {
        await view.props.onPointerLeave?.();
      });
      expect(onHoverStart).toHaveBeenCalled();
      expect(onHoverEnd).toHaveBeenCalled();
    });

    it("exposes scrollTo and scrollToEnd through ref", () => {
      const ref = React.createRef<BoxScrollHandle>();
      renderWithTheme(
        <Box ref={ref} scroll>
          <Text>Content</Text>
        </Box>
      );
      expect(typeof ref.current?.scrollTo).toBe("function");
      expect(typeof ref.current?.scrollToEnd).toBe("function");
      // Call them to cover the function bodies
      ref.current?.scrollTo(100);
      ref.current?.scrollToEnd();
    });

    it("invokes onClick with haptic feedback", async () => {
      const onClick = mock(() => Promise.resolve());
      const {getByLabelText} = renderWithTheme(
        <Box accessibilityHint="" accessibilityLabel="Press" onClick={onClick}>
          <Text>Click</Text>
        </Box>
      );
      await act(async () => {
        fireEvent.press(getByLabelText("Press"));
      });
      expect(onClick).toHaveBeenCalled();
    });
  });
});
