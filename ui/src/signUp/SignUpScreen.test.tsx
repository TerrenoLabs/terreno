import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent, render, within} from "@testing-library/react-native";
import type {ReactElement} from "react";
import {Platform} from "react-native";
import {TextField} from "../TextField";
import {ThemeProvider} from "../Theme";
import {elementProps, renderWithTheme} from "../test-utils";
import {defaultPasswordRequirements} from "./passwordPresets";
import {SignUpScreen} from "./SignUpScreen";

const defaultFields = [
  {label: "Name", name: "name", required: true, type: "text" as const},
  {label: "Email", name: "email", required: true, type: "email" as const},
  {label: "Password", name: "password", required: true, type: "password" as const},
];

describe("SignUpScreen", () => {
  it("renders with default props", () => {
    const {getByTestId} = renderWithTheme(
      <SignUpScreen fields={defaultFields} onSubmit={mock(() => Promise.resolve())} />
    );
    expect(getByTestId("signup-screen")).toBeTruthy();
  });

  it("renders title", () => {
    const {getByTestId} = renderWithTheme(
      <SignUpScreen fields={defaultFields} onSubmit={mock(() => Promise.resolve())} />
    );
    expect(getByTestId("signup-screen-title")).toBeTruthy();
  });

  it("renders custom title", () => {
    const {getByText} = renderWithTheme(
      <SignUpScreen
        fields={defaultFields}
        onSubmit={mock(() => Promise.resolve())}
        title="Join Us"
      />
    );
    expect(getByText("Join Us")).toBeTruthy();
  });

  it("renders all form fields", () => {
    const {getByTestId} = renderWithTheme(
      <SignUpScreen fields={defaultFields} onSubmit={mock(() => Promise.resolve())} />
    );
    expect(getByTestId("signup-screen-name-input")).toBeTruthy();
    expect(getByTestId("signup-screen-email-input")).toBeTruthy();
    expect(getByTestId("signup-screen-password-input")).toBeTruthy();
  });

  it("renders submit button", () => {
    const {getByTestId} = renderWithTheme(
      <SignUpScreen fields={defaultFields} onSubmit={mock(() => Promise.resolve())} />
    );
    expect(getByTestId("signup-screen-submit-button")).toBeTruthy();
  });

  it("renders login link when onLoginPress is provided", () => {
    const {getByTestId} = renderWithTheme(
      <SignUpScreen
        fields={defaultFields}
        onLoginPress={() => {}}
        onSubmit={mock(() => Promise.resolve())}
      />
    );
    expect(getByTestId("signup-screen-login-link")).toBeTruthy();
  });

  it("renders error message", () => {
    const {getByTestId} = renderWithTheme(
      <SignUpScreen
        error="Something went wrong"
        fields={defaultFields}
        onSubmit={mock(() => Promise.resolve())}
      />
    );
    expect(getByTestId("signup-screen-error")).toBeTruthy();
  });

  it("renders password requirements when provided", () => {
    const {getByTestId} = renderWithTheme(
      <SignUpScreen
        fields={defaultFields}
        onSubmit={mock(() => Promise.resolve())}
        passwordRequirements={defaultPasswordRequirements}
      />
    );
    expect(getByTestId("signup-screen-password-requirements")).toBeTruthy();
  });

  it("renders OAuth buttons when providers are given", () => {
    const providers = [{onPress: mock(() => Promise.resolve()), provider: "google" as const}];
    const {getByTestId} = renderWithTheme(
      <SignUpScreen
        fields={defaultFields}
        oauthProviders={providers}
        onSubmit={mock(() => Promise.resolve())}
      />
    );
    expect(getByTestId("signup-screen-oauth")).toBeTruthy();
  });

  it("updates form field values on change", () => {
    const {getByTestId} = renderWithTheme(
      <SignUpScreen fields={defaultFields} onSubmit={mock(() => Promise.resolve())} />
    );
    const nameInput = getByTestId("signup-screen-name-input");
    fireEvent.changeText(nameInput, "John Doe");
    expect(nameInput.props.value).toBe("John Doe");
  });

  it("renders with custom testID", () => {
    const {getByTestId} = renderWithTheme(
      <SignUpScreen
        fields={defaultFields}
        onSubmit={mock(() => Promise.resolve())}
        testID="custom-signup"
      />
    );
    expect(getByTestId("custom-signup")).toBeTruthy();
  });

  it("renders correctly with all props", () => {
    const {toJSON} = renderWithTheme(
      <SignUpScreen
        error="Error!"
        fields={defaultFields}
        loading
        onLoginPress={() => {}}
        onSubmit={mock(() => Promise.resolve())}
        passwordRequirements={defaultPasswordRequirements}
        title="Sign Up"
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("hints new-password on password fields unless the field sets its own", () => {
    const {UNSAFE_getAllByType} = renderWithTheme(
      <SignUpScreen
        fields={[
          {autoComplete: "email", label: "Email", name: "email", type: "email"},
          {label: "Password", name: "password", type: "password"},
        ]}
        onSubmit={mock(() => Promise.resolve())}
      />
    );
    const [email, password] = UNSAFE_getAllByType(TextField);
    expect(email.props.autoComplete).toBe("email");
    expect(password.props.autoComplete).toBe("new-password");
  });

  it("hints username on the email field so password managers save it with the new password", () => {
    const {getByTestId} = renderWithTheme(
      <SignUpScreen fields={defaultFields} onSubmit={mock(() => Promise.resolve())} />
    );
    expect(getByTestId("signup-screen-email-input").props.autoComplete).toBe("username");
    expect(getByTestId("signup-screen-password-input").props.autoComplete).toBe("new-password");
    expect(getByTestId("signup-screen-password-input").props.textContentType).toBe("newPassword");
  });

  it("names each input by its field label for assistive tech", () => {
    const {getByTestId} = renderWithTheme(
      <SignUpScreen fields={defaultFields} onSubmit={mock(() => Promise.resolve())} />
    );
    expect(getByTestId("signup-screen-name-input").props["aria-label"]).toBe("Name");
    expect(getByTestId("signup-screen-email-input").props["aria-label"]).toBe("Email");
    expect(getByTestId("signup-screen-password-input").props["aria-label"]).toBe("Password");
  });
});

/** Renders with host-node mocks: focus() records the input's testID; forms get requestSubmit. */
const renderWithHostMocks = (
  ui: ReactElement,
  {requestSubmit}: {requestSubmit?: () => void} = {}
): ReturnType<typeof render> & {focused: string[]} => {
  const focused: string[] = [];
  const result = render(ui, {
    createNodeMock: (element: ReactElement) => {
      if (element.type === "form") {
        return requestSubmit ? {requestSubmit} : {};
      }
      return {
        blur: (): void => {},
        focus: (): void => {
          focused.push(elementProps<{testID?: string}>(element).testID ?? "");
        },
      };
    },
    wrapper: ThemeProvider,
  });
  return {...result, focused};
};

const fillSignUp = (getByTestId: (id: string) => unknown, password = "Password1!"): void => {
  fireEvent.changeText(getByTestId("signup-screen-name-input") as never, "Ada");
  fireEvent.changeText(getByTestId("signup-screen-email-input") as never, "ada@test.com");
  fireEvent.changeText(getByTestId("signup-screen-password-input") as never, password);
};

describe("SignUpScreen keyboard", () => {
  it("moves focus down the fields on Enter and marks the return keys", () => {
    const onSubmit = mock(() => Promise.resolve());
    const {focused, getByTestId} = renderWithHostMocks(
      <SignUpScreen fields={defaultFields} onSubmit={onSubmit} />
    );
    expect(getByTestId("signup-screen-name-input").props.enterKeyHint).toBe("next");
    expect(getByTestId("signup-screen-email-input").props.enterKeyHint).toBe("next");
    expect(getByTestId("signup-screen-password-input").props.enterKeyHint).toBe("go");
    fillSignUp(getByTestId);
    fireEvent(getByTestId("signup-screen-name-input"), "submitEditing");
    fireEvent(getByTestId("signup-screen-email-input"), "submitEditing");
    expect(focused).toEqual(["signup-screen-email-input", "signup-screen-password-input"]);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits once on Enter in the last field", async () => {
    const onSubmit = mock((_values: Record<string, string>) => Promise.resolve());
    const {getByTestId} = renderWithTheme(
      <SignUpScreen
        fields={defaultFields}
        onSubmit={onSubmit}
        passwordRequirements={defaultPasswordRequirements}
      />
    );
    fillSignUp(getByTestId);
    await act(async () => {
      fireEvent(getByTestId("signup-screen-password-input"), "submitEditing");
      fireEvent(getByTestId("signup-screen-password-input"), "submitEditing");
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]).toEqual([
      {email: "ada@test.com", name: "Ada", password: "Password1!"},
    ]);
  });

  it("does nothing on Enter while the password misses a requirement", async () => {
    const onSubmit = mock(() => Promise.resolve());
    const {getByTestId} = renderWithTheme(
      <SignUpScreen
        fields={defaultFields}
        onSubmit={onSubmit}
        passwordRequirements={defaultPasswordRequirements}
      />
    );
    fillSignUp(getByTestId, "short");
    await act(async () => {
      fireEvent(getByTestId("signup-screen-password-input"), "submitEditing");
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("wraps the fields in a form on web and submits through it", async () => {
    const originalOS = Platform.OS;
    Platform.OS = "web";
    try {
      const requestSubmit = mock(() => {});
      const onSubmit = mock(() => Promise.resolve());
      const {UNSAFE_getByType, getByTestId} = renderWithHostMocks(
        <SignUpScreen fields={defaultFields} onSubmit={onSubmit} />,
        {requestSubmit}
      );
      const form = UNSAFE_getByType("form" as never);
      expect(form.props["data-testid"]).toBe("signup-screen-form");
      expect(within(form).getByTestId("signup-screen-email-input")).toBeTruthy();
      expect(within(form).getByTestId("signup-screen-password-input")).toBeTruthy();
      fillSignUp(getByTestId);
      await act(async () => {
        fireEvent.press(getByTestId("signup-screen-submit-button"));
      });
      expect(requestSubmit).toHaveBeenCalledTimes(1);
      await act(async () => {
        fireEvent(form, "submit", {preventDefault: () => {}});
      });
      expect(onSubmit).toHaveBeenCalledTimes(1);
    } finally {
      Platform.OS = originalOS;
    }
  });

  it("ignores a browser submit while the password misses a requirement", async () => {
    const originalOS = Platform.OS;
    Platform.OS = "web";
    try {
      const onSubmit = mock(() => Promise.resolve());
      const {UNSAFE_getByType, getByTestId} = renderWithHostMocks(
        <SignUpScreen
          fields={defaultFields}
          onSubmit={onSubmit}
          passwordRequirements={defaultPasswordRequirements}
        />
      );
      fillSignUp(getByTestId, "short");
      await act(async () => {
        fireEvent(UNSAFE_getByType("form" as never), "submit", {preventDefault: () => {}});
      });
      expect(onSubmit).not.toHaveBeenCalled();
    } finally {
      Platform.OS = originalOS;
    }
  });
});
