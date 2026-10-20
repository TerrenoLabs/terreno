import {operationName} from "./hookNames";
import type {
  DiscoveredOperation,
  OpenApiDocument,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiSchema,
} from "./types";

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

type Method = (typeof METHODS)[number];

const SUCCESS_CODES = ["200", "201", "202", "203", "204"];

const trimSlash = (path: string): string => (path.endsWith("/") ? path.slice(0, -1) : path);

/**
 * Collection CRUD routes for synced collections: the list path (GET/POST) and its
 * `/{param}` item path (GET/PATCH/PUT/DELETE). The local-first store owns those;
 * actions under the same prefix (`/todos/{id}/markComplete`) stay in the API SDK.
 */
const syncedCrudKeys = (spec: OpenApiDocument): Set<string> => {
  const keys = new Set<string>();
  const paths = Object.keys(spec.paths ?? {});
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    if (!item.get?.["x-terreno-sync"]?.collection) {
      continue;
    }
    keys.add(`get ${path}`);
    keys.add(`post ${path}`);
    const base = trimSlash(path);
    for (const candidate of paths) {
      if (!candidate.startsWith(`${base}/`)) {
        continue;
      }
      if (!/^\{[^/]+\}\/?$/.test(candidate.slice(base.length + 1))) {
        continue;
      }
      for (const method of ["get", "patch", "put", "delete"]) {
        keys.add(`${method} ${candidate}`);
      }
    }
  }
  return keys;
};

const isExcluded = (path: string, excludePaths: string[] | undefined): boolean =>
  (excludePaths ?? []).some((pattern) =>
    pattern.startsWith("^") ? new RegExp(pattern).test(path) : path.startsWith(pattern)
  );

const pickBody = (operation: OpenApiOperation): DiscoveredOperation["body"] => {
  const content = operation.requestBody?.content;
  if (!content) {
    return undefined;
  }
  const mediaType =
    ["application/json", "multipart/form-data"].find((type) => content[type]) ??
    Object.keys(content)[0];
  if (!mediaType) {
    return undefined;
  }
  return {
    mediaType,
    required: operation.requestBody?.required ?? true,
    schema: content[mediaType]?.schema ?? {},
  };
};

const pickResponse = (operation: OpenApiOperation): OpenApiSchema | null | undefined => {
  const responses = operation.responses ?? {};
  for (const code of SUCCESS_CODES) {
    const schema = responses[code]?.content?.["application/json"]?.schema;
    if (schema) {
      return schema;
    }
  }
  const hasOnlyNoContent = Boolean(responses["204"]) && !responses["200"] && !responses["201"];
  return hasOnlyNoContent ? null : undefined;
};

const paramsIn = (operation: OpenApiOperation, location: string): OpenApiParameter[] =>
  (operation.parameters ?? []).filter((param) => param.in === location && param.name);

/**
 * Express keeps `:name` and Express 5 `*name` segments in some spec keys. Read both as
 * `{name}`; `*name` params may contain slashes, so they are recorded as wildcards.
 */
const normalizePath = (path: string): {path: string; wildcards: string[]} => {
  const wildcards: string[] = [];
  const normalized = path
    .split("/")
    .map((segment) => {
      const match = segment.match(/^([:*])([A-Za-z_$][A-Za-z0-9_$]*)$/);
      if (!match) {
        return segment;
      }
      if (match[1] === "*") {
        wildcards.push(match[2]);
      }
      return `{${match[2]}}`;
    })
    .join("/");
  return {path: normalized, wildcards};
};

/**
 * Every OpenAPI operation the API SDK should emit a hook for: everything except
 * synced collection CRUD and `excludePaths`. Throws when two operations would
 * generate the same hook name.
 */
export const discoverOperations = ({
  excludePaths,
  spec,
}: {
  excludePaths?: string[];
  spec: OpenApiDocument;
}): DiscoveredOperation[] => {
  const synced = syncedCrudKeys(spec);
  const operations: DiscoveredOperation[] = [];
  const seen = new Map<string, string>();
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    if (isExcluded(path, excludePaths)) {
      continue;
    }
    for (const method of METHODS) {
      const operation = item[method as Method];
      if (!operation || synced.has(`${method} ${path}`)) {
        continue;
      }
      const normalized = normalizePath(path);
      const name = operationName({
        method,
        operationId: operation.operationId,
        path: normalized.path,
      });
      const where = `${method.toUpperCase()} ${path}`;
      const templateParams = new Set(
        [...normalized.path.matchAll(/\{([^}]+)\}/g)].map(([, param]) => param)
      );
      const strayParam = paramsIn(operation, "path").find(
        (param) => !templateParams.has(param.name ?? "")
      );
      if (strayParam) {
        throw new Error(
          `${where} declares path param "${strayParam.name}" that its path does not contain.`
        );
      }
      const clash = seen.get(name);
      if (clash) {
        throw new Error(
          `Operations ${clash} and ${where} both generate "${name}". Give one an operationId.`
        );
      }
      seen.set(name, where);
      operations.push({
        body: pickBody(operation),
        method,
        name,
        path: normalized.path,
        pathParams: paramsIn(operation, "path"),
        queryParams: paramsIn(operation, "query"),
        response: pickResponse(operation),
        summary: operation.summary,
        tags: operation.tags ?? [],
        wildcardParams: normalized.wildcards,
      });
    }
  }
  return operations;
};
