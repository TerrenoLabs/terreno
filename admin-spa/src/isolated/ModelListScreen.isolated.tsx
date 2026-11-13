/**
 * Isolated: `mock.module` for the Expo router, the shell and the admin screens would leak into
 * the shared suite. Proves the `[model]` screen wires the loader's rpc seed into the admin
 * screen router and builds the right breadcrumb trail for each kind of route.
 */
import {beforeAll, beforeEach, describe, expect, it, mock} from "bun:test";
import * as adminFrontend from "@terreno/admin-frontend";
import {render} from "@testing-library/react-native";
import React from "react";
import {Text} from "react-native";

interface Crumb {
  href?: string;
  label: string;
}

const routeState: {config: unknown; loaderData: unknown; model: string; appConfig: unknown} = {
  appConfig: {},
  config: undefined,
  loaderData: undefined,
  model: "User",
};
const apiBasesAsked: string[] = [];

let ModelTableScreen: React.FC;

beforeAll(async () => {
  mock.module("expo-router", () => ({
    useLoaderData: () => routeState.loaderData,
    useLocalSearchParams: () => ({model: routeState.model}),
  }));
  mock.module("../../components/AdminSpaShell", () => ({
    AdminSpaShell: ({breadcrumbs, children}: {breadcrumbs: Crumb[]; children: React.ReactNode}) => (
      <>
        <Text testID="crumbs">{JSON.stringify(breadcrumbs)}</Text>
        {children}
      </>
    ),
  }));
  mock.module("../../components/AppConfigGate", () => ({
    useAppConfig: () => ({appConfig: routeState.appConfig}),
  }));
  mock.module("@terreno/admin-frontend", () => ({
    ...adminFrontend,
    AdminRpcSeed: ({children, data}: {children: React.ReactNode; data: unknown}) => (
      <>
        <Text testID="seed">{JSON.stringify(data)}</Text>
        {children}
      </>
    ),
    AdminScreenRouter: ({apiBase, name, routeBase}: Record<string, string>) => (
      <Text testID="router">{JSON.stringify({apiBase, name, routeBase})}</Text>
    ),
    useAdminConfig: (apiBase: string) => {
      apiBasesAsked.push(apiBase);
      return {config: routeState.config};
    },
  }));
  ModelTableScreen = (await import("../../app/[model]/index")).default;
});

beforeEach(() => {
  routeState.appConfig = {};
  routeState.config = undefined;
  routeState.loaderData = undefined;
  routeState.model = "User";
  apiBasesAsked.length = 0;
});

const textOf = (node: {props: {children?: unknown}}): string =>
  [node.props.children].flat().join("");

const renderScreen = (): {crumbs: Crumb[]; router: unknown; seed: unknown} => {
  const {getByTestId} = render(<ModelTableScreen />);
  return {
    crumbs: JSON.parse(textOf(getByTestId("crumbs"))),
    router: JSON.parse(textOf(getByTestId("router"))),
    seed: JSON.parse(textOf(getByTestId("seed"))),
  };
};

describe("[model] screen", () => {
  it("seeds the admin screen router with the loader's rpc bodies", () => {
    routeState.loaderData = {rpc: {"/admin/users": {data: [{_id: "u1"}]}}};
    const {router, seed} = renderScreen();
    expect(seed).toEqual({"/admin/users": {data: [{_id: "u1"}]}});
    expect(router).toEqual({apiBase: "/admin", name: "User", routeBase: ""});
  });

  it("seeds an empty object when the page has no loader data (client navigation)", () => {
    expect(renderScreen().seed).toEqual({});
  });

  it("uses the configured admin API base path for config and routing", () => {
    routeState.appConfig = {adminApiBasePath: "/internal/admin"};
    const {router} = renderScreen();
    expect(apiBasesAsked).toEqual(["/internal/admin"]);
    expect(router).toMatchObject({apiBase: "/internal/admin"});
  });

  it("labels the trail with the model's display name when the config knows it", () => {
    routeState.config = {models: [{displayName: "Team Members", name: "User"}]};
    expect(renderScreen().crumbs).toEqual([{href: "/", label: "Admin"}, {label: "Team Members"}]);
  });

  it("falls back to the raw route name for a model missing from the config", () => {
    routeState.config = {models: [{displayName: "Other", name: "Other"}]};
    expect(renderScreen().crumbs.at(-1)).toEqual({label: "User"});
  });

  it("falls back to the raw route name while the config is still loading", () => {
    expect(renderScreen().crumbs.at(-1)).toEqual({label: "User"});
  });

  it.each([
    ["__scripts", "Scripts"],
    ["__migrations", "Migrations"],
    ["version-config", "Version configuration"],
  ])("uses a fixed label for the %s route", (model, label) => {
    routeState.model = model;
    routeState.config = {models: [{displayName: "Wrong", name: model}]};
    expect(renderScreen().crumbs).toEqual([{href: "/", label: "Admin"}, {label}]);
  });
});
