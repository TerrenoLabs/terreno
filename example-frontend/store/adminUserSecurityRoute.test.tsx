import {afterEach, describe, it} from "bun:test";
import {configureStore} from "@reduxjs/toolkit";
import {AdminScreenPage, UserSecurityScreen} from "@terreno/admin-frontend";
import type {PermissionSet} from "@terreno/rtk";
import {assert} from "chai";
import {useLocalSearchParams} from "expo-router";
import React from "react";
import {Provider} from "react-redux";
import TestRenderer, {act, type ReactTestRenderer} from "react-test-renderer";

import AdminUserSecurityRoute from "../app/admin/users/[id]/security";
import {terrenoApi} from "./sdk";

interface Profile {
  _id: string;
  admin?: boolean;
  permissions?: PermissionSet;
}

// The package preload registers useLocalSearchParams as a mock; this file only swaps its
// implementation and puts the preload's default back afterwards.
const searchParams = useLocalSearchParams as unknown as {
  mockImplementation: (impl: () => Record<string, string>) => void;
};

const renderRoute = ({
  isLoading = false,
  profile,
  userId = "user-7",
}: {
  isLoading?: boolean;
  profile?: Profile;
  userId?: string;
}): ReactTestRenderer => {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = TestRenderer.create(
      <AdminUserSecurityRoute
        dependencies={{
          useProfile: () => ({data: profile, isLoading}),
          useUserId: () => userId,
        }}
      />
    );
  });
  if (!renderer) {
    throw new Error("route did not render");
  }
  return renderer;
};

describe("AdminUserSecurityRoute", () => {
  let mounted: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => {
      mounted?.unmount();
    });
    mounted = undefined;
    searchParams.mockImplementation(() => ({}));
  });

  it("shows the security screen to staff holding user:manageSecurity", () => {
    mounted = renderRoute({
      profile: {_id: "operator-1", permissions: {admin: ["access"], user: ["manageSecurity"]}},
    });

    const screen = mounted.root.findByType(UserSecurityScreen);
    assert.deepEqual(screen.props, {routeBase: "/admin", userId: "user-7", userModelName: "User"});
    assert.lengthOf(mounted.root.findAllByProps({testID: "admin-user-security-forbidden"}), 0);
  });

  it("shows the forbidden page, with a back link to the record and no panel, to other staff", () => {
    mounted = renderRoute({
      profile: {_id: "viewer-1", admin: true, permissions: {admin: ["access"], user: ["read"]}},
    });

    const page = mounted.root.findByType(AdminScreenPage);
    assert.equal(page.props.testID, "admin-user-security-forbidden");
    assert.equal(page.props.backHref, "/admin/User/user-7");
    assert.lengthOf(mounted.root.findAllByType(UserSecurityScreen), 0);
  });

  it("falls back to admin: true when the profile carries no RBAC permissions", () => {
    mounted = renderRoute({profile: {_id: "admin-1", admin: true}});

    assert.equal(mounted.root.findByType(UserSecurityScreen).props.userId, "user-7");
  });

  it("shows a spinner and no screen while the profile loads", () => {
    mounted = renderRoute({isLoading: true});

    assert.isNotEmpty(mounted.root.findAllByProps({testID: "admin-user-security-loading"}));
    assert.lengthOf(mounted.root.findAllByType(UserSecurityScreen), 0);
    assert.lengthOf(mounted.root.findAllByType(AdminScreenPage), 0);
  });

  it("reads the user id from the route and the profile from the me query by default", async () => {
    searchParams.mockImplementation(() => ({id: "user-9"}));
    const store = configureStore({
      middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(terrenoApi.middleware),
      reducer: {[terrenoApi.reducerPath]: terrenoApi.reducer},
    });
    // Seed the me query so the route decides access from it without a backend.
    await store.dispatch(
      terrenoApi.util.upsertQueryData("getMe", undefined, {
        _id: "operator-1",
        permissions: {admin: ["access"], user: ["manageSecurity"]},
      } as never)
    );

    act(() => {
      mounted = TestRenderer.create(
        <Provider store={store}>
          <AdminUserSecurityRoute />
        </Provider>
      );
    });

    assert.equal(mounted?.root.findByType(UserSecurityScreen).props.userId, "user-9");
  });
});
