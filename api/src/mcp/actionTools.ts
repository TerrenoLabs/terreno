import type {Request, Response} from "express";
import type {Model} from "mongoose";
import {toJSONSchema, type ZodObject, type ZodType, z} from "zod";

import {
  type ActionContext,
  type ActionScope,
  type BaseActionConfig,
  type CollectionActionConfig,
  type InstanceActionConfig,
  runActionPermissions,
} from "../actions";
import type {ModelRouterOptions} from "../api";
import type {User} from "../auth";
import type {CollectionRecord} from "../collectionRegistry";
import {loadDocOr404} from "../docLoader";
import {APIError, isAPIError} from "../errors";
import {createMCPRequest} from "./createMCPRequest";
import {errorMessage, errorResult, textResult} from "./handlers";
import {executeTool} from "./toolExecution";
import type {MCPToolDefinition} from "./toolGenerator";
import type {MCPToolArgs, MCPToolInputSchema, MCPToolResult} from "./types";

type AnyActionConfig =
  | InstanceActionConfig<unknown, unknown, unknown, unknown>
  | CollectionActionConfig<unknown, unknown, unknown>;

interface MCPActionEntry {
  actionName: string;
  config: AnyActionConfig;
  model: Model<unknown>;
  options: ModelRouterOptions<unknown>;
  scope: ActionScope;
}

/**
 * Stands in for `res` during an MCP call. MCP returns the handler's value as the tool result,
 * so a handler that writes to `res` has nowhere to send it; failing loudly beats a silent drop.
 */
const createMCPResponseStub = (toolName: string): Response => {
  return new Proxy({} as Response, {
    get: (_target, property) => {
      // Inspectors and promise checks probe symbols; only real field access is an error.
      if (typeof property === "symbol") {
        return undefined;
      }
      throw new APIError({
        code: "mcp-action-touched-response",
        detail: `The action behind MCP tool "${toolName}" read res.${property}. Return a value instead of writing to res, or leave mcp off this action.`,
        status: 500,
        title: "Action used res during an MCP call",
      });
    },
  });
};

const ID_SCHEMA = z.string().describe("Id of the document to run the action on");

/** `{id}` merged with the body (POST) or query (GET) schema; collection actions have no id. */
const buildActionInputSchema = (scope: ActionScope, config: AnyActionConfig): ZodType => {
  const idShape: Record<string, ZodType> = scope === "instance" ? {id: ID_SCHEMA} : {};
  const argsSchema = config.method === "GET" ? config.query : config.body;
  if (!argsSchema) {
    // No schema: REST forwards the raw body, so the tool accepts any extra arguments too.
    return z.looseObject(idShape);
  }
  // safeExtend keeps refinements on the action's schema; registration checked it is an object.
  return (argsSchema as unknown as ZodObject).safeExtend(idShape);
};

/** Expected refusals carry no cause, so the audit log records them as warnings. */
const toolErrorFromException = (error: unknown): MCPToolResult => {
  if (!isAPIError(error)) {
    return errorResult(errorMessage(error), error);
  }
  const fieldErrors = error.meta?.fields as Record<string, string> | undefined;
  const fields = fieldErrors
    ? Object.entries(fieldErrors)
        .map(([field, message]) => `${field}: ${message}`)
        .join("; ")
    : undefined;
  const message = fields ? `${error.title} (${fields})` : error.title;
  return (error.status ?? 500) < 500 ? errorResult(message) : errorResult(message, error);
};

const isAuthenticationRequired = (entry: MCPActionEntry, user?: User): boolean => {
  return !user && !(entry.config.allowAnonymous ?? entry.options.allowAnonymous);
};

/**
 * Run an action the way REST does: pre-document permissions, load the document and re-check
 * (instance actions), then the handler. The MCP server already validated `args` against the
 * action's zod schema, so the parsed values go to the handler as-is.
 */
const runActionTool = async (
  entry: MCPActionEntry,
  toolName: string,
  args: MCPToolArgs,
  user?: User
): Promise<MCPToolResult> => {
  const {config, model, options, scope} = entry;
  if (isAuthenticationRequired(entry, user)) {
    return errorResult("Permission denied: authentication required");
  }
  // Only instance tools add `id`; a collection action's own schema may define one for its body.
  const {id, ...instanceInput} = args;
  const input = scope === "instance" ? instanceInput : args;
  const isGet = config.method === "GET";
  const req = createMCPRequest({
    body: isGet ? {} : input,
    params: scope === "instance" ? {id: String(id)} : {},
    query: isGet ? input : {},
    user,
  });

  try {
    await runActionPermissions(
      config as BaseActionConfig<unknown, unknown, unknown>,
      scope,
      model,
      req,
      undefined,
      options.accessControl,
      options.access
    );
    let doc: unknown;
    if (scope === "instance") {
      doc = await loadDocOr404(model, String(id), options.populatePaths);
      (req as Request & {obj?: unknown}).obj = doc;
      await runActionPermissions(
        config as BaseActionConfig<unknown, unknown, unknown>,
        scope,
        model,
        req,
        doc,
        options.accessControl,
        options.access
      );
    }

    const ctx = {
      body: req.body,
      doc,
      query: req.query,
      req,
      res: createMCPResponseStub(toolName),
      user: req.user,
    };
    const result =
      scope === "instance"
        ? await (config as InstanceActionConfig<unknown, unknown, unknown, unknown>).handler(
            ctx as ActionContext<unknown, unknown, unknown>
          )
        : await (config as CollectionActionConfig<unknown, unknown, unknown>).handler(
            ctx as Omit<ActionContext<never, unknown, unknown>, "doc">
          );
    return textResult(JSON.stringify(result ?? null));
  } catch (error) {
    return toolErrorFromException(error);
  }
};

const isDisabled = (config: AnyActionConfig): boolean => {
  return config.permissions !== undefined && config.permissions.length === 0 && !config.access;
};

const listMCPActions = (record: CollectionRecord): MCPActionEntry[] => {
  const {model, options} = record;
  const entries: MCPActionEntry[] = [];
  const scopes: [ActionScope, Record<string, AnyActionConfig> | undefined][] = [
    ["instance", options.instanceActions as Record<string, AnyActionConfig> | undefined],
    ["collection", options.collectionActions as Record<string, AnyActionConfig> | undefined],
  ];
  for (const [scope, actions] of scopes) {
    for (const [actionName, config] of Object.entries(actions ?? {})) {
      if (config.mcp && !isDisabled(config)) {
        entries.push({actionName, config, model, options, scope});
      }
    }
  }
  return entries;
};

const describeAction = (entry: MCPActionEntry): string => {
  const {actionName, config, model, scope} = entry;
  const base =
    config.mcp?.description ??
    config.description ??
    config.summary ??
    `Run the ${actionName} action on ${model.modelName}`;
  return scope === "instance" ? `${base} (pass the ${model.modelName} id as "id")` : base;
};

/** MCP tools for every modelRouter action that sets `mcp`, across all registered routers. */
export const generateActionTools = (records: CollectionRecord[]): MCPToolDefinition[] => {
  const tools: MCPToolDefinition[] = [];
  for (const record of records) {
    for (const entry of listMCPActions(record)) {
      const toolName = entry.config.mcp?.name as string;
      const zodSchema = buildActionInputSchema(entry.scope, entry.config);
      tools.push({
        description: describeAction(entry),
        handler: (args: MCPToolArgs, user?: User) =>
          executeTool({
            labels: {
              mcpAction: entry.actionName,
              mcpModel: entry.model.modelName,
              mcpTool: toolName,
            },
            run: () => runActionTool(entry, toolName, args, user),
            user,
          }),
        inputSchema: toJSONSchema(zodSchema) as MCPToolInputSchema,
        name: toolName,
        zodSchema,
      });
    }
  }
  return tools;
};
