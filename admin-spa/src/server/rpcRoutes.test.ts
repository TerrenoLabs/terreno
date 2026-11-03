import {describe, expect, it} from "bun:test";
import {rpcUrlsForRoute} from "../../server/rpcRoutes";

/**
 * The literals are the URLs each screen's hooks request on mount. They are pinned from the other
 * side by admin-frontend/src/isolated/adminRouteSeeds.ssr.isolated.tsx, which renders each screen
 * and records what it requests (unseeded) and proves a seed from the same URLs leaves it silent.
 * - `/configuration`: `useConfigurationApi.ts:38,50`, default `basePath` `ConfigurationScreen.tsx:194`
 *   (not under the admin base).
 * - `/roles`: `useAdminRoles.ts:74,96-106`; `rbacRouter` mounts at the API root, so a trailing
 *   `/admin` is trimmed from the base.
 * - `/scripts`: `useAdminScripts.ts:57-80` builds `page` then `limit`; `AdminScriptList.tsx:38`
 *   page size 25. The "latest runs" and "history" queries share this one URL.
 * - `/version-config`: `AdminVersionConfig.tsx:50-53`.
 */
const model = (name: string, routePath: string, extra: Record<string, unknown> = {}) => ({
  displayName: name,
  fields: {_id: {required: true, type: "string"}},
  listFields: ["_id"],
  name,
  routePath,
  ...extra,
});

const emptyConfig = {customScreens: [], models: [], scripts: []};

const exampleConfig = {
  customScreens: [],
  home: {
    slots: {
      contentTop: [],
      main: ["modelStats"],
      navGlobal: ["scriptRunner", "feature-flags-overrides"],
      sidebar: ["versionConfig", "jobs", "recentActivity"],
    },
    title: "Example administration",
  },
  models: [model("User", "/admin/users"), model("AdminAuditLog", "/admin/audit-logs")],
  scripts: [],
};

const sorted = (urls: string[]): string[] => [...urls].sort();

describe("rpcUrlsForRoute", () => {
  it("/configuration requests the schema meta, then the values (not under the admin base)", () => {
    expect(
      rpcUrlsForRoute("/configuration", {adminConfig: emptyConfig, apiBase: "/admin"})
    ).toEqual(["/configuration/meta", "/configuration"]);
    expect(
      rpcUrlsForRoute("/configuration", {adminConfig: emptyConfig, apiBase: "/internal/admin"})
    ).toEqual(["/configuration/meta", "/configuration"]);
  });

  it("/roles requests the roles and the statements at the API root", () => {
    expect(rpcUrlsForRoute("/roles", {adminConfig: emptyConfig, apiBase: "/admin"})).toEqual([
      "/rbac/roles",
      "/rbac/statements",
    ]);
  });

  it("/roles trims a trailing /admin from a nested admin base", () => {
    expect(
      rpcUrlsForRoute("/roles", {adminConfig: emptyConfig, apiBase: "/internal/admin"})
    ).toEqual(["/internal/rbac/roles", "/internal/rbac/statements"]);
  });

  it("/scripts requests the first page of 25 script runs under the admin base", () => {
    expect(rpcUrlsForRoute("/scripts", {adminConfig: emptyConfig, apiBase: "/admin"})).toEqual([
      "/admin/scripts/runs?page=1&limit=25",
    ]);
    expect(
      rpcUrlsForRoute("/scripts", {adminConfig: emptyConfig, apiBase: "/internal/admin"})
    ).toEqual(["/internal/admin/scripts/runs?page=1&limit=25"]);
  });

  it("/version-config requests the version config under the admin base", () => {
    expect(
      rpcUrlsForRoute("/version-config", {adminConfig: emptyConfig, apiBase: "/admin"})
    ).toEqual(["/admin/version-config"]);
    expect(
      rpcUrlsForRoute("/version-config", {adminConfig: emptyConfig, apiBase: "/internal/admin"})
    ).toEqual(["/internal/admin/version-config"]);
  });

  it("/ with a recentActivity slot requests the audit-log list the widget asks for", () => {
    // The widget reads the audit-log model (name AdminAuditLog / AuditEvent, or an audit route
    // path), not an arbitrary model: `RecentActivityWidget.tsx:14-15` with `{limit: 8, page: 1}`.
    const adminConfig = {
      customScreens: [],
      home: {slots: {sidebar: ["recentActivity"]}, title: "Admin"},
      models: [model("User", "/admin/users"), model("AdminAuditLog", "/admin/audit-logs")],
      scripts: [],
    };
    expect(rpcUrlsForRoute("/", {adminConfig, apiBase: "/admin"})).toEqual([
      "/admin/audit-logs?limit=8&page=1&sort=-created",
    ]);
  });

  it("/ with no slots requests nothing", () => {
    expect(
      rpcUrlsForRoute("/", {
        adminConfig: {...emptyConfig, home: {slots: {}, title: "Admin"}},
        apiBase: "/admin",
      })
    ).toEqual([]);
    expect(rpcUrlsForRoute("/", {adminConfig: emptyConfig, apiBase: "/admin"})).toEqual([]);
  });

  it("/ with an unknown custom widget seeds nothing for it and keeps the known widgets", () => {
    const adminConfig = {
      ...emptyConfig,
      home: {slots: {main: ["acmeCustom"], sidebar: ["jobs"]}, title: "Admin"},
    };
    expect(rpcUrlsForRoute("/", {adminConfig, apiBase: "/admin"})).toEqual(["/jobs/stats"]);
  });

  it("/ with the example config's slots seeds every built-in widget's URLs once", () => {
    const urls = rpcUrlsForRoute("/", {adminConfig: exampleConfig, apiBase: "/admin"});
    expect(new Set(urls).size).toBe(urls.length);
    expect(sorted(urls)).toEqual(
      sorted([
        "/admin/users?limit=1&page=1",
        "/admin/audit-logs?limit=1&page=1",
        "/admin/audit-logs?limit=8&page=1&sort=-created",
        "/admin/version-config",
        "/jobs/stats",
      ])
    );
  });

  it.each([null, undefined, "str", 7])(
    "/ with a malformed config (%p) requests nothing",
    (adminConfig) => {
      expect(rpcUrlsForRoute("/", {adminConfig: adminConfig as never, apiBase: "/admin"})).toEqual(
        []
      );
    }
  );
});
