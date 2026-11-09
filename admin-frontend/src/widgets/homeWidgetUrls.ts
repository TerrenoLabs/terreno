import {buildAdminApiListQueryRequest} from "../adminApiQueryParams";
import {isAuditLogModel} from "../isAuditLogModel";
import type {AdminConfigResponse, AdminModelConfig} from "../types";

/** Home slots, in the order the dashboard lays them out. */
const SLOT_NAMES = ["navGlobal", "contentTop", "main", "sidebar"] as const;

/** Rows `RecentActivityWidget` shows. */
const RECENT_ACTIVITY_LIMIT = 8;

/** Models a server render can read: routed, and not tied to an organization it has not chosen. */
const readableModels = (adminConfig: AdminConfigResponse): AdminModelConfig[] => {
  const models = Array.isArray(adminConfig.models) ? adminConfig.models : [];
  return models.filter((model) => Boolean(model?.routePath) && !model.organizationScoped);
};

/** The URLs one built-in widget requests on mount; an unknown or quiet widget requests none. */
const urlsForWidget = (
  widget: string,
  {adminConfig, apiBase}: {adminConfig: AdminConfigResponse; apiBase: string}
): string[] => {
  switch (widget) {
    case "modelStats":
    case "modelsGrid":
      return readableModels(adminConfig).map(
        (model) => buildAdminApiListQueryRequest(model.routePath, {limit: 1, page: 1}).url
      );
    case "recentActivity": {
      // The same model AdminHome hands the widget: the first audit-log model of all of them.
      const models = Array.isArray(adminConfig.models) ? adminConfig.models : [];
      const auditModel = models.find((model) => isAuditLogModel(model));
      if (!auditModel?.routePath || auditModel.organizationScoped) {
        return [];
      }
      const params = {
        limit: RECENT_ACTIVITY_LIMIT,
        page: 1,
        sort: auditModel.defaultSort ?? "-created",
      };
      return [buildAdminApiListQueryRequest(auditModel.routePath, params).url];
    }
    case "versionConfig":
      return [`${apiBase}/version-config`];
    case "jobs":
      return ["/jobs/stats"];
    default:
      return [];
  }
};

/**
 * The URLs the home dashboard's built-in widgets request on mount, for the widgets placed in
 * `adminConfig.home.slots`: `modelStats` / `modelsGrid` (one count per model), `recentActivity`
 * (the audit log), `versionConfig` and `jobs`. A server render seeds these so the dashboard
 * renders its data at once. Custom widgets are not known here: they load on the client, as do
 * organization-scoped models, since a server render has no organization selected.
 */
export const homeWidgetUrls = ({
  adminConfig,
  apiBase,
}: {
  adminConfig: AdminConfigResponse;
  apiBase: string;
}): string[] => {
  const slots = (adminConfig as {home?: {slots?: Record<string, unknown>}} | null)?.home?.slots;
  if (!slots || typeof slots !== "object") {
    return [];
  }
  const urls: string[] = [];
  for (const slot of SLOT_NAMES) {
    const widgets = slots[slot];
    if (!Array.isArray(widgets)) {
      continue;
    }
    for (const widget of widgets) {
      if (typeof widget !== "string") {
        continue;
      }
      for (const url of urlsForWidget(widget, {adminConfig, apiBase})) {
        if (!urls.includes(url)) {
          urls.push(url);
        }
      }
    }
  }
  return urls;
};
