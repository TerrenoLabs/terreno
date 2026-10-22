import {beforeAll, beforeEach, describe, it, mock} from "bun:test";
import {type ApiClient, createApiClient, type FetchLike} from "@terreno/syncdb/api";
import {ApiClientProvider} from "@terreno/syncdb/react";
import {waitFor} from "@testing-library/react-native";
import {assert} from "chai";
import {useLocalSearchParams} from "expo-router";
import React from "react";
import {Text} from "react-native";
import {renderWithTheme} from "../../ui/src/test-utils";

type MockableUseLocalSearchParams = typeof useLocalSearchParams & {
  mockImplementation?: (impl: typeof useLocalSearchParams) => void;
};

interface AdminSpaAppConfig {
  adminApiBasePath?: string;
  authBasePath?: string;
  brandName: string;
  logoUrl?: string;
  primaryColor: string;
  providers: ReadonlyArray<"email" | "google" | "github" | "apple">;
}

const capturedMembersProps: {
  current?: {api?: unknown; organizationId?: string; routeBase?: string};
} = {};

const registerSharedAdminFrontendMock = ({
  capturedOrgSwitcherProps,
  capturedShellProps,
}: {
  capturedOrgSwitcherProps: {current?: {api?: unknown; routeBase?: string}};
  capturedShellProps: {current?: Record<string, unknown>};
}): void => {
  mock.module("@terreno/admin-frontend", () => ({
    AdminShellLayout: (props: {
      api?: unknown;
      apiBase?: string;
      breadcrumbs?: {href?: string; label: string}[];
      children?: React.ReactNode;
      configurationPath?: string;
      isOrganizationOperator?: boolean;
      organizationDirectoryPath?: string;
      organizationSwitcher?: React.ReactNode;
      rolesPath?: string;
      routeBase?: string;
    }) => {
      capturedShellProps.current = props;
      return (
        <Text testID="admin-shell-layout-mock">
          {props.organizationSwitcher}
          {props.children}
        </Text>
      );
    },
    OrgMembersScreen: (props: {api?: unknown; organizationId?: string; routeBase?: string}) => {
      capturedMembersProps.current = props;
      return <Text testID="org-members-screen-stub" />;
    },
    OrgSwitcher: (props: {api?: unknown; routeBase?: string}) => {
      capturedOrgSwitcherProps.current = props;
      return <Text testID="org-switcher-mock" />;
    },
  }));
};

const registerAdminSpaShellMocks = ({
  appConfigState,
  capturedOrgSwitcherProps,
  capturedShellProps,
}: {
  appConfigState: {appConfig: AdminSpaAppConfig};
  capturedOrgSwitcherProps: {current?: {api?: unknown; routeBase?: string}};
  capturedShellProps: {current?: Record<string, unknown>};
}): void => {
  const shellModuleUrl = new URL("../components/AdminSpaShell.tsx", import.meta.url);
  const appConfigGatePath = new URL("./AppConfigGate.tsx", shellModuleUrl).pathname;

  registerSharedAdminFrontendMock({capturedOrgSwitcherProps, capturedShellProps});
  mock.module(appConfigGatePath, () => ({
    useAppConfig: () => ({
      appConfig: appConfigState.appConfig,
      basePath: "",
    }),
  }));
};

interface FakeProfileServer {
  client: ApiClient;
  requests: {credentials?: RequestCredentials; url: string}[];
}

/** Request client whose `fetch` answers `/auth/me` with `profile` (404 for anything else). */
const createFakeProfileServer = (profile: {roles?: string[]} | undefined): FakeProfileServer => {
  const requests: FakeProfileServer["requests"] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = String(input);
    requests.push({credentials: init?.credentials, url});
    if (url !== "/auth/me") {
      return new Response(JSON.stringify({title: "Not found"}), {status: 404});
    }
    return new Response(JSON.stringify({data: profile ?? {}}), {
      headers: {"Content-Type": "application/json"},
      status: 200,
    });
  };
  return {client: createApiClient({credentials: "same-origin", fetchImpl}), requests};
};

describe("AdminSpaShell", () => {
  const appConfigState: {appConfig: AdminSpaAppConfig} = {
    appConfig: {
      adminApiBasePath: "/admin",
      authBasePath: "/api/auth",
      brandName: "Terreno Admin",
      primaryColor: "#2563EB",
      providers: ["email"],
    },
  };
  const capturedShellProps: {current?: Record<string, unknown>} = {};
  const capturedOrgSwitcherProps: {current?: {api?: unknown; routeBase?: string}} = {};
  const breadcrumbs = [{href: "/", label: "Admin"}, {label: "Members"}];
  let AdminSpaShell: React.FC<{
    breadcrumbs?: {href?: string; label: string}[];
    children: React.ReactNode;
  }>;
  let server: FakeProfileServer;

  const renderShell = (): ReturnType<typeof renderWithTheme> =>
    renderWithTheme(
      <ApiClientProvider client={server.client}>
        <AdminSpaShell breadcrumbs={breadcrumbs}>
          <Text testID="admin-spa-shell-child">Child</Text>
        </AdminSpaShell>
      </ApiClientProvider>
    );

  /** Wait until `/auth/me` has resolved so the shell re-rendered with the profile. */
  const waitForProfile = async (): Promise<void> => {
    await waitFor(() => {
      assert.equal(
        server.client.getQueryState({method: "GET", url: "/auth/me"}).status,
        "fulfilled"
      );
    });
  };

  beforeAll(async () => {
    registerAdminSpaShellMocks({
      appConfigState,
      capturedOrgSwitcherProps,
      capturedShellProps,
    });
    ({AdminSpaShell} = await import("../components/AdminSpaShell"));
  });

  beforeEach(() => {
    appConfigState.appConfig = {
      adminApiBasePath: "/admin",
      authBasePath: "/api/auth",
      brandName: "Terreno Admin",
      primaryColor: "#2563EB",
      providers: ["email"],
    };
    server = createFakeProfileServer(undefined);
    capturedShellProps.current = undefined;
    capturedOrgSwitcherProps.current = undefined;
  });

  it("uses the default /admin api base when app config omits adminApiBasePath", async () => {
    appConfigState.appConfig = {
      ...appConfigState.appConfig,
      adminApiBasePath: undefined,
    };

    renderShell();
    await waitForProfile();

    assert.equal(capturedShellProps.current?.apiBase, "/admin");
  });

  it("uses the configured adminApiBasePath from app config", async () => {
    appConfigState.appConfig = {
      ...appConfigState.appConfig,
      adminApiBasePath: "/console/admin",
    };

    renderShell();
    await waitForProfile();

    assert.equal(capturedShellProps.current?.apiBase, "/console/admin");
  });

  it("marks organization operators when profile roles include operator", async () => {
    server = createFakeProfileServer({roles: ["operator"]});

    renderShell();
    await waitForProfile();

    assert.isTrue(capturedShellProps.current?.isOrganizationOperator);
  });

  it("marks organization operators when profile roles include superadmin", async () => {
    server = createFakeProfileServer({roles: ["superadmin"]});

    renderShell();
    await waitForProfile();

    assert.isTrue(capturedShellProps.current?.isOrganizationOperator);
  });

  it("does not mark organization operators for non-operator roles", async () => {
    server = createFakeProfileServer({roles: ["org-admin", "member"]});

    renderShell();
    await waitForProfile();

    assert.isFalse(capturedShellProps.current?.isOrganizationOperator);
  });

  it("does not mark organization operators when profile roles are missing", async () => {
    server = createFakeProfileServer(undefined);

    renderShell();
    await waitForProfile();

    assert.isFalse(capturedShellProps.current?.isOrganizationOperator);
  });

  it("loads the profile from /auth/me with the same-origin session cookie", async () => {
    renderShell();
    await waitForProfile();

    assert.deepEqual(server.requests, [{credentials: "same-origin", url: "/auth/me"}]);
  });

  it("wires AdminShellLayout, OrgSwitcher, breadcrumbs, and children", async () => {
    const {getByTestId} = renderShell();
    await waitForProfile();

    assert.deepEqual(capturedShellProps.current?.breadcrumbs, breadcrumbs);
    assert.isUndefined(capturedShellProps.current?.api);
    assert.equal(capturedShellProps.current?.configurationPath, "/configuration");
    assert.equal(capturedShellProps.current?.organizationDirectoryPath, "/orgs");
    assert.equal(capturedShellProps.current?.rolesPath, "/roles");
    assert.equal(capturedShellProps.current?.routeBase, "");
    assert.isNotNull(getByTestId("admin-shell-layout-mock"));
    assert.isNotNull(getByTestId("admin-spa-shell-child"));
    assert.isUndefined(capturedOrgSwitcherProps.current?.api);
    assert.equal(capturedOrgSwitcherProps.current?.routeBase, "");
  });
});

describe("OrgMembersRoute", () => {
  const searchParamsState: {orgId?: string} = {orgId: "org-42"};
  const capturedRouteShellProps: {
    current?: {breadcrumbs?: {href?: string; label: string}[]; children?: React.ReactNode};
  } = {};
  let OrgMembersRoute: React.FC;

  beforeAll(async () => {
    const membersModuleUrl = new URL("../app/orgs/[orgId]/members.tsx", import.meta.url);
    const adminSpaShellPath = new URL("../../../components/AdminSpaShell.tsx", membersModuleUrl)
      .pathname;

    mock.module(adminSpaShellPath, () => ({
      AdminSpaShell: (props: {
        breadcrumbs?: {href?: string; label: string}[];
        children?: React.ReactNode;
      }) => {
        capturedRouteShellProps.current = props;
        return <Text testID="admin-spa-shell-stub">{props.children}</Text>;
      },
    }));
    ({default: OrgMembersRoute} = await import("../app/orgs/[orgId]/members"));
  });

  beforeEach(() => {
    searchParamsState.orgId = "org-42";
    const useLocalSearchParamsMock = useLocalSearchParams as MockableUseLocalSearchParams;
    useLocalSearchParamsMock.mockImplementation?.(() => searchParamsState);
    capturedRouteShellProps.current = undefined;
    capturedMembersProps.current = undefined;
  });

  it("reads orgId from expo-router search params", () => {
    searchParamsState.orgId = "org-acme-99";

    renderWithTheme(<OrgMembersRoute />);

    assert.equal(capturedMembersProps.current?.organizationId, "org-acme-99");
  });

  it("passes admin breadcrumbs including the organization href", () => {
    searchParamsState.orgId = "org-acme-99";

    renderWithTheme(<OrgMembersRoute />);

    assert.deepEqual(capturedRouteShellProps.current?.breadcrumbs, [
      {href: "/", label: "Admin"},
      {href: "/orgs/org-acme-99", label: "Organization"},
      {label: "Members"},
    ]);
  });

  it("wires OrgMembersScreen with the route base and no api prop", () => {
    renderWithTheme(<OrgMembersRoute />);

    assert.isUndefined(capturedMembersProps.current?.api);
    assert.equal(capturedMembersProps.current?.organizationId, "org-42");
    assert.equal(capturedMembersProps.current?.routeBase, "");
    assert.isNotNull(capturedRouteShellProps.current?.children);
  });
});
