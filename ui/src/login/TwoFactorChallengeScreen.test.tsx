import {describe, expect, it, mock, spyOn} from "bun:test";
import {act, fireEvent, render, waitFor} from "@testing-library/react-native";
import type {ReactElement} from "react";

import {ThemeProvider} from "../Theme";
import {renderWithTheme} from "../test-utils";
import type {TwoFactorChallengeSubmission} from "./loginTypes";
import {TwoFactorChallengeScreen} from "./TwoFactorChallengeScreen";

const makeOnSubmit = () => mock((_values: TwoFactorChallengeSubmission) => Promise.resolve());

/** Renders with a node mock per code cell and records the cells focused (1-based), in order. */
const renderWithFocusSpy = (ui: ReactElement): ReturnType<typeof render> & {focused: number[]} => {
  const focused: number[] = [];
  const result = render(ui, {
    createNodeMock: (element: ReactElement) => {
      const cellTestID = (element.props as {testID?: string}).testID ?? "";
      const match = /-otp-cell-(\d+)$/.exec(cellTestID);
      return {
        focus: () => {
          if (match) {
            focused.push(Number(match[1]));
          }
        },
      };
    },
    wrapper: ThemeProvider,
  });
  return Object.assign(result, {focused});
};

const pressButton = async (element: Parameters<typeof fireEvent.press>[0]): Promise<void> => {
  await act(async () => {
    fireEvent.press(element);
  });
};

describe("TwoFactorChallengeScreen", () => {
  it("renders the root, title and TOTP cells", () => {
    const {getByTestId, getByText, queryByTestId} = renderWithTheme(
      <TwoFactorChallengeScreen onSubmit={makeOnSubmit()} />
    );
    expect(getByTestId("two-factor-challenge")).toBeTruthy();
    expect(getByText("Enter your code")).toBeTruthy();
    expect(getByTestId("two-factor-challenge-otp-cell-1")).toBeTruthy();
    expect(getByTestId("two-factor-challenge-otp-cell-6")).toBeTruthy();
    expect(queryByTestId("two-factor-challenge-backup-input")).toBeNull();
  });

  it("auto-submits a completed TOTP code", async () => {
    const onSubmit = makeOnSubmit();
    const {getByTestId} = renderWithTheme(<TwoFactorChallengeScreen onSubmit={onSubmit} />);
    await act(async () => {
      fireEvent.changeText(getByTestId("two-factor-challenge-otp-cell-1"), "123456");
    });
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({code: "123456", kind: "totp", trustDevice: false});
    });
  });

  it("keeps submit disabled until the TOTP code is complete", () => {
    const {getByTestId} = renderWithTheme(<TwoFactorChallengeScreen onSubmit={makeOnSubmit()} />);
    fireEvent.changeText(getByTestId("two-factor-challenge-otp-cell-1"), "1");
    expect(getByTestId("two-factor-challenge-submit").props.accessibilityState?.disabled).toBe(
      true
    );
  });

  it("the backup toggle switches kind to backup and submits the trimmed code", async () => {
    const onSubmit = makeOnSubmit();
    const {getByTestId, queryByTestId} = renderWithTheme(
      <TwoFactorChallengeScreen onSubmit={onSubmit} />
    );
    await pressButton(getByTestId("two-factor-challenge-backup-toggle"));
    await waitFor(() => {
      expect(getByTestId("two-factor-challenge-backup-input")).toBeTruthy();
    });
    expect(queryByTestId("two-factor-challenge-otp-cell-1")).toBeNull();
    // Backup codes are case-sensitive, so the field must not capitalize or autocorrect.
    expect(getByTestId("two-factor-challenge-backup-input").props.autoCapitalize).toBe("none");
    expect(getByTestId("two-factor-challenge-backup-input").props.autoCorrect).toBe(false);

    fireEvent.changeText(getByTestId("two-factor-challenge-backup-input"), " abcde-12345 ");
    await pressButton(getByTestId("two-factor-challenge-submit"));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        code: "abcde-12345",
        kind: "backup",
        trustDevice: false,
      });
    });
  });

  it("the backup toggle switches back to the authenticator code", async () => {
    const {getByTestId, getByText} = renderWithTheme(
      <TwoFactorChallengeScreen initialKind="backup" onSubmit={makeOnSubmit()} />
    );
    expect(getByText("Use your authenticator app")).toBeTruthy();
    await pressButton(getByTestId("two-factor-challenge-backup-toggle"));
    await waitFor(() => {
      expect(getByTestId("two-factor-challenge-otp-cell-1")).toBeTruthy();
    });
  });

  it("hides the trust-device checkbox without trustDeviceDays", () => {
    const {queryByTestId} = renderWithTheme(<TwoFactorChallengeScreen onSubmit={makeOnSubmit()} />);
    expect(queryByTestId("two-factor-challenge-trust-device")).toBeNull();
  });

  it("starts the trust-device checkbox unchecked when initialTrustDevice is false", async () => {
    const onSubmit = makeOnSubmit();
    const {getByTestId} = renderWithTheme(
      <TwoFactorChallengeScreen
        initialTrustDevice={false}
        onSubmit={onSubmit}
        trustDeviceDays={30}
      />
    );
    expect(getByTestId("two-factor-challenge-trust-device").props["aria-checked"]).toBe(false);
    await act(async () => {
      fireEvent.changeText(getByTestId("two-factor-challenge-otp-cell-1"), "654321");
    });
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({code: "654321", kind: "totp", trustDevice: false});
    });
  });

  it("submits trustDevice when the checkbox is checked", async () => {
    const onSubmit = makeOnSubmit();
    const {getByTestId, getByText} = renderWithTheme(
      <TwoFactorChallengeScreen onSubmit={onSubmit} trustDeviceDays={30} />
    );
    const checkbox = getByTestId("two-factor-challenge-trust-device");
    expect(getByText("Trust this device")).toBeTruthy();
    expect(checkbox.props.role).toBe("checkbox");
    expect(checkbox.props["aria-checked"]).toBe(true);

    await act(async () => {
      fireEvent.changeText(getByTestId("two-factor-challenge-otp-cell-1"), "654321");
    });
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({code: "654321", kind: "totp", trustDevice: true});
    });
  });

  it("renders the error under two-factor-challenge-error as an alert", () => {
    const {getByTestId, getByText} = renderWithTheme(
      <TwoFactorChallengeScreen error="Invalid code" onSubmit={makeOnSubmit()} />
    );
    const error = getByTestId("two-factor-challenge-error");
    expect(error.props.role).toBe("alert");
    expect(getByText("Invalid code")).toBeTruthy();
  });

  it("focuses the first code cell on mount by default", () => {
    const {focused} = renderWithFocusSpy(<TwoFactorChallengeScreen onSubmit={makeOnSubmit()} />);
    expect(focused).toEqual([1]);
  });

  it("autoFocus={false} leaves focus alone on mount but refocuses after a rejected code", () => {
    const onSubmit = makeOnSubmit();
    const {focused, rerender} = renderWithFocusSpy(
      <TwoFactorChallengeScreen autoFocus={false} onSubmit={onSubmit} />
    );
    expect(focused).toEqual([]);
    rerender(
      <TwoFactorChallengeScreen autoFocus={false} error="Invalid code" onSubmit={onSubmit} />
    );
    expect(focused).toEqual([1]);
  });

  it("clears the entered code when a new error arrives", async () => {
    const onSubmit = makeOnSubmit();
    const {getByTestId, rerender} = renderWithTheme(
      <TwoFactorChallengeScreen onSubmit={onSubmit} />
    );
    await act(async () => {
      fireEvent.changeText(getByTestId("two-factor-challenge-otp-cell-1"), "123456");
    });
    expect(getByTestId("two-factor-challenge-otp-cell-6").props.value).toBe("6");
    rerender(<TwoFactorChallengeScreen error="Invalid code" onSubmit={onSubmit} />);
    await waitFor(() => {
      expect(getByTestId("two-factor-challenge-otp-cell-1").props.value).toBe("");
    });
  });

  it("does not submit when loading turns on after the code is entered", async () => {
    const onSubmit = makeOnSubmit();
    const {getByTestId, rerender} = renderWithTheme(
      <TwoFactorChallengeScreen initialKind="backup" onSubmit={onSubmit} />
    );
    fireEvent.changeText(getByTestId("two-factor-challenge-backup-input"), "abcde-12345");
    rerender(<TwoFactorChallengeScreen initialKind="backup" loading onSubmit={onSubmit} />);
    await pressButton(getByTestId("two-factor-challenge-submit"));
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(onSubmit).not.toHaveBeenCalled();

    // The same press goes through once loading ends, so the check above is not vacuous.
    rerender(<TwoFactorChallengeScreen initialKind="backup" onSubmit={onSubmit} />);
    await pressButton(getByTestId("two-factor-challenge-submit"));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });

  it("asks for one-time-code autofill and a numeric keyboard on the code cells", () => {
    const {getByTestId} = renderWithTheme(<TwoFactorChallengeScreen onSubmit={makeOnSubmit()} />);
    const cell = getByTestId("two-factor-challenge-otp-cell-1");
    expect(cell.props.autoComplete).toBe("one-time-code");
    expect(cell.props.textContentType).toBe("oneTimeCode");
    expect(cell.props.keyboardType).toBe("number-pad");
  });

  it("submits a complete code on Enter, and ignores Enter on an incomplete one", async () => {
    const onSubmit = makeOnSubmit();
    const {getByTestId} = renderWithTheme(<TwoFactorChallengeScreen onSubmit={onSubmit} />);
    await act(async () => {
      fireEvent.changeText(getByTestId("two-factor-challenge-otp-cell-1"), "12345");
    });
    await act(async () => {
      fireEvent(getByTestId("two-factor-challenge-otp-cell-6"), "submitEditing");
    });
    expect(onSubmit).not.toHaveBeenCalled();

    // The last digit auto-submits; Enter on the completed code submits it again.
    await act(async () => {
      fireEvent.changeText(getByTestId("two-factor-challenge-otp-cell-6"), "6");
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent(getByTestId("two-factor-challenge-otp-cell-6"), "submitEditing");
    });
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit).toHaveBeenLastCalledWith({code: "123456", kind: "totp", trustDevice: false});
  });

  it("submits the backup code on Enter", async () => {
    const onSubmit = makeOnSubmit();
    const {getByTestId} = renderWithTheme(
      <TwoFactorChallengeScreen initialKind="backup" onSubmit={onSubmit} />
    );
    fireEvent.changeText(getByTestId("two-factor-challenge-backup-input"), "abcde-12345");
    await act(async () => {
      fireEvent(getByTestId("two-factor-challenge-backup-input"), "submitEditing");
    });
    expect(onSubmit).toHaveBeenCalledWith({
      code: "abcde-12345",
      kind: "backup",
      trustDevice: false,
    });
  });

  it("submits once when Verify is pressed while the auto-submit is in flight", async () => {
    let resolveSubmit: () => void = () => {};
    const onSubmit = mock(
      (_values: TwoFactorChallengeSubmission) =>
        new Promise<void>((resolve) => {
          resolveSubmit = resolve;
        })
    );
    const {getByTestId} = renderWithTheme(<TwoFactorChallengeScreen onSubmit={onSubmit} />);
    await act(async () => {
      fireEvent.changeText(getByTestId("two-factor-challenge-otp-cell-1"), "123456");
    });
    await pressButton(getByTestId("two-factor-challenge-submit"));
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveSubmit();
    });
  });

  it("catches a rejected onSubmit and clears the code", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const onSubmit = mock((_values: TwoFactorChallengeSubmission) =>
      Promise.reject(new Error("network"))
    );
    const {getByTestId} = renderWithTheme(<TwoFactorChallengeScreen onSubmit={onSubmit} />);
    await act(async () => {
      fireEvent.changeText(getByTestId("two-factor-challenge-otp-cell-1"), "123456");
    });
    await waitFor(() => {
      expect(getByTestId("two-factor-challenge-otp-cell-1").props.value).toBe("");
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("clears the code again when the same error comes back after loading", async () => {
    const onSubmit = makeOnSubmit();
    const {getByTestId, rerender} = renderWithTheme(
      <TwoFactorChallengeScreen error="Invalid code" initialKind="backup" onSubmit={onSubmit} />
    );
    fireEvent.changeText(getByTestId("two-factor-challenge-backup-input"), "abcde-12345");
    rerender(
      <TwoFactorChallengeScreen
        error="Invalid code"
        initialKind="backup"
        loading
        onSubmit={onSubmit}
      />
    );
    expect(getByTestId("two-factor-challenge-backup-input").props.value).toBe("abcde-12345");
    rerender(
      <TwoFactorChallengeScreen error="Invalid code" initialKind="backup" onSubmit={onSubmit} />
    );
    await waitFor(() => {
      expect(getByTestId("two-factor-challenge-backup-input").props.value).toBe("");
    });
  });

  it("clears the code again when a submission settles with the same error", async () => {
    const onSubmit = makeOnSubmit();
    const {getByTestId} = renderWithTheme(
      <TwoFactorChallengeScreen error="Invalid code" onSubmit={onSubmit} />
    );
    await act(async () => {
      fireEvent.changeText(getByTestId("two-factor-challenge-otp-cell-1"), "123456");
    });
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(getByTestId("two-factor-challenge-otp-cell-1").props.value).toBe("");
    });
  });

  it("toggles the trust-device checkbox with the Space key", () => {
    const preventDefault = mock(() => {});
    const {getByTestId} = renderWithTheme(
      <TwoFactorChallengeScreen onSubmit={makeOnSubmit()} trustDeviceDays={30} />
    );
    fireEvent(getByTestId("two-factor-challenge-trust-device"), "keyDown", {
      key: " ",
      preventDefault,
    });
    expect(getByTestId("two-factor-challenge-trust-device").props["aria-checked"]).toBe(false);
    expect(preventDefault).toHaveBeenCalled();
    fireEvent(getByTestId("two-factor-challenge-trust-device"), "keyDown", {
      nativeEvent: {key: "Enter"},
    });
    expect(getByTestId("two-factor-challenge-trust-device").props["aria-checked"]).toBe(false);
  });

  it("names the backup input Backup code", async () => {
    const {getByTestId} = renderWithTheme(
      <TwoFactorChallengeScreen initialKind="backup" onSubmit={makeOnSubmit()} />
    );
    expect(getByTestId("two-factor-challenge-backup-input").props["aria-label"]).toBe(
      "Backup code"
    );
  });

  it("shows the cancel link only with onCancel and calls it", async () => {
    const onCancel = mock(() => {});
    const {getByTestId, getByText, rerender, queryByTestId} = renderWithTheme(
      <TwoFactorChallengeScreen onSubmit={makeOnSubmit()} />
    );
    expect(queryByTestId("two-factor-challenge-cancel")).toBeNull();
    rerender(<TwoFactorChallengeScreen onCancel={onCancel} onSubmit={makeOnSubmit()} />);
    expect(getByText("Sign in a different way")).toBeTruthy();
    await pressButton(getByTestId("two-factor-challenge-cancel"));
    await waitFor(() => {
      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });

  it("uses a custom code length", () => {
    const {getByTestId, getByText, queryByTestId} = renderWithTheme(
      <TwoFactorChallengeScreen codeLength={8} onSubmit={makeOnSubmit()} />
    );
    expect(getByTestId("two-factor-challenge-otp-cell-8")).toBeTruthy();
    expect(queryByTestId("two-factor-challenge-otp-cell-9")).toBeNull();
    expect(getByText("Open your authenticator app and enter the 8-digit code.")).toBeTruthy();
  });
});
