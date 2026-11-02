import {beforeAll, beforeEach, describe, it, mock} from "bun:test";
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
  mockTerrenoApi,
  profileState,
}: {
  appConfigState: {appConfig: AdminSpaAppConfig};
  capturedOrgSwitcherProps: {current?: {api?: unknown; routeBase?: string}};
  capturedShellProps: {current?: Record<string, unknown>};
  mockTerrenoApi: {reducerPath: string};
  profileState: {data?: {roles?: string[]}};
}): void => {
  const shellModuleUrl = new URL("../components/AdminSpaShell.tsx", import.meta.url);
  const appConfigGatePath = new URL("./AppConfigGate.tsx", shellModuleUrl).pathname;
  const sdkPath = new URL("../store/sdk.ts", shellModuleUrl).pathname;

  registerSharedAdminFrontendMock({capturedOrgSwitcherProps, capturedShellProps});
  mock.module(appConfigGatePath, () => ({
    useAppConfig: () => ({
      appConfig: appConfigState.appConfig,
      basePath: "",
    }),
  }));
  mock.module(sdkPath, () => ({
    terrenoApi: mockTerrenoApi,
    useGetAdminSpaProfileQuery: () => ({data: profileState.data}),
  }));
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
  const profileState: {data?: {roles?: string[]}} = {};
  const capturedShellProps: {current?: Record<string, unknown>} = {};
  const capturedOrgSwitcherProps: {current?: {api?: unknown; routeBase?: string}} = {};
  const mockTerrenoApi = {reducerPath: "terreno-admin-spa-test-api"};
  const breadcrumbs = [{href: "/", label: "Admin"}, {label: "Members"}];
  let AdminSpaShell: React.FC<{
    breadcrumbs?: {href?: string; label: string}[];
    children: React.ReactNode;
  }>;

  beforeAll(async () => {
    registerAdminSpaShellMocks({
      appConfigState,
      capturedOrgSwitcherProps,
      capturedShellProps,
      mockTerrenoApi,
      profileState,
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
    profileState.data = undefined;
    capturedShellProps.current = undefined;
    capturedOrgSwitcherProps.current = undefined;
  });

  it("uses the default /admin api base when app config omits adminApiBasePath", () => {
    appConfigState.appConfig = {
      ...appConfigState.appConfig,
      adminApiBasePath: undefined,
    };

    renderWithTheme(
      <AdminSpaShell breadcrumbs={breadcrumbs}>
        <Text testID="admin-spa-shell-child">Child</Text>
      </AdminSpaShell>
    );

    assert.equal(capturedShellProps.current?.apiBase, "/admin");
  });

  it("uses the configured adminApiBasePath from app config", () => {
    appConfigState.appConfig = {
      ...appConfigState.appConfig,
      adminApiBasePath: "/console/admin",
    };

    renderWithTheme(
      <AdminSpaShell breadcrumbs={breadcrumbs}>
        <Text testID="admin-spa-shell-child">Child</Text>
      </AdminSpaShell>
    );

    assert.equal(capturedShellProps.current?.apiBase, "/console/admin");
  });

  it("marks organization operators when profile roles include operator", () => {
    profileState.data = {roles: ["operator"]};

    renderWithTheme(
      <AdminSpaShell breadcrumbs={breadcrumbs}>
        <Text testID="admin-spa-shell-child">Child</Text>
      </AdminSpaShell>
    );

    assert.isTrue(capturedShellProps.current?.isOrganizationOperator);
  });

  it("marks organization operators when profile roles include superadmin", () => {
    profileState.data = {roles: ["superadmin"]};

    renderWithTheme(
      <AdminSpaShell breadcrumbs={breadcrumbs}>
        <Text testID="admin-spa-shell-child">Child</Text>
      </AdminSpaShell>
    );

    assert.isTrue(capturedShellProps.current?.isOrganizationOperator);
  });

  it("does not mark organization operators for non-operator roles", () => {
    profileState.data = {roles: ["org-admin", "member"]};

    renderWithTheme(
      <AdminSpaShell breadcrumbs={breadcrumbs}>
        <Text testID="admin-spa-shell-child">Child</Text>
      </AdminSpaShell>
    );

    assert.isFalse(capturedShellProps.current?.isOrganizationOperator);
  });

  it("does not mark organization operators when profile roles are missing", () => {
    profileState.data = undefined;

    renderWithTheme(
      <AdminSpaShell breadcrumbs={breadcrumbs}>
        <Text testID="admin-spa-shell-child">Child</Text>
      </AdminSpaShell>
    );

    assert.isFalse(capturedShellProps.current?.isOrganizationOperator);
  });

  it("wires AdminShellLayout, OrgSwitcher, breadcrumbs, and children", () => {
    const {getByTestId} = renderWithTheme(
      <AdminSpaShell breadcrumbs={breadcrumbs}>
        <Text testID="admin-spa-shell-child">Child</Text>
      </AdminSpaShell>
    );

    assert.deepEqual(capturedShellProps.current?.breadcrumbs, breadcrumbs);
    assert.equal(capturedShellProps.current?.api, mockTerrenoApi);
    assert.equal(capturedShellProps.current?.configurationPath, "/configuration");
    assert.equal(capturedShellProps.current?.organizationDirectoryPath, "/orgs");
    assert.equal(capturedShellProps.current?.rolesPath, "/roles");
    assert.equal(capturedShellProps.current?.routeBase, "");
    assert.isNotNull(getByTestId("admin-shell-layout-mock"));
    assert.isNotNull(getByTestId("admin-spa-shell-child"));
    assert.equal(capturedOrgSwitcherProps.current?.api, mockTerrenoApi);
    assert.equal(capturedOrgSwitcherProps.current?.routeBase, "");
  });
});

describe("OrgMembersRoute", () => {
  const searchParamsState: {orgId?: string} = {orgId: "org-42"};
  const capturedRouteShellProps: {
    current?: {breadcrumbs?: {href?: string; label: string}[]; children?: React.ReactNode};
  } = {};
  const mockTerrenoApi = {reducerPath: "terreno-admin-spa-members-test-api"};
  let OrgMembersRoute: React.FC;

  beforeAll(async () => {
    const membersModuleUrl = new URL("../app/orgs/[orgId]/members.tsx", import.meta.url);
    const adminSpaShellPath = new URL("../../../components/AdminSpaShell.tsx", membersModuleUrl)
      .pathname;
    const membersSdkPath = new URL("../../../store/sdk.ts", membersModuleUrl).pathname;

    mock.module(adminSpaShellPath, () => ({
      AdminSpaShell: (props: {
        breadcrumbs?: {href?: string; label: string}[];
        children?: React.ReactNode;
      }) => {
        capturedRouteShellProps.current = props;
        return <Text testID="admin-spa-shell-stub">{props.children}</Text>;
      },
    }));
    mock.module(membersSdkPath, () => ({
      terrenoApi: mockTerrenoApi,
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

  it("wires OrgMembersScreen with the SDK api and route base", () => {
    renderWithTheme(<OrgMembersRoute />);

    assert.equal(capturedMembersProps.current?.api, mockTerrenoApi);
    assert.equal(capturedMembersProps.current?.organizationId, "org-42");
    assert.equal(capturedMembersProps.current?.routeBase, "");
    assert.isNotNull(capturedRouteShellProps.current?.children);
  });
});
