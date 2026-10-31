// noExplicitAny: test harness doubles
// biome-ignore-all lint/suspicious/noExplicitAny: test harness doubles
import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import React from "react";
import type {ScaledSize} from "react-native";
import {useWindowDimensions} from "react-native";
import type {ReactTestInstance} from "react-test-renderer";
import {renderWithTheme} from "../../ui/src/test-utils";
import {configureUseAdminApiDouble, resetUseAdminApiDouble} from "./testing/useAdminApiDouble";
import type {AdminApi, AdminConfigResponse} from "./types";

mock.module("expo-router", () => ({
  router: {push: mock(() => {})},
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

import {AdminHome} from "./AdminHome";

const adminApi = {
  injectEndpoints: ({endpoints}: {endpoints: (builder: unknown) => Record<string, unknown>}) => {
    endpoints({
      mutation: (spec: Record<string, unknown>) => spec,
      query: (spec: Record<string, unknown>) => spec,
    });
    return {
      useAdminVersionConfigQuery: () => ({data: null, error: null, isLoading: false}),
      useUpdateVersionConfigMutation: () => [
        () => ({unwrap: async () => ({})}),
        {isLoading: false},
      ],
    };
  },
} as unknown as AdminApi;

const buildConfig = (overrides?: Partial<AdminConfigResponse>): AdminConfigResponse => ({
  customScreens: [],
  home: {
    slots: {
      contentTop: ["feature-flags-overrides"],
      main: ["modelsGrid"],
      navGlobal: ["scriptRunner"],
      sidebar: ["recentActivity", "versionConfig"],
    },
    title: "Test Admin",
  },
  models: [
    {
      defaultSort: "-created",
      displayName: "Feature Flags",
      fields: {key: {required: true, type: "string"}},
      listFields: ["key"],
      name: "FeatureFlag",
      routePath: "/admin/feature-flags",
    },
    {
      defaultSort: "-created",
      displayName: "Widget",
      fields: {title: {required: false, type: "string"}},
      listFields: ["title"],
      name: "Widget",
      routePath: "/admin/widgets",
    },
    {
      displayName: "Audit log",
      fields: {},
      listFields: ["verb"],
      name: "AdminAuditLog",
      routePath: "/admin/audit-logs",
    },
  ],
  scripts: [],
  ...overrides,
});

const countTestIdInSubtree = (root: ReactTestInstance, testId: string): number => {
  let count = 0;
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") {
      return;
    }
    const inst = node as ReactTestInstance;
    if (inst.props?.testID === testId) {
      count += 1;
    }
    const ch = inst.children;
    if (Array.isArray(ch)) {
      for (const c of ch) {
        walk(c);
      }
    }
  };
  walk(root);
  return count;
};

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

describe("AdminHome", () => {
  let restoreWindowWidth: (() => void) | undefined;

  beforeEach(() => {
    resetUseAdminApiDouble();
    configureUseAdminApiDouble({
      useListQuery: () => ({
        data: {data: [], total: 0},
        error: null,
        isError: false,
        isLoading: false,
      }),
    });
    configState.config = null;
    configState.isLoading = false;
    restoreWindowWidth = setWindowWidth(375);
  });

  afterEach(() => {
    restoreWindowWidth?.();
    restoreWindowWidth = undefined;
  });

  it("renders scriptRunner in the top band with contentTop widgets on the same row, not inside main", () => {
    configState.config = buildConfig();
    const {UNSAFE_root} = renderWithTheme(<AdminHome api={adminApi} baseUrl="/admin" />);
    const top = UNSAFE_root.findAll(
      (n: ReactTestInstance) => n.props?.testID === "admin-home-slot-top"
    );
    const main = UNSAFE_root.findAll(
      (n: ReactTestInstance) => n.props?.testID === "admin-home-slot-main"
    );
    expect(top.length).toBeGreaterThan(0);
    expect(main.length).toBeGreaterThan(0);
    const topSlot = top[0] as ReactTestInstance;
    const mainSlot = main[0] as ReactTestInstance;
    expect(countTestIdInSubtree(topSlot, "admin-home-widget-scriptRunner")).toBeGreaterThan(0);
    expect(
      countTestIdInSubtree(topSlot, "admin-home-widget-feature-flags-overrides")
    ).toBeGreaterThan(0);
    expect(countTestIdInSubtree(mainSlot, "admin-home-widget-scriptRunner")).toBe(0);
  });

  it("shows per-model row counts on each model card", () => {
    configState.config = buildConfig();
    const {UNSAFE_root} = renderWithTheme(<AdminHome api={adminApi} baseUrl="/admin" />);
    const modelCountLabels = UNSAFE_root.findAll(
      (n: ReactTestInstance) => n.props?.testID === "admin-home-model-count-Widget"
    );
    expect(modelCountLabels.length).toBeGreaterThan(0);
  });

  it("normalizes legacy modelStats to a single modelsGrid widget", () => {
    configState.config = buildConfig({
      home: {
        slots: {
          main: ["modelStats", "modelsGrid"],
          navGlobal: [],
          sidebar: [],
        },
        title: "Test Admin",
      },
    });
    const {UNSAFE_root} = renderWithTheme(<AdminHome api={adminApi} baseUrl="/admin" />);
    const mainSlots = UNSAFE_root.findAll(
      (n: ReactTestInstance) => n.props?.testID === "admin-home-slot-main"
    );
    expect(mainSlots.length).toBeGreaterThan(0);
    const mainSlot = mainSlots[0] as ReactTestInstance;
    const directWidgetWrappers = mainSlot.children.filter(
      (child) => typeof child === "object" && child !== null
    );
    expect(directWidgetWrappers.length).toBe(1);
    expect(countTestIdInSubtree(mainSlot, "admin-home-widget-modelsGrid")).toBeGreaterThan(0);
  });

  it("places recentActivity after other sidebar widgets when configured first in sidebar", () => {
    configState.config = buildConfig({
      home: {
        slots: {
          main: [],
          navGlobal: [],
          sidebar: ["recentActivity", "modelsGrid"],
        },
        title: "Test Admin",
      },
    });
    const {UNSAFE_root} = renderWithTheme(<AdminHome api={adminApi} baseUrl="/admin" />);
    const sidebar = UNSAFE_root.findAll(
      (n: ReactTestInstance) => n.props?.testID === "admin-home-slot-sidebar"
    );
    expect(sidebar.length).toBeGreaterThan(0);
    const sidebarSlot = sidebar[0] as ReactTestInstance;
    const ids: string[] = [];
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") {
        return;
      }
      const inst = node as ReactTestInstance;
      const tid = inst.props?.testID as string | undefined;
      if (tid === "admin-home-widget-recentActivity" || tid === "admin-home-widget-modelsGrid") {
        ids.push(tid);
      }
      const ch = inst.children;
      if (Array.isArray(ch)) {
        for (const c of ch) {
          walk(c);
        }
      }
    };
    walk(sidebarSlot);
    expect(ids[ids.length - 1]).toBe("admin-home-widget-recentActivity");
    expect(ids[0]).toBe("admin-home-widget-modelsGrid");
  });

  it("renders the real version config widget without replacing its module", () => {
    configState.config = buildConfig();
    const {getByTestId} = renderWithTheme(<AdminHome api={adminApi} baseUrl="/admin" />);
    expect(getByTestId("admin-version-config-widget")).toBeTruthy();
  });

  it("stacks the home columns below the desktop floor", () => {
    restoreWindowWidth?.();
    restoreWindowWidth = setWindowWidth(800);
    configState.config = buildConfig();
    const {getByTestId} = renderWithTheme(<AdminHome api={adminApi} baseUrl="/admin" />);
    expect(getByTestId("admin-home-columns").props.style.flexDirection).toBe("column");
  });

  it("places the home columns side by side at the desktop floor", () => {
    restoreWindowWidth?.();
    restoreWindowWidth = setWindowWidth(1024);
    configState.config = buildConfig();
    const {getByTestId} = renderWithTheme(<AdminHome api={adminApi} baseUrl="/admin" />);
    expect(getByTestId("admin-home-columns").props.style.flexDirection).toBe("row");
  });

  it("keeps an embedded dashboard stacked at desktop width", () => {
    restoreWindowWidth?.();
    restoreWindowWidth = setWindowWidth(1024);
    configState.config = buildConfig();
    const {getByTestId} = renderWithTheme(<AdminHome api={adminApi} baseUrl="/admin" embedded />);
    expect(getByTestId("admin-home-columns").props.style.flexDirection).toBe("column");
  });
});
