import {beforeAll, beforeEach, describe, it, mock} from "bun:test";
import {assert} from "chai";
import React from "react";
import {renderToString} from "react-dom/server";

const capturedMembersProps: {
  current?: {api?: unknown; organizationId?: string; routeBase?: string};
} = {};
const mockTerrenoApi = {reducerPath: "example-frontend-members-test-api"};
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
mock.module("@/store/sdk", () => ({
  terrenoApi: mockTerrenoApi,
  // Sibling suites import named RTK hooks from this module under Bun's
  // process-global mock.module; keep stubs so those exports stay resolvable.
  usePostNotificationsDevNotifyMutation: () => [async (): Promise<void> => {}, {isLoading: false}],
}));

let OrgMembersRoute: React.FC;

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

    renderToString(<OrgMembersRoute />);

    assert.equal(capturedMembersProps.current?.organizationId, "org-acme-99");
  });

  it("wires OrgMembersScreen with organizationId and routeBase and no RTK api", () => {
    renderToString(<OrgMembersRoute />);

    assert.isUndefined(capturedMembersProps.current?.api);
    assert.equal(capturedMembersProps.current?.organizationId, "org-42");
    assert.equal(capturedMembersProps.current?.routeBase, "/admin");
  });
});
