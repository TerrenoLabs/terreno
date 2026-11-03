import {describe, expect, it} from "bun:test";
import {homeWidgetUrls} from "./homeWidgetUrls";

/**
 * `homeWidgetUrls` maps each built-in home widget to the URLs it requests on mount. The literals
 * below are pinned by admin-frontend/src/isolated/adminRouteSeeds.ssr.isolated.tsx, which renders
 * the home dashboard and records what it really requests:
 * - `modelStats` / `modelsGrid`: `ModelsGridWidget.tsx` asks `useListQuery({limit: 1, page: 1})`
 *   for every model with a route path (`<routePath>?limit=1&page=1`).
 * - `recentActivity`: `RecentActivityWidget.tsx:14-15` asks `{limit: 8, page: 1, sort}` on the
 *   audit-log model (`isAuditLogModel`), sort `defaultSort ?? "-created"`.
 * - `versionConfig`: `AdminVersionConfig.tsx:50-53` asks `{apiBase}/version-config`.
 * - `jobs`: `JobsHomeWidget.tsx` asks `useStatsQuery` -> `/jobs/stats` (never under apiBase).
 */
const model = (name: string, routePath: string, extra: Record<string, unknown> = {}) => ({
  displayName: name,
  fields: {_id: {required: true, type: "string"}},
  listFields: ["_id"],
  name,
  routePath,
  ...extra,
});

const auditModel = model("AdminAuditLog", "/admin/audit-logs");

const configWith = (
  slots: Record<string, string[]>,
  models: unknown[] = [model("User", "/admin/users")]
) => ({
  customScreens: [],
  home: {slots, title: "Admin"},
  models,
  scripts: [],
});

const sorted = (urls: string[]): string[] => [...urls].sort();

describe("homeWidgetUrls", () => {
  it("returns no URLs when the config has no home slots", () => {
    expect(
      homeWidgetUrls({adminConfig: {customScreens: [], models: [], scripts: []}, apiBase: "/admin"})
    ).toEqual([]);
    expect(homeWidgetUrls({adminConfig: configWith({}), apiBase: "/admin"})).toEqual([]);
  });

  it.each([null, undefined, {}, {home: "x"}, {home: {slots: null}}, "str", 7])(
    "returns [] for a malformed config (%p)",
    (adminConfig) => {
      expect(homeWidgetUrls({adminConfig, apiBase: "/admin"})).toEqual([]);
    }
  );

  it("modelStats requests limit 1 page 1 of every model with a route path", () => {
    const adminConfig = configWith({main: ["modelStats"]}, [
      model("User", "/admin/users"),
      model("Todo", "/admin/todos"),
    ]);
    expect(sorted(homeWidgetUrls({adminConfig, apiBase: "/admin"}))).toEqual([
      "/admin/todos?limit=1&page=1",
      "/admin/users?limit=1&page=1",
    ]);
  });

  it("modelsGrid is the same widget as modelStats, and a repeated widget adds no duplicate URL", () => {
    const adminConfig = configWith({main: ["modelStats"], sidebar: ["modelsGrid"]});
    expect(homeWidgetUrls({adminConfig, apiBase: "/admin"})).toEqual([
      "/admin/users?limit=1&page=1",
    ]);
  });

  it("skips a model with no route path", () => {
    const adminConfig = configWith({main: ["modelStats"]}, [
      model("User", "/admin/users"),
      model("Unrouted", ""),
    ]);
    expect(homeWidgetUrls({adminConfig, apiBase: "/admin"})).toEqual([
      "/admin/users?limit=1&page=1",
    ]);
  });

  it("skips an organization-scoped model: the server render has no organization selected", () => {
    const adminConfig = configWith({main: ["modelStats"]}, [
      model("User", "/admin/users"),
      model("Patient", "/admin/patients", {organizationScoped: true}),
    ]);
    expect(homeWidgetUrls({adminConfig, apiBase: "/admin"})).toEqual([
      "/admin/users?limit=1&page=1",
    ]);
  });

  it("recentActivity requests 8 rows of the audit-log model, newest first by default", () => {
    const adminConfig = configWith({sidebar: ["recentActivity"]}, [
      model("User", "/admin/users"),
      auditModel,
    ]);
    expect(homeWidgetUrls({adminConfig, apiBase: "/admin"})).toEqual([
      "/admin/audit-logs?limit=8&page=1&sort=-created",
    ]);
  });

  it("recentActivity uses the audit model's defaultSort", () => {
    const adminConfig = configWith({sidebar: ["recentActivity"]}, [
      model("AuditEvent", "/admin/audit-events", {defaultSort: "-timestamp"}),
    ]);
    expect(homeWidgetUrls({adminConfig, apiBase: "/admin"})).toEqual([
      "/admin/audit-events?limit=8&page=1&sort=-timestamp",
    ]);
  });

  it("recentActivity without an audit-log model requests nothing", () => {
    const adminConfig = configWith({sidebar: ["recentActivity"]});
    expect(homeWidgetUrls({adminConfig, apiBase: "/admin"})).toEqual([]);
  });

  it("recentActivity skips an organization-scoped audit model", () => {
    const adminConfig = configWith({sidebar: ["recentActivity"]}, [
      model("AuditEvent", "/admin/audit-events", {organizationScoped: true}),
    ]);
    expect(homeWidgetUrls({adminConfig, apiBase: "/admin"})).toEqual([]);
  });

  it("versionConfig requests the version config under the admin base", () => {
    const adminConfig = configWith({sidebar: ["versionConfig"]});
    expect(homeWidgetUrls({adminConfig, apiBase: "/admin"})).toEqual(["/admin/version-config"]);
    expect(homeWidgetUrls({adminConfig, apiBase: "/internal/admin"})).toEqual([
      "/internal/admin/version-config",
    ]);
  });

  it("jobs requests the job stats, which are not under the admin base", () => {
    const adminConfig = configWith({sidebar: ["jobs"]});
    expect(homeWidgetUrls({adminConfig, apiBase: "/admin"})).toEqual(["/jobs/stats"]);
    expect(homeWidgetUrls({adminConfig, apiBase: "/internal/admin"})).toEqual(["/jobs/stats"]);
  });

  it("widgets that request nothing on mount contribute no URLs", () => {
    const adminConfig = configWith({navGlobal: ["scriptRunner", "feature-flags-overrides"]});
    expect(homeWidgetUrls({adminConfig, apiBase: "/admin"})).toEqual([]);
  });

  it("an unknown custom widget contributes no URLs and does not hide the known ones", () => {
    const adminConfig = configWith({main: ["acmeCustomWidget"], sidebar: ["jobs", "acmeOther"]});
    expect(homeWidgetUrls({adminConfig, apiBase: "/admin"})).toEqual(["/jobs/stats"]);
  });

  it("reads every slot: navGlobal, contentTop, main and sidebar", () => {
    const adminConfig = configWith(
      {
        contentTop: ["jobs"],
        main: ["versionConfig"],
        navGlobal: ["recentActivity"],
        sidebar: ["modelStats"],
      },
      [model("User", "/admin/users"), auditModel]
    );
    expect(sorted(homeWidgetUrls({adminConfig, apiBase: "/admin"}))).toEqual(
      sorted([
        "/jobs/stats",
        "/admin/version-config",
        "/admin/audit-logs?limit=8&page=1&sort=-created",
        "/admin/users?limit=1&page=1",
        "/admin/audit-logs?limit=1&page=1",
      ])
    );
  });

  it("the example config's slots request each built-in widget's URLs once", () => {
    const adminConfig = configWith(
      {
        contentTop: [],
        main: ["modelStats"],
        navGlobal: ["scriptRunner", "feature-flags-overrides"],
        sidebar: ["versionConfig", "jobs", "recentActivity"],
      },
      [model("User", "/admin/users"), model("Todo", "/admin/todos"), auditModel]
    );
    const urls = homeWidgetUrls({adminConfig, apiBase: "/admin"});
    expect(new Set(urls).size).toBe(urls.length);
    expect(sorted(urls)).toEqual(
      sorted([
        "/admin/users?limit=1&page=1",
        "/admin/todos?limit=1&page=1",
        "/admin/audit-logs?limit=1&page=1",
        "/admin/audit-logs?limit=8&page=1&sort=-created",
        "/admin/version-config",
        "/jobs/stats",
      ])
    );
  });
});
