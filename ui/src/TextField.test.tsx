import {afterEach, beforeEach, describe, expect, it, mock, spyOn} from "bun:test";
import {act, fireEvent, userEvent} from "@testing-library/react-native";
import {assert} from "chai";
import type {ReactElement} from "react";
import type {TextInput} from "react-native";
import {TextField} from "./TextField";
import {renderWithTheme} from "./test-utils";

describe("TextField", () => {
  let mockOnChange: ReturnType<typeof mock>;
  let mockOnFocus: ReturnType<typeof mock>;
  let mockOnBlur: ReturnType<typeof mock>;
  let mockOnEnter: ReturnType<typeof mock>;

  beforeEach(() => {
    mockOnChange = mock(() => {});
    mockOnFocus = mock(() => {});
    mockOnBlur = mock(() => {});
    mockOnEnter = mock(() => {});
  });

  afterEach(() => {
    // Reset mocks after each test
  });

  describe("basic rendering", () => {
    it("warns when the device timezone cannot be determined", () => {
      mock.module("expo-localization", () => ({
        getCalendars: mock(() => []),
        getLocales: mock(() => [
          {
            countryCode: "US",
            decimalSeparator: ".",
            digitGroupingSeparator: ",",
            languageCode: "en",
            measurementSystem: "US",
            temperatureUnit: "F",
            textDirection: "ltr",
          },
        ]),
      }));
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

      try {
        renderWithTheme(<TextField onChange={mockOnChange} value="" />);
        assert.equal(warnSpy.mock.calls.length, 1);
        assert.equal(warnSpy.mock.calls[0]?.[0], "Could not automatically determine timezone.");
      } finally {
        mock.module("expo-localization", () => ({
          getCalendars: mock(() => [
            {
              calendar: "gregorian",
              id: "gregorian",
              locale: "en-US",
              timeZone: "America/New_York",
            },
          ]),
          getLocales: mock(() => [
            {
              countryCode: "US",
              decimalSeparator: ".",
              digitGroupingSeparator: ",",
              languageCode: "en",
              measurementSystem: "US",
              temperatureUnit: "F",
              textDirection: "ltr",
            },
          ]),
        }));
        warnSpy.mockRestore();
      }
    });

    it("should render with default props", () => {
      const {getByDisplayValue} = renderWithTheme(
        <TextField onChange={mockOnChange} value="test value" />
      );

      expect(getByDisplayValue("test value").props.value).toBe("test value");
    });

    it("should render with title", () => {
      const {getByText} = renderWithTheme(
        <TextField onChange={mockOnChange} title="Test Title" value="" />
      );

      expect(getByText("Test Title")).toBeTruthy();
    });

    it("should render with placeholder", () => {
      const {getByPlaceholderText} = renderWithTheme(
        <TextField onChange={mockOnChange} placeholder="Enter text" value="" />
      );

      expect(getByPlaceholderText("Enter text")).toBeTruthy();
    });

    it("should render helper text", () => {
      const {getByText} = renderWithTheme(
        <TextField helperText="This is helper text" onChange={mockOnChange} value="" />
      );

      expect(getByText("This is helper text")).toBeTruthy();
    });

    it("should render error text", () => {
      const {getByText} = renderWithTheme(
        <TextField errorText="This is an error" onChange={mockOnChange} value="" />
      );

      expect(getByText("This is an error")).toBeTruthy();
    });
  });

  describe("user interactions", () => {
    it("should call onChange when text is entered", async () => {
      const user = userEvent.setup();
      const {getByDisplayValue} = renderWithTheme(<TextField onChange={mockOnChange} value="" />);

      const input = getByDisplayValue("");
      await user.type(input, "hello");

      expect(mockOnChange).toHaveBeenCalled();
      expect(mockOnChange.mock.calls.length).toBeGreaterThan(0);
    });

    it("should call onFocus when input is focused", async () => {
      const {getByDisplayValue} = renderWithTheme(
        <TextField onChange={mockOnChange} onFocus={mockOnFocus} value="" />
      );

      const input = getByDisplayValue("");
      expect(input.props.onFocus).toBeTruthy();
    });

    it("should call onBlur when input loses focus", async () => {
      const user = userEvent.setup();
      const {getByDisplayValue} = renderWithTheme(
        <TextField onBlur={mockOnBlur} onChange={mockOnChange} value="test" />
      );

      const input = getByDisplayValue("test");
      await user.press(input);
      await act(async () => {
        input.props.onBlur();
      });

      expect(mockOnBlur).toHaveBeenCalledTimes(1);
      expect(mockOnBlur.mock.calls[0][0]).toBe("test");
    });

    it("should call onEnter when enter key is pressed", async () => {
      const _user = userEvent.setup();
      const {getByDisplayValue} = renderWithTheme(
        <TextField onChange={mockOnChange} onEnter={mockOnEnter} value="" />
      );

      const input = getByDisplayValue("");
      await act(async () => {
        input.props.onSubmitEditing();
      });

      expect(mockOnEnter).toHaveBeenCalledTimes(1);
    });

    it("should trim value on blur if trimOnBlur is true, even if onBlur prop is not provided", () => {
      const {getByDisplayValue} = renderWithTheme(
        <TextField onChange={mockOnChange} trimOnBlur value="test    " />
      );

      const input = getByDisplayValue("test    ");

      fireEvent(input, "blur");

      // on change should be called with trimmed value
      expect(mockOnChange).toHaveBeenCalled();
      const lastCall = mockOnChange.mock.calls.at(-1);
      expect(lastCall?.[0]).toBe("test");
    });

    it("should trim value on blur if trimOnBlur is true, with onBlur prop provided", async () => {
      const {getByDisplayValue} = renderWithTheme(
        <TextField onBlur={mockOnBlur} onChange={mockOnChange} trimOnBlur={true} value="test    " />
      );

      const input = getByDisplayValue("test    ");

      fireEvent(input, "blur");

      // onChange should be called with trimmed value
      expect(mockOnChange).toHaveBeenCalled();
      const lastCall = mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1];
      expect(lastCall[0]).toBe("test");

      // onBlur should also be called with trimmed value
      expect(mockOnBlur).toHaveBeenCalledTimes(1);
      expect(mockOnBlur.mock.calls[0][0]).toBe("test");
    });

    it("should NOT trim value on blur if trimOnBlur is false", async () => {
      const {getByDisplayValue} = renderWithTheme(
        <TextField onChange={mockOnChange} trimOnBlur={false} value="test    " />
      );

      const input = getByDisplayValue("test    ");
      fireEvent(input, "blur");

      // onChange should not be called because the value hasn't changed (no trimming)
      expect(mockOnChange).not.toHaveBeenCalled();
    });

    it("trims on blur by default when no prop is provided", async () => {
      const {getByDisplayValue} = renderWithTheme(
        <TextField onChange={mockOnChange} value="test    " />
      );

      const input = getByDisplayValue("test    ");
      fireEvent(input, "blur");

      // onChange should be called with trimmed value
      expect(mockOnChange).toHaveBeenCalled();
      const lastCall = mockOnChange.mock.calls.at(-1);
      expect(lastCall?.[0]).toBe("test");
    });
  });

  describe("field types", () => {
    it("should render email type with correct keyboard", () => {
      const {getByDisplayValue} = renderWithTheme(
        <TextField onChange={mockOnChange} type="email" value="" />
      );

      const input = getByDisplayValue("");
      expect(input.props.keyboardType).toBe("email-address");
    });

    it("should render password type with secure text entry", () => {
      const {getByDisplayValue} = renderWithTheme(
        <TextField onChange={mockOnChange} type="password" value="" />
      );

      const input = getByDisplayValue("");
      expect(input.props.secureTextEntry).toBe(true);
    });

    describe("password visibility toggle", () => {
      it("should reveal and re-hide the value when the toggle is pressed", () => {
        const {getByDisplayValue, getByTestId} = renderWithTheme(
          <TextField onChange={mockOnChange} testID="pw" type="password" value="hunter2" />
        );

        expect(getByDisplayValue("hunter2").props.secureTextEntry).toBe(true);

        fireEvent.press(getByTestId("pw.visibility-toggle"));
        expect(getByDisplayValue("hunter2").props.secureTextEntry).toBe(false);

        fireEvent.press(getByTestId("pw.visibility-toggle"));
        expect(getByDisplayValue("hunter2").props.secureTextEntry).toBe(true);
      });

      it("should describe the next action on the toggle", () => {
        const {getByTestId} = renderWithTheme(
          <TextField onChange={mockOnChange} testID="pw" type="password" value="hunter2" />
        );

        const toggle = getByTestId("pw.visibility-toggle");
        expect(toggle.props.accessibilityLabel).toBe("Show password");

        fireEvent.press(toggle);
        expect(getByTestId("pw.visibility-toggle").props.accessibilityLabel).toBe("Hide password");
      });

      it("should not render the toggle for non-password types", () => {
        const {queryByTestId} = renderWithTheme(
          <TextField onChange={mockOnChange} testID="email" type="email" value="" />
        );

        expect(queryByTestId("email.visibility-toggle")).toBeNull();
      });

      it("should not render the toggle when showVisibilityToggle is false", () => {
        const {queryByTestId} = renderWithTheme(
          <TextField
            onChange={mockOnChange}
            showVisibilityToggle={false}
            testID="pw"
            type="password"
            value="hunter2"
          />
        );

        expect(queryByTestId("pw.visibility-toggle")).toBeNull();
      });

      it("should keep the value hidden when the field is disabled", () => {
        const {getByDisplayValue, getByTestId} = renderWithTheme(
          <TextField disabled onChange={mockOnChange} testID="pw" type="password" value="hunter2" />
        );

        fireEvent.press(getByTestId("pw.visibility-toggle"));
        expect(getByDisplayValue("hunter2").props.secureTextEntry).toBe(true);
      });

      it("should accept a custom toggle test id", () => {
        const {getByTestId} = renderWithTheme(
          <TextField
            onChange={mockOnChange}
            testID="pw"
            testIDs={{visibilityToggle: "custom-toggle"}}
            type="password"
            value="hunter2"
          />
        );

        expect(getByTestId("custom-toggle")).toBeTruthy();
      });

      it("should not blur the input when the visibility toggle is pressed", async () => {
        const {getByDisplayValue, getByTestId} = renderWithTheme(
          <TextField
            onBlur={mockOnBlur}
            onChange={mockOnChange}
            testID="pw"
            trimOnBlur
            type="password"
            value="secret  "
          />
        );

        const input = getByDisplayValue("secret  ");
        fireEvent(input, "focus");
        await act(async () => {
          fireEvent.press(getByTestId("pw.visibility-toggle"));
          await new Promise((resolve) => {
            setTimeout(resolve, 0);
          });
        });

        expect(mockOnBlur).not.toHaveBeenCalled();
        expect(mockOnChange).not.toHaveBeenCalled();
      });

      it("refocuses and restores selection on web when toggled while focused", () => {
        const reactNative = require("react-native") as {Platform: {OS: string}};
        const originalOS = reactNative.Platform.OS;
        const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
        const requestAnimationFrameSpy = mock((callback: FrameRequestCallback): number => {
          callback(0);
          return 1;
        });
        reactNative.Platform.OS = "web";
        globalThis.requestAnimationFrame = requestAnimationFrameSpy;

        try {
          const {getByDisplayValue, getByTestId} = renderWithTheme(
            <TextField onChange={mockOnChange} testID="pw" type="password" value="hunter2" />
          );
          const input = getByDisplayValue("hunter2");
          const webInput: {
            focus: () => void;
            selectionEnd: number;
            selectionStart: number;
            setSelectionRange: (start: number, end: number) => void;
          } = {
            focus: () => {},
            selectionEnd: 0,
            selectionStart: 0,
            setSelectionRange: () => {},
          };
          const focusSpy = mock(() => {});
          const setSelectionRangeSpy = mock((_start: number, _end: number) => {});
          const ref = (input.props as unknown as {ref?: (value: TextInput | null) => void}).ref;
          assert.isFunction(ref);
          webInput.focus = focusSpy;
          webInput.selectionStart = 2;
          webInput.selectionEnd = 5;
          webInput.setSelectionRange = setSelectionRangeSpy;

          fireEvent(input, "focus");
          ref?.(webInput as unknown as TextInput);
          const preventDefault = mock(() => {});
          fireEvent(getByTestId("pw.visibility-toggle"), "mouseDown", {preventDefault});
          fireEvent.press(getByTestId("pw.visibility-toggle"));

          assert.equal(requestAnimationFrameSpy.mock.calls.length, 1);
          assert.equal(focusSpy.mock.calls.length, 1);
          assert.deepEqual(setSelectionRangeSpy.mock.calls[0], [2, 5]);
          assert.equal(preventDefault.mock.calls.length, 1);
        } finally {
          reactNative.Platform.OS = originalOS;
          globalThis.requestAnimationFrame = originalRequestAnimationFrame;
        }
      });

      it("refocuses with a timeout when requestAnimationFrame is unavailable on web", async () => {
        const reactNative = require("react-native") as {Platform: {OS: string}};
        const originalOS = reactNative.Platform.OS;
        const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
        const originalSetTimeout = globalThis.setTimeout;
        let scheduledRefocus: (() => void) | undefined;
        const setTimeoutSpy = spyOn(globalThis, "setTimeout").mockImplementation(
          (handler, timeout, ...args) => {
            scheduledRefocus = handler as unknown as () => void;
            return originalSetTimeout(() => {}, timeout, ...args);
          }
        );
        reactNative.Platform.OS = "web";
        globalThis.requestAnimationFrame = undefined;

        try {
          const {getByDisplayValue, getByTestId} = renderWithTheme(
            <TextField onChange={mockOnChange} testID="pw" type="password" value="hunter2" />
          );
          const input = getByDisplayValue("hunter2");
          const webInput = {focus: () => void 0};
          const ref = (input.props as unknown as {ref?: (value: TextInput | null) => void}).ref;
          assert.isFunction(ref);
          const focusSpy = mock(() => {});
          webInput.focus = focusSpy;

          fireEvent(input, "focus");
          ref?.(webInput as unknown as TextInput);
          fireEvent.press(getByTestId("pw.visibility-toggle"));

          assert.isAtLeast(setTimeoutSpy.mock.calls.length, 1);
          ref?.(webInput as unknown as TextInput);
          scheduledRefocus?.();
          assert.equal(focusSpy.mock.calls.length, 1);
        } finally {
          setTimeoutSpy.mockRestore();
          reactNative.Platform.OS = originalOS;
          globalThis.requestAnimationFrame = originalRequestAnimationFrame;
        }
      });
    });

    it("calls both onEnter and onSubmitEditing when submitting", () => {
      const onSubmitEditing = mock(() => {});
      const {getByDisplayValue} = renderWithTheme(
        <TextField
          onChange={mockOnChange}
          onEnter={mockOnEnter}
          onSubmitEditing={onSubmitEditing}
          value=""
        />
      );

      getByDisplayValue("").props.onSubmitEditing();

      assert.equal(mockOnEnter.mock.calls.length, 1);
      assert.equal(onSubmitEditing.mock.calls.length, 1);
    });

    it("should render url type with correct keyboard", () => {
      const {getByDisplayValue} = renderWithTheme(
        <TextField onChange={mockOnChange} type="url" value="" />
      );

      const input = getByDisplayValue("");
      expect(input.props.keyboardType === "url" || input.props.keyboardType === "default").toBe(
        true
      );
    });

    it("should render phoneNumber type with number keyboard", () => {
      const {getByDisplayValue} = renderWithTheme(
        <TextField onChange={mockOnChange} type="phoneNumber" value="" />
      );

      const input = getByDisplayValue("");
      expect(input.props.keyboardType).toBe("number-pad");
    });

    it("should render search type with default keyboard", () => {
      const {getByDisplayValue} = renderWithTheme(
        <TextField onChange={mockOnChange} type="search" value="" />
      );

      const input = getByDisplayValue("");
      expect(input.props.keyboardType).toBe("default");
    });
  });

  describe("multiline behavior", () => {
    it("should render as multiline when multiline prop is true", () => {
      const {getByDisplayValue} = renderWithTheme(
        <TextField multiline onChange={mockOnChange} value="" />
      );

      const input = getByDisplayValue("");
      expect(input.props.multiline).toBe(true);
    });

    it("should set number of lines when rows prop is provided", () => {
      const {getByDisplayValue} = renderWithTheme(
        <TextField multiline onChange={mockOnChange} rows={5} value="" />
      );

      const input = getByDisplayValue("");
      expect(input.props.numberOfLines).toBe(5);
    });

    it("should handle grow behavior with multiline", () => {
      const {getByDisplayValue} = renderWithTheme(
        <TextField grow multiline onChange={mockOnChange} value="" />
      );

      const input = getByDisplayValue("");
      expect(input.props.multiline).toBe(true);
    });
  });

  describe("disabled state", () => {
    it("should be read-only when disabled", () => {
      const {getByDisplayValue} = renderWithTheme(
        <TextField disabled onChange={mockOnChange} value="test" />
      );

      const input = getByDisplayValue("test");
      expect(input.props.readOnly).toBe(true);
    });

    it("should not call onFocus when disabled", async () => {
      const _user = userEvent.setup();
      const {getByDisplayValue} = renderWithTheme(
        <TextField disabled onChange={mockOnChange} onFocus={mockOnFocus} value="" />
      );

      const input = getByDisplayValue("");
      expect(input.props.readOnly).toBe(true);
    });

    it("should not call onBlur when disabled", async () => {
      const {getByDisplayValue} = renderWithTheme(
        <TextField disabled onBlur={mockOnBlur} onChange={mockOnChange} value="test" />
      );

      const input = getByDisplayValue("test");
      await act(async () => {
        input.props.onBlur();
      });

      expect(mockOnBlur).not.toHaveBeenCalled();
    });
  });

  describe("icon functionality", () => {
    it("should render icon when iconName is provided", () => {
      const {getByDisplayValue} = renderWithTheme(
        <TextField iconName="check" onChange={mockOnChange} value="" />
      );

      const input = getByDisplayValue("");
      expect(input).toBeTruthy();
    });

    it("should call onIconClick when icon is pressed", async () => {
      const mockOnIconClick = mock(() => {});
      const {getByDisplayValue} = renderWithTheme(
        <TextField
          iconName="check"
          onChange={mockOnChange}
          onIconClick={mockOnIconClick}
          value=""
        />
      );

      const input = getByDisplayValue("");
      expect(input).toBeTruthy();
    });
  });

  describe("accessibility", () => {
    it("should have correct accessibility properties", () => {
      const {getByDisplayValue} = renderWithTheme(<TextField onChange={mockOnChange} value="" />);

      const input = getByDisplayValue("");
      expect(input.props.accessibilityHint).toBe("Enter text here");
      expect(input.props["aria-label"]).toBe("Text input field");
    });

    it("should indicate disabled state in accessibility", () => {
      const {getByDisplayValue} = renderWithTheme(
        <TextField disabled onChange={mockOnChange} value="" />
      );

      const input = getByDisplayValue("");
      expect(input.props.accessibilityState.disabled).toBe(true);
    });
  });

  describe("auto-complete and text content", () => {
    it("should set autoComplete property", () => {
      const {getByDisplayValue} = renderWithTheme(
        <TextField autoComplete="username" onChange={mockOnChange} value="" />
      );

      const input = getByDisplayValue("");
      expect(input).toBeTruthy();
    });

    it("should handle text content type for email", () => {
      const {getByDisplayValue} = renderWithTheme(
        <TextField onChange={mockOnChange} type="email" value="" />
      );

      const input = getByDisplayValue("");
      expect(input.props.textContentType).toBe("emailAddress");
    });

    it("should handle text content type for password", () => {
      const {getByDisplayValue} = renderWithTheme(
        <TextField onChange={mockOnChange} type="password" value="" />
      );

      const input = getByDisplayValue("");
      expect(input.props.textContentType).toBe("password");
    });
  });

  describe("edge cases", () => {
    it("should handle empty value", () => {
      const {getByDisplayValue} = renderWithTheme(<TextField onChange={mockOnChange} value="" />);

      const input = getByDisplayValue("");
      expect(input.props.value).toBe("");
    });

    it("should handle undefined value", () => {
      const {root} = renderWithTheme(<TextField onChange={mockOnChange} value={undefined} />);

      expect(root).toBeTruthy();
    });

    it("should handle long text values", () => {
      const longText = "a".repeat(1000);
      const {getByDisplayValue} = renderWithTheme(
        <TextField onChange={mockOnChange} value={longText} />
      );

      const input = getByDisplayValue(longText);
      expect(input.props.value).toBe(longText);
    });

    it("should handle special characters", () => {
      const specialText = "!@#$%^&*()_+-=[]{}|;':\",./<>?";
      const {getByDisplayValue} = renderWithTheme(
        <TextField onChange={mockOnChange} value={specialText} />
      );

      const input = getByDisplayValue(specialText);
      expect(input.props.value).toBe(specialText);
    });
  });

  describe("return key behavior", () => {
    it("should set return key type", () => {
      const {getByDisplayValue} = renderWithTheme(
        <TextField onChange={mockOnChange} returnKeyType="done" value="" />
      );

      const input = getByDisplayValue("");
      expect(input.props.enterKeyHint).toBe("done");
    });

    it("should handle blur on submit", () => {
      const {getByDisplayValue} = renderWithTheme(
        <TextField blurOnSubmit={false} onChange={mockOnChange} value="" />
      );

      const input = getByDisplayValue("");
      expect(input.props.blurOnSubmit).toBe(false);
    });
  });

  describe("input ref", () => {
    it("should call inputRef with the input reference", () => {
      const mockInputRef = mock(() => {});
      renderWithTheme(<TextField inputRef={mockInputRef} onChange={mockOnChange} value="" />);

      expect(mockInputRef).toHaveBeenCalled();
    });
  });

  describe("snapshots", () => {
    it("should match snapshot with default props", () => {
      const component = renderWithTheme(<TextField onChange={mockOnChange} value="test value" />);
      expect(component.toJSON()).toMatchSnapshot();
    });

    it("should match snapshot with all props", () => {
      const component = renderWithTheme(
        <TextField
          disabled={false}
          errorText="Error text"
          helperText="Helper text"
          iconName="check"
          multiline={false}
          onBlur={mockOnBlur}
          onChange={mockOnChange}
          onEnter={mockOnEnter}
          onFocus={mockOnFocus}
          onIconClick={mock(() => {})}
          placeholder="Enter text"
          title="Test Title"
          type="text"
          value="test value"
        />
      );
      expect(component.toJSON()).toMatchSnapshot();
    });

    it("should match snapshot when disabled", () => {
      const component = renderWithTheme(
        <TextField disabled onChange={mockOnChange} title="Disabled Field" value="disabled value" />
      );
      expect(component.toJSON()).toMatchSnapshot();
    });

    it("should match snapshot with multiline", () => {
      const component = renderWithTheme(
        <TextField
          multiline
          onChange={mockOnChange}
          rows={3}
          title="Multiline Field"
          value="line 1\nline 2"
        />
      );
      expect(component.toJSON()).toMatchSnapshot();
    });

    it("should match snapshot with error state", () => {
      const component = renderWithTheme(
        <TextField
          errorText="This field is required"
          onChange={mockOnChange}
          title="Error Field"
          value=""
        />
      );
      expect(component.toJSON()).toMatchSnapshot();
    });
  });

  describe("platform, unsupported types, and content sizing", () => {
    const PlatformModule = require("react-native").Platform;

    it("renders with the web outline style when running on web", () => {
      const savedOS = PlatformModule.OS;
      try {
        PlatformModule.OS = "web";
        const {getByDisplayValue} = renderWithTheme(
          <TextField onChange={mockOnChange} value="web value" />
        );
        expect(getByDisplayValue("web value")).toBeTruthy();
      } finally {
        PlatformModule.OS = savedOS;
      }
    });

    it("warns for not-yet-supported field types", () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      try {
        renderWithTheme(<TextField onChange={mockOnChange} type="numberRange" value="" />);
        expect(warnSpy).toHaveBeenCalledWith("numberRange is not yet supported");
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("ignores content size changes when grow is disabled", () => {
      const {getByDisplayValue} = renderWithTheme(
        <TextField multiline onChange={mockOnChange} value="" />
      );
      const input = getByDisplayValue("");
      // Without `grow`, onContentSizeChange returns early and must not throw.
      expect(() =>
        fireEvent(input, "contentSizeChange", {nativeEvent: {contentSize: {height: 999}}})
      ).not.toThrow();
    });

    it("grows to the reported content height when grow is enabled", () => {
      const {getByDisplayValue} = renderWithTheme(
        <TextField grow multiline onChange={mockOnChange} value="" />
      );
      const input = getByDisplayValue("");
      expect(() =>
        fireEvent(input, "contentSizeChange", {nativeEvent: {contentSize: {height: 120}}})
      ).not.toThrow();
    });

    it("clears the measured grow height after the controlled value is emptied", async () => {
      const {getByDisplayValue, rerender} = renderWithTheme(
        <TextField grow multiline onChange={mockOnChange} value="long note" />
      );
      fireEvent(getByDisplayValue("long note"), "contentSizeChange", {
        nativeEvent: {contentSize: {height: 120}},
      });

      rerender(<TextField grow multiline onChange={mockOnChange} value="" />);
      await act(async () => {});
      rerender(<TextField grow multiline onChange={mockOnChange} value="n" />);

      const styles = [getByDisplayValue("n").props.style].flat(Infinity);
      assert.isTrue(styles.some((style) => style?.height === 40));
    });

    it("invokes the onFocus callback when the input is focused", () => {
      const {getByDisplayValue} = renderWithTheme(
        <TextField onChange={mockOnChange} onFocus={mockOnFocus} value="" />
      );
      fireEvent(getByDisplayValue(""), "focus");
      expect(mockOnFocus).toHaveBeenCalledTimes(1);
    });

    it("ignores onChangeText when the text matches the controlled value", async () => {
      const onChange = mock(() => {});
      const {getByDisplayValue} = renderWithTheme(
        <TextField onChange={onChange} value="stable title" />
      );

      await act(async () => {
        fireEvent.changeText(getByDisplayValue("stable title"), "stable title");
      });

      expect(onChange).not.toHaveBeenCalled();
    });

    it("keeps a stable onChangeText callback across value and onChange updates while invoking the latest onChange", async () => {
      const onChange1 = mock(() => {});
      const onChange2 = mock(() => {});
      const {getByDisplayValue, rerender} = renderWithTheme(
        <TextField onChange={onChange1} value="hello" />
      );

      const initialOnChangeText = getByDisplayValue("hello").props.onChangeText;

      rerender(<TextField onChange={onChange2} value="world" />);

      const input = getByDisplayValue("world");
      expect(input.props.onChangeText).toBe(initialOnChangeText);

      await act(async () => {
        fireEvent.changeText(input, "updated");
      });

      expect(onChange2).toHaveBeenCalledWith("updated");
      expect(onChange1).not.toHaveBeenCalled();
    });

    it("preserves per-character typing when onChangeText identity churn would trigger stale RN Web rebinds", async () => {
      const savedOS = PlatformModule.OS;
      const perCharTitle = "Review";

      try {
        PlatformModule.OS = "web";
        let value = "";
        const onChange = mock((next: string) => {
          value = next;
        });

        const renderField = (): ReactElement => (
          <TextField onChange={onChange} type="text" value={value} />
        );

        const view = renderWithTheme(renderField());

        for (let i = 0; i < perCharTitle.length; i++) {
          const partial = perCharTitle.slice(0, i + 1);
          const field = view.getByDisplayValue(value);
          const previousOnChangeText = field.props.onChangeText;

          await act(async () => {
            fireEvent.changeText(field, partial);
          });

          view.rerender(renderField());

          const fieldAfterChange = view.getByDisplayValue(value);
          expect(fieldAfterChange.props.onChangeText).toBe(previousOnChangeText);
          expect(fieldAfterChange.props.value).toBe(partial);
        }

        expect(view.getByDisplayValue(value).props.value).toBe(perCharTitle);
      } finally {
        PlatformModule.OS = savedOS;
      }
    });

    it("disables browser autocorrect and spellcheck on web", () => {
      const savedOS = PlatformModule.OS;
      try {
        PlatformModule.OS = "web";
        const {getByDisplayValue} = renderWithTheme(
          <TextField onChange={mockOnChange} type="text" value="controlled title" />
        );
        const input = getByDisplayValue("controlled title");
        expect(input.props.autoCorrect).toBe(false);
        expect(input.props.spellCheck).toBe(false);
      } finally {
        PlatformModule.OS = savedOS;
      }
    });

    it("does not recurse when synthetic onChange alternates by a single-space autocorrect delta", async () => {
      const savedOS = PlatformModule.OS;
      const withoutSpace =
        "Tetginsbhep al attempt to trigger loop crash now via extended typed input to reachthreshold fo maximum update depth exc";
      const withSpace =
        "Tetginsbhep al attempt to trigger loop crash now via extended typed input to reach threshold fo maximum update depth exc";

      try {
        PlatformModule.OS = "web";
        let value = withoutSpace;
        const onChange = mock((next: string) => {
          value = next;
        });

        const renderField = (): ReactElement => (
          <TextField onChange={onChange} testID="admin-field-title" type="text" value={value} />
        );

        const view = renderWithTheme(renderField());
        const alternates = [withSpace, withoutSpace];

        for (let i = 0; i < 6; i++) {
          const nextText = alternates[i % 2];
          await act(async () => {
            fireEvent.changeText(view.getByDisplayValue(value), nextText);
          });
          view.rerender(renderField());
        }

        expect(onChange.mock.calls.length).toBe(1);
        expect(onChange.mock.calls[0]?.[0]).toBe(withSpace);
        expect(value).toBe(withSpace);
      } finally {
        PlatformModule.OS = savedOS;
      }
    });

    it("allows backspace and retype after the oscillation window", async () => {
      const savedOS = PlatformModule.OS;
      const originalNow = performance.now.bind(performance);
      let fakeNow = 10_000;

      try {
        PlatformModule.OS = "web";
        performance.now = () => fakeNow;

        let value = "hello";
        const onChange = mock((next: string) => {
          value = next;
        });

        const view = renderWithTheme(
          <TextField onChange={onChange} testID="admin-field-title" type="text" value={value} />
        );

        await act(async () => {
          fireEvent.changeText(view.getByDisplayValue(value), "hell");
        });
        view.rerender(
          <TextField onChange={onChange} testID="admin-field-title" type="text" value={value} />
        );

        fakeNow += 600;
        await act(async () => {
          fireEvent.changeText(view.getByDisplayValue(value), "hello");
        });

        expect(onChange.mock.calls.map((call) => call[0])).toEqual(["hell", "hello"]);
      } finally {
        performance.now = originalNow;
        PlatformModule.OS = savedOS;
      }
    });
  });
});
