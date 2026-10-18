import type {
  Api,
  BaseQueryFn,
  EndpointBuilder as RtkEndpointBuilder,
} from "@reduxjs/toolkit/query/react";
import type React from "react";

/**
 * Type alias for an RTK Query API instance with type-erased generic parameters.
 *
 * The admin panel dynamically injects endpoints into the consumer's RTK Query API at
 * runtime via `api.injectEndpoints()`. The consumer's API is built from a generated
 * OpenAPI SDK with thousands of distinct endpoint types — there is no shared base
 * type we can constrain to, so the generic parameters are erased.
 */
export type AdminApi = Api<
  BaseQueryFn<unknown, unknown, unknown>,
  Record<string, never>,
  string,
  string
>;

/**
 * Generic field/document value used throughout the admin panel.
 *
 * Admin screens operate over arbitrary Mongoose documents whose field types are not
 * known statically — they are discovered at runtime via the `/admin/config` endpoint.
 * Read sites must narrow with `typeof` checks before passing to typed UI components.
 */
export type AdminFieldValue = unknown;

export interface AdminRecordCapabilities {
  delete: boolean;
  update: boolean;
}

/**
 * RTK Query's `build` argument from `api.injectEndpoints({ endpoints: (build) => ... })`.
 *
 * The build helper is generic over the full endpoint set; since the admin panel injects
 * endpoints dynamically into a consumer-supplied API, the endpoint shapes are not
 * statically expressible here.
 */
export type EndpointBuilder = RtkEndpointBuilder<
  BaseQueryFn<unknown, unknown, unknown>,
  string,
  string
>;

export interface AdminFieldConfig {
  type: string;
  required: boolean;
  description?: string;
  enum?: string[];
  default?: AdminFieldValue;
  ref?: string;
  searchable?: boolean;
  widget?: string;
  /** For array fields of sub-documents: metadata about each item's sub-fields */
  items?: Record<string, AdminFieldConfig>;
  /** For array fields of primitives: the item type (string/number/boolean/objectid) */
  itemType?: string;
  /** For array fields of primitives: enum values for each item */
  itemEnum?: string[];
  /** For array fields of ObjectId refs: the referenced model name */
  itemRef?: string;
}

interface AdminModelPermissions {
  create?: boolean;
  delete?: boolean;
  update?: boolean;
}

export interface AdminModelConfig {
  name: string;
  routePath: string;
  displayName: string;
  listFields: string[];
  defaultSort: string;
  fields: Record<string, AdminFieldConfig>;
  /**
   * From `GET /admin/config`: true when the app collection registered
   * `sync.adminBroadcast`. Windowed TinyBase lists require this plus
   * {@link AdminProviderValue.syncDb} and a fetch client.
   */
  adminBroadcast?: boolean;
  /**
   * Sync collection tag (`todos`, not `/admin/todos`) when `adminBroadcast`
   * is true. Omitted on other models.
   */
  syncCollection?: string;
  /** True when the admin host enables organizations and the model has `organizationId`. */
  organizationScoped?: boolean;
  fieldOrder?: string[];
  /** Optional per-column pixel widths used by AdminModelTable when rendering listFields. */
  listColumnWidths?: Record<string, number>;
  /**
   * Field key used for the edit screen title (stack / document title). When unset, the form
   * picks a scalar label from common keys (`name`, `title`, …) then the first list column.
   */
  recordTitleField?: string;
  /** Fields that use async autocomplete against the model list endpoint (Phase 3+). */
  autocompleteFields?: string[];
  /** Server-side excluded fields (scrubbed from responses; informational for forms). */
  excludeFields?: string[];
  /** Admin UI v2 — declarative bulk actions */
  actions?: {
    allowed?: boolean;
    background?: boolean;
    confirm?: string;
    id: string;
    label: string;
    patchKeys?: string[];
  }[];
  bulkPatchAllowlist?: string[];
  fieldsets?: {fields: string[]; title: string}[];
  filters?: {
    allowEmpty?: boolean;
    choices?: {label: string; value: string}[];
    field: string;
    kind: string;
    label?: string;
  }[];
  group?: string;
  hiddenFields?: string[];
  listDisplay?: string[];
  listDisplayLinks?: string[];
  pageSize?: number;
  permissions?: AdminModelPermissions;
  readonlyFields?: string[];
  realtime?: boolean;
  searchFields?: string[];
  sortableFields?: string[];
}

export interface AdminCustomScreen {
  description?: string;
  displayName: string;
  /** Sidebar group label; grouped screens render with matching model groups in AdminShell. */
  group?: string;
  icon?: string;
  name: string;
}

export interface AdminScriptConfig {
  name: string;
  description: string;
}

/** Admin UI v2 home layout slots (Django template-block analogue). */
interface AdminHomeSlots {
  contentTop?: string[];
  main?: string[];
  navGlobal?: string[];
  sidebar?: string[];
}

export interface AdminHome {
  slots: AdminHomeSlots;
  title: string;
}

export interface AdminCapabilities {
  actions: boolean;
  fieldsets: boolean;
  filters: boolean;
  realtime: boolean;
}

export interface AdminConfigResponse {
  capabilities?: AdminCapabilities;
  customScreens?: AdminCustomScreen[];
  home?: AdminHome;
  models: AdminModelConfig[];
  /** Server-authorized visibility for built-in Platform sidebar tools. */
  platformTools?: {
    configuration: boolean;
    roles: boolean;
    runScripts?: boolean;
    scripts: boolean;
    version: boolean;
    viewScripts?: boolean;
  };
  schemaVersion?: number;
  scripts: AdminScriptConfig[];
  /** Present when AdminApp was given `migrations.dir`. */
  migrations?: {enabled: boolean};
  /** Plugin home widget ids merged from admin contributions (informational). */
  widgetIds?: string[];
}

/** Props passed to home dashboard widgets resolved from `home.slots`. */
export interface AdminHomeWidgetProps {
  api: AdminApi;
  apiBase: string;
  routeBase: string;
  config: AdminConfigResponse;
  models: AdminModelConfig[];
  auditModel?: AdminModelConfig;
  featureFlagModel?: AdminModelConfig;
}

/** Props passed to custom admin screen widgets registered in `widgets.screens`. */
export interface AdminScreenWidgetProps extends AdminScreenProps {
  config: AdminConfigResponse;
  screenName: string;
}

/** Props passed to per-field form widgets registered in `widgets.fields`. */
export interface AdminFieldWidgetProps extends AdminScreenProps {
  errorText?: string;
  fieldConfig: AdminFieldConfig;
  fieldKey: string;
  modelConfigs?: Array<{name: string; routePath: string}>;
  onChange: (value: AdminFieldValue) => void;
  parentFormState?: Record<string, AdminFieldValue>;
  readOnly?: boolean;
  refRenderers?: RefRendererMap;
  value: AdminFieldValue;
}

export type HomeWidgetComponent = React.FC<AdminHomeWidgetProps>;
export type ScreenWidgetComponent = React.FC<AdminScreenWidgetProps>;
export type FieldWidgetComponent = React.FC<AdminFieldWidgetProps>;

export interface AdminWidgetRegistry {
  fields: Record<string, FieldWidgetComponent>;
  home: Record<string, HomeWidgetComponent>;
  screens: Record<string, ScreenWidgetComponent>;
}

import type {AdminRpc} from "./adminRpc";

export type AdminGetAuthHeaders = () => HeadersInit | Promise<HeadersInit>;

/** Narrow syncdb surface admin collection CRUD uses. Hosts pass `createSyncDb()` as this. */
export interface AdminSyncDbEntity {
  data: unknown;
  deleted?: boolean;
  id: string;
}

export interface AdminSyncConflict {
  collection: string;
  entityId: string;
  localData: string;
  mutationId: string;
  serverData: string;
}

export interface AdminSyncConflicts {
  conflicts: AdminSyncConflict[];
  resolve: (args: {mutationId: string; strategy: "useServer" | "keepMine"}) => void;
}

export interface AdminSyncDb {
  hydrateWindow: (args: {
    collection: string;
    ids: string[];
    restRows?: Record<string, unknown>;
  }) => Promise<{hydratedIds: string[]}>;
  mutate: (args: {
    collection: string;
    data?: Record<string, unknown>;
    id?: string;
    operation: "create" | "update" | "delete";
  }) => {id: string; mutationId: string};
  store: {
    getEntity: (args: {collection: string; id: string}) => AdminSyncDbEntity | undefined;
    raw: {
      addTableListener: (tableId: string, listener: () => void) => string;
      delListener: (listenerId: string) => void;
    };
  };
}

export interface AdminProviderValue {
  adminRpc?: AdminRpc;
  api: AdminApi;
  apiBase: string;
  /** API origin for cross-origin embedded RPC (`http://localhost:4000`). */
  apiOrigin?: string;
  credentials?: RequestCredentials;
  getAuthHeaders?: AdminGetAuthHeaders;
  routeBase: string;
  syncConflicts?: AdminSyncConflicts;
  syncDb?: AdminSyncDb;
  widgets: AdminWidgetRegistry;
}

interface BackgroundTaskProgress {
  percentage: number;
  stage?: string;
  message?: string;
}

interface BackgroundTaskLog {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
}

export interface BackgroundTask {
  _id: string;
  taskType: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  progress?: BackgroundTaskProgress;
  isDryRun: boolean;
  result?: string[];
  error?: string;
  logs: BackgroundTaskLog[];
  startedAt?: string;
  completedAt?: string;
  created: string;
  updated: string;
}

/** A single past script run, as returned by `GET {apiBase}/scripts/runs`. */
export interface ScriptRun extends BackgroundTask {
  /** Display name (or email) of the admin who triggered the run, when available. */
  createdByName?: string;
}

/** Paginated response from the script run-history endpoint. */
export interface ScriptRunListResponse {
  data: ScriptRun[];
  limit: number;
  more: boolean;
  page: number;
  total: number;
}

/**
 * Common props for admin screens.
 *
 * The admin panel separates two distinct concepts:
 * - `apiBase`: the base path where JSON/API requests are sent (e.g. "/admin").
 * - `routeBase`: the base path used for in-app navigation (e.g. "/admin" when mounted
 *   inside an app, or "" for a standalone admin SPA whose navigation stays at its root).
 *
 * `baseUrl` is a backward-compatible alias: when only `baseUrl` is provided it is used
 * for BOTH the API base and the route base, preserving the original behavior. When
 * `apiBase`/`routeBase` are provided they take precedence over `baseUrl`. Use
 * {@link resolveAdminBases} to resolve the effective bases.
 */
export interface AdminScreenProps {
  /** @deprecated Use `apiBase` and `routeBase`. Kept as a backward-compatible alias. */
  baseUrl?: string;
  /** Base path where JSON/API requests are sent. Falls back to `baseUrl`. */
  apiBase?: string;
  /** Base path used for in-app navigation. Falls back to `baseUrl`. */
  routeBase?: string;
  /**
   * @deprecated Terreno 57 compatibility for ObjectId/API-only CRUD. Do not add
   * new admin `injectEndpoints`; Terreno 58 removes the required `api` prop.
   */
  api: AdminApi;
  /**
   * Fetch credentials mode for {@link adminRequest}. SPA cookie sessions use
   * `"same-origin"`; omit when the host only sends Bearer headers.
   */
  credentials?: RequestCredentials;
  /** Extra headers for {@link adminRequest} (embedded hosts return `Authorization: Bearer …`). */
  getAuthHeaders?: AdminGetAuthHeaders;
  /**
   * Backend origin for native `fetch` RPC when the Expo app and API are on
   * different hosts. Do not put this in `apiBase` — that stays a path prefix
   * (`/admin`) so navigation `routeBase` is not rewritten to the API origin.
   */
  apiOrigin?: string;
}

/**
 * Resolves the effective API and route bases from the (optional) `baseUrl`, `apiBase`,
 * and `routeBase` props. When only `baseUrl` is provided, both resolved bases equal it,
 * preserving the original single-prop behavior.
 */
export const resolveAdminBases = ({
  baseUrl,
  apiBase,
  routeBase,
}: {
  baseUrl?: string;
  apiBase?: string;
  routeBase?: string;
}): {apiBase: string; routeBase: string} => {
  return {
    apiBase: apiBase ?? baseUrl ?? "",
    routeBase: routeBase ?? baseUrl ?? "",
  };
};

/**
 * Props passed to a custom ref-field renderer. Matches AdminRefField's interface so a
 * custom renderer is a drop-in replacement.
 *
 * `routePath` is the API path used to fetch reference options (e.g. "/admin/users").
 * `routeBase` is the base path for in-app navigation to the referenced item.
 */
export interface RefFieldRendererProps {
  api: AdminApi;
  /** @deprecated Use `apiBase`/`routeBase`. Kept as a backward-compatible alias. */
  baseUrl?: string;
  /** Base path where JSON/API requests are sent. Falls back to `baseUrl`. */
  apiBase?: string;
  /** Base path used for in-app navigation. Falls back to `baseUrl`. */
  routeBase?: string;
  routePath: string;
  refModelName: string;
  title: string;
  value: string;
  onChange: (value: string) => void;
  errorText?: string;
  helperText?: string;
  /** When true, the picker is display-only and does not submit changes. */
  readOnly?: boolean;
  /** When true, query the referenced model search endpoint as the user types. */
  autocomplete?: boolean;
  testID?: string;
}

/**
 * Map from referenced model name (e.g. "User") to a custom component used to render
 * fields that reference that model. When a key matches `fieldConfig.ref` (single ref)
 * or `fieldConfig.itemRef` (primitive array of refs), the custom component renders in
 * place of the built-in {@link AdminRefField}. Falls back to AdminRefField when no
 * key matches.
 */
export type RefRendererMap = Record<string, React.ComponentType<RefFieldRendererProps>>;

// System fields that should be skipped in forms
export const SYSTEM_FIELDS = new Set(["_id", "id", "__v", "created", "updated", "deleted"]);

export interface DocumentFile {
  name: string;
  fullPath: string;
  size: number;
  contentType: string | undefined;
  updated: string;
  isFolder: boolean;
}

export interface DocumentListResponse {
  files: DocumentFile[];
  folders: string[];
  prefix: string;
}

export interface DocumentStorageBrowserProps {
  api: AdminApi;
  basePath: string;
  /** Route opened by the standard admin screen back arrow. */
  backHref?: string;
  /** Show the admin back arrow. Defaults to true; pass false when embedded outside admin. */
  backButton?: boolean;
  title?: string;
  allowDelete?: boolean;
  allowUpload?: boolean;
  onFileSelect?: (file: DocumentFile) => void;
  onSettingsPress?: () => void;
}
