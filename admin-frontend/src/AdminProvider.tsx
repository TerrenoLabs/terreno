import React, {useEffect, useMemo, useRef} from "react";
import {AdminWidgetContext, useAdminContext} from "./adminContext";
import {bindAdminRequest} from "./adminRequest";
import type {
  AdminProviderValue,
  AdminScreenProps,
  AdminSyncConflicts,
  AdminSyncDb,
  AdminWidgetRegistry,
  FieldWidgetComponent,
  HomeWidgetComponent,
  ScreenWidgetComponent,
} from "./types";
import {resolveAdminBases} from "./types";
import {BUILT_IN_WIDGET_REGISTRY, mergeWidgetRegistry} from "./widgets/builtInWidgets";

export {useAdminContext} from "./adminContext";

const warnedMissingWidgets = new Set<string>();

const missingKey = (bucket: string, id: string): string => `${bucket}:${id}`;

const warnMissingWidget = (bucket: "fields" | "home" | "screens", widgetId: string): void => {
  const key = missingKey(bucket, widgetId);
  if (warnedMissingWidgets.has(key)) {
    return;
  }
  warnedMissingWidgets.add(key);
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    console.warn(
      `[AdminProvider] Unknown admin ${bucket} widget "${widgetId}". Register it on AdminProvider.widgets.${bucket}.`
    );
  }
};

/** @internal Test helper — clears one-time missing-widget warnings. */
export const resetAdminWidgetWarningsForTests = (): void => {
  warnedMissingWidgets.clear();
};

export interface AdminProviderProps extends AdminScreenProps {
  children: React.ReactNode;
  /** Optional windowed TinyBase client for String `_id` + `adminBroadcast` models. */
  syncDb?: AdminSyncDb;
  /** Optional adapter from the host's `useConflicts()` result. */
  syncConflicts?: AdminSyncConflicts;
  widgets?: Partial<AdminWidgetRegistry>;
}

export const AdminProvider: React.FC<AdminProviderProps> = ({
  children,
  baseUrl,
  apiBase,
  apiOrigin,
  credentials,
  getAuthHeaders,
  routeBase,
  syncConflicts,
  syncDb,
  widgets: userWidgets,
}) => {
  const bases = resolveAdminBases({apiBase, baseUrl, routeBase});
  const mergedWidgets = useMemo(() => mergeWidgetRegistry(userWidgets), [userWidgets]);
  // Every admin request (model CRUD and RPC) goes through this host-bound fetch client.
  const adminRpc = useMemo(
    () => bindAdminRequest({credentials, getAuthHeaders, origin: apiOrigin}),
    [apiOrigin, credentials, getAuthHeaders]
  );
  const value = useMemo(
    (): AdminProviderValue => ({
      adminRpc,
      apiBase: bases.apiBase,
      apiOrigin,
      credentials,
      getAuthHeaders,
      routeBase: bases.routeBase,
      syncConflicts,
      syncDb,
      widgets: mergedWidgets,
    }),
    [
      adminRpc,
      apiOrigin,
      bases.apiBase,
      bases.routeBase,
      credentials,
      getAuthHeaders,
      mergedWidgets,
      syncConflicts,
      syncDb,
    ]
  );

  return <AdminWidgetContext.Provider value={value}>{children}</AdminWidgetContext.Provider>;
};

export const useAdminWidgetRegistry = (): AdminWidgetRegistry => {
  const ctx = useAdminContext();
  return ctx?.widgets ?? BUILT_IN_WIDGET_REGISTRY;
};

export const useHomeWidget = (widgetId: string): HomeWidgetComponent | undefined => {
  const registry = useAdminWidgetRegistry();
  const widget = registry.home[widgetId];
  if (!widget) {
    warnMissingWidget("home", widgetId);
  }
  return widget;
};

export const useScreenWidget = (screenName: string): ScreenWidgetComponent | undefined => {
  const registry = useAdminWidgetRegistry();
  const widget = registry.screens[screenName];
  if (!widget) {
    warnMissingWidget("screens", screenName);
  }
  return widget;
};

export const useFieldWidget = (widgetKey: string | undefined): FieldWidgetComponent | undefined => {
  if (!widgetKey) {
    return undefined;
  }
  const registry = useAdminWidgetRegistry();
  const widget = registry.fields[widgetKey];
  if (!widget) {
    warnMissingWidget("fields", widgetKey);
  }
  return widget;
};

/** Warn once when legacy `customScreens` prop is used alongside AdminProvider. */
export const useDeprecatedCustomScreensProp = (customScreens?: unknown[]): void => {
  const ctx = useAdminContext();
  const warnedRef = useRef(false);
  useEffect(() => {
    if (warnedRef.current || !ctx) {
      return;
    }
    if (customScreens && customScreens.length > 0) {
      warnedRef.current = true;
      if (typeof __DEV__ !== "undefined" && __DEV__) {
        console.warn(
          "[admin] AdminModelList customScreens prop is deprecated when using AdminProvider. Register screens via widgets.screens instead."
        );
      }
    }
  }, [ctx, customScreens]);
};
