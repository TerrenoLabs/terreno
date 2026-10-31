import {describe, it} from "bun:test";
import {act, render, waitFor} from "@testing-library/react-native";
import {assert} from "chai";
import type React from "react";
import {useEffect} from "react";

import {Box} from "./Box";
import {Heading} from "./Heading";
import {MarkdownView} from "./MarkdownView";
import {Text} from "./Text";
import {ThemeProvider, useTheme} from "./Theme";

interface ThemeMutationProps {
  surfaceBase: "neutral000" | "error100";
}

const ThemeMutation: React.FC<ThemeMutationProps> = ({surfaceBase}) => {
  const {setTheme, theme} = useTheme();

  // Keep the provider mutation driven by props so rerender tests exercise context propagation.
  useEffect((): void => {
    const desiredColor = surfaceBase === "neutral000" ? "#FFFFFF" : "#D33232";
    if (theme.surface.base === desiredColor) {
      return;
    }
    setTheme({surface: {base: surfaceBase}});
  }, [setTheme, surfaceBase, theme.surface.base]);

  return null;
};

const renderP0 = (element: React.ReactElement): ReturnType<typeof render> => {
  return render(<ThemeProvider>{element}</ThemeProvider>);
};

describe("P0 component rerender regression coverage", () => {
  it("updates Box layout and theme props without retaining stale styles", () => {
    const result = renderP0(
      <Box color="base" padding={1} testID="box">
        first
      </Box>
    );

    result.rerender(
      <ThemeProvider>
        <Box color="error" padding={4} testID="box">
          second
        </Box>
      </ThemeProvider>
    );

    const box = result.getByTestId("box");
    assert.equal(box.props.style.padding, 16);
    assert.equal(box.props.style.backgroundColor, "#BD1111");
    assert.include(box.children, "second");
    assert.notInclude(box.children, "first");
  });

  it("does not leak border-adjusted sizing through the shared Box style map", () => {
    const result = render(
      <ThemeProvider>
        <Box border="default" height={80} testID="bordered" width={100} />
        <Box height={80} testID="plain" width={100} />
      </ThemeProvider>
    );

    assert.equal(result.getByTestId("bordered").props.style.width, 104);
    assert.equal(result.getByTestId("bordered").props.style.height, 84);
    assert.equal(result.getByTestId("plain").props.style.width, 100);
    assert.equal(result.getByTestId("plain").props.style.height, 80);

    result.rerender(
      <ThemeProvider>
        <Box height={80} testID="bordered" width={100} />
        <Box border="default" height={80} testID="plain" width={100} />
      </ThemeProvider>
    );

    assert.equal(result.getByTestId("bordered").props.style.width, 100);
    assert.equal(result.getByTestId("bordered").props.style.height, 80);
    assert.equal(result.getByTestId("plain").props.style.width, 104);
    assert.equal(result.getByTestId("plain").props.style.height, 84);
  });

  it("switches Box host behavior when onClick changes", () => {
    const onClick = (): void => {};
    const result = renderP0(<Box testID="box" />);

    assert.exists(result.getByTestId("box"));
    result.rerender(
      <ThemeProvider>
        <Box
          accessibilityHint="Runs the box action"
          accessibilityLabel="Box action"
          onClick={onClick}
          testID="box"
        />
      </ThemeProvider>
    );

    assert.exists(result.getByTestId("box-clickable"));
    assert.isNull(result.queryByTestId("box"));
  });

  it("keeps a Box imperative handle stable and usable across rerenders", () => {
    interface BoxHandle {
      scrollTo: (y: number) => void;
      scrollToEnd: () => void;
    }

    const boxRef = {current: null} as React.RefObject<BoxHandle | null>;
    const result = renderP0(<Box padding={1} ref={boxRef} scroll />);

    result.rerender(
      <ThemeProvider>
        <Box padding={2} ref={boxRef} scroll />
      </ThemeProvider>
    );

    assert.exists(boxRef.current);
    assert.isFunction(boxRef.current?.scrollTo);
    assert.isFunction(boxRef.current?.scrollToEnd);
  });

  it("updates Text content, typography, color, and truncation props", () => {
    const result = renderP0(
      <Text color="primary" size="sm" testID="text">
        first
      </Text>
    );

    result.rerender(
      <ThemeProvider>
        <Text bold color="error" numberOfLines={2} size="xl" skipLinking testID="text">
          second
        </Text>
      </ThemeProvider>
    );

    const text = result.getByTestId("text");
    assert.equal(text.props.style.color, "#BD1111");
    assert.equal(text.props.style.fontFamily, "text-bold");
    assert.equal(text.props.style.fontSize, 18);
    assert.equal(text.props.numberOfLines, 2);
    assert.include(text.children, "second");
  });

  it("updates Heading children and presentation props", () => {
    const result = renderP0(
      <Heading color="primary" size="sm" testID="heading">
        first
      </Heading>
    );

    result.rerender(
      <ThemeProvider>
        <Heading align="right" color="error" size="2xl" testID="heading">
          second
        </Heading>
      </ThemeProvider>
    );

    const heading = result.getByTestId("heading");
    assert.equal(heading.props.style.color, "#BD1111");
    assert.equal(heading.props.style.fontSize, 32);
    assert.equal(heading.props.style.textAlign, "right");
    assert.include(heading.children, "second");
  });

  it("updates MarkdownView content and inverted theme styles", async () => {
    const result = renderP0(<MarkdownView>{"**first**"}</MarkdownView>);
    await waitFor(() => {
      assert.include(JSON.stringify(result.toJSON()), "first");
    });

    await act(async () => {
      result.rerender(
        <ThemeProvider>
          <MarkdownView inverted>{"# second"}</MarkdownView>
        </ThemeProvider>
      );
    });

    await waitFor(() => {
      const serialized = JSON.stringify(result.toJSON());
      assert.include(serialized, "second");
      assert.include(serialized, "#FFFFFF");
      assert.notInclude(serialized, "first");
    });
  });

  it("propagates theme updates through memoization boundaries", async () => {
    const result = render(
      <ThemeProvider>
        <ThemeMutation surfaceBase="neutral000" />
        <Box color="base" testID="themed-box">
          <Text color="primary" testID="themed-text">
            themed
          </Text>
        </Box>
      </ThemeProvider>
    );

    result.rerender(
      <ThemeProvider>
        <ThemeMutation surfaceBase="error100" />
        <Box color="base" testID="themed-box">
          <Text color="primary" testID="themed-text">
            themed
          </Text>
        </Box>
      </ThemeProvider>
    );

    await act(async (): Promise<void> => {});

    assert.equal(result.getByTestId("themed-box").props.style.backgroundColor, "#D33232");
    assert.equal(result.getByTestId("themed-text").props.style.color, "#1C1C1C");
  });
});
