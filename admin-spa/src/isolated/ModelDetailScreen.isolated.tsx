/**
 * Isolated: `mock.module` for the Expo router, the shell and the admin screens would leak into
 * the shared suite. Proves the `[model]/[id]` screen wires the loader's rpc seed around the
 * edit form, and shows the not-found state instead of the form when the loader reports a 404.
 */
import {beforeAll, beforeEach, describe, expect, it, mock} from "bun:test";
import * as adminFrontend from "@terreno/admin-frontend";
import {render} from "@testing-library/react-native";
import React from "react";
import {Text} from "react-native";

const routeState: {appConfig: unknown; id: string; loaderData: unknown; model: string} = {
  appConfig: {},
  id: "u1",
  loaderData: undefined,
  model: "User",
};

let ModelEditScreen: React.FC;

beforeAll(async () => {
  mock.module("expo-router", () => ({
    useLoaderData: () => routeState.loaderData,
    useLocalSearchParams: () => ({id: routeState.id, model: routeState.model}),
  }));
  mock.module("../../components/AdminSpaShell", () => ({
    AdminSpaShell: ({children}: {children: React.ReactNode}) => <>{children}</>,
  }));
  mock.module("../../components/AppConfigGate", () => ({
    useAppConfig: () => ({appConfig: routeState.appConfig}),
  }));
  mock.module("@terreno/admin-frontend", () => ({
    ...adminFrontend,
    AdminModelForm: (props: Record<string, string>) => (
      <Text testID="form">
        {JSON.stringify({
          apiBase: props.apiBase,
          itemId: props.itemId,
          mode: props.mode,
          modelName: props.modelName,
          routeBase: props.routeBase,
        })}
      </Text>
    ),
    AdminRpcSeed: ({children, data}: {children: React.ReactNode; data: unknown}) => (
      <>
        <Text testID="seed">{JSON.stringify(data)}</Text>
        {children}
      </>
    ),
    // Stands in for the existing not-found state (`admin-screen-not-found`).
    AdminScreenRouter: () => <Text testID="admin-screen-not-found">not found</Text>,
    useAdminConfig: () => ({config: {models: [{displayName: "Team Members", name: "User"}]}}),
  }));
  ModelEditScreen = (await import("../../app/[model]/[id]")).default;
});

beforeEach(() => {
  routeState.appConfig = {};
  routeState.id = "u1";
  routeState.loaderData = undefined;
  routeState.model = "User";
});

const textOf = (node: {props: {children?: unknown}}): string =>
  [node.props.children].flat().join("");

describe("[model]/[id] screen", () => {
  it("seeds the edit form with the loader's rpc bodies", () => {
    routeState.loaderData = {rpc: {"/admin/users/u1": {data: {_id: "u1"}}}};
    const {getByTestId} = render(<ModelEditScreen />);
    expect(JSON.parse(textOf(getByTestId("seed")))).toEqual({
      "/admin/users/u1": {data: {_id: "u1"}},
    });
    expect(JSON.parse(textOf(getByTestId("form")))).toEqual({
      apiBase: "/admin",
      itemId: "u1",
      mode: "edit",
      modelName: "User",
      routeBase: "",
    });
  });

  it("seeds an empty object when the page has no loader data (client navigation)", () => {
    const {getByTestId} = render(<ModelEditScreen />);
    expect(JSON.parse(textOf(getByTestId("seed")))).toEqual({});
    expect(getByTestId("form")).toBeTruthy();
  });

  it("renders the not-found state and no form when the loader reports notFound", () => {
    routeState.loaderData = {notFound: true, rpc: {}};
    const {getByTestId, queryByTestId} = render(<ModelEditScreen />);
    expect(getByTestId("admin-screen-not-found")).toBeTruthy();
    expect(queryByTestId("form")).toBeNull();
  });
});
