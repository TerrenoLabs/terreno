import {afterEach, beforeAll, beforeEach, describe, expect, it, mock} from "bun:test";
import {fireEvent, waitFor} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";

// Isolated file: it registers module mocks (expo-router, the auth client, the session hook)
// that would leak into other suites.
const replace = mock((_href: string) => {});
const refresh = mock(async (): Promise<void> => {});
interface SignInResult {
  data: Record<string, unknown> | null;
  error: {message?: string} | null;
}
const signInEmail = mock(
  async (_args: unknown): Promise<SignInResult> => ({data: {}, error: null})
);
const searchParams: {current: Record<string, string | string[] | undefined>} = {current: {}};

const socialSignIn = mock(async (_args: unknown): Promise<unknown> => ({}));
const providers: {current: string[]} = {current: ["email"]};

let LoginScreen: React.FC;

beforeAll(async () => {
  const appConfigGate = new URL("../../components/AppConfigGate.tsx", import.meta.url).pathname;
  const storeProvider = new URL("../../components/StoreProvider.tsx", import.meta.url).pathname;
  mock.module("expo-router", () => ({
    DarkTheme: {colors: {}, dark: true, fonts: {}},
    DefaultTheme: {colors: {}, dark: false, fonts: {}},
    Link: ({children}: {children?: React.ReactNode}) => children,
    Navigator: ({children}: {children?: React.ReactNode}) => children,
    router: {back: () => {}, navigate: () => {}, push: () => {}, replace, setParams: () => {}},
    Slot: ({children}: {children?: React.ReactNode}) => children,
    Stack: ({children}: {children?: React.ReactNode}) => children,
    Tabs: ({children}: {children?: React.ReactNode}) => children,
    ThemeProvider: ({children}: {children?: React.ReactNode}) => children,
    useFocusEffect: () => undefined,
    useGlobalSearchParams: () => searchParams.current,
    useLoaderData: () => ({appConfig: null}),
    useLocalSearchParams: () => searchParams.current,
    useNavigation: () => ({
      addListener: () => () => undefined,
      goBack: () => {},
      navigate: () => {},
    }),
    usePathname: () => "/login",
    useRouter: () => ({replace}),
    useSearchParams: () => searchParams.current,
    useSegments: () => [],
  }));
  mock.module("@terreno/syncdb/auth", () => ({
    useSession: () => ({refresh}),
  }));
  mock.module(appConfigGate, () => ({
    useAppConfig: () => ({
      appConfig: {brandName: "Test Brand", primaryColor: "#2563EB", providers: providers.current},
      basePath: "/console",
    }),
  }));
  mock.module(storeProvider, () => ({
    useAuthClient: () => ({signIn: {email: signInEmail, social: socialSignIn}}),
  }));
  LoginScreen = (await import("../../app/login")).default;
});

beforeEach(() => {
  replace.mockClear();
  refresh.mockClear();
  signInEmail.mockReset();
  signInEmail.mockImplementation(async (_args: unknown) => ({data: {}, error: null}));
  socialSignIn.mockReset();
  socialSignIn.mockImplementation(async (_args: unknown) => ({}));
  providers.current = ["email"];
  searchParams.current = {};
});

const signIn = async (): Promise<void> => {
  const {getByTestId} = renderWithTheme(<LoginScreen />);
  fireEvent.changeText(getByTestId("admin-spa-login-email"), "admin@example.com");
  fireEvent.changeText(getByTestId("admin-spa-login-password"), "pw");
  fireEvent.press(getByTestId("admin-spa-login-submit"));
  await waitFor(() => expect(replace).toHaveBeenCalled());
};

describe("login screen returnTo", () => {
  it("goes to a valid returnTo after a successful sign-in", async () => {
    searchParams.current = {returnTo: "/todos"};
    await signIn();
    expect(replace).toHaveBeenCalledWith("/todos");
  });

  it("goes to / when returnTo is a protocol-relative URL", async () => {
    searchParams.current = {returnTo: "//evil.example"};
    await signIn();
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("goes to / when there is no returnTo", async () => {
    await signIn();
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("goes to the first value when returnTo is repeated", async () => {
    searchParams.current = {returnTo: ["/a", "/b"]};
    await signIn();
    expect(replace).toHaveBeenCalledWith("/a");
  });
});

const textOf = (node: {props: {children?: unknown}}): string =>
  [node.props.children].flat().join("");

const submitCredentials = (getByTestId: (id: string) => never): void => {
  fireEvent.changeText(getByTestId("admin-spa-login-email"), "admin@example.com");
  fireEvent.changeText(getByTestId("admin-spa-login-password"), "pw");
  fireEvent.press(getByTestId("admin-spa-login-submit"));
};

describe("login screen failures", () => {
  it("shows the server's message and stays put when sign-in returns an error", async () => {
    signInEmail.mockImplementation(async () => ({data: null, error: {message: "Bad password"}}));
    const {getByTestId} = renderWithTheme(<LoginScreen />);
    submitCredentials(getByTestId as never);
    await waitFor(() => expect(getByTestId("admin-spa-login-error")).toBeTruthy());
    expect(textOf(getByTestId("admin-spa-login-error"))).toBe("Bad password");
    expect(replace).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("falls back to a generic message when the error has none", async () => {
    signInEmail.mockImplementation(async () => ({data: null, error: {}}));
    const {getByTestId} = renderWithTheme(<LoginScreen />);
    submitCredentials(getByTestId as never);
    await waitFor(() => expect(getByTestId("admin-spa-login-error")).toBeTruthy());
    expect(textOf(getByTestId("admin-spa-login-error"))).toBe("Sign in failed.");
  });

  it("shows a retry message when the sign-in request throws", async () => {
    const consoleError = mock((..._args: unknown[]) => {});
    const original = console.error;
    console.error = consoleError;
    try {
      signInEmail.mockImplementation(async () => {
        throw new Error("network down");
      });
      const {getByTestId} = renderWithTheme(<LoginScreen />);
      submitCredentials(getByTestId as never);
      await waitFor(() => expect(getByTestId("admin-spa-login-error")).toBeTruthy());
      expect(textOf(getByTestId("admin-spa-login-error"))).toBe(
        "Sign in failed. Please try again."
      );
      expect(replace).not.toHaveBeenCalled();
    } finally {
      console.error = original;
    }
  });
});

describe("login screen providers", () => {
  const originalWindow = (globalThis as {window?: unknown}).window;
  beforeEach(() => {
    (globalThis as {window?: unknown}).window = {
      location: {href: "https://x.example/console/login"},
    };
  });
  afterEach(() => {
    (globalThis as {window?: unknown}).window = originalWindow;
  });

  it("hides the email form and starts the social flow with the current URL", async () => {
    providers.current = ["google"];
    const {getByTestId, queryByTestId} = renderWithTheme(<LoginScreen />);
    expect(queryByTestId("admin-spa-login-email")).toBeNull();
    fireEvent.press(getByTestId("admin-spa-login-google"));
    await waitFor(() => expect(socialSignIn).toHaveBeenCalled());
    expect(socialSignIn.mock.calls[0]?.[0]).toMatchObject({
      callbackURL: "https://x.example/console/login",
      provider: "google",
    });
  });

  it("shows an error when the social sign-in throws", async () => {
    const original = console.error;
    console.error = () => {};
    try {
      providers.current = ["email", "google"];
      socialSignIn.mockImplementation(async () => {
        throw new Error("popup blocked");
      });
      const {getByTestId} = renderWithTheme(<LoginScreen />);
      fireEvent.press(getByTestId("admin-spa-login-google"));
      await waitFor(() => expect(getByTestId("admin-spa-login-error")).toBeTruthy());
      expect(textOf(getByTestId("admin-spa-login-error"))).toBe(
        "Sign in failed. Please try again."
      );
    } finally {
      console.error = original;
    }
  });
});
