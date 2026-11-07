/**
 * Isolated: `mock.module` for the Expo router, the shell and the admin screens would leak into
 * the shared suite. Proves the jobs and comms routes wrap their screen in `AdminRpcSeed` fed by
 * the loader's `rpc`, seed `{}` on a client navigation (no loader data), and that the detail
 * routes show the record not-found state (testID `admin-screen-not-found`, as `[model]/[id]`
 * does) instead of the screen when the loader reports `notFound`.
 */
import {beforeAll, beforeEach, describe, expect, it, mock} from "bun:test";
import * as adminFrontend from "@terreno/admin-frontend";
import {render} from "@testing-library/react-native";
import React, {createContext, useContext} from "react";
import {Text} from "react-native";

const routeState: {loaderData: unknown; params: Record<string, string>} = {
  loaderData: undefined,
  params: {},
};
const SeedContext = createContext<unknown>("no-seed");

/** A screen stub that prints the seed it sits under and the props it got. */
const screenStub =
  (name: string) =>
  (props: Record<string, unknown>): React.ReactElement => {
    const seed = useContext(SeedContext);
    return (
      <Text testID={`screen-${name}`}>
        {JSON.stringify({id: props.jobId ?? props.messageId, name, seed})}
      </Text>
    );
  };

const passthrough = ({children}: {children?: React.ReactNode}): React.ReactElement => (
  <>{children}</>
);

const screens: Record<string, React.FC> = {};

beforeAll(async () => {
  mock.module("expo-router", () => ({
    useLoaderData: () => routeState.loaderData,
    useLocalSearchParams: () => routeState.params,
  }));
  mock.module("../../components/AdminSpaShell", () => ({AdminSpaShell: passthrough}));
  mock.module("../../components/AppConfigGate", () => ({useAppConfig: () => ({appConfig: {}})}));
  mock.module("@terreno/admin-frontend", () => ({
    ...adminFrontend,
    AdminRpcSeed: ({children, data}: {children: React.ReactNode; data: unknown}) => (
      <SeedContext.Provider value={data}>{children}</SeedContext.Provider>
    ),
    AdminScreenPage: passthrough,
    AdminShellLayout: passthrough,
    CommsDashboardScreenWidget: screenStub("comms"),
    CommsMessageDetail: screenStub("comms-detail"),
    JobsDashboardScreenWidget: screenStub("jobs"),
    JobsJobDetail: screenStub("jobs-detail"),
  }));
  screens.jobs = (await import("../../app/jobs/index")).default;
  screens["jobs-detail"] = (await import("../../app/jobs/[id]")).default;
  screens.comms = (await import("../../app/comms/index")).default;
  screens["comms-detail"] = (await import("../../app/comms/[id]")).default;
});

beforeEach(() => {
  routeState.loaderData = undefined;
  routeState.params = {};
});

const NAMES = ["jobs", "jobs-detail", "comms", "comms-detail"];
const DETAIL_NAMES = ["jobs-detail", "comms-detail"];

const textOf = (node: {props: {children?: unknown}}): string =>
  [node.props.children].flat().join("");

const renderRoute = (name: string): {id?: string; seed: unknown} => {
  const Screen = screens[name];
  const {getByTestId} = render(<Screen />);
  return JSON.parse(textOf(getByTestId(`screen-${name}`)));
};

describe.each(NAMES)("%s route screen", (name) => {
  it("renders its screen under AdminRpcSeed with the loader's rpc bodies", () => {
    routeState.loaderData = {rpc: {"/some/url": {ok: true}}};
    expect(renderRoute(name).seed).toEqual({"/some/url": {ok: true}});
  });

  it("seeds an empty object when the page has no loader data (client navigation)", () => {
    expect(renderRoute(name).seed).toEqual({});
  });
});

describe.each(DETAIL_NAMES)("%s route screen record lookup", (name) => {
  it("passes the id route param to its screen", () => {
    routeState.params = {id: "x1"};
    expect(renderRoute(name).id).toBe("x1");
  });

  it("shows the not-found state, not the screen, when the loader reports notFound", () => {
    routeState.params = {id: "gone"};
    routeState.loaderData = {notFound: true, rpc: {}};
    const Screen = screens[name];
    const view = render(<Screen />);
    expect(view.getByTestId("admin-screen-not-found")).toBeTruthy();
    expect(view.queryByTestId(`screen-${name}`)).toBeNull();
  });

  it("shows the screen, not the not-found state, when the record loaded", () => {
    routeState.params = {id: "x1"};
    routeState.loaderData = {rpc: {}};
    const Screen = screens[name];
    const view = render(<Screen />);
    expect(view.queryByTestId("admin-screen-not-found")).toBeNull();
    expect(view.getByTestId(`screen-${name}`)).toBeTruthy();
  });
});
