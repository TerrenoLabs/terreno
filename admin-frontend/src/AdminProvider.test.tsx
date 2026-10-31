import {beforeEach, describe, expect, it, mock} from "bun:test";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../ui/src/test-utils";
import {
  AdminProvider,
  resetAdminWidgetWarningsForTests,
  useAdminContext,
  useAdminWidgetRegistry,
  useDeprecatedCustomScreensProp,
  useFieldWidget,
  useHomeWidget,
  useScreenWidget,
} from "./AdminProvider";
import type {
  AdminProviderValue,
  AdminWidgetRegistry,
  FieldWidgetComponent,
  HomeWidgetComponent,
  ScreenWidgetComponent,
} from "./types";
import {BUILT_IN_HOME_WIDGETS, mergeWidgetRegistry} from "./widgets/builtInWidgets";

describe("AdminProvider widget registry", () => {
  beforeEach(() => {
    resetAdminWidgetWarningsForTests();
  });

  it("merges user home widgets over built-ins", () => {
    const Custom: HomeWidgetComponent = () => null;
    const merged = mergeWidgetRegistry({
      home: {modelsGrid: Custom},
    });
    expect(merged.home.modelsGrid).toBe(Custom);
    expect(merged.home.scriptRunner).toBe(BUILT_IN_HOME_WIDGETS.scriptRunner);
  });

  it("includes all built-in home widget ids", () => {
    expect(BUILT_IN_HOME_WIDGETS.modelsGrid).toBeDefined();
    expect(BUILT_IN_HOME_WIDGETS.scriptRunner).toBeDefined();
    expect(BUILT_IN_HOME_WIDGETS.recentActivity).toBeDefined();
  });

  it("provides resolved bases and user widget overrides", () => {
    const CustomHome: HomeWidgetComponent = () => null;
    const CustomField: FieldWidgetComponent = () => null;
    const CustomScreen: ScreenWidgetComponent = () => null;
    let context: AdminProviderValue | null = null;
    let registry: AdminWidgetRegistry | null = null;
    const Probe: React.FC = () => {
      context = useAdminContext();
      registry = useAdminWidgetRegistry();
      return null;
    };

    renderWithTheme(
      <AdminProvider
        apiBase="/admin"
        routeBase="/console"
        widgets={{
          fields: {custom: CustomField},
          home: {custom: CustomHome},
          screens: {custom: CustomScreen},
        }}
      >
        <Probe />
      </AdminProvider>
    );

    expect(context).toMatchObject({apiBase: "/admin", routeBase: "/console"});
    expect(registry?.fields.custom).toBe(CustomField);
    expect(registry?.home.custom).toBe(CustomHome);
    expect(registry?.screens.custom).toBe(CustomScreen);
  });

  it("resolves widget hooks with and without a provider", () => {
    const CustomHome: HomeWidgetComponent = () => null;
    const CustomField: FieldWidgetComponent = () => null;
    const CustomScreen: ScreenWidgetComponent = () => null;
    const results: unknown[] = [];
    const Probe: React.FC = () => {
      results.push(
        useFieldWidget(undefined),
        useFieldWidget("custom"),
        useHomeWidget("custom"),
        useScreenWidget("custom"),
        useHomeWidget("missing"),
        useScreenWidget("missing"),
        useFieldWidget("missing")
      );
      return null;
    };

    renderWithTheme(
      <AdminProvider
        baseUrl="/admin"
        widgets={{
          fields: {custom: CustomField},
          home: {custom: CustomHome},
          screens: {custom: CustomScreen},
        }}
      >
        <Probe />
      </AdminProvider>
    );

    expect(results).toEqual([
      undefined,
      CustomField,
      CustomHome,
      CustomScreen,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("warns once per missing widget and for the deprecated customScreens prop", () => {
    const warn = mock(() => {});
    const originalWarn = console.warn;
    console.warn = warn;
    const Probe: React.FC = () => {
      useHomeWidget("missing-home");
      useHomeWidget("missing-home");
      useScreenWidget("missing-screen");
      useFieldWidget(undefined);
      useFieldWidget("missing-field");
      useDeprecatedCustomScreensProp([{name: "legacy"}]);
      return null;
    };

    const {toJSON} = renderWithTheme(
      <AdminProvider baseUrl="/admin">
        <Probe />
      </AdminProvider>
    );
    console.warn = originalWarn;

    // One warning per unique missing widget plus one for the deprecated prop.
    expect(warn.mock.calls.length).toBe(4);
    expect(toJSON()).toBeNull();
  });

  it("exposes host-injected credentials and getAuthHeaders on context", () => {
    const getAuthHeaders = (): HeadersInit => ({Authorization: "Bearer ctx-token"});
    let context: AdminProviderValue | null = null;
    const Probe: React.FC = () => {
      context = useAdminContext();
      return null;
    };

    renderWithTheme(
      <AdminProvider
        apiBase="/admin"
        credentials="same-origin"
        getAuthHeaders={getAuthHeaders}
        routeBase=""
      >
        <Probe />
      </AdminProvider>
    );

    expect(context?.credentials).toBe("same-origin");
    expect(context?.getAuthHeaders).toBe(getAuthHeaders);
    expect(context?.apiOrigin).toBeUndefined();
  });

  it("exposes apiOrigin and binds it onto RPC context", () => {
    let context: AdminProviderValue | null = null;
    const Probe: React.FC = () => {
      context = useAdminContext();
      return null;
    };

    renderWithTheme(
      <AdminProvider
        apiBase="/admin"
        apiOrigin="http://localhost:4000"
        getAuthHeaders={() => ({Authorization: "Bearer ctx-token"})}
        routeBase="/admin"
      >
        <Probe />
      </AdminProvider>
    );

    expect(context?.apiOrigin).toBe("http://localhost:4000");
    expect(context?.adminRpc).toBeDefined();
  });

  it("exposes host-injected syncDb on context", () => {
    const syncDb = {
      hydrateWindow: async () => ({hydratedIds: []}),
      mutate: () => ({id: "id", mutationId: "mutation"}),
      store: {
        getEntity: () => undefined,
        raw: {addTableListener: () => "listener", delListener: () => {}},
      },
    };
    let context: AdminProviderValue | null = null;
    const Probe: React.FC = () => {
      context = useAdminContext();
      return null;
    };

    renderWithTheme(
      <AdminProvider apiBase="/admin" syncDb={syncDb}>
        <Probe />
      </AdminProvider>
    );

    expect(context?.syncDb).toBe(syncDb);
  });

  it("exposes the host useConflicts adapter on context", () => {
    const syncConflicts = {conflicts: [], resolve: () => {}};
    let context: AdminProviderValue | null = null;
    const Probe: React.FC = () => {
      context = useAdminContext();
      return null;
    };

    renderWithTheme(
      <AdminProvider apiBase="/admin" syncConflicts={syncConflicts}>
        <Probe />
      </AdminProvider>
    );

    assert.strictEqual(context?.syncConflicts, syncConflicts);
  });
});
