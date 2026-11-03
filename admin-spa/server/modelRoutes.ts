import {
  type AdminModelConfig,
  buildAdminApiListQueryRequest,
  buildAdminListQueryParams,
  buildAdminReadUrl,
} from "@terreno/admin-frontend";

/**
 * A route param as a loader sees it, decoded. expo-server passes params straight from the
 * encoded pathname (the browser router decodes them), so `/console/User/a%20b` arrives as
 * `a%20b`; the URL builders encode again, so the param must be decoded first. Undefined for a
 * missing param or a malformed escape.
 */
export const decodeRouteParam = (value: string | string[] | undefined): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
};

/** Rows `AdminModelTable` asks for when a model sets no `pageSize`. */
const DEFAULT_PAGE_LIMIT = 20;

/** The model whose `name` is `modelName` in an admin config, or undefined. */
const findAdminModel = (adminConfig: unknown, modelName: string): AdminModelConfig | undefined => {
  if (!modelName) {
    return undefined;
  }
  const models = (adminConfig as {models?: unknown} | null | undefined)?.models;
  if (!Array.isArray(models)) {
    return undefined;
  }
  return (models as AdminModelConfig[]).find((model) => model?.name === modelName);
};

/**
 * The list URL `AdminModelTable` requests on its first render for `modelName` (the `[model]`
 * route param): page 1, the model's page size, its default sort, no filters or search. Built
 * with the table's own param and URL builders, so the server's seed key matches the hook's
 * request. Null for an unknown name or a model without a route path. Windowed sync models
 * get their REST membership URL too.
 */
export const resolveModelListUrl = (adminConfig: unknown, modelName: string): string | null => {
  const model = findAdminModel(adminConfig, modelName);
  if (!model?.routePath) {
    return null;
  }
  const params = buildAdminListQueryParams({
    filterState: {},
    limit: model.pageSize ?? DEFAULT_PAGE_LIMIT,
    modelConfig: model,
    page: 1,
    searchDebounced: "",
    sort: model.defaultSort,
  });
  return buildAdminApiListQueryRequest(model.routePath, params).url;
};

/**
 * The read URL `useReadQuery` requests for `id` of `modelName`, built with the hook's own
 * `buildAdminReadUrl` (the id is encoded). Null for an unknown name, a model without a route
 * path, or an empty id.
 */
export const resolveModelReadUrl = (
  adminConfig: unknown,
  modelName: string,
  id: string
): string | null => {
  const model = findAdminModel(adminConfig, modelName);
  if (!model?.routePath || !id) {
    return null;
  }
  return buildAdminReadUrl(model.routePath, id);
};
