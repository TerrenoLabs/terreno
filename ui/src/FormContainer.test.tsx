import {afterEach, beforeEach, describe, expect, it, mock, spyOn} from "bun:test";
import {act, fireEvent, render} from "@testing-library/react-native";
import {createRef} from "react";
import {Platform, Text} from "react-native";

import {FormContainer, type FormContainerHandle} from "./FormContainer";
import {ThemeProvider} from "./Theme";
import {renderWithTheme} from "./test-utils";

const setOS = (os: string): string => {
  const original = Platform.OS;
  Object.defineProperty(Platform, "OS", {configurable: true, value: os});
  return original;
};

describe("FormContainer", () => {
  describe("native", () => {
    it("renders its children in a Box, with no form element", () => {
      const {getByTestId, getByText, UNSAFE_queryAllByType} = renderWithTheme(
        <FormContainer gap={2} testID="sign-in-form">
          <Text>Child</Text>
        </FormContainer>
      );
      expect(getByTestId("sign-in-form")).toBeTruthy();
      expect(getByText("Child")).toBeTruthy();
      expect(UNSAFE_queryAllByType("form" as never)).toHaveLength(0);
    });

    it("renders no hidden username input", () => {
      const {UNSAFE_queryAllByType} = renderWithTheme(
        <FormContainer username="ada@example.com">
          <Text>Child</Text>
        </FormContainer>
      );
      expect(UNSAFE_queryAllByType("input" as never)).toHaveLength(0);
    });

    it("calls onSubmit when requestSubmit is called", async () => {
      const onSubmit = mock(() => {});
      const ref = createRef<FormContainerHandle>();
      renderWithTheme(
        <FormContainer onSubmit={onSubmit} ref={ref} testID="sign-in-form">
          <Text>Child</Text>
        </FormContainer>
      );
      await act(async () => {
        await ref.current?.requestSubmit();
      });
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it("does nothing on requestSubmit without onSubmit", async () => {
      const ref = createRef<FormContainerHandle>();
      renderWithTheme(
        <FormContainer ref={ref}>
          <Text>Child</Text>
        </FormContainer>
      );
      await expect(ref.current?.requestSubmit()).resolves.toBeUndefined();
    });
  });

  describe("web", () => {
    let originalOS: string;

    beforeEach(() => {
      originalOS = setOS("web");
    });

    afterEach(() => {
      setOS(originalOS);
    });

    it("renders a real form that skips browser validation and does not take part in layout", () => {
      const {UNSAFE_getByType, getByText} = renderWithTheme(
        <FormContainer accessibilityLabel="Sign in" gap={4} testID="sign-in-form">
          <Text>Child</Text>
        </FormContainer>
      );
      const form = UNSAFE_getByType("form" as never);
      expect(form.props.noValidate).toBe(true);
      expect(form.props["data-testid"]).toBe("sign-in-form");
      expect(form.props["aria-label"]).toBe("Sign in");
      expect(form.props.style).toEqual({display: "contents"});
      expect(getByText("Child")).toBeTruthy();
    });

    it("adds a hidden username input so password managers know whose password changes", () => {
      const {UNSAFE_getByType} = renderWithTheme(
        <FormContainer testID="password-form" username="ada@example.com">
          <Text>Child</Text>
        </FormContainer>
      );
      const input = UNSAFE_getByType("input" as never);
      expect(input.props.autoComplete).toBe("username");
      expect(input.props.value).toBe("ada@example.com");
      expect(input.props.hidden).toBe(true);
      expect(input.props.readOnly).toBe(true);
      expect(input.props.tabIndex).toBe(-1);
      expect(input.props["data-testid"]).toBe("password-form-username");
    });

    it("leaves out the hidden username input without a username", () => {
      const {UNSAFE_queryAllByType} = renderWithTheme(
        <FormContainer>
          <Text>Child</Text>
        </FormContainer>
      );
      expect(UNSAFE_queryAllByType("input" as never)).toHaveLength(0);
    });

    it("prevents the page reload and calls onSubmit on a submit event", () => {
      const onSubmit = mock(() => {});
      const preventDefault = mock(() => {});
      const {UNSAFE_getByType} = renderWithTheme(
        <FormContainer onSubmit={onSubmit}>
          <Text>Child</Text>
        </FormContainer>
      );
      fireEvent(UNSAFE_getByType("form" as never), "submit", {preventDefault});
      expect(preventDefault).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it("prevents the page reload even without onSubmit", () => {
      const preventDefault = mock(() => {});
      const {UNSAFE_getByType} = renderWithTheme(
        <FormContainer>
          <Text>Child</Text>
        </FormContainer>
      );
      fireEvent(UNSAFE_getByType("form" as never), "submit", {preventDefault});
      expect(preventDefault).toHaveBeenCalledTimes(1);
    });

    it("routes requestSubmit through the form element so password managers see a submit", async () => {
      const onSubmit = mock(() => {});
      const requestSubmit = mock(() => {});
      const ref = createRef<FormContainerHandle>();
      render(
        <FormContainer onSubmit={onSubmit} ref={ref}>
          <Text>Child</Text>
        </FormContainer>,
        {
          createNodeMock: (element) => (element.type === "form" ? {requestSubmit} : null),
          wrapper: ThemeProvider,
        }
      );
      await act(async () => {
        await ref.current?.requestSubmit();
      });
      expect(requestSubmit).toHaveBeenCalledTimes(1);
      // The browser fires the submit event, which calls onSubmit; requestSubmit does not.
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("resolves requestSubmit after the browser-run onSubmit settles", async () => {
      let resolveSubmit: () => void = () => {};
      const onSubmit = mock(
        () =>
          new Promise<void>((resolve) => {
            resolveSubmit = resolve;
          })
      );
      const ref = createRef<FormContainerHandle>();
      const {UNSAFE_getByType} = render(
        <FormContainer onSubmit={onSubmit} ref={ref}>
          <Text>Child</Text>
        </FormContainer>,
        {
          createNodeMock: (element) =>
            element.type === "form"
              ? {
                  requestSubmit: (): void => {
                    fireEvent(UNSAFE_getByType("form" as never), "submit", {
                      preventDefault: () => {},
                    });
                  },
                }
              : null,
          wrapper: ThemeProvider,
        }
      );
      let isSettled = false;
      const pending = ref.current?.requestSubmit().then(() => {
        isSettled = true;
      });
      await Promise.resolve();
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(isSettled).toBe(false);
      resolveSubmit();
      await pending;
      expect(isSettled).toBe(true);
    });

    it("warns instead of leaving a rejection unhandled on a browser-started submit", async () => {
      const warn = spyOn(console, "warn").mockImplementation(() => {});
      const {UNSAFE_getByType} = renderWithTheme(
        <FormContainer onSubmit={() => Promise.reject(new Error("nope"))}>
          <Text>Child</Text>
        </FormContainer>
      );
      fireEvent(UNSAFE_getByType("form" as never), "submit", {preventDefault: () => {}});
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(warn).toHaveBeenCalledWith("FormContainer: onSubmit rejected", expect.any(Error));
      warn.mockRestore();
    });

    it("renders a nested FormContainer as a Box, since HTML forms cannot nest", async () => {
      const onInnerSubmit = mock(() => {});
      const innerRef = createRef<FormContainerHandle>();
      const {UNSAFE_queryAllByType, getByTestId} = renderWithTheme(
        <FormContainer testID="outer">
          <FormContainer onSubmit={onInnerSubmit} ref={innerRef} testID="inner">
            <Text>Child</Text>
          </FormContainer>
        </FormContainer>
      );
      expect(UNSAFE_queryAllByType("form" as never)).toHaveLength(1);
      expect(getByTestId("inner")).toBeTruthy();
      await act(async () => {
        await innerRef.current?.requestSubmit();
      });
      expect(onInnerSubmit).toHaveBeenCalledTimes(1);
    });

    it("calls onSubmit directly when the browser has no requestSubmit", async () => {
      const onSubmit = mock(() => {});
      const ref = createRef<FormContainerHandle>();
      render(
        <FormContainer onSubmit={onSubmit} ref={ref}>
          <Text>Child</Text>
        </FormContainer>,
        {createNodeMock: () => ({}), wrapper: ThemeProvider}
      );
      await act(async () => {
        await ref.current?.requestSubmit();
      });
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });
});
