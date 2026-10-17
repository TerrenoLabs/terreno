import mongoose from "mongoose";

import {addPopulateToQuery, type JSONValue} from "../api";
import type {User} from "../auth";
import {isAPIError} from "../errors";
import {checkPermissions} from "../permissions";
import type {PopulatePath} from "../populate";
import {executeCreate, executeDelete, executeUpdate} from "../sync/executors";
import {defaultResponseHandler} from "../transformers";
import {createMCPRequest} from "./createMCPRequest";
import {buildListQuery} from "./query";
import {restWriteExcludeFields, writeExcludeFields} from "./schemaGenerator";
import type {MCPDocument, MCPMethod, MCPRegistryEntry, MCPToolArgs, MCPToolResult} from "./types";

/** Methods whose responses go through a responseHandler (delete returns only a status). */
type SerializableMCPMethod = Exclude<MCPMethod, "delete">;

// Causes stay server-side: a WeakMap lets the observability wrapper capture the
// original exception without adding stack traces or internal details to the MCP result.
const errorCauses = new WeakMap<MCPToolResult, unknown>();

export const getMCPErrorCause = (result: MCPToolResult): unknown => {
  return errorCauses.get(result);
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

/** Mongoose documents only expose their fields through toObject(). */
const toPlain = (value: unknown): unknown => {
  if (isPlainObject(value) && typeof value.toObject === "function") {
    return (value.toObject as () => unknown)();
  }
  return value;
};

/**
 * Values that serialize themselves — ObjectId, Date, Decimal128, Buffer — must be passed
 * through untouched. Rebuilding them entry by entry would replace an ObjectId with its
 * raw `{buffer: ...}` internals and a Date with `{}`.
 */
const isSelfSerializing = (value: Record<string, unknown>): boolean => {
  return typeof value.toJSON === "function";
};

/**
 * Delete a dot-notation path, descending into arrays element-wise so paths through
 * arrays of subdocuments (e.g. "items.secret") are removed from every element.
 */
const deleteAtPath = (obj: unknown, segments: string[]): void => {
  if (Array.isArray(obj)) {
    for (const item of obj) {
      deleteAtPath(item, segments);
    }
    return;
  }
  if (!isPlainObject(obj) || segments.length === 0) {
    return;
  }
  const [head, ...rest] = segments;
  if (rest.length === 0) {
    delete obj[head];
    return;
  }
  deleteAtPath(obj[head], rest);
};

/**
 * Remove excluded fields from an MCP response.
 *
 * Bare field names are removed at every depth (including inside arrays and populated
 * refs) so a redacted name never leaks through a nested document. Use a dot-notation
 * path when only one specific location should be removed. Literal object keys that
 * equal a denylist entry (including dotted names) are also dropped.
 */
const stripExcludedFields = (data: unknown, excludeFields: string[]): unknown => {
  if (!excludeFields.length || !data) {
    return data;
  }

  const bareKeys = new Set(excludeFields.filter((field) => !field.includes(".")));
  const dotPaths = excludeFields
    .filter((field) => field.includes("."))
    .map((field) => field.split("."));

  const strip = (value: unknown): unknown => {
    const plain = toPlain(value);
    if (Array.isArray(plain)) {
      return plain.map(strip);
    }
    if (!isPlainObject(plain) || isSelfSerializing(plain)) {
      return plain;
    }
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(plain)) {
      // Exact key match covers both bare names and literal dotted keys
      // ("metadata.nested.token") that Mongoose would otherwise treat as a path.
      if (bareKeys.has(key) || excludeFields.includes(key)) {
        continue;
      }
      result[key] = strip(nested);
    }
    return result;
  };

  const stripped = strip(data);
  for (const segments of dotPaths) {
    deleteAtPath(stripped, segments);
  }
  return stripped;
};

/**
 * Resolve the `populate` tool argument against the model router's declared paths.
 *
 * REST never lets a caller choose populate paths — population comes entirely from
 * `options.populatePaths`, whose `fields` limit which columns of the referenced document
 * are exposed. An arbitrary path from an MCP client would bypass that limit and return
 * whole referenced documents, so a requested path must match a declared one. Requesting
 * paths only narrows the set; anything undeclared is an error rather than a silent widen.
 */
const resolvePopulatePaths = (
  populateStr: string | undefined,
  declaredPaths?: PopulatePath[]
): {paths?: PopulatePath[]; error?: string} => {
  const declared = declaredPaths ?? [];
  if (!populateStr) {
    return {paths: declared};
  }

  const requested = populateStr
    .split(",")
    .map((path) => path.trim())
    .filter(Boolean);
  if (!requested.length) {
    return {paths: declared};
  }

  const paths: PopulatePath[] = [];
  for (const path of requested) {
    const match = declared.find((declaredPath) => declaredPath.path === path);
    if (!match) {
      const allowed = declared.map((declaredPath) => declaredPath.path).join(", ");
      return {
        error: allowed
          ? `${path} is not a populate-able path. Allowed: ${allowed}`
          : `${path} is not a populate-able path. This model has no populate-able paths`,
      };
    }
    if (!paths.includes(match)) {
      paths.push(match);
    }
  }
  return {paths};
};

const asOptionalString = (value: unknown): string | undefined => {
  return typeof value === "string" ? value : undefined;
};

/**
 * Remove denylisted keys from an MCP create/update body.
 *
 * Matches response redaction: a bare name is deleted at every depth (including
 * Mixed/embedded objects and arrays), and a dotted path is deleted at that
 * location only. The incoming args object is not mutated.
 */
const omitDeniedWriteFields = (body: MCPToolArgs, denied: string[]): MCPToolArgs => {
  if (denied.length === 0) {
    return body;
  }
  return stripExcludedFields(body, denied) as MCPToolArgs;
};

/** Mongoose's populated query result types don't narrow to a single document. */
const asDocument = (result: unknown): MCPDocument | null => {
  return (result ?? null) as MCPDocument | null;
};

/**
 * Run a findById query and map Mongoose CastError (malformed ids) to null so
 * callers can return a structured not-found. 24-hex ids with mixed case are
 * valid for findById even though `isValidObjectId` requires canonical lowercase.
 */
const execFindByIdQuery = async (query: {
  exec: () => Promise<unknown>;
}): Promise<MCPDocument | null> => {
  try {
    return asDocument(await query.exec());
  } catch (error) {
    if (error instanceof mongoose.Error.CastError) {
      return null;
    }
    throw error;
  }
};

const missingDocumentResult = (id: unknown): MCPToolResult => {
  return errorResult(`Document ${id} not found`);
};

/**
 * Mirror REST's `authenticateMiddleware(options.allowAnonymous)`, which answers 401 before
 * any permission check when credentials are missing. Without this, read-only helpers like
 * `IsAuthenticatedOrReadOnly` would let an anonymous MCP client list or read data that the
 * same router refuses over HTTP.
 */
const requiresAuthentication = (entry: MCPRegistryEntry, user?: User): boolean => {
  return !user && entry.options.allowAnonymous !== true;
};

/** Map executor/APIError failures onto the MCP error envelope. */
const fromExecutorError = (error: unknown): MCPToolResult => {
  if (isAPIError(error)) {
    return errorResult(error.title, error);
  }
  return errorResult(errorMessage(error), error);
};

const deniedWriteFields = (entry: MCPRegistryEntry, phase: "create" | "update"): string[] => {
  return writeExcludeFields(entry.config, restWriteExcludeFields(phase, entry.options.validation));
};

const serializeResponse = async (
  data: unknown,
  method: SerializableMCPMethod,
  entry: MCPRegistryEntry,
  user?: User
): Promise<{error: MCPToolResult} | {value: JSONValue}> => {
  try {
    const excludeFields = entry.config.excludeFields ?? [];

    if (entry.config.mcpResponseHandler) {
      const result = await entry.config.mcpResponseHandler(data, method, user);
      return {value: stripExcludedFields(result, excludeFields) as JSONValue};
    }

    // Use the model router's responseHandler if available, otherwise default
    const responseHandler = entry.options.responseHandler ?? defaultResponseHandler;

    const result = await responseHandler(
      data as NonNullable<Parameters<typeof responseHandler>[0]>,
      method,
      createMCPRequest({user}),
      entry.options
    );
    return {value: stripExcludedFields(result, excludeFields) as JSONValue};
  } catch (error) {
    if (isAPIError(error)) {
      return {error: errorResult(error.title, error)};
    }
    return {error: errorResult(`Response handler failed: ${errorMessage(error)}`, error)};
  }
};

export const handleList = async (
  entry: MCPRegistryEntry,
  args: MCPToolArgs,
  user?: User
): Promise<MCPToolResult> => {
  const {model, config, options} = entry;
  const maxLimit = config.maxLimit ?? 50;

  if (requiresAuthentication(entry, user)) {
    return errorResult("Permission denied: authentication required");
  }

  // Check permissions
  if (!(await checkPermissions("list", options.permissions.list, user))) {
    return errorResult("Permission denied: cannot list");
  }

  // Build query from args — only fields in queryFields, with an allowlist of operators
  const {error: queryError, query: builtFilter} = buildListQuery({args, config, options});
  if (queryError || !builtFilter) {
    return errorResult(queryError ?? "Could not build query");
  }
  let query: Record<string, unknown> = builtFilter;

  // Apply query filter
  if (options.queryFilter) {
    try {
      const filtered = await options.queryFilter(user, query);
      if (filtered === null) {
        return textResult(JSON.stringify({data: [], more: false, page: 1, total: 0}));
      }
      query = {...query, ...filtered};
    } catch (error) {
      if (isAPIError(error)) {
        return errorResult(error.title, error);
      }
      return errorResult(`queryFilter failed: ${errorMessage(error)}`, error);
    }
  }

  // Pagination
  const limit = Math.max(1, Math.min(Number(args.limit) || maxLimit, maxLimit));
  const page = Math.max(1, Number(args.page) || 1);

  let builtQuery = model.find(query).limit(limit + 1);
  const total = await model.countDocuments(query);

  if (page > 1) {
    builtQuery = builtQuery.skip((page - 1) * limit);
  }

  // Sort
  const sort = asOptionalString(args.sort) ?? options.sort;
  if (sort) {
    builtQuery = builtQuery.sort(sort);
  }

  // Populate
  const {error: populateError, paths: populatePaths} = resolvePopulatePaths(
    asOptionalString(args.populate),
    options.populatePaths
  );
  if (populateError || !populatePaths) {
    return errorResult(populateError ?? "Could not resolve populate paths");
  }
  const populatedQuery = addPopulateToQuery(builtQuery, populatePaths);

  const data = await populatedQuery.exec();
  const more = data.length > limit;
  const sliced = more ? data.slice(0, limit) : data;

  const serialized = await serializeResponse(sliced, "list", entry, user);
  if ("error" in serialized) {
    return serialized.error;
  }

  return textResult(JSON.stringify({data: serialized.value, more, page, total}));
};

export const handleRead = async (
  entry: MCPRegistryEntry,
  args: MCPToolArgs,
  user?: User
): Promise<MCPToolResult> => {
  const {model, options} = entry;

  if (requiresAuthentication(entry, user)) {
    return errorResult("Permission denied: authentication required");
  }

  // Check method-level permission
  if (!(await checkPermissions("read", options.permissions.read, user))) {
    return errorResult("Permission denied: cannot read");
  }

  const {error: populateError, paths: populatePaths} = resolvePopulatePaths(
    asOptionalString(args.populate),
    options.populatePaths
  );
  if (populateError || !populatePaths) {
    return errorResult(populateError ?? "Could not resolve populate paths");
  }
  const id = asOptionalString(args.id);
  if (!id) {
    return missingDocumentResult(args.id);
  }
  const data = await execFindByIdQuery(addPopulateToQuery(model.findById(id), populatePaths));

  if (!data) {
    return missingDocumentResult(id);
  }

  // Check object-level permission
  if (!(await checkPermissions("read", options.permissions.read, user, data))) {
    return errorResult("Permission denied: cannot read this document");
  }

  const serialized = await serializeResponse(data, "read", entry, user);
  if ("error" in serialized) {
    return serialized.error;
  }
  return textResult(JSON.stringify({data: serialized.value}));
};

export const handleCreate = async (
  entry: MCPRegistryEntry,
  args: MCPToolArgs,
  user?: User
): Promise<MCPToolResult> => {
  const {model, options} = entry;

  if (requiresAuthentication(entry, user)) {
    return errorResult("Permission denied: authentication required");
  }

  const body = omitDeniedWriteFields(args, deniedWriteFields(entry, "create")) as MCPToolArgs;
  const req = createMCPRequest({body, user});

  let data: MCPDocument | null;
  try {
    const result = await executeCreate({
      body,
      model,
      options,
      req,
      user,
      writeModelName: entry.modelName,
    });
    data = result.doc as MCPDocument;
  } catch (error) {
    return fromExecutorError(error);
  }

  const serialized = await serializeResponse(data, "create", entry, user);
  if ("error" in serialized) {
    return serialized.error;
  }
  return textResult(JSON.stringify({data: serialized.value}));
};

export const handleUpdate = async (
  entry: MCPRegistryEntry,
  args: MCPToolArgs,
  user?: User
): Promise<MCPToolResult> => {
  const {model, options} = entry;
  const {id, ...updateFields} = args;

  if (requiresAuthentication(entry, user)) {
    return errorResult("Permission denied: authentication required");
  }

  const documentId = asOptionalString(id);
  if (!documentId) {
    return missingDocumentResult(id);
  }

  const body = omitDeniedWriteFields(
    updateFields,
    deniedWriteFields(entry, "update")
  ) as MCPToolArgs;
  const req = createMCPRequest({body, user});

  let doc: MCPDocument | null;
  try {
    const result = await executeUpdate({
      body,
      id: documentId,
      model,
      options,
      req,
      user,
      writeModelName: entry.modelName,
    });
    doc = result.doc as MCPDocument;
  } catch (error) {
    return fromExecutorError(error);
  }

  const serialized = await serializeResponse(doc, "update", entry, user);
  if ("error" in serialized) {
    return serialized.error;
  }
  return textResult(JSON.stringify({data: serialized.value}));
};

export const handleDelete = async (
  entry: MCPRegistryEntry,
  args: MCPToolArgs,
  user?: User
): Promise<MCPToolResult> => {
  const {model, options} = entry;
  const {id} = args;

  if (requiresAuthentication(entry, user)) {
    return errorResult("Permission denied: authentication required");
  }

  const documentId = asOptionalString(id);
  if (!documentId) {
    return missingDocumentResult(id);
  }

  try {
    await executeDelete({
      id: documentId,
      model,
      options,
      req: createMCPRequest({body: args, user}),
      user,
    });
  } catch (error) {
    return fromExecutorError(error);
  }

  return textResult(JSON.stringify({success: true}));
};

export const errorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

export const textResult = (text: string): MCPToolResult => ({
  content: [{text, type: "text" as const}],
});

export const errorResult = (message: string, cause?: unknown): MCPToolResult => {
  const result: MCPToolResult = {
    content: [{text: JSON.stringify({error: message}), type: "text" as const}],
    isError: true,
  };
  if (cause !== undefined) {
    errorCauses.set(result, cause);
  }
  return result;
};
