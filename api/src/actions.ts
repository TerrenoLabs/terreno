import {OpenAPIRegistry, OpenApiGeneratorV3} from "@asteasolutions/zod-to-openapi";
import type express from "express";
import type {NextFunction, Request, Response} from "express";
import type {Model, SchemaType} from "mongoose";
import type {ZodSchema, ZodType} from "zod";
import {asyncHandler, type ModelRouterOptions, type RESTMethod} from "./api";
import {authenticateMiddleware, type User} from "./auth";
import {loadDocOr404} from "./docLoader";
import {APIError, ForbiddenError, ValidationError} from "./errors";
import {defaultOpenApiErrorResponses} from "./openApi";
import {checkPermissions, type PermissionMethod} from "./permissions";
import {createIsPermitted} from "./rbac/middleware";
import type {AnyTerrenoAccess, ModelRouterAccessOptions} from "./rbac/types";

// At least two characters: leading letter plus one or more alphanumeric/_/- chars.
export const ACTION_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]+$/;

export interface ActionContext<TDoc, TBody, TQuery> {
  req: Request;
  res: Response;
  user: User | undefined;
  body: TBody;
  query: TQuery;
  doc: TDoc;
}

interface BaseActionConfig<TBody, TQuery, TResponse> {
  method: "GET" | "POST";
  allowAnonymous?: boolean;
  permissions?: PermissionMethod<unknown>[];
  access?: {resource: string; action: string};
  body?: ZodSchema<TBody>;
  query?: ZodSchema<TQuery>;
  response?: ZodSchema<TResponse>;
  summary?: string;
  description?: string;
  tag?: string;
  status?: number;
}

export interface InstanceActionConfig<TDoc, TBody, TQuery, TResponse>
  extends BaseActionConfig<TBody, TQuery, TResponse> {
  handler: (ctx: ActionContext<TDoc, TBody, TQuery>) => TResponse | Promise<TResponse>;
}

export interface CollectionActionConfig<TBody, TQuery, TResponse>
  extends BaseActionConfig<TBody, TQuery, TResponse> {
  handler: (
    ctx: Omit<ActionContext<never, TBody, TQuery>, "doc">
  ) => TResponse | Promise<TResponse>;
}

export const defineInstanceAction = <TDoc, TBody = unknown, TQuery = unknown, TResponse = unknown>(
  config: InstanceActionConfig<TDoc, TBody, TQuery, TResponse>
): InstanceActionConfig<TDoc, TBody, TQuery, TResponse> => {
  return config;
};

export const defineCollectionAction = <TBody = unknown, TQuery = unknown, TResponse = unknown>(
  config: CollectionActionConfig<TBody, TQuery, TResponse>
): CollectionActionConfig<TBody, TQuery, TResponse> => {
  return config;
};

type ActionScope = "instance" | "collection";

type RegisteredAction<T> =
  | {scope: "instance"; name: string; config: InstanceActionConfig<T, unknown, unknown, unknown>}
  | {scope: "collection"; name: string; config: CollectionActionConfig<unknown, unknown, unknown>};

const mapActionToCrudMethod = (scope: ActionScope, httpMethod: "GET" | "POST"): RESTMethod => {
  if (scope === "instance") {
    return httpMethod === "GET" ? "read" : "update";
  }
  return httpMethod === "GET" ? "list" : "create";
};

const resolveActionAccess = (
  action: BaseActionConfig<unknown, unknown, unknown>,
  scope: ActionScope,
  routerAccess?: ModelRouterAccessOptions
): {action: string; resource: string} | null | undefined => {
  if (action.access) {
    return action.access;
  }
  if (!routerAccess?.resource) {
    return undefined;
  }
  const crud = mapActionToCrudMethod(scope, action.method);
  const mapped = routerAccess.actions?.[crud];
  if (mapped === null) {
    return null;
  }
  return {action: mapped ?? crud, resource: routerAccess.resource};
};

export const runActionPermissions = async <T>(
  action: BaseActionConfig<unknown, unknown, unknown>,
  scope: ActionScope,
  model: Model<T>,
  req: Request,
  doc?: T,
  accessControl?: AnyTerrenoAccess,
  routerAccess?: ModelRouterAccessOptions
): Promise<void> => {
  const method = mapActionToCrudMethod(scope, action.method);
  let permissions = action.permissions;
  const rbacAccess = resolveActionAccess(action, scope, routerAccess);
  if (rbacAccess === null || permissions?.length === 0) {
    permissions = [];
  } else if (rbacAccess && accessControl) {
    const isPermitted = createIsPermitted({can: accessControl.can});
    const rbacCheck = isPermitted({
      [rbacAccess.resource]: [rbacAccess.action],
    }) as PermissionMethod<unknown>;
    permissions = [...(action.permissions ?? []), rbacCheck];
  }
  if (!permissions) {
    throw new APIError({status: 500, title: "Action missing permissions configuration"});
  }
  const allowed = await checkPermissions(method, permissions, req.user, doc);
  if (allowed) {
    return;
  }

  if (!doc) {
    // Status kept at 405 for backwards compatibility with the same pre-document permission denial
    // in modelRouter's array operations; changing it would break consumers matching on it.
    throw new APIError({
      code: "action-access-denied",
      detail:
        `Access to ${method.toUpperCase()} on ${model.modelName} ` + `denied for ${req.user?.id}`,
      meta: {action: method.toUpperCase(), model: model.modelName},
      status: 405,
      title: "Access denied",
    });
  }

  throw new ForbiddenError({
    code: "action-access-denied",
    detail:
      `Access to ${method.toUpperCase()} on ${model.modelName}:${req.params.id} ` +
      `denied for ${req.user?.id}`,
    meta: {action: method.toUpperCase(), model: model.modelName},
    title: "Access denied",
  });
};

const flattenZodFieldErrors = (
  fieldErrors: Record<string, string[] | undefined>
): Record<string, string> => {
  const fields: Record<string, string> = {};
  for (const [key, msgs] of Object.entries(fieldErrors)) {
    if (msgs && msgs.length > 0) {
      fields[key] = msgs[0];
    }
  }
  return fields;
};

export const validateActionRequest = <TBody, TQuery>({
  action,
  req,
}: {
  action: BaseActionConfig<TBody, TQuery, unknown>;
  req: Request;
}): {body: TBody | undefined; query: TQuery | undefined} => {
  let body: TBody | undefined;
  if (action.body) {
    const parsedBody = action.body.safeParse(req.body);
    if (!parsedBody.success) {
      throw new ValidationError({
        code: "action-body-validation-failed",
        detail: "The request body did not match the action's schema",
        fields: flattenZodFieldErrors(parsedBody.error.flatten().fieldErrors),
        title: "Validation failed",
      });
    }
    body = parsedBody.data;
  } else {
    body = req.body as TBody;
  }

  let query: TQuery | undefined;
  if (action.query) {
    const parsedQuery = action.query.safeParse(req.query);
    if (!parsedQuery.success) {
      throw new ValidationError({
        code: "action-query-validation-failed",
        detail: "The query parameters did not match the action's schema",
        fields: flattenZodFieldErrors(parsedQuery.error.flatten().fieldErrors),
        title: "Validation failed",
      });
    }
    query = parsedQuery.data;
  } else {
    query = req.query as TQuery;
  }

  return {body, query};
};

export const wrapActionResponse = (
  handlerResult: unknown,
  action: BaseActionConfig<unknown, unknown, unknown>,
  res: Response
): void => {
  if (res.headersSent) {
    return;
  }
  res.status(action.status ?? 200).json({data: handlerResult ?? null});
};

let inlineOpenApiSchemaCounter = 0;

const zodToJsonSchema = (zodSchema: ZodType): Record<string, unknown> => {
  const registry = new OpenAPIRegistry();
  const refId = `ActionInlineSchema${inlineOpenApiSchemaCounter++}`;
  registry.register(refId, zodSchema);
  const generator = new OpenApiGeneratorV3(registry.definitions);
  const {components} = generator.generateComponents();
  const schema = components?.schemas?.[refId];
  if (schema && typeof schema === "object") {
    return schema as Record<string, unknown>;
  }
  return {type: "object"};
};

const queryParametersFromSchema = (querySchema: ZodType): Record<string, unknown>[] => {
  const jsonSchema = zodToJsonSchema(querySchema);
  const properties = jsonSchema.properties as Record<string, Record<string, unknown>> | undefined;
  if (!properties) {
    return [];
  }
  const requiredFields = (jsonSchema.required as string[] | undefined) ?? [];
  return Object.entries(properties).map(([name, schema]) => ({
    in: "query",
    name,
    required: requiredFields.includes(name),
    schema,
  }));
};

export const createActionOpenApiMiddleware = <T>({
  action,
  scope,
  actionName,
  model,
  options,
}: {
  action: BaseActionConfig<unknown, unknown, unknown>;
  scope: ActionScope;
  actionName: string;
  model: Model<T>;
  options: Partial<ModelRouterOptions<T>>;
}): express.RequestHandler => {
  if (!options.openApi?.path) {
    return (_req, _res, next) => next();
  }

  const tag = action.tag ?? model.collection.collectionName;
  const statusCode = String(action.status ?? 200);

  const parameters: Record<string, unknown>[] = [];
  if (scope === "instance") {
    parameters.push({
      in: "path",
      name: "id",
      required: true,
      schema: {type: "string"},
    });
  }
  if (action.query) {
    parameters.push(...queryParametersFromSchema(action.query));
  }

  const operation: Record<string, unknown> = {
    description: action.description,
    operationId: `${tag}_${actionName}`,
    parameters,
    responses: {
      [statusCode]: {
        content: {
          "application/json": {
            schema: action.response
              ? {
                  properties: {
                    data: zodToJsonSchema(action.response),
                  },
                  required: ["data"],
                  type: "object",
                }
              : {
                  properties: {
                    data: {type: "object"},
                  },
                  type: "object",
                },
          },
        },
        description: "Successful response",
      },
      ...defaultOpenApiErrorResponses,
    },
    summary: action.summary ?? `${actionName} ${scope} action`,
    tags: [tag],
  };

  if (action.body) {
    operation.requestBody = {
      content: {
        "application/json": {
          schema: zodToJsonSchema(action.body),
        },
      },
      required: true,
    };
  }

  return options.openApi.path(operation);
};

const getArrayFieldNames = <T>(model: Model<T>): string[] => {
  return (Object.values(model.schema.paths) as SchemaType[])
    .filter((config) => config.instance === "Array")
    .map((config) => config.path);
};

// Registration-time validation throws APIError so misconfiguration fails at app boot.
const validateActionConfig = (
  scope: ActionScope,
  name: string,
  config: BaseActionConfig<unknown, unknown, unknown>
): void => {
  if (!name) {
    throw new APIError({status: 500, title: "Action name cannot be empty"});
  }
  if (!ACTION_NAME_PATTERN.test(name)) {
    throw new APIError({
      status: 500,
      title: `Invalid action name "${name}". Action names must match ${ACTION_NAME_PATTERN.toString()}`,
    });
  }
  if (config.permissions === undefined && !config.access) {
    throw new APIError({
      status: 500,
      title:
        `Action "${name}" (${scope}) is missing required "permissions" or "access". ` +
        "Provide at least one permission function, an access descriptor, or [] to disable the action.",
    });
  }
  if (config.permissions !== undefined && config.permissions.length === 0 && !config.access) {
    return;
  }
  if (config.method !== "GET" && config.method !== "POST") {
    throw new APIError({
      status: 500,
      title: `Action "${name}" (${scope}) only supports GET and POST methods`,
    });
  }
};

export const assertNoActionCollisions = <T>(
  model: Model<T>,
  options: Pick<ModelRouterOptions<T>, "instanceActions" | "collectionActions">
): void => {
  const arrayFields = new Set(getArrayFieldNames(model));

  const validateMap = (
    actions:
      | Record<string, InstanceActionConfig<T, unknown, unknown, unknown>>
      | Record<string, CollectionActionConfig<unknown, unknown, unknown>>
      | undefined,
    scope: ActionScope
  ): void => {
    if (!actions) {
      return;
    }
    for (const [name, config] of Object.entries(actions)) {
      validateActionConfig(scope, name, config);
      if (scope === "instance" && arrayFields.has(name)) {
        throw new APIError({
          status: 500,
          title: `instanceAction '${name}' collides with array field operations on /:id/${name}`,
        });
      }
    }
  };

  validateMap(options.instanceActions, "instance");
  validateMap(options.collectionActions, "collection");
};

const buildActionMiddleware = <T>(
  model: Model<T>,
  options: Partial<ModelRouterOptions<T>>,
  registered: RegisteredAction<T>
): express.RequestHandler[] => {
  const action = registered.config;
  const scope = registered.scope;
  const actionName = registered.name;

  const preDocPermissions = async (req: Request, _res: Response, next: NextFunction) => {
    try {
      await runActionPermissions(
        action,
        scope,
        model,
        req,
        undefined,
        options.accessControl,
        options.access
      );
      return next();
    } catch (error) {
      return next(error);
    }
  };

  const loadDocAndPostPermissions =
    scope === "instance"
      ? async (req: Request, _res: Response, next: NextFunction) => {
          try {
            const doc = await loadDocOr404<T>(
              model,
              req.params.id as string,
              options.populatePaths
            );
            (req as Request & {obj?: T}).obj = doc;
            await runActionPermissions(
              action,
              scope,
              model,
              req,
              doc,
              options.accessControl,
              options.access
            );
            return next();
          } catch (error) {
            return next(error);
          }
        }
      : null;

  const validateAndRun = asyncHandler(async (req: Request, res: Response) => {
    const {body, query} = validateActionRequest({action, req});
    const doc = scope === "instance" ? (req as Request & {obj?: T}).obj : undefined;

    const ctx = {
      body,
      doc,
      query,
      req,
      res,
      user: req.user,
    };

    const result =
      scope === "instance"
        ? await (action as InstanceActionConfig<T, unknown, unknown, unknown>).handler(
            ctx as ActionContext<T, unknown, unknown>
          )
        : await (action as CollectionActionConfig<unknown, unknown, unknown>).handler(
            ctx as Omit<ActionContext<never, unknown, unknown>, "doc">
          );

    wrapActionResponse(result, action, res);
  });

  const chain: express.RequestHandler[] = [
    authenticateMiddleware(action.allowAnonymous ?? options.allowAnonymous),
    createActionOpenApiMiddleware({action, actionName, model, options, scope}),
    preDocPermissions,
  ];
  if (loadDocAndPostPermissions) {
    chain.push(loadDocAndPostPermissions);
  }
  chain.push(validateAndRun);
  return chain;
};

export const registerActionRoutes = <T>(
  router: express.Router,
  model: Model<T>,
  options: Partial<ModelRouterOptions<T>>
): void => {
  const instanceActions = options.instanceActions ?? {};
  const collectionActions = options.collectionActions ?? {};

  const registeredActions: RegisteredAction<T>[] = [
    ...Object.entries(instanceActions).map(([name, config]) => ({
      config,
      name,
      scope: "instance" as const,
    })),
    ...Object.entries(collectionActions).map(([name, config]) => ({
      config,
      name,
      scope: "collection" as const,
    })),
  ];

  for (const registered of registeredActions) {
    const {config, name, scope} = registered;
    const middleware = buildActionMiddleware(model, options, registered);
    const routePath = scope === "instance" ? `/:id/${name}` : `/${name}`;
    if (config.method === "GET") {
      router.get(routePath, middleware);
    } else {
      router.post(routePath, middleware);
    }
  }
};
