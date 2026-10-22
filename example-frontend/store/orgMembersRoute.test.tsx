import {afterAll, beforeAll, beforeEach, describe, it, mock} from "bun:test";
import {assert} from "chai";
import {useLocalSearchParams} from "expo-router";
import React from "react";
import {act, create} from "react-test-renderer";

const capturedMembersProps: {
  current?: {api?: unknown; organizationId?: string; routeBase?: string};
} = {};
const searchParamsState: {orgId?: string} = {orgId: "org-42"};

// Spread the real module: Bun's mock.module is process-global, and sibling suites
// (documents) import other admin-frontend exports.
const actualAdminFrontend = await import("@terreno/admin-frontend");
mock.module("@terreno/admin-frontend", () => ({
  ...actualAdminFrontend,
  OrgMembersScreen: (props: {api?: unknown; organizationId?: string; routeBase?: string}) => {
    capturedMembersProps.current = props;
    return null;
  },
}));
// Drive the preload's expo-router mock instead of replacing the module: Bun's
// mock.module is process-global and sibling suites rely on the shared mock functions.
const searchParamsMock = useLocalSearchParams as unknown as {
  mockImplementation: (impl: () => {orgId?: string}) => void;
};

let OrgMembersRoute: React.FC;

const renderRoute = (): void => {
  act(() => {
    create(<OrgMembersRoute />);
  });
};

describe("OrgMembersRoute", () => {
  afterAll(() => {
    searchParamsMock.mockImplementation(() => ({}));
  });

  beforeAll(async () => {
    ({default: OrgMembersRoute} = await import("../app/admin/orgs/[orgId]/members"));
  });

  beforeEach(() => {
    searchParamsMock.mockImplementation(() => searchParamsState);
    searchParamsState.orgId = "org-42";
    capturedMembersProps.current = undefined;
  });

  it("reads orgId from expo-router search params", () => {
    searchParamsState.orgId = "org-acme-99";

    renderRoute();

    assert.equal(capturedMembersProps.current?.organizationId, "org-acme-99");
  });

  it("wires OrgMembersScreen with organizationId and routeBase and no api prop", () => {
    renderRoute();

    assert.isUndefined(capturedMembersProps.current?.api);
    assert.equal(capturedMembersProps.current?.organizationId, "org-42");
    assert.equal(capturedMembersProps.current?.routeBase, "/admin");
  });
});
