import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent, waitFor, within} from "@testing-library/react-native";
import {Platform} from "react-native";
import {TextField} from "../TextField";
import {renderWithTheme} from "../test-utils";
import {LoginScreen} from "./LoginScreen";
import type {LoginAccountOption} from "./loginTypes";

const defaultFields = [
  {label: "Email", name: "email", required: true, type: "email" as const},
  {label: "Password", name: "password", required: true, type: "password" as const},
];

describe("LoginScreen", () => {
  it("renders with default props", () => {
    const {getByTestId} = renderWithTheme(
      <LoginScreen fields={defaultFields} onSubmit={mock(() => Promise.resolve())} />
    );
    expect(getByTestId("login-screen")).toBeTruthy();
  });

  it("renders title", () => {
    const {getByTestId} = renderWithTheme(
      <LoginScreen fields={defaultFields} onSubmit={mock(() => Promise.resolve())} />
    );
    expect(getByTestId("login-screen-title")).toBeTruthy();
  });

  it("renders custom title", () => {
    const {getByText} = renderWithTheme(
      <LoginScreen
        fields={defaultFields}
        onSubmit={mock(() => Promise.resolve())}
        title="Sign In"
      />
    );
    expect(getByText("Sign In")).toBeTruthy();
  });

  it("renders all form fields", () => {
    const {getByTestId} = renderWithTheme(
      <LoginScreen fields={defaultFields} onSubmit={mock(() => Promise.resolve())} />
    );
    expect(getByTestId("login-screen-email-input")).toBeTruthy();
    expect(getByTestId("login-screen-password-input")).toBeTruthy();
  });

  it("renders submit button", () => {
    const {getByTestId} = renderWithTheme(
      <LoginScreen fields={defaultFields} onSubmit={mock(() => Promise.resolve())} />
    );
    expect(getByTestId("login-screen-submit-button")).toBeTruthy();
  });

  it("renders sign-up link when onSignUpPress is provided", () => {
    const {getByTestId} = renderWithTheme(
      <LoginScreen
        fields={defaultFields}
        onSignUpPress={() => {}}
        onSubmit={mock(() => Promise.resolve())}
      />
    );
    expect(getByTestId("login-screen-signup-link")).toBeTruthy();
  });

  it("renders forgot password button when onForgotPassword is provided", () => {
    const {getByTestId} = renderWithTheme(
      <LoginScreen
        fields={defaultFields}
        onForgotPassword={() => {}}
        onSubmit={mock(() => Promise.resolve())}
      />
    );
    expect(getByTestId("login-screen-forgot-password")).toBeTruthy();
  });

  it("does not render forgot password without a callback", () => {
    const {queryByTestId} = renderWithTheme(
      <LoginScreen fields={defaultFields} onSubmit={mock(() => Promise.resolve())} />
    );
    expect(queryByTestId("login-screen-forgot-password")).toBeNull();
  });

  it("renders error message", () => {
    const {getByTestId} = renderWithTheme(
      <LoginScreen
        error="Invalid credentials"
        fields={defaultFields}
        onSubmit={mock(() => Promise.resolve())}
      />
    );
    expect(getByTestId("login-screen-error")).toBeTruthy();
  });

  it("renders OAuth buttons when providers are given", () => {
    const providers = [
      {onPress: mock(() => Promise.resolve()), provider: "google" as const},
      {onPress: mock(() => Promise.resolve()), provider: "github" as const},
    ];
    const {getByTestId} = renderWithTheme(
      <LoginScreen
        fields={defaultFields}
        oauthProviders={providers}
        onSubmit={mock(() => Promise.resolve())}
      />
    );
    expect(getByTestId("login-screen-oauth")).toBeTruthy();
  });

  it("updates form field values on change", () => {
    const {getByTestId} = renderWithTheme(
      <LoginScreen fields={defaultFields} onSubmit={mock(() => Promise.resolve())} />
    );
    const emailInput = getByTestId("login-screen-email-input");
    fireEvent.changeText(emailInput, "test@example.com");
    expect(emailInput.props.value).toBe("test@example.com");
  });

  it("renders with custom testID", () => {
    const {getByTestId} = renderWithTheme(
      <LoginScreen
        fields={defaultFields}
        onSubmit={mock(() => Promise.resolve())}
        testID="custom-login"
      />
    );
    expect(getByTestId("custom-login")).toBeTruthy();
  });

  it("does not render forgot password when handler not provided", () => {
    const {queryByTestId} = renderWithTheme(
      <LoginScreen fields={defaultFields} onSubmit={mock(() => Promise.resolve())} />
    );
    expect(queryByTestId("login-screen-forgot-password")).toBeNull();
  });

  it("does not render sign-up link when handler not provided", () => {
    const {queryByTestId} = renderWithTheme(
      <LoginScreen fields={defaultFields} onSubmit={mock(() => Promise.resolve())} />
    );
    expect(queryByTestId("login-screen-signup-link")).toBeNull();
  });

  it("calls onSubmit when submit button is pressed and fields filled", async () => {
    const onSubmit = mock(() => Promise.resolve());
    const {getByTestId} = renderWithTheme(
      <LoginScreen fields={defaultFields} onSubmit={onSubmit} />
    );
    fireEvent.changeText(getByTestId("login-screen-email-input"), "user@test.com");
    fireEvent.changeText(getByTestId("login-screen-password-input"), "secret123");
    fireEvent.press(getByTestId("login-screen-submit-button"));
    await new Promise((r) => setTimeout(r, 600));
    expect(onSubmit).toHaveBeenCalled();
  });

  it("renders correctly with all props", () => {
    const {toJSON} = renderWithTheme(
      <LoginScreen
        error="Error!"
        fields={defaultFields}
        loading
        onForgotPasswordPress={() => {}}
        onSignUpPress={() => {}}
        onSubmit={mock(() => Promise.resolve())}
        title="Log In"
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("calls onSubmit with form values when submit button is pressed", async () => {
    const onSubmit = mock(() => Promise.resolve());
    const {getByTestId} = renderWithTheme(
      <LoginScreen fields={defaultFields} onSubmit={onSubmit} />
    );

    await act(async () => {
      fireEvent.changeText(getByTestId("login-screen-email-input"), "user@test.com");
    });
    await act(async () => {
      fireEvent.changeText(getByTestId("login-screen-password-input"), "secret123");
    });
    await act(async () => {
      fireEvent.press(getByTestId("login-screen-submit-button"));
    });

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit.mock.calls[0][0]).toEqual({email: "user@test.com", password: "secret123"});
  });
});

interface RenderedNode {
  props?: {testID?: string};
  children?: (RenderedNode | string)[] | null;
}

// Lists every testID in render order, so tests can assert where a method sits on the screen.
const collectTestIDs = (node: RenderedNode | RenderedNode[] | string | null): string[] => {
  if (!node || typeof node === "string") {
    return [];
  }
  if (Array.isArray(node)) {
    return node.flatMap(collectTestIDs);
  }
  const own = node.props?.testID ? [node.props.testID] : [];
  return [...own, ...collectTestIDs((node.children ?? null) as RenderedNode[] | null)];
};

const indexOfTestID = (ids: string[], testID: string): number => {
  const index = ids.indexOf(testID);
  if (index === -1) {
    throw new Error(`testID ${testID} not rendered`);
  }
  return index;
};

const brandedProviders = () => [
  {onPress: mock(() => Promise.resolve()), provider: "google" as const},
  {onPress: mock(() => Promise.resolve()), provider: "github" as const},
];

describe("LoginScreen last used method", () => {
  it("puts the last-used provider first, above the form, with a badge", () => {
    const {getByTestId, toJSON} = renderWithTheme(
      <LoginScreen
        fields={defaultFields}
        lastUsedMethod="github"
        oauthProviders={brandedProviders()}
        onSubmit={mock(() => Promise.resolve())}
      />
    );
    expect(getByTestId("login-screen-last-used-github")).toBeTruthy();
    expect(getByTestId("login-screen-oauth-github").props["aria-label"]).toBe(
      "Continue with GitHub, last used"
    );
    expect(getByTestId("login-screen-oauth-google").props["aria-label"]).toBe(
      "Continue with Google"
    );
    const ids = collectTestIDs(toJSON() as RenderedNode);
    expect(indexOfTestID(ids, "login-screen-oauth-github")).toBeLessThan(
      indexOfTestID(ids, "login-screen-oauth-google")
    );
    expect(indexOfTestID(ids, "login-screen-oauth")).toBeLessThan(
      indexOfTestID(ids, "login-screen-email-input")
    );
  });

  it("keeps providers below the form in their given order without a last-used provider", () => {
    const {queryByTestId, toJSON} = renderWithTheme(
      <LoginScreen
        fields={defaultFields}
        oauthProviders={brandedProviders()}
        onSubmit={mock(() => Promise.resolve())}
      />
    );
    expect(queryByTestId("login-screen-last-used-google")).toBeNull();
    const ids = collectTestIDs(toJSON() as RenderedNode);
    expect(indexOfTestID(ids, "login-screen-oauth-google")).toBeLessThan(
      indexOfTestID(ids, "login-screen-oauth-github")
    );
    expect(indexOfTestID(ids, "login-screen-oauth")).toBeGreaterThan(
      indexOfTestID(ids, "login-screen-submit-button")
    );
  });

  it("badges the email form and keeps it first when email was last used", () => {
    const {getByTestId, toJSON} = renderWithTheme(
      <LoginScreen
        fields={defaultFields}
        lastUsedMethod="email"
        oauthProviders={brandedProviders()}
        onPasskeyPress={mock(() => Promise.resolve())}
        onSubmit={mock(() => Promise.resolve())}
      />
    );
    expect(getByTestId("login-screen-last-used-email")).toBeTruthy();
    expect(getByTestId("login-screen-submit-button").props.accessibilityLabel).toBe(
      "Log In, last used"
    );
    const ids = collectTestIDs(toJSON() as RenderedNode);
    expect(indexOfTestID(ids, "login-screen-last-used-email")).toBeLessThan(
      indexOfTestID(ids, "login-screen-email-input")
    );
    expect(indexOfTestID(ids, "login-screen-email-input")).toBeLessThan(
      indexOfTestID(ids, "login-screen-oauth")
    );
    expect(indexOfTestID(ids, "login-screen-email-input")).toBeLessThan(
      indexOfTestID(ids, "login-screen-passkey-button")
    );
  });

  it("moves the passkey button above the form when a passkey was last used", () => {
    const {getByTestId, toJSON} = renderWithTheme(
      <LoginScreen
        fields={defaultFields}
        lastUsedMethod="passkey"
        oauthProviders={brandedProviders()}
        onPasskeyPress={mock(() => Promise.resolve())}
        onSubmit={mock(() => Promise.resolve())}
      />
    );
    expect(getByTestId("login-screen-last-used-passkey")).toBeTruthy();
    expect(getByTestId("login-screen-passkey-button").props.accessibilityLabel).toBe(
      "Sign in with a passkey, last used"
    );
    const ids = collectTestIDs(toJSON() as RenderedNode);
    expect(indexOfTestID(ids, "login-screen-passkey-button")).toBeLessThan(
      indexOfTestID(ids, "login-screen-email-input")
    );
    expect(indexOfTestID(ids, "login-screen-oauth")).toBeGreaterThan(
      indexOfTestID(ids, "login-screen-email-input")
    );
  });

  it("ignores a last-used method the screen does not offer", () => {
    const {queryByTestId, toJSON} = renderWithTheme(
      <LoginScreen
        fields={defaultFields}
        lastUsedMethod="apple"
        oauthProviders={brandedProviders()}
        onSubmit={mock(() => Promise.resolve())}
      />
    );
    expect(queryByTestId("login-screen-last-used-apple")).toBeNull();
    const ids = collectTestIDs(toJSON() as RenderedNode);
    expect(indexOfTestID(ids, "login-screen-oauth")).toBeGreaterThan(
      indexOfTestID(ids, "login-screen-email-input")
    );
  });

  it("uses a custom last-used label", () => {
    const {getByText} = renderWithTheme(
      <LoginScreen
        fields={defaultFields}
        lastUsedLabel="Your last method"
        lastUsedMethod="email"
        onSubmit={mock(() => Promise.resolve())}
      />
    );
    expect(getByText("Your last method")).toBeTruthy();
  });
});

describe("LoginScreen generic providers", () => {
  it("renders a labelled button for a non-branded provider and calls its onPress", async () => {
    const onPress = mock(() => Promise.resolve());
    const {getByTestId, getByText} = renderWithTheme(
      <LoginScreen
        fields={defaultFields}
        genericProviders={[{id: "mock-oidc", label: "Mock OIDC", onPress}]}
        onSubmit={mock(() => Promise.resolve())}
      />
    );
    expect(getByText("Continue with Mock OIDC")).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByTestId("login-screen-oauth-mock-oidc"));
    });
    await waitFor(() => {
      expect(onPress).toHaveBeenCalledTimes(1);
    });
  });

  it("puts a last-used generic provider before the branded ones", () => {
    const {getByTestId, toJSON} = renderWithTheme(
      <LoginScreen
        fields={defaultFields}
        genericProviders={[
          {id: "mock-oidc", label: "Mock OIDC", onPress: mock(() => Promise.resolve())},
        ]}
        lastUsedMethod="mock-oidc"
        oauthProviders={brandedProviders()}
        onSubmit={mock(() => Promise.resolve())}
      />
    );
    expect(getByTestId("login-screen-last-used-mock-oidc")).toBeTruthy();
    const ids = collectTestIDs(toJSON() as RenderedNode);
    expect(indexOfTestID(ids, "login-screen-oauth-mock-oidc")).toBeLessThan(
      indexOfTestID(ids, "login-screen-oauth-google")
    );
    expect(indexOfTestID(ids, "login-screen-oauth")).toBeLessThan(
      indexOfTestID(ids, "login-screen-email-input")
    );
  });

  it("follows later changes to a provider's loading prop", () => {
    const onSubmit = mock(() => Promise.resolve());
    const onPress = mock(() => Promise.resolve());
    const {getByTestId, rerender} = renderWithTheme(
      <LoginScreen
        fields={defaultFields}
        oauthProviders={[{onPress, provider: "github"}]}
        onSubmit={onSubmit}
      />
    );
    expect(getByTestId("login-screen-oauth-github").props.disabled).toBeFalsy();
    rerender(
      <LoginScreen
        fields={defaultFields}
        oauthProviders={[{loading: true, onPress, provider: "github"}]}
        onSubmit={onSubmit}
      />
    );
    expect(getByTestId("login-screen-oauth-github").props.disabled).toBe(true);
  });
});

describe("LoginScreen continue as", () => {
  const session: LoginAccountOption = {
    email: "ada@example.com",
    id: "session-1",
    method: "github",
    name: "Ada Lovelace",
  };
  const remembered: LoginAccountOption = {id: "remembered-1", method: "google"};

  it("continues with a signed-in session or a remembered account", async () => {
    const onContinue = mock(() => {});
    const {getByTestId, getByText} = renderWithTheme(
      <LoginScreen
        currentSessions={[session]}
        fields={defaultFields}
        onContinue={onContinue}
        onForget={mock(() => {})}
        onSubmit={mock(() => Promise.resolve())}
        rememberedAccounts={[remembered]}
      />
    );
    expect(getByText("Ada Lovelace")).toBeTruthy();
    expect(getByText("ada@example.com")).toBeTruthy();
    // A session card names the method it is signed in with.
    expect(getByText("Signed in on this device · GitHub")).toBeTruthy();
    expect(getByTestId("login-screen-continue-0").props["aria-label"]).toBe(
      "Continue as Ada Lovelace, GitHub"
    );
    // Without a remembered identity (D5 default) the card names only the method.
    expect(getByText("Continue with Google")).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByTestId("login-screen-continue-0"));
    });
    await act(async () => {
      fireEvent.press(getByTestId("login-screen-continue-1"));
    });
    await waitFor(() => {
      expect(onContinue).toHaveBeenCalledTimes(2);
    });
    expect(onContinue.mock.calls[0]).toEqual([session, "session"] as never);
    expect(onContinue.mock.calls[1]).toEqual([remembered, "remembered"] as never);
  });

  it("offers forget only on remembered accounts", async () => {
    const onForget = mock(() => {});
    const {getByTestId, queryByTestId} = renderWithTheme(
      <LoginScreen
        currentSessions={[session]}
        fields={defaultFields}
        onContinue={mock(() => {})}
        onForget={onForget}
        onSubmit={mock(() => Promise.resolve())}
        rememberedAccounts={[remembered]}
      />
    );
    expect(queryByTestId("login-screen-forget-0")).toBeNull();
    expect(getByTestId("login-screen-forget-1").props.accessibilityLabel).toBe(
      "Forget this Google account"
    );
    await act(async () => {
      fireEvent.press(getByTestId("login-screen-forget-1"));
    });
    await waitFor(() => {
      expect(onForget).toHaveBeenCalledTimes(1);
    });
    expect(onForget.mock.calls[0]).toEqual([remembered] as never);
  });

  it("hides forget when no onForget is given", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <LoginScreen
        fields={defaultFields}
        onContinue={mock(() => {})}
        onSubmit={mock(() => Promise.resolve())}
        rememberedAccounts={[remembered]}
      />
    );
    expect(getByTestId("login-screen-continue-0")).toBeTruthy();
    expect(queryByTestId("login-screen-forget-0")).toBeNull();
  });

  it("renders no cards without onContinue", () => {
    const {queryByTestId} = renderWithTheme(
      <LoginScreen
        currentSessions={[session]}
        fields={defaultFields}
        onSubmit={mock(() => Promise.resolve())}
      />
    );
    expect(queryByTestId("login-screen-continue-0")).toBeNull();
  });

  it("names a generic provider by its label and an email account by its address", () => {
    const {getByTestId} = renderWithTheme(
      <LoginScreen
        fields={defaultFields}
        genericProviders={[
          {id: "mock-oidc", label: "Mock OIDC", onPress: mock(() => Promise.resolve())},
        ]}
        onContinue={mock(() => {})}
        onForget={mock(() => {})}
        onSubmit={mock(() => Promise.resolve())}
        rememberedAccounts={[
          {id: "a", method: "mock-oidc"},
          {email: "bo@example.com", id: "b", method: "email"},
          {id: "c", method: "passkey"},
        ]}
      />
    );
    expect(
      within(getByTestId("login-screen-continue-0")).getByText("Continue with Mock OIDC")
    ).toBeTruthy();
    expect(within(getByTestId("login-screen-continue-1")).getByText("bo@example.com")).toBeTruthy();
    expect(
      within(getByTestId("login-screen-continue-2")).getByText("Continue with a passkey")
    ).toBeTruthy();
    expect(getByTestId("login-screen-forget-2").props.accessibilityLabel).toBe(
      "Forget this passkey account"
    );
  });
});

describe("LoginScreen passkeys", () => {
  it("shows the passkey button only when onPasskeyPress is set", async () => {
    const onPasskeyPress = mock(() => Promise.resolve());
    const {queryByTestId: queryWithout} = renderWithTheme(
      <LoginScreen fields={defaultFields} onSubmit={mock(() => Promise.resolve())} />
    );
    expect(queryWithout("login-screen-passkey-button")).toBeNull();

    const {getByTestId} = renderWithTheme(
      <LoginScreen
        fields={defaultFields}
        onPasskeyPress={onPasskeyPress}
        onSubmit={mock(() => Promise.resolve())}
      />
    );
    await act(async () => {
      fireEvent.press(getByTestId("login-screen-passkey-button"));
    });
    await waitFor(() => {
      expect(onPasskeyPress).toHaveBeenCalledTimes(1);
    });
  });

  it("asks the browser for passkey autofill on the email field on web", () => {
    const originalOS = Platform.OS;
    Platform.OS = "web";
    try {
      const {getByTestId} = renderWithTheme(
        <LoginScreen
          fields={defaultFields}
          onSubmit={mock(() => Promise.resolve())}
          passkeyAutofill
        />
      );
      expect(getByTestId("login-screen-email-input").props.autoComplete).toBe("username webauthn");
      expect(getByTestId("login-screen-password-input").props.autoComplete).toBe(
        "current-password"
      );
    } finally {
      Platform.OS = originalOS;
    }
  });

  it("keeps the email field's own autoComplete on native", () => {
    const {UNSAFE_getAllByType} = renderWithTheme(
      <LoginScreen
        fields={[
          {autoComplete: "username", label: "Email", name: "email", type: "email"},
          {label: "Password", name: "password", type: "password"},
        ]}
        onSubmit={mock(() => Promise.resolve())}
        passkeyAutofill
      />
    );
    const [email, password] = UNSAFE_getAllByType(TextField);
    expect(email.props.autoComplete).toBe("username");
    expect(password.props.autoComplete).toBe("current-password");
  });
});

describe("LoginScreen notice", () => {
  it("renders the notice text and runs its action", async () => {
    const onAction = mock(() => {});
    const {getByTestId, getByText} = renderWithTheme(
      <LoginScreen
        fields={defaultFields}
        notice={{
          actionLabel: "Sign in with Google",
          onAction,
          text: "This email already has an account. Sign in with Google to link GitHub.",
          tone: "warning",
        }}
        onSubmit={mock(() => Promise.resolve())}
      />
    );
    expect(getByTestId("login-screen-notice").props.role).toBe("alert");
    expect(
      getByText("This email already has an account. Sign in with Google to link GitHub.")
    ).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByTestId("login-screen-notice-action"));
    });
    await waitFor(() => {
      expect(onAction).toHaveBeenCalledTimes(1);
    });
  });

  it("renders an info notice without an action", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <LoginScreen
        fields={defaultFields}
        notice={{text: "Signed out.", tone: "info"}}
        onSubmit={mock(() => Promise.resolve())}
      />
    );
    expect(getByTestId("login-screen-notice").props.role).toBe("status");
    expect(queryByTestId("login-screen-notice-action")).toBeNull();
  });
});

describe("LoginScreen loading", () => {
  it("disables continue cards, forget, passkey and provider buttons while loading", () => {
    const {getByTestId} = renderWithTheme(
      <LoginScreen
        fields={defaultFields}
        genericProviders={[
          {id: "mock-oidc", label: "Mock OIDC", onPress: mock(() => Promise.resolve())},
        ]}
        loading
        oauthProviders={[{onPress: mock(() => Promise.resolve()), provider: "github"}]}
        onContinue={mock(() => {})}
        onForget={mock(() => {})}
        onPasskeyPress={mock(() => Promise.resolve())}
        onSubmit={mock(() => Promise.resolve())}
        rememberedAccounts={[{id: "r1", method: "google"}]}
      />
    );
    expect(getByTestId("login-screen-continue-0").props.accessibilityState.disabled).toBe(true);
    expect(getByTestId("login-screen-forget-0").props.accessibilityState.disabled).toBe(true);
    expect(getByTestId("login-screen-passkey-button").props.accessibilityState.disabled).toBe(true);
    expect(getByTestId("login-screen-oauth-mock-oidc").props.accessibilityState.disabled).toBe(
      true
    );
    expect(getByTestId("login-screen-oauth-github").props.disabled).toBe(true);
  });
});

describe("LoginScreen v2 snapshot", () => {
  it("renders every new state together", () => {
    const {toJSON} = renderWithTheme(
      <LoginScreen
        currentSessions={[
          {email: "ada@example.com", id: "s1", method: "github", name: "Ada Lovelace"},
        ]}
        fields={defaultFields}
        genericProviders={[
          {id: "mock-oidc", label: "Mock OIDC", onPress: mock(() => Promise.resolve())},
        ]}
        lastUsedMethod="github"
        notice={{text: "Sign in with Google to link GitHub.", tone: "warning"}}
        oauthProviders={brandedProviders()}
        onContinue={mock(() => {})}
        onForget={mock(() => {})}
        onPasskeyPress={mock(() => Promise.resolve())}
        onSubmit={mock(() => Promise.resolve())}
        rememberedAccounts={[{id: "r1", method: "google"}]}
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });
});
