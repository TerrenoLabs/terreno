import {
  type AdminModelConfig,
  buildAdminApiListQueryRequest,
  buildAdminListQueryParams,
} from "@terreno/admin-frontend";

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
