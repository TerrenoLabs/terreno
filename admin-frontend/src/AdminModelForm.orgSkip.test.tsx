import {beforeEach, describe, it, mock} from "bun:test";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../ui/src/test-utils";
import {
  configureAdminModelApiDouble,
  resetAdminModelApiDouble,
} from "./testing/useAdminModelApiDouble";
import type {AdminConfigResponse} from "./types";

const routerBack = mock(() => {});
const routerPush = mock(() => {});

mock.module("expo-router", () => ({
  router: {back: routerBack, push: routerPush},
  useNavigation: () => ({setOptions: mock(() => {})}),
}));

const configState: {config: AdminConfigResponse | null; isLoading: boolean} = {
  config: null,
  isLoading: false,
};
mock.module("./useAdminConfig", () => ({
  useAdminConfig: () => ({
    config: configState.config,
    error: null,
    isLoading: configState.isLoading,
  }),
}));

const readSkipCalls: boolean[] = [];

import {AdminModelForm} from "./AdminModelForm";
import {AdminProvider} from "./AdminProvider";

const orgScopedModel = {
  adminBroadcast: false,
  defaultSort: "-created",
  displayName: "Projects",
  fieldOrder: ["name"],
  fields: {
    _id: {required: true, type: "string"},
    name: {required: true, type: "string"},
  },
  listFields: ["name"],
  name: "Project",
  organizationScoped: true,
  routePath: "/admin/projects",
};

describe("AdminModelForm org-scoped read skip", () => {
  beforeEach(() => {
    readSkipCalls.length = 0;
    resetAdminModelApiDouble();
    configureAdminModelApiDouble({
      useReadQuery: (_id: string, opts: {skip?: boolean}) => {
        readSkipCalls.push(Boolean(opts.skip));
        return {data: null, error: null, isLoading: false};
      },
    });
    configState.isLoading = false;
    configState.config = {
      models: [orgScopedModel],
      schemaVersion: 1,
    } as unknown as AdminConfigResponse;
  });

  it("skips edit reads until organization context is selected", () => {
    renderWithTheme(
      <AdminProvider apiBase="/admin" getAuthHeaders={() => ({})}>
        <AdminModelForm apiBase="/admin" itemId="item-1" mode="edit" modelName="Project" />
      </AdminProvider>
    );

    assert.isAtLeast(readSkipCalls.length, 1);
    assert.isTrue(readSkipCalls[readSkipCalls.length - 1]);
  });
});
