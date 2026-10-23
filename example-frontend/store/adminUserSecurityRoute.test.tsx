import {afterEach, beforeAll, beforeEach, describe, it, mock} from "bun:test";
import {assert} from "chai";
import React from "react";
import {renderToString} from "react-dom/server";

// Bun's mock.module replaces a module for every file in this process. Each stub spreads the
// module it replaces and overrides only what this test needs, and useGetMeQuery falls through
// to the real hook unless a test sets a profile, so sibling suites are unaffected.
const realAdminFrontend = await import("@terreno/admin-frontend");
const preloadExpoRouter = await import("expo-router");
const preloadSdk = await import("@/store/sdk");

interface Captured {
  page?: {backHref?: string; testID?: string};
  screen?: {routeBase?: string; userId?: string; userModelName?: string};
}

interface MeState {
  override?: {
    data?: {_id: string; admin?: boolean; permissions?: Record<string, readonly string[]>};
    isLoading: boolean;
  };
}

const captured: Captured = {};
const meState: MeState = {};
const searchParamsState: {id?: string} = {id: "user-7"};

mock.module("@terreno/admin-frontend", () => ({
  ...realAdminFrontend,
  AdminScreenPage: (props: {backHref?: string; testID?: string}) => {
    captured.page = props;
    return null;
  },
  UserSecurityScreen: (props: {routeBase?: string; userId?: string; userModelName?: string}) => {
    captured.screen = props;
    return null;
  },
}));
mock.module("expo-router", () => ({
  ...preloadExpoRouter,
  useLocalSearchParams: () => searchParamsState,
}));
mock.module("@/store/sdk", () => ({
  ...preloadSdk,
  useGetMeQuery: (...args: Parameters<typeof preloadSdk.useGetMeQuery>) =>
    meState.override ?? preloadSdk.useGetMeQuery(...args),
}));

let AdminUserSecurityRoute: React.FC;

describe("AdminUserSecurityRoute", () => {
  beforeAll(async () => {
    ({default: AdminUserSecurityRoute} = await import("../app/admin/users/[id]/security"));
  });

  beforeEach(() => {
    captured.page = undefined;
    captured.screen = undefined;
    searchParamsState.id = "user-7";
  });

  afterEach(() => {
    meState.override = undefined;
  });

  it("shows the security screen to staff holding user:manageSecurity", () => {
    meState.override = {
      data: {_id: "operator-1", permissions: {admin: ["access"], user: ["manageSecurity"]}},
      isLoading: false,
    };

    renderToString(<AdminUserSecurityRoute />);

    assert.deepEqual(captured.screen, {
      routeBase: "/admin",
      userId: "user-7",
      userModelName: "User",
    });
    assert.isUndefined(captured.page);
  });

  it("shows the forbidden page, with a back link to the record and no panel, to other staff", () => {
    meState.override = {
      data: {_id: "viewer-1", admin: true, permissions: {admin: ["access"], user: ["read"]}},
      isLoading: false,
    };

    renderToString(<AdminUserSecurityRoute />);

    assert.equal(captured.page?.testID, "admin-user-security-forbidden");
    assert.equal(captured.page?.backHref, "/admin/User/user-7");
    assert.isUndefined(captured.screen);
  });
});
