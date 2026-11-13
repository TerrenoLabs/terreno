/**
 * Isolated: `mock.module` for the Expo router, the shell and the admin screens would leak into
 * the shared suite. Proves each of the home, configuration, roles, scripts and version-config
 * routes wraps its screen in `AdminRpcSeed` fed by the loader's `rpc`, and seeds `{}` on a
 * client navigation (no loader data).
 */
import {beforeAll, beforeEach, describe, expect, it, mock} from "bun:test";
import * as adminFrontend from "@terreno/admin-frontend";
import {render} from "@testing-library/react-native";
import React, {createContext, useContext} from "react";
import {Text} from "react-native";

const routeState: {appConfig: unknown; loaderData: unknown} = {
  appConfig: {},
  loaderData: undefined,
};
const SeedContext = createContext<unknown>("no-seed");

/** A screen stub that prints the seed it sits under and the props it got. */
const screenStub =
  (name: string) =>
  (props: Record<string, unknown>): React.ReactElement => {
    const seed = useContext(SeedContext);
    return (
      <Text testID={`screen-${name}`}>{JSON.stringify({apiBase: props.apiBase, name, seed})}</Text>
    );
  };

const screens: Record<string, React.FC> = {};

beforeAll(async () => {
  mock.module("expo-router", () => ({
    useLoaderData: () => routeState.loaderData,
    useLocalSearchParams: () => ({}),
  }));
  mock.module("../../components/AdminSpaShell", () => ({
    AdminSpaShell: ({children}: {children: React.ReactNode}) => <>{children}</>,
  }));
  mock.module("../../components/AppConfigGate", () => ({
    useAppConfig: () => ({appConfig: routeState.appConfig}),
  }));
  mock.module("@terreno/admin-frontend", () => ({
    ...adminFrontend,
    AdminHome: screenStub("home"),
    AdminRolesList: screenStub("roles"),
    AdminRpcSeed: ({children, data}: {children: React.ReactNode; data: unknown}) => (
      <SeedContext.Provider value={data}>{children}</SeedContext.Provider>
    ),
    AdminScriptList: screenStub("scripts"),
    AdminVersionConfig: screenStub("version-config"),
    ConfigurationScreen: screenStub("configuration"),
  }));
  screens.home = (await import("../../app/index")).default;
  screens.configuration = (await import("../../app/configuration")).default;
  screens.roles = (await import("../../app/roles/index")).default;
  screens.scripts = (await import("../../app/scripts")).default;
  screens["version-config"] = (await import("../../app/version-config")).default;
});

beforeEach(() => {
  routeState.appConfig = {};
  routeState.loaderData = undefined;
});

const textOf = (node: {props: {children?: unknown}}): string =>
  [node.props.children].flat().join("");

const renderRoute = (name: string): {apiBase?: string; seed: unknown} => {
  const Screen = screens[name];
  const {getByTestId} = render(<Screen />);
  return JSON.parse(textOf(getByTestId(`screen-${name}`)));
};

const NAMES = ["home", "configuration", "roles", "scripts", "version-config"];

describe.each(NAMES)("%s route screen", (name) => {
  it("renders its screen under AdminRpcSeed with the loader's rpc bodies", () => {
    routeState.loaderData = {rpc: {"/some/url": {ok: true}}};
    expect(renderRoute(name).seed).toEqual({"/some/url": {ok: true}});
  });

  it("seeds an empty object when the page has no loader data (client navigation)", () => {
    expect(renderRoute(name).seed).toEqual({});
  });
});

describe("admin API base path", () => {
  it.each(["home", "roles", "scripts", "version-config"])(
    "%s passes the configured admin API base path to its screen",
    (name) => {
      routeState.appConfig = {adminApiBasePath: "/internal/admin"};
      expect(renderRoute(name).apiBase).toBe("/internal/admin");
    }
  );
});
