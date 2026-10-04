// noExplicitAny: test harness doubles
// biome-ignore-all lint/suspicious/noExplicitAny: test harness doubles
import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import type {ScaledSize} from "react-native";
import {Text, useWindowDimensions} from "react-native";
import {SafeAreaView} from "react-native-safe-area-context";
import type {ReactTestInstance} from "react-test-renderer";
import {renderWithTheme} from "../../ui/src/test-utils";
import type {AdminApi, AdminConfigResponse, AdminModelConfig} from "./types";

const mockRouterPush = mock((_href: string) => {});

mock.module("expo-router", () => ({
  router: {push: mockRouterPush},
}));

const configState: {
  config: AdminConfigResponse | null;
  error: Error | null;
  isLoading: boolean;
} = {
  config: null,
  error: null,
  isLoading: false,
};

mock.module("./useAdminConfig", () => ({
  useAdminConfig: () => ({
    config: configState.config,
    error: configState.error,
    isLoading: configState.isLoading,
  }),
}));

import {AdminShell} from "./AdminShell";

type WindowDimensionsImpl = () => ScaledSize;
type MockableUseWindowDimensions = WindowDimensionsImpl & {
  mockImplementation?: (impl: WindowDimensionsImpl) => void;
};

const getScaledSize =
  (width: number): WindowDimensionsImpl =>
  (): ScaledSize => ({
    fontScale: 1,
    height: 1000,
    scale: 2,
    width,
  });

const setWindowWidth = (width: number): (() => void) => {
  const useWindowDimensionsMock = useWindowDimensions as MockableUseWindowDimensions;
  const dimensionsImpl = getScaledSize(width);

  if (typeof useWindowDimensionsMock.mockImplementation === "function") {
    useWindowDimensionsMock.mockImplementation(dimensionsImpl);

    return (): void => {
      useWindowDimensionsMock.mockImplementation(getScaledSize(375));
    };
  }

  return (): void => {};
};

const buildConfig = (): AdminConfigResponse => ({
  customScreens: [],
  models: [
    {
      defaultSort: "-created",
      displayName: "Todos",
      fields: {title: {required: true, type: "string"}},
      listFields: ["title"],
      name: "Todo",
      routePath: "/admin/todos",
    },
  ],
  scripts: [{description: "Seed", name: "seed"}],
});

const platformModel = ({
  displayName,
  name,
  routePath,
}: Pick<AdminModelConfig, "displayName" | "name" | "routePath">): AdminModelConfig => ({
  defaultSort: "-created",
  displayName,
  fields: {name: {required: true, type: "string"}},
  group: "Platform",
  listFields: ["name"],
  name,
  routePath,
});

const mockApi = {} as unknown as AdminApi;

describe("AdminShell", () => {
  let restoreWindowWidth: (() => void) | undefined;

  beforeEach(() => {
    configState.config = buildConfig();
    configState.error = null;
    configState.isLoading = false;
    mockRouterPush.mockClear();
    restoreWindowWidth = setWindowWidth(375);
  });

  afterEach(() => {
    restoreWindowWidth?.();
    restoreWindowWidth = undefined;
  });

  it("shows the fixed sidebar on desktop widths", () => {
    restoreWindowWidth?.();
    restoreWindowWidth = setWindowWidth(1024);

    const {getByTestId, queryByTestId} = renderWithTheme(
      <AdminShell api={mockApi} apiBase="/admin" routeBase="/admin">
        <React.Fragment />
      </AdminShell>
    );

    expect(getByTestId("admin-shell-sidebar")).toBeTruthy();
    expect(queryByTestId("admin-shell-menu-button")).toBeNull();
    expect(queryByTestId("admin-shell-mobile-header")).toBeNull();
  });

  it("shows organization directory navigation only to operators", () => {
    restoreWindowWidth?.();
    restoreWindowWidth = setWindowWidth(1024);
    const operator = renderWithTheme(
      <AdminShell
        api={mockApi}
        apiBase="/admin"
        isOrganizationOperator
        organizationDirectoryPath="/orgs"
        routeBase="/admin"
      >
        <React.Fragment />
      </AdminShell>
    );
    expect(operator.getByTestId("admin-shell-nav-organizations-clickable")).toBeTruthy();
    operator.unmount();

    const orgAdmin = renderWithTheme(
      <AdminShell
        api={mockApi}
        apiBase="/admin"
        isOrganizationOperator={false}
        organizationDirectoryPath="/orgs"
        routeBase="/admin"
      >
        <React.Fragment />
      </AdminShell>
    );
    expect(orgAdmin.queryByTestId("admin-shell-nav-organizations-clickable")).toBeNull();
  });

  it("shows a forbidden state when admin config returns 403", () => {
    configState.config = null;
    configState.error = {status: 403} as unknown as Error;
    restoreWindowWidth?.();
    restoreWindowWidth = setWindowWidth(1024);

    const {getByTestId, queryByTestId} = renderWithTheme(
      <AdminShell api={mockApi} apiBase="/admin" routeBase="/admin">
        <React.Fragment />
      </AdminShell>
    );

    expect(getByTestId("admin-shell-forbidden")).toBeTruthy();
    expect(queryByTestId("admin-shell-error")).toBeNull();
    expect(queryByTestId("admin-shell-sidebar")).toBeNull();
  });

  it("shows loading and generic error states", () => {
    configState.isLoading = true;
    let rendered = renderWithTheme(
      <AdminShell api={mockApi} apiBase="/admin" routeBase="/admin">
        <React.Fragment />
      </AdminShell>
    );
    expect(rendered.getByTestId("admin-shell-loading")).toBeTruthy();
    rendered.unmount();

    configState.isLoading = false;
    configState.config = null;
    configState.error = new Error("network");
    rendered = renderWithTheme(
      <AdminShell api={mockApi} apiBase="/admin" routeBase="/admin">
        <React.Fragment />
      </AdminShell>
    );
    expect(rendered.getByTestId("admin-shell-error")).toBeTruthy();
  });

  it("hides the fixed sidebar and shows a hamburger header below 768px", () => {
    const {getByTestId, getByLabelText, queryByTestId, UNSAFE_root} = renderWithTheme(
      <AdminShell api={mockApi} apiBase="/admin" routeBase="/admin">
        <React.Fragment />
      </AdminShell>
    );

    expect(queryByTestId("admin-shell-sidebar")).toBeNull();
    expect(getByTestId("admin-shell-mobile-header")).toBeTruthy();
    expect(getByTestId("admin-shell-menu-button-clickable")).toBeTruthy();
    expect(getByLabelText("Open navigation menu")).toBeTruthy();
    expect(UNSAFE_root.findAllByType(SafeAreaView)).toHaveLength(1);
  });

  it("opens and closes the navigation drawer from the hamburger menu", async () => {
    const {getByTestId, getByLabelText, queryByTestId} = renderWithTheme(
      <AdminShell api={mockApi} apiBase="/admin" routeBase="/admin">
        <React.Fragment />
      </AdminShell>
    );

    expect(queryByTestId("admin-shell-drawer")).toBeNull();

    await act(async () => {
      fireEvent.press(getByTestId("admin-shell-menu-button-clickable"));
    });

    expect(getByTestId("admin-shell-drawer")).toBeTruthy();
    expect(getByTestId("admin-shell-drawer-backdrop-clickable")).toBeTruthy();
    expect(getByLabelText("Close navigation menu")).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByTestId("admin-shell-drawer-close-clickable"));
    });

    expect(queryByTestId("admin-shell-drawer")).toBeNull();
  });

  it("closes the drawer when the backdrop is pressed", async () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <AdminShell api={mockApi} apiBase="/admin" routeBase="/admin">
        <React.Fragment />
      </AdminShell>
    );

    await act(async () => {
      fireEvent.press(getByTestId("admin-shell-menu-button-clickable"));
    });
    expect(getByTestId("admin-shell-drawer")).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByTestId("admin-shell-drawer-backdrop-clickable"));
    });

    expect(queryByTestId("admin-shell-drawer")).toBeNull();
  });

  it("closes the drawer after selecting a navigation item", async () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <AdminShell api={mockApi} apiBase="/admin" routeBase="/admin">
        <React.Fragment />
      </AdminShell>
    );

    await act(async () => {
      fireEvent.press(getByTestId("admin-shell-menu-button-clickable"));
    });
    expect(getByTestId("admin-shell-drawer")).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByTestId("admin-shell-nav-home-clickable"));
    });

    expect(mockRouterPush).toHaveBeenCalled();
    expect(queryByTestId("admin-shell-drawer")).toBeNull();
  });

  it("renders the ordered Platform block last and removes its models from Models", async () => {
    restoreWindowWidth?.();
    restoreWindowWidth = setWindowWidth(1024);
    configState.config = {
      ...buildConfig(),
      models: [
        ...buildConfig().models,
        platformModel({
          displayName: "Audit Logs",
          name: "AdminAuditLog",
          routePath: "/admin/audit-logs",
        }),
        platformModel({
          displayName: "Feature Flags",
          name: "FeatureFlag",
          routePath: "/admin/feature-flags",
        }),
      ],
    };

    const {getByTestId, queryByTestId, queryByText} = renderWithTheme(
      <AdminShell
        api={mockApi}
        apiBase="/admin"
        configurationPath="/admin/configuration"
        rolesPath="/roles"
        routeBase="/admin"
      >
        <React.Fragment />
      </AdminShell>
    );

    const platform = getByTestId("admin-shell-nav-platform");
    const platformLinkTestIDs = platform
      .findAll((node: ReactTestInstance) => typeof node.props.testID === "string")
      .map((node: ReactTestInstance) => node.props.testID)
      .filter((testID: string) => testID.startsWith("admin-shell-nav-"))
      .filter((testID: string) => !testID.endsWith("-clickable"))
      .filter((testID: string, index: number, testIDs: string[]) => {
        return testIDs.indexOf(testID) === index;
      });
    expect(platformLinkTestIDs).toEqual([
      "admin-shell-nav-platform",
      "admin-shell-nav-scripts",
      "admin-shell-nav-roles",
      "admin-shell-nav-version",
      "admin-shell-nav-audit-log",
      "admin-shell-nav-feature-flags",
      "admin-shell-nav-configuration",
    ]);
    expect(queryByText("Tools")).toBeNull();
    expect(queryByTestId("admin-shell-nav-model-AdminAuditLog")).toBeNull();
    expect(queryByTestId("admin-shell-nav-model-FeatureFlag")).toBeNull();

    await act(async () => {
      fireEvent.press(getByTestId("admin-shell-nav-audit-log-clickable"));
    });
    expect(mockRouterPush).toHaveBeenLastCalledWith("/admin/AdminAuditLog");
  });

  it("lifts AuditEvent into Platform Audit Log", async () => {
    restoreWindowWidth?.();
    restoreWindowWidth = setWindowWidth(1024);
    configState.config = {
      ...buildConfig(),
      models: [
        ...buildConfig().models,
        platformModel({
          displayName: "Audit Log",
          name: "AuditEvent",
          routePath: "/admin/audit-events",
        }),
      ],
    };

    const {getByTestId, queryByTestId} = renderWithTheme(
      <AdminShell
        api={mockApi}
        apiBase="/admin"
        configurationPath="/admin/configuration"
        rolesPath="/admin/roles"
        routeBase="/admin"
      >
        <React.Fragment />
      </AdminShell>
    );

    assert.isNotNull(getByTestId("admin-shell-nav-audit-log-clickable"));
    expect(queryByTestId("admin-shell-nav-model-AuditEvent")).toBeNull();
    await act(async () => {
      fireEvent.press(getByTestId("admin-shell-nav-audit-log-clickable"));
    });
    expect(mockRouterPush).toHaveBeenLastCalledWith("/admin/AuditEvent");
  });

  it("shows Migrations in Platform when config.migrations.enabled", async () => {
    restoreWindowWidth?.();
    restoreWindowWidth = setWindowWidth(1024);
    configState.config = {
      ...buildConfig(),
      migrations: {enabled: true},
    };

    const {getByTestId} = renderWithTheme(
      <AdminShell
        api={mockApi}
        apiBase="/admin"
        configurationPath="/admin/configuration"
        rolesPath="/admin/roles"
        routeBase="/admin"
      >
        <React.Fragment />
      </AdminShell>
    );

    await act(async () => {
      fireEvent.press(getByTestId("admin-shell-nav-migrations-clickable"));
    });
    expect(mockRouterPush).toHaveBeenLastCalledWith("/admin/__migrations");
  });

  it("hides Migrations when config.migrations.enabled is omitted", () => {
    restoreWindowWidth?.();
    restoreWindowWidth = setWindowWidth(1024);
    configState.config = buildConfig();

    const {queryByTestId} = renderWithTheme(
      <AdminShell
        api={mockApi}
        apiBase="/admin"
        configurationPath="/admin/configuration"
        rolesPath="/admin/roles"
        routeBase="/admin"
      >
        <React.Fragment />
      </AdminShell>
    );

    expect(queryByTestId("admin-shell-nav-migrations")).toBeNull();
  });

  it("renders top chrome and navigates every desktop sidebar section", async () => {
    restoreWindowWidth?.();
    restoreWindowWidth = setWindowWidth(1024);
    configState.config = {
      ...buildConfig(),
      customScreens: [{displayName: "Reports", name: "reports"}],
    };
    const {getByTestId} = renderWithTheme(
      <AdminShell
        api={mockApi}
        apiBase="/admin"
        breadcrumbs={[{href: "/admin", label: "Home"}, {label: "Todos"}]}
        configurationPath="/configuration"
        footer={<React.Fragment>Signed in</React.Fragment>}
        headerActions={<React.Fragment>New item</React.Fragment>}
        rolesPath="/roles"
        routeBase="/console/"
        sidebarVariant="clinical"
        versionConfigPath="/version"
      >
        <React.Fragment>Content</React.Fragment>
      </AdminShell>
    );

    expect(getByTestId("admin-shell-top-bar")).toBeTruthy();
    for (const testID of [
      "admin-shell-nav-model-Todo-clickable",
      "admin-shell-nav-screen-reports-clickable",
      "admin-shell-nav-scripts-clickable",
      "admin-shell-nav-roles-clickable",
      "admin-shell-nav-version-clickable",
      "admin-shell-nav-configuration-clickable",
    ]) {
      await act(async () => {
        fireEvent.press(getByTestId(testID));
      });
    }

    expect(mockRouterPush.mock.calls.map((call) => call[0])).toEqual([
      "/console/Todo",
      "/console/reports",
      "/console/__scripts",
      "/console/roles",
      "/console/version",
      "/configuration",
    ]);
  });

  it("hides built-in platform tools denied by backend RBAC metadata", () => {
    restoreWindowWidth?.();
    restoreWindowWidth = setWindowWidth(1024);
    configState.config = {
      ...buildConfig(),
      platformTools: {
        configuration: false,
        roles: false,
        scripts: false,
        version: false,
      },
    };

    const {queryByTestId} = renderWithTheme(
      <AdminShell
        api={mockApi}
        apiBase="/admin"
        configurationPath="/admin/configuration"
        customScreens={[{displayName: "Denied local screen", name: "denied"}]}
        rolesPath="/roles"
        routeBase="/admin"
      >
        <React.Fragment />
      </AdminShell>
    );

    assert.isNull(queryByTestId("admin-shell-nav-scripts"));
    assert.isNull(queryByTestId("admin-shell-nav-roles"));
    assert.isNull(queryByTestId("admin-shell-nav-version"));
    assert.isNull(queryByTestId("admin-shell-nav-configuration"));
    assert.isNull(queryByTestId("admin-shell-nav-screen-denied"));
  });

  it("shows only the platform tools and models granted to the current role", () => {
    restoreWindowWidth?.();
    restoreWindowWidth = setWindowWidth(1024);
    configState.config = {
      ...buildConfig(),
      models: [
        {
          ...buildConfig().models[0],
          permissions: {create: false, delete: false, update: false},
        },
      ],
      platformTools: {
        configuration: false,
        roles: true,
        scripts: false,
        version: false,
      },
    };

    const {getByTestId, queryByTestId} = renderWithTheme(
      <AdminShell
        api={mockApi}
        apiBase="/admin"
        configurationPath="/admin/configuration"
        rolesPath="/roles"
        routeBase="/admin"
      >
        <React.Fragment />
      </AdminShell>
    );

    assert.isNotNull(getByTestId("admin-shell-nav-model-Todo-clickable"));
    assert.isNotNull(getByTestId("admin-shell-nav-roles-clickable"));
    assert.isNull(queryByTestId("admin-shell-nav-scripts"));
    assert.isNull(queryByTestId("admin-shell-nav-version"));
    assert.isNull(queryByTestId("admin-shell-nav-configuration"));
  });

  it("hides empty Models and Screens headings", () => {
    restoreWindowWidth?.();
    restoreWindowWidth = setWindowWidth(1024);
    configState.config = {
      customScreens: [],
      models: [
        platformModel({
          displayName: "Audit Logs",
          name: "AdminAuditLog",
          routePath: "/admin/audit-logs",
        }),
        platformModel({
          displayName: "Feature Flags",
          name: "FeatureFlag",
          routePath: "/admin/feature-flags",
        }),
      ],
      scripts: [],
    };

    const {getByText, queryByText} = renderWithTheme(
      <AdminShell api={mockApi} apiBase="/admin" routeBase="/admin">
        <React.Fragment />
      </AdminShell>
    );

    expect(queryByText("Models")).toBeNull();
    expect(queryByText("Screens")).toBeNull();
    expect(queryByText("Tools")).toBeNull();
    expect(getByText("Platform")).toBeTruthy();
  });

  it("lifts the jobs custom screen into Platform and keeps other screens", async () => {
    restoreWindowWidth?.();
    restoreWindowWidth = setWindowWidth(1024);
    configState.config = {
      ...buildConfig(),
      customScreens: [
        {displayName: "Comms", name: "comms"},
        {displayName: "Jobs", name: "jobs"},
      ],
      scripts: [],
    };

    const {getByTestId, queryByTestId, queryByText} = renderWithTheme(
      <AdminShell api={mockApi} apiBase="/admin" routeBase="/admin">
        <React.Fragment />
      </AdminShell>
    );

    assert.isNotNull(getByTestId("admin-shell-nav-jobs-clickable"));
    assert.isNotNull(getByTestId("admin-shell-nav-screen-comms-clickable"));
    assert.isNull(queryByTestId("admin-shell-nav-screen-jobs"));
    assert.isNotNull(queryByText("Screens"));

    await act(async () => {
      fireEvent.press(getByTestId("admin-shell-nav-jobs-clickable"));
    });
    expect(mockRouterPush).toHaveBeenLastCalledWith("/admin/jobs");
  });

  it("shows a loading spinner while admin config is loading", () => {
    configState.config = null;
    configState.error = null;
    configState.isLoading = true;

    const {getByTestId, queryByTestId} = renderWithTheme(
      <AdminShell api={mockApi} apiBase="/admin" routeBase="/admin">
        <React.Fragment />
      </AdminShell>
    );

    assert.isNotNull(getByTestId("admin-shell-loading"));
    assert.isNull(queryByTestId("admin-shell"));
    assert.isNull(queryByTestId("admin-shell-error"));
  });

  it("shows a generic error when admin config fails without a 403", () => {
    configState.config = null;
    configState.error = new Error("network");
    configState.isLoading = false;

    const {getByTestId, queryByTestId} = renderWithTheme(
      <AdminShell api={mockApi} apiBase="/admin" routeBase="/admin">
        <React.Fragment />
      </AdminShell>
    );

    assert.isNotNull(getByTestId("admin-shell-error"));
    assert.isNull(queryByTestId("admin-shell-forbidden"));
    assert.isNull(queryByTestId("admin-shell-sidebar"));
  });

  it("renders children in the main column", () => {
    restoreWindowWidth?.();
    restoreWindowWidth = setWindowWidth(1024);

    const {getByTestId} = renderWithTheme(
      <AdminShell api={mockApi} apiBase="/admin" routeBase="/admin">
        <Text testID="admin-shell-child">Child content</Text>
      </AdminShell>
    );

    assert.isNotNull(getByTestId("admin-shell-child"));
    assert.isNotNull(getByTestId("admin-shell-main"));
  });

  it("renders the sidebar footer when provided", () => {
    restoreWindowWidth?.();
    restoreWindowWidth = setWindowWidth(1024);

    const {getByTestId} = renderWithTheme(
      <AdminShell
        api={mockApi}
        apiBase="/admin"
        footer={<Text testID="admin-shell-footer">Signed in</Text>}
        routeBase="/admin"
      >
        <React.Fragment />
      </AdminShell>
    );

    assert.isNotNull(getByTestId("admin-shell-footer"));
  });

  it("renders the clinical sidebar variant on desktop", () => {
    restoreWindowWidth?.();
    restoreWindowWidth = setWindowWidth(1024);

    const {getByTestId} = renderWithTheme(
      <AdminShell api={mockApi} apiBase="/admin" routeBase="/admin" sidebarVariant="clinical">
        <React.Fragment />
      </AdminShell>
    );

    assert.isNotNull(getByTestId("admin-shell-sidebar"));
    assert.isNotNull(getByTestId("admin-shell-nav-home-clickable"));
  });

  it("shows the top bar with breadcrumbs and header actions", () => {
    restoreWindowWidth?.();
    restoreWindowWidth = setWindowWidth(1024);

    const {getByTestId} = renderWithTheme(
      <AdminShell
        api={mockApi}
        apiBase="/admin"
        breadcrumbs={[{href: "/admin", label: "Admin"}, {label: "Todos"}]}
        headerActions={<Text testID="admin-shell-header-action">Create</Text>}
        routeBase="/admin"
      >
        <React.Fragment />
      </AdminShell>
    );

    assert.isNotNull(getByTestId("admin-shell-top-bar"));
    assert.isNotNull(getByTestId("admin-breadcrumbs"));
    assert.isNotNull(getByTestId("admin-shell-header-action"));
  });

  it("shows the top bar when only header actions are provided", () => {
    restoreWindowWidth?.();
    restoreWindowWidth = setWindowWidth(1024);

    const {getByTestId, queryByTestId} = renderWithTheme(
      <AdminShell
        api={mockApi}
        apiBase="/admin"
        headerActions={<Text testID="admin-shell-header-only">Save</Text>}
        routeBase="/admin"
      >
        <React.Fragment />
      </AdminShell>
    );

    assert.isNotNull(getByTestId("admin-shell-top-bar"));
    assert.isNotNull(getByTestId("admin-shell-header-only"));
    assert.isNull(queryByTestId("admin-breadcrumbs"));
  });

  it("navigates from sidebar model and platform links on desktop", async () => {
    restoreWindowWidth?.();
    restoreWindowWidth = setWindowWidth(1024);
    configState.config = {
      ...buildConfig(),
      customScreens: [{displayName: "Reports", name: "reports"}],
      platformTools: {
        configuration: true,
        roles: true,
        scripts: true,
        version: true,
      },
    };

    const {getByTestId} = renderWithTheme(
      <AdminShell
        api={mockApi}
        apiBase="/admin"
        configurationPath="/admin/configuration"
        rolesPath="/roles"
        routeBase="/admin/"
        versionConfigPath="/version-config"
      >
        <React.Fragment />
      </AdminShell>
    );

    await act(async () => {
      fireEvent.press(getByTestId("admin-shell-nav-model-Todo-clickable"));
    });
    assert.equal(mockRouterPush.mock.calls.at(-1)?.[0], "/admin/Todo");

    await act(async () => {
      fireEvent.press(getByTestId("admin-shell-nav-screen-reports-clickable"));
    });
    assert.equal(mockRouterPush.mock.calls.at(-1)?.[0], "/admin/reports");

    await act(async () => {
      fireEvent.press(getByTestId("admin-shell-nav-scripts-clickable"));
    });
    assert.equal(mockRouterPush.mock.calls.at(-1)?.[0], "/admin/__scripts");

    await act(async () => {
      fireEvent.press(getByTestId("admin-shell-nav-roles-clickable"));
    });
    assert.equal(mockRouterPush.mock.calls.at(-1)?.[0], "/admin/roles");

    await act(async () => {
      fireEvent.press(getByTestId("admin-shell-nav-version-clickable"));
    });
    assert.equal(mockRouterPush.mock.calls.at(-1)?.[0], "/admin/version-config");

    await act(async () => {
      fireEvent.press(getByTestId("admin-shell-nav-configuration-clickable"));
    });
    assert.equal(mockRouterPush.mock.calls.at(-1)?.[0], "/admin/configuration");
  });

  it("merges prop custom screens when backend config omits platformTools metadata", () => {
    restoreWindowWidth?.();
    restoreWindowWidth = setWindowWidth(1024);
    configState.config = {
      ...buildConfig(),
      customScreens: [{displayName: "Backend screen", name: "backend-screen"}],
      scripts: [],
    };

    const {getByTestId} = renderWithTheme(
      <AdminShell
        api={mockApi}
        apiBase="/admin"
        customScreens={[{displayName: "Local screen", name: "local-screen"}]}
        routeBase="/admin"
      >
        <React.Fragment />
      </AdminShell>
    );

    assert.isNotNull(getByTestId("admin-shell-nav-screen-backend-screen-clickable"));
    assert.isNotNull(getByTestId("admin-shell-nav-screen-local-screen-clickable"));
    assert.isNotNull(getByTestId("admin-shell-nav-screens"));
  });

  it("uses only backend custom screens when platformTools metadata is present", () => {
    restoreWindowWidth?.();
    restoreWindowWidth = setWindowWidth(1024);
    configState.config = {
      ...buildConfig(),
      customScreens: [{displayName: "Backend screen", name: "backend-screen"}],
      platformTools: {
        configuration: false,
        roles: false,
        scripts: false,
        version: false,
      },
    };

    const {getByTestId, queryByTestId} = renderWithTheme(
      <AdminShell
        api={mockApi}
        apiBase="/admin"
        customScreens={[{displayName: "Local screen", name: "local-screen"}]}
        routeBase="/admin"
      >
        <React.Fragment />
      </AdminShell>
    );

    assert.isNotNull(getByTestId("admin-shell-nav-screen-backend-screen-clickable"));
    assert.isNull(queryByTestId("admin-shell-nav-screen-local-screen"));
  });

  it("routes audit-log and feature-flag models through platform links by route and display name", async () => {
    restoreWindowWidth?.();
    restoreWindowWidth = setWindowWidth(1024);
    configState.config = {
      customScreens: [],
      models: [
        {
          defaultSort: "-created",
          displayName: "Feature Flags",
          fields: {name: {required: true, type: "string"}},
          listFields: ["name"],
          name: "Flags",
          routePath: "/admin/flags",
        },
        {
          defaultSort: "-created",
          displayName: "Audit Trail",
          fields: {action: {required: true, type: "string"}},
          listFields: ["action"],
          name: "Trail",
          routePath: "/admin/audit-log",
        },
      ],
      platformTools: {
        configuration: false,
        roles: false,
        scripts: false,
        version: false,
      },
      scripts: [],
    };

    const {getByTestId} = renderWithTheme(
      <AdminShell api={mockApi} apiBase="/admin" routeBase="/admin">
        <React.Fragment />
      </AdminShell>
    );

    await act(async () => {
      fireEvent.press(getByTestId("admin-shell-nav-feature-flags-clickable"));
    });
    assert.equal(mockRouterPush.mock.calls.at(-1)?.[0], "/admin/Flags");

    await act(async () => {
      fireEvent.press(getByTestId("admin-shell-nav-audit-log-clickable"));
    });
    assert.equal(mockRouterPush.mock.calls.at(-1)?.[0], "/admin/Trail");
  });

  it("renders grouped custom screens inside matching model groups before model links", () => {
    restoreWindowWidth?.();
    restoreWindowWidth = setWindowWidth(1024);
    configState.config = {
      ...buildConfig(),
      customScreens: [
        {displayName: "Overview", group: "Work", name: "announcements"},
        {displayName: "Ungrouped", name: "ungrouped"},
      ],
      models: [
        {
          ...buildConfig().models[0],
          group: "Work",
        },
      ],
      platformTools: {
        configuration: false,
        roles: false,
        scripts: false,
        version: false,
      },
      scripts: [],
    };

    const {getByTestId} = renderWithTheme(
      <AdminShell api={mockApi} apiBase="/admin" routeBase="/admin">
        <React.Fragment />
      </AdminShell>
    );

    assert.isNotNull(getByTestId("admin-shell-nav-screen-announcements-clickable"));
    assert.isNotNull(getByTestId("admin-shell-nav-model-Todo-clickable"));
    assert.isNotNull(getByTestId("admin-shell-nav-screen-ungrouped-clickable"));
  });

  it("groups models under their configured sidebar group labels", () => {
    restoreWindowWidth?.();
    restoreWindowWidth = setWindowWidth(1024);
    configState.config = {
      ...buildConfig(),
      models: [
        {
          ...buildConfig().models[0],
          group: "Work",
        },
        {
          defaultSort: "-created",
          displayName: "Users",
          fields: {email: {required: true, type: "string"}},
          group: "Accounts",
          listFields: ["email"],
          name: "User",
          routePath: "/admin/users",
        },
      ],
      platformTools: {
        configuration: false,
        roles: false,
        scripts: false,
        version: false,
      },
      scripts: [],
    };

    const {getByText, getByTestId} = renderWithTheme(
      <AdminShell api={mockApi} apiBase="/admin" routeBase="/admin">
        <React.Fragment />
      </AdminShell>
    );

    assert.isNotNull(getByText("Accounts"));
    assert.isNotNull(getByText("Work"));
    assert.isNotNull(getByTestId("admin-shell-nav-model-User-clickable"));
    assert.isNotNull(getByTestId("admin-shell-nav-model-Todo-clickable"));
  });

  it("renders grouped custom screens separately from ungrouped Screens", () => {
    restoreWindowWidth?.();
    restoreWindowWidth = setWindowWidth(1024);
    configState.config = {
      ...buildConfig(),
      customScreens: [
        {displayName: "AI Requests", name: "ai-requests"},
        {displayName: "Prompts", group: "AI Observability", name: "ai-prompts"},
        {displayName: "Traces", group: "AI Observability", name: "ai-traces"},
        {displayName: "Review queue", group: "AI Observability", name: "ai-review"},
      ],
    };

    const {getByTestId, getByText} = renderWithTheme(
      <AdminShell api={mockApi} apiBase="/admin" routeBase="/admin">
        <React.Fragment />
      </AdminShell>
    );

    expect(getByTestId("admin-shell-nav-group-ai-observability")).toBeTruthy();
    expect(getByText("AI Observability")).toBeTruthy();
    expect(getByTestId("admin-shell-nav-screen-ai-prompts-clickable")).toBeTruthy();
    expect(getByTestId("admin-shell-nav-screen-ai-review-clickable")).toBeTruthy();
    expect(getByTestId("admin-shell-nav-screens")).toBeTruthy();
    expect(getByTestId("admin-shell-nav-screen-ai-requests-clickable")).toBeTruthy();
  });

  it("closes the mobile drawer when the viewport expands to desktop width", async () => {
    const {getByTestId, queryByTestId, rerender} = renderWithTheme(
      <AdminShell api={mockApi} apiBase="/admin" routeBase="/admin">
        <React.Fragment />
      </AdminShell>
    );

    await act(async () => {
      fireEvent.press(getByTestId("admin-shell-menu-button-clickable"));
    });
    assert.isNotNull(getByTestId("admin-shell-drawer"));

    restoreWindowWidth?.();
    restoreWindowWidth = setWindowWidth(1024);

    await act(async () => {
      rerender(
        <AdminShell api={mockApi} apiBase="/admin" routeBase="/admin">
          <React.Fragment />
        </AdminShell>
      );
    });

    assert.isNull(queryByTestId("admin-shell-drawer"));
    assert.isNotNull(getByTestId("admin-shell-sidebar"));
  });
});
