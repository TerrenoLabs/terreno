import {describe, expect, it, mock, spyOn} from "bun:test";
import {act, fireEvent, render, waitFor} from "@testing-library/react-native";
import {assert} from "chai";
import type {ReactTestInstance} from "react-test-renderer";

import {Button} from "./Button";
import type {ButtonProps} from "./Common";
import {isNarrowViewport} from "./MediaQuery";
import * as ThemeModule from "./Theme";
import {renderWithIcons, renderWithTheme, TEST_CUSTOM_ICON_TEST_ID} from "./test-utils";
import {Unifier} from "./Unifier";
import * as Utilities from "./Utilities";

const ACTIVE_BUTTON_VARIANTS: {
  backgroundColor: string;
  variant: NonNullable<ButtonProps["variant"]>;
}[] = [
  {backgroundColor: "#2B6072", variant: "primary"},
  {backgroundColor: "#0E9DCD", variant: "secondary"},
  {backgroundColor: "#0E9DCD", variant: "muted"},
  {backgroundColor: "#0E9DCD", variant: "outline"},
  {backgroundColor: "#BD1111", variant: "destructive"},
  {backgroundColor: "#0E9DCD", variant: "ghost"},
];

interface PressableTestProps {
  onPress: () => Promise<void>;
}

interface CancelablePress {
  (): void;
  cancel: () => void;
}

const LONG_LABEL = "Go team 🎉🎉🎉🎉🎉…";

const hostParentOf = (node: ReactTestInstance | null): ReactTestInstance | null => {
  let parent = node?.parent ?? null;
  while (parent && typeof parent.type !== "string") {
    parent = parent.parent;
  }
  return parent;
};

/** The label and the icon and spinner rows around it, innermost first. */
const labelAndRows = (label: ReactTestInstance): (ReactTestInstance | null)[] => {
  const iconRow = hostParentOf(label);
  return [label, iconRow, hostParentOf(iconRow)];
};

describe("Button", () => {
  it("renders correctly with default props", () => {
    const {toJSON} = renderWithTheme(<Button onClick={() => {}} text="Click me" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders button text correctly", () => {
    const {getByText} = renderWithTheme(<Button onClick={() => {}} text="Submit" />);
    expect(getByText("Submit")).toBeTruthy();
  });

  it("renders with testID", () => {
    const {getByTestId} = renderWithTheme(
      <Button onClick={() => {}} testID="test-button" text="Test" />
    );
    expect(getByTestId("test-button")).toBeTruthy();
  });

  it("keeps a long label on one line by default", () => {
    const {getByTestId, getByText} = renderWithTheme(
      <Button onClick={() => {}} size="sm" testID="one-line" text={LONG_LABEL} />
    );

    const [label, iconRow, spinnerRow] = labelAndRows(getByText(LONG_LABEL));
    for (const node of [label, iconRow, spinnerRow]) {
      expect(node?.props.style).not.toHaveProperty("flexShrink");
    }
    expect(label?.props.style).not.toHaveProperty("textAlign");
    const style = getByTestId("one-line").props.style;
    expect(style).toMatchObject({height: 28, paddingVertical: 0});
    expect(style).not.toHaveProperty("maxWidth");
    expect(style).not.toHaveProperty("minHeight");
  });

  it("fits its container and wraps a long label onto centered lines with wrapText", () => {
    const {getByTestId, getByText} = renderWithTheme(
      <Button onClick={() => {}} testID="wrapping" text={LONG_LABEL} wrapText />
    );

    const [label, iconRow, spinnerRow] = labelAndRows(getByText(LONG_LABEL));
    expect(label?.props.style).toMatchObject({flexShrink: 1, textAlign: "center"});
    for (const row of [iconRow, spinnerRow]) {
      expect(row?.props.style).toMatchObject({flexShrink: 1});
    }
    const style = getByTestId("wrapping").props.style;
    expect(style).toMatchObject({maxWidth: "100%", paddingVertical: 8});
    expect(style.height).toBeUndefined();
    expect(style).not.toHaveProperty("minHeight");
  });

  for (const {paddingVertical, variant} of [
    {paddingVertical: 4, variant: "primary"},
    {paddingVertical: 2, variant: "outline"},
  ] as const) {
    it(`grows a sm ${variant} button from 28px instead of clipping a wrapped label`, () => {
      const {getByTestId, getByText} = renderWithTheme(
        <Button
          onClick={() => {}}
          size="sm"
          testID="sm-wrap"
          text={LONG_LABEL}
          variant={variant}
          wrapText
        />
      );

      const style = getByTestId("sm-wrap").props.style;
      expect(style.height).toBeUndefined();
      expect(style).toMatchObject({maxWidth: "100%", minHeight: 28, paddingVertical});
      expect(getByText(LONG_LABEL).props.style).toMatchObject({flexShrink: 1, fontSize: 14});
    });
  }

  it("supports an accessible name distinct from visible text", () => {
    const {getByTestId} = renderWithTheme(
      <Button accessibilityLabel="Filter Name" onClick={() => {}} testID="filter-button" text="" />
    );
    expect(getByTestId("filter-button").props.accessibilityLabel).toBe("Filter Name");
  });

  // Variant tests
  it("renders primary variant", () => {
    const {toJSON} = renderWithTheme(
      <Button onClick={() => {}} text="Primary" variant="primary" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders secondary variant", () => {
    const {toJSON} = renderWithTheme(
      <Button onClick={() => {}} text="Secondary" variant="secondary" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders muted variant", () => {
    const {toJSON} = renderWithTheme(<Button onClick={() => {}} text="Muted" variant="muted" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders outline variant", () => {
    const {toJSON} = renderWithTheme(
      <Button onClick={() => {}} text="Outline" variant="outline" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders destructive variant", () => {
    const {toJSON} = renderWithTheme(
      <Button onClick={() => {}} text="Delete" variant="destructive" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  for (const {backgroundColor, variant} of ACTIVE_BUTTON_VARIANTS) {
    it(`renders ${variant} variant in active state`, () => {
      const {getByTestId, getByText} = renderWithTheme(
        <Button
          onClick={() => {}}
          state="active"
          testID={`${variant}-active`}
          text={`${variant} active`}
          variant={variant}
        />
      );

      expect(getByTestId(`${variant}-active`)).toHaveStyle({backgroundColor});
      expect(getByText(`${variant} active`)).toHaveStyle({color: "#FFFFFF"});
    });
  }

  it("removes the outline border in active state", () => {
    const {getByTestId} = renderWithTheme(
      <Button
        onClick={() => {}}
        state="active"
        testID="outline-active"
        text="Outline active"
        variant="outline"
      />
    );

    expect(getByTestId("outline-active").props.style.borderColor).toBeUndefined();
    expect(getByTestId("outline-active").props.style.borderWidth).toBeUndefined();
  });

  for (const size of ["default", "sm"] as const) {
    it(`renders ${size} outline button with the same outer box as solid buttons`, () => {
      const {getByTestId} = renderWithTheme(
        <>
          <Button onClick={() => {}} size={size} testID="solid" text="Solid" />
          <Button
            onClick={() => {}}
            size={size}
            testID="outline"
            text="Outline"
            variant="outline"
          />
        </>
      );
      const outerBox = (style: Record<string, number | undefined>): Record<string, number> => {
        const border = style.borderWidth ?? 0;
        return {
          height: style.height ?? 0,
          horizontal: (style.paddingHorizontal ?? 0) + border,
          vertical: style.height === undefined ? (style.paddingVertical ?? 0) + border : 0,
        };
      };

      expect(outerBox(getByTestId("outline").props.style)).toEqual(
        outerBox(getByTestId("solid").props.style)
      );
    });
  }

  it("keeps disabled styling when state is active", () => {
    const {getByTestId} = renderWithTheme(
      <Button
        disabled
        onClick={() => {}}
        state="active"
        testID="disabled-active"
        text="Disabled active"
      />
    );

    expect(getByTestId("disabled-active")).toHaveStyle({backgroundColor: "#949494"});
  });

  it("defaults to scale press animation", () => {
    const tree = renderWithTheme(<Button onClick={() => {}} text="Default animation" />).toJSON();
    expect(Array.isArray(tree)).toBe(false);
    expect(tree?.type).toBe("PressableScale");
  });

  it("renders opacity press animation", () => {
    const tree = renderWithTheme(
      <Button onClick={() => {}} pressAnimation="opacity" text="Opacity" />
    ).toJSON();
    expect(Array.isArray(tree)).toBe(false);
    expect(tree?.type).toBe("PressableOpacity");
  });

  it("renders no press animation", () => {
    const tree = renderWithTheme(
      <Button onClick={() => {}} pressAnimation="none" text="No animation" />
    ).toJSON();
    expect(Array.isArray(tree)).toBe(false);
    expect(tree?.type).toBe("PressableWithoutFeedback");
  });

  // Disabled state
  it("renders disabled state", () => {
    const {toJSON} = renderWithTheme(<Button disabled onClick={() => {}} text="Disabled" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("applies disabled styles when disabled", () => {
    const {toJSON} = renderWithTheme(<Button disabled onClick={() => {}} text="Disabled" />);
    // The button should render with disabled styling
    expect(toJSON()).toMatchSnapshot();
  });

  // Loading state
  it("renders loading state", () => {
    const {toJSON} = renderWithTheme(<Button loading onClick={() => {}} text="Loading" />);
    expect(toJSON()).toMatchSnapshot();
  });

  // fullWidth
  it("renders fullWidth button", () => {
    const {toJSON} = renderWithTheme(<Button fullWidth onClick={() => {}} text="Full Width" />);
    expect(toJSON()).toMatchSnapshot();
  });

  // Icon tests
  it("renders with icon on left", () => {
    const {toJSON} = renderWithTheme(
      <Button iconName="check" onClick={() => {}} text="With Icon" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with icon on right", () => {
    const {toJSON} = renderWithTheme(
      <Button iconName="arrow-right" iconPosition="right" onClick={() => {}} text="Next" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  // Click handling
  it("calls onClick when pressed", async () => {
    const handleClick = mock(() => Promise.resolve());
    const {getByText} = renderWithTheme(<Button onClick={handleClick} text="Click" />);

    await act(async () => {
      fireEvent.press(getByText("Click"));
      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    await waitFor(() => {
      expect(handleClick).toHaveBeenCalled();
    });
  });

  it("does not call onClick again on the trailing debounce edge after rapid presses", async () => {
    const handleClick = mock(() => Promise.resolve());
    const {getByText} = renderWithTheme(<Button onClick={handleClick} text="Click" />);

    await act(async () => {
      fireEvent.press(getByText("Click"));
      fireEvent.press(getByText("Click"));
      await new Promise((resolve) => setTimeout(resolve, 700));
    });

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("skips equivalent parent updates and redraws changed props", () => {
    const handleClick = mock(() => Promise.resolve());
    const mobileDeviceMock = isNarrowViewport as ReturnType<typeof mock>;
    mobileDeviceMock.mockClear();
    const {rerender} = renderWithTheme(<Button onClick={handleClick} text="Stable" />);
    const initialRenderCalls = mobileDeviceMock.mock.calls.length;

    rerender(<Button onClick={handleClick} text="Stable" />);
    assert.equal(mobileDeviceMock.mock.calls.length, initialRenderCalls);

    rerender(<Button onClick={handleClick} text="Changed" />);
    assert.equal(mobileDeviceMock.mock.calls.length, initialRenderCalls + 1);
  });

  it("prevents another press while an async handler remains pending", async () => {
    let resolveClick: (() => void) | undefined;
    const handleClick = mock(
      () =>
        new Promise<void>((resolve) => {
          resolveClick = resolve;
        })
    );
    const {getByTestId} = renderWithTheme(
      <Button onClick={handleClick} testID="delayed-button" text="Delayed" />
    );
    const button = getByTestId("delayed-button");

    await act(async () => {
      fireEvent.press(button);
      await new Promise((resolve) => setTimeout(resolve, 600));
      fireEvent.press(button);
    });

    assert.lengthOf(handleClick.mock.calls, 1);

    await act(async () => {
      resolveClick?.();
      await Promise.resolve();
    });
  });

  it("cancels the debounced press handler on unmount", () => {
    const {getByTestId, unmount} = renderWithTheme(
      <Button onClick={() => {}} testID="cleanup-button" text="Cleanup" />
    );
    const onPress = getByTestId("cleanup-button").props.onPress as CancelablePress;
    const cancelSpy = spyOn(onPress, "cancel");

    unmount();

    assert.lengthOf(cancelSpy.mock.calls, 1);
  });

  it("does not start an action when unmounted during async press setup", async () => {
    let resolveHaptic: (() => void) | undefined;
    const hapticSpy = spyOn(Unifier.utils, "haptic").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveHaptic = resolve;
        })
    );
    const handleClick = mock(() => Promise.resolve());
    const {getByTestId, unmount} = renderWithTheme(
      <Button onClick={handleClick} testID="unmount-button" text="Unmount" />
    );

    fireEvent.press(getByTestId("unmount-button"));
    unmount();
    await act(async () => {
      resolveHaptic?.();
      await Promise.resolve();
    });

    assert.lengthOf(handleClick.mock.calls, 0);
    hapticSpy.mockRestore();
  });

  it("keeps the confirmation modal path absent for plain buttons", async () => {
    const handleClick = mock(() => Promise.resolve());
    const {getByText, queryByText} = renderWithTheme(
      <Button
        confirmationText="Plain buttons never show this"
        modalTitle="Unused confirmation"
        onClick={handleClick}
        text="Plain"
      />
    );

    await act(async () => {
      fireEvent.press(getByText("Plain"));
      await Promise.resolve();
    });

    assert.isNull(queryByText("Unused confirmation"));
    assert.isNull(queryByText("Plain buttons never show this"));
    assert.lengthOf(handleClick.mock.calls, 1);
  });

  // Confirmation modal tests
  it("renders with confirmation modal props", () => {
    const {toJSON} = renderWithTheme(
      <Button
        confirmationText="Are you sure?"
        modalSubTitle="This action cannot be undone"
        modalTitle="Confirm Delete"
        onClick={() => {}}
        text="Delete"
        withConfirmation
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("shows confirmation modal when withConfirmation is true and button is pressed", async () => {
    const handleClick = mock(() => Promise.resolve());
    const {getByText, queryByText} = renderWithTheme(
      <Button
        confirmationText="Are you sure you want to proceed?"
        modalTitle="Confirm Action"
        onClick={handleClick}
        text="Press Me"
        withConfirmation
      />
    );

    await act(async () => {
      fireEvent.press(getByText("Press Me"));
      await new Promise((resolve) => setTimeout(resolve, 600));
    });

    // The confirmation modal should now be visible with the modal title
    await waitFor(
      () => {
        expect(queryByText("Confirm Action")).toBeTruthy();
      },
      {timeout: 2000}
    );
  });

  // Accessibility
  it("has correct accessibility props", () => {
    const {getByLabelText} = renderWithTheme(<Button onClick={() => {}} text="Accessible" />);
    expect(getByLabelText("Accessible")).toBeTruthy();
  });

  it("invokes onClick when confirmation primary button is pressed", async () => {
    const handleClick = mock(() => Promise.resolve());
    const {getByText, queryByText} = renderWithTheme(
      <Button
        confirmationText="Confirm action?"
        modalTitle="Confirm Title"
        onClick={handleClick}
        text="Press Me"
        withConfirmation
      />
    );

    await act(async () => {
      fireEvent.press(getByText("Press Me"));
      await new Promise((resolve) => setTimeout(resolve, 600));
    });

    // Wait for confirmation modal
    await waitFor(
      () => {
        expect(queryByText("Confirm Title")).toBeTruthy();
      },
      {timeout: 2000}
    );

    await act(async () => {
      fireEvent.press(getByText("Confirm"));
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    await waitFor(() => {
      expect(handleClick).toHaveBeenCalled();
    });
  });

  it("dismisses confirmation modal when secondary button is pressed", async () => {
    const handleClick = mock(() => Promise.resolve());
    const {getByText, queryByText} = renderWithTheme(
      <Button
        confirmationText="Confirm action?"
        modalTitle="Confirm Title"
        onClick={handleClick}
        text="Press Me"
        withConfirmation
      />
    );

    await act(async () => {
      fireEvent.press(getByText("Press Me"));
      await new Promise((resolve) => setTimeout(resolve, 600));
    });

    await waitFor(
      () => {
        expect(queryByText("Cancel")).toBeTruthy();
      },
      {timeout: 2000}
    );

    // Cancel does not throw and does not invoke onClick
    expect(() => fireEvent.press(getByText("Cancel"))).not.toThrow();
    expect(handleClick).not.toHaveBeenCalled();
  });

  it("reopens the confirmation modal immediately after Cancel", async () => {
    const handleClick = mock(() => Promise.resolve());
    const {getByText, queryByText} = renderWithTheme(
      <Button
        confirmationText="Confirm action?"
        modalTitle="Reopen Title"
        onClick={handleClick}
        text="Press Me"
        withConfirmation
      />
    );

    await act(async () => {
      fireEvent.press(getByText("Press Me"));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(queryByText("Reopen Title")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText("Cancel"));
      await Promise.resolve();
    });
    await waitFor(() => {
      assert.isNull(queryByText("Reopen Title"));
    });

    // Re-press well inside the 500ms press debounce window.
    await act(async () => {
      fireEvent.press(getByText("Press Me"));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(queryByText("Reopen Title")).toBeTruthy();
    });
    assert.lengthOf(handleClick.mock.calls, 0);
  });

  it("reopens the confirmation modal immediately after Confirm", async () => {
    const handleClick = mock(() => Promise.resolve());
    const {getByText, queryByText} = renderWithTheme(
      <Button
        confirmationText="Confirm action?"
        modalTitle="Confirm Reopen"
        onClick={handleClick}
        text="Press Me"
        withConfirmation
      />
    );

    await act(async () => {
      fireEvent.press(getByText("Press Me"));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(queryByText("Confirm Reopen")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText("Confirm"));
      await Promise.resolve();
    });
    await waitFor(() => {
      assert.isNull(queryByText("Confirm Reopen"));
    });
    assert.lengthOf(handleClick.mock.calls, 1);

    await act(async () => {
      fireEvent.press(getByText("Press Me"));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(queryByText("Confirm Reopen")).toBeTruthy();
    });
  });

  it("still debounces repeated presses that do not open the modal", async () => {
    const handleClick = mock(() => Promise.resolve());
    const hapticSpy = spyOn(Unifier.utils, "haptic");
    const {getByText} = renderWithTheme(
      <Button
        confirmationText="Confirm action?"
        modalTitle="Debounced Title"
        onClick={handleClick}
        text="Press Me"
        withConfirmation
      />
    );

    const hapticCallsBefore = hapticSpy.mock.calls.length;
    await act(async () => {
      fireEvent.press(getByText("Press Me"));
      fireEvent.press(getByText("Press Me"));
      fireEvent.press(getByText("Press Me"));
      await Promise.resolve();
    });

    assert.equal(hapticSpy.mock.calls.length - hapticCallsBefore, 1);
    hapticSpy.mockRestore();
  });

  it("renders with tooltip on desktop (wrapped in Tooltip)", () => {
    const {toJSON} = renderWithTheme(
      <Button onClick={() => {}} text="Hover me" tooltipText="Tooltip text" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders without a ThemeProvider using default context theme", () => {
    const {toJSON} = render(<Button onClick={() => {}} text="No theme" />);
    // The ThemeContext provides a default computed theme, so the button renders
    expect(toJSON()).toBeTruthy();
  });

  it("uses Pressable when disabled (not PressableScale)", () => {
    const tree = renderWithTheme(<Button disabled onClick={() => {}} text="Disabled" />).toJSON();
    expect(Array.isArray(tree)).toBe(false);
    expect(tree?.type).toBe("Pressable");
  });

  it("uses Pressable when loading (not PressableScale)", () => {
    const tree = renderWithTheme(<Button loading onClick={() => {}} text="Loading" />).toJSON();
    expect(Array.isArray(tree)).toBe(false);
    expect(tree?.type).toBe("Pressable");
  });

  it("renders with custom confirmationText and modalSubTitle", () => {
    const {toJSON} = renderWithTheme(
      <Button
        confirmationText="Custom confirmation text"
        modalSubTitle="Custom subtitle"
        modalTitle="Custom Title"
        onClick={() => {}}
        text="Confirm Btn"
        withConfirmation
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  describe("custom icons", () => {
    it("renders a registered custom icon by name", () => {
      const {queryByTestId} = renderWithIcons(
        <Button iconName="testCustomIcon" onClick={() => {}} text="Custom" />
      );
      expect(queryByTestId(TEST_CUSTOM_ICON_TEST_ID)).not.toBeNull();
    });

    it("renders a FontAwesome icon (not the custom one) for unregistered names", () => {
      const {queryByTestId, getByText} = renderWithIcons(
        <Button iconName="check" onClick={() => {}} text="FontAwesome" />
      );
      expect(queryByTestId(TEST_CUSTOM_ICON_TEST_ID)).toBeNull();
      expect(getByText("FontAwesome")).toBeTruthy();
    });
  });

  it("renders disabled button and does not call onClick", () => {
    const handleClick = mock(() => Promise.resolve());
    const {getByText} = renderWithTheme(<Button disabled onClick={handleClick} text="Disabled" />);
    fireEvent.press(getByText("Disabled"));
    expect(handleClick).not.toHaveBeenCalled();
  });

  it("shows loading indicator when loading prop is true", () => {
    const {toJSON} = renderWithTheme(<Button loading onClick={() => {}} text="Loading" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders ghost variant with correct styles", () => {
    const {toJSON} = renderWithTheme(<Button onClick={() => {}} text="Ghost" variant="ghost" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with size sm", () => {
    const tree = renderWithTheme(<Button onClick={() => {}} size="sm" text="Small" />).toJSON();
    expect(tree).toBeTruthy();
  });

  it("does not render tooltip wrapper when isNarrowViewport is true", () => {
    const nativeSpy = spyOn(Utilities, "isNative").mockReturnValue(false);
    (isNarrowViewport as ReturnType<typeof mock>).mockImplementation(() => true);

    const {getByText, toJSON} = renderWithTheme(
      <Button onClick={() => {}} text="No Tooltip" tooltipText="Should not wrap" />
    );

    expect(getByText("No Tooltip")).toBeTruthy();
    const tree = JSON.stringify(toJSON());
    expect(tree).not.toContain("Should not wrap");
    nativeSpy.mockRestore();
    (isNarrowViewport as ReturnType<typeof mock>).mockImplementation(() => false);
  });

  it("renders tooltip wrapper when tooltipText is provided and not native", () => {
    const nativeSpy = spyOn(Utilities, "isNative").mockReturnValue(false);
    (isNarrowViewport as ReturnType<typeof mock>).mockImplementation(() => false);

    const {getByText} = renderWithTheme(
      <Button onClick={() => {}} text="With Tooltip" tooltipText="Helpful tip" />
    );

    expect(getByText("With Tooltip")).toBeTruthy();
    nativeSpy.mockRestore();
    (isNarrowViewport as ReturnType<typeof mock>).mockImplementation(() => false);
  });

  it("resets loading and rethrows when onClick rejects", async () => {
    const error = new Error("boom");
    const handleClick = mock(() => Promise.reject(error));
    const {getByTestId} = renderWithTheme(
      <Button onClick={handleClick} pressAnimation="none" testID="throwing-button" text="Throw" />
    );

    const button = getByTestId("throwing-button");
    await act(async () => {
      await expect((button.props as PressableTestProps).onPress()).rejects.toThrow("boom");
    });

    expect(handleClick).toHaveBeenCalled();
  });

  it("renders null when no theme is available from context", () => {
    const useThemeSpy = spyOn(ThemeModule, "useTheme").mockReturnValue({
      resetTheme: () => {},
      setPrimitives: () => {},
      setTheme: () => {},
      theme: undefined,
    } as unknown as ReturnType<typeof ThemeModule.useTheme>);

    const {toJSON} = render(<Button onClick={() => {}} text="No theme" />);
    expect(toJSON()).toBeNull();

    useThemeSpy.mockRestore();
  });
});
