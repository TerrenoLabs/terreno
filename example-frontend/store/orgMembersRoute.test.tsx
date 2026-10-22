import {beforeAll, beforeEach, describe, it, mock} from "bun:test";
import {assert} from "chai";
import React from "react";
import {act, create} from "react-test-renderer";

const capturedMembersProps: {
  current?: {api?: unknown; organizationId?: string; routeBase?: string};
} = {};
const searchParamsState: {orgId?: string} = {orgId: "org-42"};

mock.module("@terreno/admin-frontend", () => ({
  OrgMembersScreen: (props: {api?: unknown; organizationId?: string; routeBase?: string}) => {
    capturedMembersProps.current = props;
    return null;
  },
}));
mock.module("expo-router", () => ({
  useLocalSearchParams: () => searchParamsState,
  // Include useRouter so this incomplete mock does not break sibling suites that
  // import {useRouter} from "expo-router" under Bun's process-global mock.module.
  useRouter: () => ({back: (): void => {}, push: (): void => {}}),
}));

let OrgMembersRoute: React.FC;

const renderRoute = (): void => {
  act(() => {
    create(<OrgMembersRoute />);
  });
};

describe("OrgMembersRoute", () => {
  beforeAll(async () => {
    ({default: OrgMembersRoute} = await import("../app/admin/orgs/[orgId]/members"));
  });

  beforeEach(() => {
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
