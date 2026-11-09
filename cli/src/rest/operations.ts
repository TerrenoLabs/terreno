export type HttpMethod = "get" | "put" | "post" | "delete" | "patch" | "options" | "head";

export interface OpenApiParameter {
  in?: string;
  name?: string;
  required?: boolean;
  schema?: {type?: string};
}

export interface OpenApiOperation {
  operationId?: string;
  parameters?: OpenApiParameter[];
  requestBody?: {
    content?: Record<string, {schema?: unknown}>;
    required?: boolean;
  };
  summary?: string;
  tags?: string[];
}

export interface OpenApiPathItem {
  delete?: OpenApiOperation;
  get?: OpenApiOperation;
  head?: OpenApiOperation;
  options?: OpenApiOperation;
  parameters?: OpenApiParameter[];
  patch?: OpenApiOperation;
  post?: OpenApiOperation;
  put?: OpenApiOperation;
}

export interface OpenApiDocument {
  info?: {title?: string; version?: string};
  openapi?: string;
  paths?: Record<string, OpenApiPathItem>;
  servers?: Array<{url?: string}>;
  swagger?: string;
}

export interface RestOperation {
  bodyRequired: boolean;
  id: string;
  method: HttpMethod;
  parameters: OpenApiParameter[];
  path: string;
  summary?: string;
  tags: string[];
}

const HTTP_METHODS: HttpMethod[] = ["get", "put", "post", "delete", "patch", "options", "head"];

export const sanitizeOperationId = (value: string): string => {
  return value
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .toLowerCase();
};

const operationFrom = (
  method: HttpMethod,
  path: string,
  op: OpenApiOperation,
  sharedParameters: OpenApiParameter[]
): RestOperation => {
  const parameters = [...sharedParameters, ...(op.parameters ?? [])];
  const fallbackId = sanitizeOperationId(`${method}_${path}`);
  return {
    bodyRequired: Boolean(op.requestBody?.required),
    id: op.operationId ? sanitizeOperationId(op.operationId) : fallbackId,
    method,
    parameters,
    path,
    summary: op.summary,
    tags: op.tags ?? [],
  };
};

export const listRestOperations = (spec: OpenApiDocument): RestOperation[] => {
  const operations: RestOperation[] = [];
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    if (!item) {
      continue;
    }
    const shared = item.parameters ?? [];
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op) {
        continue;
      }
      operations.push(operationFrom(method, path, op, shared));
    }
  }
  return operations.sort((a, b) => a.id.localeCompare(b.id));
};

export const findRestOperation = (
  operations: RestOperation[],
  matcher: {id?: string; method?: string; path?: string}
): RestOperation | undefined => {
  if (matcher.id) {
    const id = sanitizeOperationId(matcher.id);
    const exact = operations.find((op) => op.id === id);
    if (exact) {
      return exact;
    }
  }
  if (matcher.method && matcher.path) {
    const method = matcher.method.toLowerCase();
    return operations.find(
      (op) => op.method === method && (op.path === matcher.path || op.path === `/${matcher.path}`)
    );
  }
  return undefined;
};

export const fillPathTemplate = (path: string, params: Record<string, string>): string => {
  return path.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) {
      throw new Error(`Missing path parameter "${name}" for ${path}`);
    }
    return encodeURIComponent(value);
  });
};
