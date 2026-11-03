import {beforeAll, beforeEach, describe, expect, it, mock} from "bun:test";
import {fireEvent, waitFor} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";

// Isolated file: it registers module mocks (expo-router, the auth client, the session hook)
// that would leak into other suites.
const replace = mock((_href: string) => {});
const refresh = mock(async (): Promise<void> => {});
const signInEmail = mock(async (_args: unknown) => ({data: {}, error: null}));
const searchParams: {current: Record<string, string | string[] | undefined>} = {current: {}};

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
      appConfig: {brandName: "Test Brand", primaryColor: "#2563EB", providers: ["email"]},
      basePath: "/console",
    }),
  }));
  mock.module(storeProvider, () => ({
    useAuthClient: () => ({signIn: {email: signInEmail, social: mock(async () => ({}))}}),
  }));
  LoginScreen = (await import("../../app/login")).default;
});

beforeEach(() => {
  replace.mockClear();
  refresh.mockClear();
  signInEmail.mockClear();
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
