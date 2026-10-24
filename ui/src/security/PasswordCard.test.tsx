import {describe, expect, it, mock, spyOn} from "bun:test";
import {act, fireEvent, render, waitFor} from "@testing-library/react-native";
import type {ReactElement} from "react";
import {ThemeProvider} from "../Theme";
import {renderWithTheme} from "../test-utils";
import {PasswordCard} from "./PasswordCard";
import type {PasswordCardSubmission} from "./securityTypes";

const makeOnSubmit = () => mock((_values: PasswordCardSubmission) => Promise.resolve());

const press = async (element: Parameters<typeof fireEvent.press>[0]): Promise<void> => {
  await act(async () => {
    fireEvent.press(element);
  });
};

/** Renders with host-node mocks whose focus() records the focused input's testID. */
const renderTrackingFocus = (ui: ReactElement): ReturnType<typeof render> & {focused: string[]} => {
  const focused: string[] = [];
  const result = render(ui, {
    createNodeMock: (element: ReactElement<{testID?: string}>) => ({
      blur: (): void => {},
      clear: (): void => {},
      focus: (): void => {
        focused.push(element.props.testID ?? "");
      },
      isFocused: (): boolean => false,
    }),
    wrapper: ThemeProvider,
  });
  return {...result, focused};
};

const setOS = (os: string): string => {
  const reactNative = require("react-native") as {Platform: {OS: string}};
  const originalOS = reactNative.Platform.OS;
  reactNative.Platform.OS = os;
  return originalOS;
};

describe("PasswordCard", () => {
  describe("change mode", () => {
    it("renders current, new and confirm fields and the sign-out checkbox", () => {
      const {getByTestId} = renderWithTheme(<PasswordCard hasPassword onSubmit={makeOnSubmit()} />);
      expect(getByTestId("password-card")).toBeTruthy();
      expect(getByTestId("password-card-title").props.children).toBe("Change password");
      expect(getByTestId("password-card-current")).toBeTruthy();
      expect(getByTestId("password-card-new")).toBeTruthy();
      expect(getByTestId("password-card-confirm")).toBeTruthy();
      expect(getByTestId("password-card-revoke-other-sessions")).toBeTruthy();
      expect(getByTestId("password-card-submit")).toBeTruthy();
    });

    it("hints current-password and new-password to password managers on web", () => {
      const originalOS = setOS("web");
      try {
        const {getByTestId} = renderWithTheme(
          <PasswordCard hasPassword onSubmit={makeOnSubmit()} />
        );
        expect(getByTestId("password-card-current").props.autoComplete).toBe("current-password");
        expect(getByTestId("password-card-new").props.autoComplete).toBe("new-password");
        expect(getByTestId("password-card-confirm").props.autoComplete).toBe("new-password");
      } finally {
        setOS(originalOS);
      }
    });

    it("submits the current and new password with the sign-out choice", async () => {
      const onSubmit = makeOnSubmit();
      const {getByTestId} = renderWithTheme(<PasswordCard hasPassword onSubmit={onSubmit} />);
      fireEvent.changeText(getByTestId("password-card-current"), "old-password");
      fireEvent.changeText(getByTestId("password-card-new"), "new-password-1");
      fireEvent.changeText(getByTestId("password-card-confirm"), "new-password-1");
      await press(getByTestId("password-card-revoke-other-sessions"));
      await press(getByTestId("password-card-submit"));
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith({
          currentPassword: "old-password",
          mode: "change",
          newPassword: "new-password-1",
          revokeOtherSessions: true,
        });
      });
    });

    it("leaves revokeOtherSessions false by default", async () => {
      const onSubmit = makeOnSubmit();
      const {getByTestId} = renderWithTheme(<PasswordCard hasPassword onSubmit={onSubmit} />);
      fireEvent.changeText(getByTestId("password-card-current"), "old-password");
      fireEvent.changeText(getByTestId("password-card-new"), "new-password-1");
      fireEvent.changeText(getByTestId("password-card-confirm"), "new-password-1");
      await press(getByTestId("password-card-submit"));
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({revokeOtherSessions: false})
        );
      });
    });

    it("hides the sign-out checkbox with showRevokeOtherSessions={false}", () => {
      const {queryByTestId} = renderWithTheme(
        <PasswordCard hasPassword onSubmit={makeOnSubmit()} showRevokeOtherSessions={false} />
      );
      expect(queryByTestId("password-card-revoke-other-sessions")).toBeNull();
    });

    it("requires the current password", async () => {
      const onSubmit = makeOnSubmit();
      const {getByTestId, getByText} = renderWithTheme(
        <PasswordCard hasPassword onSubmit={onSubmit} />
      );
      fireEvent.changeText(getByTestId("password-card-new"), "new-password-1");
      fireEvent.changeText(getByTestId("password-card-confirm"), "new-password-1");
      await press(getByTestId("password-card-submit"));
      expect(getByText("Enter your current password.")).toBeTruthy();
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  describe("set mode", () => {
    it("renders only new and confirm fields for an OAuth-only user", () => {
      const {getByTestId, getByText, queryByTestId} = renderWithTheme(
        <PasswordCard hasPassword={false} onSubmit={makeOnSubmit()} />
      );
      expect(getByText("Set a password")).toBeTruthy();
      expect(queryByTestId("password-card-current")).toBeNull();
      expect(queryByTestId("password-card-revoke-other-sessions")).toBeNull();
      expect(getByTestId("password-card-new")).toBeTruthy();
      expect(getByTestId("password-card-confirm")).toBeTruthy();
    });

    it("submits mode set with the new password", async () => {
      const onSubmit = makeOnSubmit();
      const {getByTestId} = renderWithTheme(
        <PasswordCard hasPassword={false} onSubmit={onSubmit} />
      );
      fireEvent.changeText(getByTestId("password-card-new"), "first-password");
      fireEvent.changeText(getByTestId("password-card-confirm"), "first-password");
      await press(getByTestId("password-card-submit"));
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith({
          mode: "set",
          newPassword: "first-password",
          revokeOtherSessions: false,
        });
      });
    });

    it("switches to change mode once the user has a password", () => {
      const onSubmit = makeOnSubmit();
      const {getByTestId, rerender} = renderWithTheme(
        <PasswordCard hasPassword={false} onSubmit={onSubmit} />
      );
      fireEvent.changeText(getByTestId("password-card-new"), "first-password");
      rerender(<PasswordCard hasPassword onSubmit={onSubmit} />);
      expect(getByTestId("password-card-current")).toBeTruthy();
      expect(getByTestId("password-card-new").props.value).toBe("");
    });

    it("keeps the set-password success message after switching to change mode", async () => {
      const onSubmit = makeOnSubmit();
      const {getByTestId, getByText, rerender} = renderWithTheme(
        <PasswordCard hasPassword={false} onSubmit={onSubmit} />
      );
      fireEvent.changeText(getByTestId("password-card-new"), "first-password");
      fireEvent.changeText(getByTestId("password-card-confirm"), "first-password");
      await press(getByTestId("password-card-submit"));
      await waitFor(() => {
        expect(getByTestId("password-card-success")).toBeTruthy();
      });
      rerender(<PasswordCard hasPassword onSubmit={onSubmit} />);
      expect(
        getByText("Your password has been set. You can now sign in with your email.")
      ).toBeTruthy();
    });
  });

  describe("validation", () => {
    it("shows an inline error when the confirmation does not match", async () => {
      const onSubmit = makeOnSubmit();
      const {getByTestId, getByText} = renderWithTheme(
        <PasswordCard hasPassword={false} onSubmit={onSubmit} />
      );
      fireEvent.changeText(getByTestId("password-card-new"), "first-password");
      fireEvent.changeText(getByTestId("password-card-confirm"), "other-password");
      await press(getByTestId("password-card-submit"));
      expect(getByText("Passwords don't match.")).toBeTruthy();
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("shows an inline error when the new password is too short", async () => {
      const onSubmit = makeOnSubmit();
      const {getByTestId, getByText} = renderWithTheme(
        <PasswordCard hasPassword={false} minLength={10} onSubmit={onSubmit} />
      );
      fireEvent.changeText(getByTestId("password-card-new"), "short");
      fireEvent.changeText(getByTestId("password-card-confirm"), "short");
      await press(getByTestId("password-card-submit"));
      expect(getByText("Use at least 10 characters.")).toBeTruthy();
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("clears a field's error when that field changes", async () => {
      const {getByTestId, getByText, queryByText} = renderWithTheme(
        <PasswordCard hasPassword={false} onSubmit={makeOnSubmit()} />
      );
      fireEvent.changeText(getByTestId("password-card-new"), "first-password");
      fireEvent.changeText(getByTestId("password-card-confirm"), "other-password");
      await press(getByTestId("password-card-submit"));
      expect(getByText("Passwords don't match.")).toBeTruthy();
      fireEvent.changeText(getByTestId("password-card-confirm"), "first-password");
      expect(queryByText("Passwords don't match.")).toBeNull();
    });
  });

  describe("keyboard and focus", () => {
    it("moves focus to the next field on Enter in the current and new password fields", async () => {
      const onSubmit = makeOnSubmit();
      const {focused, getByTestId} = renderTrackingFocus(
        <PasswordCard hasPassword onSubmit={onSubmit} />
      );
      expect(getByTestId("password-card-current").props.enterKeyHint).toBe("next");
      expect(getByTestId("password-card-current").props.blurOnSubmit).toBe(false);
      expect(getByTestId("password-card-new").props.enterKeyHint).toBe("next");
      expect(getByTestId("password-card-confirm").props.enterKeyHint).toBe("done");
      fireEvent.changeText(getByTestId("password-card-current"), "old-password");
      fireEvent.changeText(getByTestId("password-card-new"), "new-password-1");
      fireEvent.changeText(getByTestId("password-card-confirm"), "new-password-1");
      await act(async () => {
        fireEvent(getByTestId("password-card-current"), "submitEditing");
      });
      await act(async () => {
        fireEvent(getByTestId("password-card-new"), "submitEditing");
      });
      expect(focused).toEqual(["password-card-new", "password-card-confirm"]);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("moves from the new password to the confirm field on Enter in set mode", async () => {
      const {focused, getByTestId} = renderTrackingFocus(
        <PasswordCard hasPassword={false} onSubmit={makeOnSubmit()} />
      );
      await act(async () => {
        fireEvent(getByTestId("password-card-new"), "submitEditing");
      });
      expect(focused).toEqual(["password-card-confirm"]);
    });

    it("wraps the fields in a form on web with the account's username and submits through it", async () => {
      const originalOS = setOS("web");
      try {
        const requestSubmit = mock(() => {});
        const onSubmit = makeOnSubmit();
        const {UNSAFE_getByType, getByTestId} = render(
          <PasswordCard hasPassword onSubmit={onSubmit} username="ada@example.com" />,
          {
            createNodeMock: (element: ReactElement) =>
              element.type === "form" ? {requestSubmit} : {focus: (): void => {}},
            wrapper: ThemeProvider,
          }
        );
        const form = UNSAFE_getByType("form" as never);
        expect(form.props["data-testid"]).toBe("password-card-form");
        expect(UNSAFE_getByType("input" as never).props.value).toBe("ada@example.com");
        fireEvent.changeText(getByTestId("password-card-current"), "old-password");
        fireEvent.changeText(getByTestId("password-card-new"), "new-password-1");
        fireEvent.changeText(getByTestId("password-card-confirm"), "new-password-1");
        await act(async () => {
          fireEvent(getByTestId("password-card-confirm"), "submitEditing");
        });
        await press(getByTestId("password-card-submit"));
        expect(requestSubmit).toHaveBeenCalledTimes(2);
        expect(onSubmit).not.toHaveBeenCalled();
        await act(async () => {
          fireEvent(form, "submit", {preventDefault: () => {}});
        });
        expect(onSubmit).toHaveBeenCalledTimes(1);
      } finally {
        setOS(originalOS);
      }
    });

    it("submits with Enter from the confirm field without pressing the button", async () => {
      const onSubmit = makeOnSubmit();
      const {getByTestId} = renderWithTheme(<PasswordCard hasPassword onSubmit={onSubmit} />);
      fireEvent.changeText(getByTestId("password-card-current"), "old-password");
      fireEvent.changeText(getByTestId("password-card-new"), "new-password-1");
      fireEvent.changeText(getByTestId("password-card-confirm"), "new-password-1");
      await act(async () => {
        fireEvent(getByTestId("password-card-confirm"), "submitEditing");
      });
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      });
      expect(onSubmit).toHaveBeenCalledWith({
        currentPassword: "old-password",
        mode: "change",
        newPassword: "new-password-1",
        revokeOtherSessions: false,
      });
    });

    it("focuses the current password field when it is the first invalid field", async () => {
      const {focused, getByTestId} = renderTrackingFocus(
        <PasswordCard hasPassword onSubmit={makeOnSubmit()} />
      );
      fireEvent.changeText(getByTestId("password-card-new"), "short");
      await press(getByTestId("password-card-submit"));
      expect(focused).toEqual(["password-card-current"]);
    });

    it("focuses the new password field when it is the first invalid field", async () => {
      const {focused, getByTestId} = renderTrackingFocus(
        <PasswordCard hasPassword onSubmit={makeOnSubmit()} />
      );
      fireEvent.changeText(getByTestId("password-card-current"), "old-password");
      fireEvent.changeText(getByTestId("password-card-new"), "short");
      fireEvent.changeText(getByTestId("password-card-confirm"), "short");
      await press(getByTestId("password-card-submit"));
      expect(focused).toEqual(["password-card-new"]);
    });

    it("focuses the confirm field when only the confirmation is wrong", async () => {
      const onSubmit = makeOnSubmit();
      const {focused, getByTestId} = renderTrackingFocus(
        <PasswordCard hasPassword={false} onSubmit={onSubmit} />
      );
      fireEvent.changeText(getByTestId("password-card-new"), "first-password");
      fireEvent.changeText(getByTestId("password-card-confirm"), "other-password");
      await press(getByTestId("password-card-submit"));
      expect(focused).toEqual(["password-card-confirm"]);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("announces failed validation with an alert that counts the invalid fields", async () => {
      const {getByTestId, getByText, queryByTestId} = renderWithTheme(
        <PasswordCard hasPassword onSubmit={makeOnSubmit()} />
      );
      fireEvent.changeText(getByTestId("password-card-new"), "short");
      await press(getByTestId("password-card-submit"));
      expect(getByTestId("password-card-validation-error").props.role).toBe("alert");
      expect(getByText("Fix the 3 highlighted fields.")).toBeTruthy();

      fireEvent.changeText(getByTestId("password-card-current"), "old-password");
      fireEvent.changeText(getByTestId("password-card-new"), "new-password-1");
      expect(getByText("Fix the highlighted field.")).toBeTruthy();
      fireEvent.changeText(getByTestId("password-card-confirm"), "new-password-1");
      expect(queryByTestId("password-card-validation-error")).toBeNull();
    });
  });

  describe("submission results", () => {
    it("submits once when pressed again before onSubmit settles", async () => {
      let resolveSubmit: () => void = () => {};
      const onSubmit = mock(
        (_values: PasswordCardSubmission) =>
          new Promise<void>((resolve) => {
            resolveSubmit = resolve;
          })
      );
      const {getByTestId} = renderWithTheme(
        <PasswordCard hasPassword={false} onSubmit={onSubmit} />
      );
      fireEvent.changeText(getByTestId("password-card-new"), "first-password");
      fireEvent.changeText(getByTestId("password-card-confirm"), "first-password");
      await act(async () => {
        fireEvent(getByTestId("password-card-confirm"), "submitEditing");
        fireEvent(getByTestId("password-card-confirm"), "submitEditing");
      });
      await press(getByTestId("password-card-submit"));
      expect(onSubmit).toHaveBeenCalledTimes(1);
      await act(async () => {
        resolveSubmit();
      });
      await waitFor(() => {
        expect(getByTestId("password-card-success")).toBeTruthy();
      });
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it("shows a success message and clears the form after onSubmit resolves", async () => {
      const {getByTestId} = renderWithTheme(
        <PasswordCard hasPassword={false} onSubmit={makeOnSubmit()} />
      );
      fireEvent.changeText(getByTestId("password-card-new"), "first-password");
      fireEvent.changeText(getByTestId("password-card-confirm"), "first-password");
      await press(getByTestId("password-card-submit"));
      await waitFor(() => {
        expect(getByTestId("password-card-success")).toBeTruthy();
      });
      expect(getByTestId("password-card-new").props.value).toBe("");
      expect(getByTestId("password-card-confirm").props.value).toBe("");
    });

    it("shows a rejection's message as an alert and keeps the form", async () => {
      const warn = spyOn(console, "warn").mockImplementation(() => {});
      const onSubmit = mock((_values: PasswordCardSubmission) =>
        Promise.reject(new Error("Invalid password"))
      );
      const {getByTestId, getByText, queryByTestId} = renderWithTheme(
        <PasswordCard hasPassword onSubmit={onSubmit} />
      );
      fireEvent.changeText(getByTestId("password-card-current"), "wrong-password");
      fireEvent.changeText(getByTestId("password-card-new"), "new-password-1");
      fireEvent.changeText(getByTestId("password-card-confirm"), "new-password-1");
      await press(getByTestId("password-card-submit"));
      await waitFor(() => {
        expect(getByTestId("password-card-error")).toBeTruthy();
      });
      expect(getByTestId("password-card-error").props.role).toBe("alert");
      expect(getByText("Invalid password")).toBeTruthy();
      expect(queryByTestId("password-card-success")).toBeNull();
      expect(getByTestId("password-card-new").props.value).toBe("new-password-1");
      warn.mockRestore();
    });

    it("shows the error prop as an alert", () => {
      const {getByTestId, getByText} = renderWithTheme(
        <PasswordCard error="Current password is incorrect" hasPassword onSubmit={makeOnSubmit()} />
      );
      expect(getByTestId("password-card-error").props.role).toBe("alert");
      expect(getByText("Current password is incorrect")).toBeTruthy();
    });

    it("does not submit while loading", async () => {
      const onSubmit = makeOnSubmit();
      const {getByTestId} = renderWithTheme(
        <PasswordCard hasPassword={false} loading onSubmit={onSubmit} />
      );
      fireEvent.changeText(getByTestId("password-card-new"), "first-password");
      fireEvent.changeText(getByTestId("password-card-confirm"), "first-password");
      await press(getByTestId("password-card-submit"));
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  it("labels each password input for screen readers", () => {
    const {getByLabelText} = renderWithTheme(
      <PasswordCard hasPassword onSubmit={makeOnSubmit()} />
    );
    expect(getByLabelText("Current password")).toBeTruthy();
    expect(getByLabelText("New password")).toBeTruthy();
    expect(getByLabelText("Confirm new password")).toBeTruthy();
  });
});
