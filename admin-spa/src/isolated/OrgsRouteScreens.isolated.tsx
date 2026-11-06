/**
 * Isolated: `mock.module` for the Expo router, the shell and the admin screens would leak into
 * the shared suite. Proves the orgs routes (T11) put their screen under `AdminRpcSeed` fed by the
 * loader's `rpc` (seed `{}` on a client navigation with no loader data), pass the route's `orgId`
 * param through, and hand the directory screen `isOperator` from the profile's roles, so a
 * non-operator still gets the screen's own forbidden behavior (the screen renders nothing).
 */
import {beforeAll, beforeEach, describe, expect, it, mock} from "bun:test";
import * as adminFrontend from "@terreno/admin-frontend";
import {render} from "@testing-library/react-native";
import React, {createContext, useContext} from "react";
import {Text} from "react-native";
import * as profileModule from "../../components/adminSpaProfile";

const routeState: {
  loaderData: unknown;
  params: Record<string, string>;
  profile: unknown;
} = {loaderData: undefined, params: {}, profile: undefined};
const SeedContext = createContext<unknown>("no-seed");

/** A screen stub that prints the seed it sits under and the props it got. */
const screenStub =
  (name: string) =>
  (props: Record<string, unknown>): React.ReactElement => {
    const seed = useContext(SeedContext);
    return (
      <Text testID={`screen-${name}`}>
        {JSON.stringify({isOperator: props.isOperator, orgId: props.organizationId, seed})}
      </Text>
    );
  };

const passthrough = ({children}: {children?: React.ReactNode}): React.ReactElement => (
  <>{children}</>
);

const screens: Record<string, React.FC> = {};

beforeAll(async () => {
  mock.module("expo-router", () => ({
    router: {push: () => {}},
    useLoaderData: () => routeState.loaderData,
    useLocalSearchParams: () => routeState.params,
  }));
  mock.module("../../components/AdminSpaShell", () => ({AdminSpaShell: passthrough}));
  mock.module("../../components/AppConfigGate", () => ({useAppConfig: () => ({appConfig: {}})}));
  mock.module("../../components/adminSpaProfile", () => ({
    ...profileModule,
    useAdminSpaProfile: () => ({data: routeState.profile}),
  }));
  mock.module("@terreno/admin-frontend", () => ({
    ...adminFrontend,
    AdminRpcSeed: ({children, data}: {children: React.ReactNode; data: unknown}) => (
      <SeedContext.Provider value={data}>{children}</SeedContext.Provider>
    ),
    OrgDirectoryScreen: screenStub("directory"),
    OrgMembersScreen: screenStub("members"),
    OrgSettingsScreen: screenStub("settings"),
    useOrgContext: () => ({selectOrganization: () => {}}),
  }));
  screens.directory = (await import("../../app/orgs/index")).default;
  screens.settings = (await import("../../app/orgs/[orgId]/index")).default;
  screens.members = (await import("../../app/orgs/[orgId]/members")).default;
});

beforeEach(() => {
  routeState.loaderData = undefined;
  routeState.params = {};
  routeState.profile = {roles: ["operator"]};
});

const NAMES = ["directory", "settings", "members"];

const textOf = (node: {props: {children?: unknown}}): string =>
  [node.props.children].flat().join("");

const renderRoute = (name: string): {isOperator?: boolean; orgId?: string; seed: unknown} => {
  const Screen = screens[name];
  const {getByTestId} = render(<Screen />);
  return JSON.parse(textOf(getByTestId(`screen-${name}`)));
};

describe.each(NAMES)("%s route screen", (name) => {
  it("renders its screen under AdminRpcSeed with the loader's rpc bodies", () => {
    routeState.params = {orgId: "o1"};
    routeState.loaderData = {rpc: {"/some/url": {ok: true}}};
    expect(renderRoute(name).seed).toEqual({"/some/url": {ok: true}});
  });

  it("seeds an empty object when the page has no loader data (client navigation)", () => {
    routeState.params = {orgId: "o1"};
    expect(renderRoute(name).seed).toEqual({});
  });
});

describe.each(["settings", "members"])("%s route screen", (name) => {
  it("passes the orgId route param to its screen", () => {
    routeState.params = {orgId: "o1"};
    expect(renderRoute(name).orgId).toBe("o1");
  });
});

describe("directory route screen operator gate", () => {
  it.each([
    ["operator", {roles: ["operator"]}, true],
    ["superadmin", {roles: ["superadmin"]}, true],
    ["admin", {roles: ["admin"]}, false],
    ["no roles", {}, false],
    ["no profile yet", undefined, false],
  ])("a %s profile gives isOperator %p", (_name, profile, expected) => {
    routeState.profile = profile;
    expect(renderRoute("directory").isOperator).toBe(expected);
  });
});
