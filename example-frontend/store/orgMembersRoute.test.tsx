import {beforeAll, beforeEach, describe, it, mock} from "bun:test";
import {assert} from "chai";
import React from "react";
import {renderToString} from "react-dom/server";

// Bun's mock.module replaces a module for every file in this process, and suites run in
// different orders under coverage. Each stub below spreads the module it replaces and overrides
// only what this test needs, so sibling suites keep every export (documents.test.tsx needs
// generateConsentHistoryPdf, and calls mockImplementation on useLocalSearchParams).
const realAdminFrontend = await import("@terreno/admin-frontend");
const preloadExpoRouter = await import("expo-router");

const capturedMembersProps: {
  current?: {api?: unknown; organizationId?: string; routeBase?: string};
} = {};
const searchParamsState: {orgId?: string} = {orgId: "org-42"};
const useLocalSearchParams = mock((): {orgId?: string} => searchParamsState);

mock.module("@terreno/admin-frontend", () => ({
  ...realAdminFrontend,
  OrgMembersScreen: (props: {api?: unknown; organizationId?: string; routeBase?: string}) => {
    capturedMembersProps.current = props;
    return null;
  },
}));
mock.module("expo-router", () => ({
  ...preloadExpoRouter,
  useLocalSearchParams,
}));

let OrgMembersRoute: React.FC;
let terrenoApi: unknown;

describe("OrgMembersRoute", () => {
  beforeAll(async () => {
    ({default: OrgMembersRoute} = await import("../app/admin/orgs/[orgId]/members"));
    // The real SDK (as the package preload provides it), not a stub that would leak.
    ({terrenoApi} = await import("@/store/sdk"));
  });

  beforeEach(() => {
    searchParamsState.orgId = "org-42";
    useLocalSearchParams.mockImplementation(() => searchParamsState);
    capturedMembersProps.current = undefined;
  });

  it("reads orgId from expo-router search params", () => {
    searchParamsState.orgId = "org-acme-99";

    renderToString(<OrgMembersRoute />);

    assert.equal(capturedMembersProps.current?.organizationId, "org-acme-99");
  });

  it("wires OrgMembersScreen with terrenoApi, organizationId, and routeBase", () => {
    renderToString(<OrgMembersRoute />);

    assert.equal(capturedMembersProps.current?.api, terrenoApi);
    assert.equal(capturedMembersProps.current?.organizationId, "org-42");
    assert.equal(capturedMembersProps.current?.routeBase, "/admin");
  });
});
