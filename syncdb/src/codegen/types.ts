interface TerrenoSyncExtension {
  collection: string;
  scope: string;
}

export interface OpenApiSchema {
  type?: string;
  format?: string;
  enum?: Array<string | number | boolean>;
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
  items?: OpenApiSchema;
  $ref?: string;
  additionalProperties?: boolean | OpenApiSchema;
  allOf?: OpenApiSchema[];
  oneOf?: OpenApiSchema[];
  anyOf?: OpenApiSchema[];
  description?: string;
  nullable?: boolean;
}

export interface OpenApiParameter {
  in?: string;
  name?: string;
  required?: boolean;
  schema?: OpenApiSchema;
  description?: string;
}

export interface OpenApiOperation {
  "x-terreno-sync"?: TerrenoSyncExtension;
  operationId?: string;
  tags?: string[];
  summary?: string;
  parameters?: OpenApiParameter[];
  requestBody?: {
    content?: Record<string, {schema?: OpenApiSchema}>;
    required?: boolean;
  };
  responses?: Record<
    string,
    {
      content?: Record<string, {schema?: OpenApiSchema}>;
      description?: string;
    }
  >;
}

interface OpenApiPathItem {
  get?: OpenApiOperation;
  post?: OpenApiOperation;
  patch?: OpenApiOperation;
  put?: OpenApiOperation;
  delete?: OpenApiOperation;
}

export interface OpenApiDocument {
  paths?: Record<string, OpenApiPathItem>;
  components?: {schemas?: Record<string, OpenApiSchema>};
}

export interface DiscoveredCollection {
  collection: string;
  entityName: string;
  entitySchema: OpenApiSchema;
  createName: string;
  createSchema: OpenApiSchema;
  updateName: string;
  updateSchema: OpenApiSchema;
  retries?: boolean | number;
}

export interface CodegenConfigFile {
  overrides?: Record<string, {retries?: boolean | number}>;
  exportName?: string;
  /** Module the generated hooks import React bindings from (default `@terreno/syncdb/react`). */
  sdkImportPath?: string;
  /** Module the API SDK imports request types from (default `@terreno/syncdb/api`). */
  apiImportPath?: string;
  /** Path prefixes or regexes (as strings) to leave out of the API SDK. */
  excludePaths?: string[];
}

/** A non-synced OpenAPI operation the API SDK emits a hook for. */
export interface DiscoveredOperation {
  /** camelCase operation name (`getAuthMe`, `todosMarkComplete`). */
  name: string;
  method: "get" | "post" | "put" | "patch" | "delete";
  path: string;
  tags: string[];
  summary?: string;
  pathParams: OpenApiParameter[];
  queryParams: OpenApiParameter[];
  body?: {mediaType: string; schema: OpenApiSchema; required: boolean};
  /** JSON schema of the first 2xx response with content; `null` for 204-only. */
  response: OpenApiSchema | null | undefined;
  /** Path params from Express `*name` segments; their values may contain `/`. */
  wildcardParams: string[];
}

export interface GenerateArgs {
  schema: string;
  out: string;
  collections?: string[];
  config?: CodegenConfigFile;
  format: boolean;
}

export interface GenerateApiArgs {
  schema: string;
  out: string;
  config?: CodegenConfigFile;
  format: boolean;
}
