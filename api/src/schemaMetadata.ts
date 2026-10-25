import type {Model} from "mongoose";

import type {ModelRouterValidationOptions} from "./openApiValidator";
import type {PopulatePath} from "./populate";
import type {FieldMask} from "./rbac/types";

export const SYSTEM_FIELD_PATHS = new Set(["_id", "id", "__v", "created", "updated", "deleted"]);

export type FieldKind =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "dateOnly"
  | "objectId"
  | "embedded"
  | "mixed"
  | "map";

export interface FieldDescription {
  kind: FieldKind;
  required: boolean;
  description?: string;
  enum?: string[];
  ref?: string;
  isArray?: boolean;
  item?: FieldDescription;
  fields?: Record<string, FieldDescription>;
  system?: boolean;
  default?: unknown;
  writableOnCreate?: boolean;
  writableOnUpdate?: boolean;
}

export interface ModelDescription {
  modelName: string;
  fields: Record<string, FieldDescription>;
}

export interface DescribeModelOptions {
  populatePaths?: PopulatePath[];
  extraProperties?: Record<string, FieldDescription>;
}

export interface DescribeModelForRouterOptions extends DescribeModelOptions {
  validation?: boolean | ModelRouterValidationOptions;
  excludeFields?: string[];
  fieldView?: FieldMask;
}

interface MongooseSchemaPath {
  $__schemaType?: MongooseSchemaPath;
  caster?: MongooseSchemaPath;
  enumValues?: string[];
  getEmbeddedSchemaType?: () => MongooseSchemaPath | undefined;
  instance?: string;
  isRequired?: boolean;
  /** What the schema passed as `required`; a function means the field is only sometimes required. */
  originalRequiredValue?: unknown;
  options?: {
    default?: unknown;
    description?: string;
    enum?: string[];
    of?: unknown;
    ref?: string;
    type?: unknown;
  };
  schema?: {
    paths: Record<string, unknown>;
  };
}

const isSystemField = (path: string): boolean => SYSTEM_FIELD_PATHS.has(path);

const isMapWildcardPath = (path: string): boolean => path === "$*" || path.endsWith(".$*");

const normalizeKind = (instance: string | undefined): FieldKind => {
  switch (instance) {
    case "String":
      return "string";
    case "Number":
      return "number";
    case "Boolean":
      return "boolean";
    case "Date":
      return "date";
    case "DateOnly":
      return "dateOnly";
    case "ObjectId":
    case "ObjectID":
    case "SchemaObjectId":
      return "objectId";
    case "Mixed":
      return "mixed";
    case "Map":
      return "map";
    case "Embedded":
      return "embedded";
    default:
      return "mixed";
  }
};

const getNestedValueSchemaPath = (
  schemaPath: MongooseSchemaPath
): MongooseSchemaPath | undefined => {
  if (typeof schemaPath.getEmbeddedSchemaType === "function") {
    const embedded = schemaPath.getEmbeddedSchemaType();
    if (embedded) {
      return embedded;
    }
  }
  return schemaPath.$__schemaType ?? schemaPath.caster;
};

const describeEmbeddedSchema = (
  embeddedSchema: {paths: Record<string, unknown>} | undefined
): Record<string, FieldDescription> | undefined => {
  if (!embeddedSchema?.paths) {
    return undefined;
  }

  const fields: Record<string, FieldDescription> = {};
  for (const [path, rawSchemaPath] of Object.entries(embeddedSchema.paths)) {
    if (isMapWildcardPath(path)) {
      continue;
    }
    fields[path] = describeSchemaPath(path, rawSchemaPath as MongooseSchemaPath);
  }
  return nestDottedFieldDescriptions(fields);
};

const describeCaster = (caster: MongooseSchemaPath): FieldDescription => {
  const kind = normalizeKind(caster.instance);
  const enumValues = caster.enumValues?.length
    ? (caster.enumValues as string[])
    : caster.options?.enum;

  return {
    description: caster.options?.description,
    enum: enumValues?.length ? enumValues : undefined,
    kind,
    ref: caster.options?.ref,
    required: false,
  };
};

/**
 * Whether a path is required on every document. A conditional `required` (a function) only
 * applies to some documents, so clients must not treat the field as always present.
 */
const isAlwaysRequired = (schemaPath: MongooseSchemaPath): boolean => {
  return Boolean(schemaPath.isRequired) && typeof schemaPath.originalRequiredValue !== "function";
};

const describeSchemaPath = (path: string, schemaPath: MongooseSchemaPath): FieldDescription => {
  const enumValues = schemaPath.enumValues?.length
    ? (schemaPath.enumValues as string[])
    : schemaPath.options?.enum;
  const base: FieldDescription = {
    default: schemaPath.options?.default,
    description: schemaPath.options?.description,
    enum: enumValues?.length ? enumValues : undefined,
    kind: normalizeKind(schemaPath.instance),
    ref: schemaPath.options?.ref,
    required: isAlwaysRequired(schemaPath),
    system: isSystemField(path),
  };

  if (schemaPath.instance === "Array") {
    if (schemaPath.schema) {
      const nestedFields = describeEmbeddedSchema(schemaPath.schema);
      return {
        ...base,
        fields: nestedFields,
        isArray: true,
        item: {
          fields: nestedFields,
          kind: "embedded",
          required: false,
        },
        kind: "embedded",
      };
    }

    const itemSchemaPath = getNestedValueSchemaPath(schemaPath);
    if (itemSchemaPath) {
      const item = describeCaster(itemSchemaPath);
      const {enum: _arrayEnum, ...arrayBase} = base;
      return {
        ...arrayBase,
        isArray: true,
        item,
        kind: item.kind,
      };
    }

    return {
      ...base,
      isArray: true,
      item: {kind: "mixed", required: false},
      kind: "mixed",
    };
  }

  if (schemaPath.instance === "Embedded" && schemaPath.schema) {
    const fields = describeEmbeddedSchema(schemaPath.schema);
    return {
      ...base,
      fields,
      kind: "embedded",
    };
  }

  if (schemaPath.instance === "Map") {
    const valueSchemaPath = getNestedValueSchemaPath(schemaPath);
    return {
      ...base,
      item: valueSchemaPath ? describeCaster(valueSchemaPath) : {kind: "mixed", required: false},
      kind: "map",
    };
  }

  return base;
};

export const nestDottedFieldDescriptions = (
  fields: Record<string, FieldDescription>
): Record<string, FieldDescription> => {
  const root: Record<string, FieldDescription> = {};

  for (const [path, field] of Object.entries(fields)) {
    if (!path.includes(".")) {
      root[path] = field;
      continue;
    }

    const parts = path.split(".");
    let current = root;
    for (let index = 0; index < parts.length - 1; index++) {
      const part = parts[index];
      if (!current[part]) {
        current[part] = {
          fields: {},
          kind: "embedded",
          required: false,
        };
      }
      if (!current[part].fields) {
        current[part].fields = {};
      }
      current = current[part].fields as Record<string, FieldDescription>;
    }

    current[parts[parts.length - 1]] = field;
  }

  return root;
};

const isWritePathAllowed = (path: string, write: string[] | "*"): boolean => {
  if (write === "*") {
    return true;
  }
  return write.some((allowed) => path === allowed || path.startsWith(`${allowed}.`));
};

const applyWriteMasks = (
  fields: Record<string, FieldDescription>,
  options: DescribeModelForRouterOptions
): Record<string, FieldDescription> => {
  const validation =
    typeof options.validation === "object" && options.validation !== null
      ? options.validation
      : undefined;
  const excludeFromCreate = new Set(validation?.excludeFromCreate ?? []);
  const excludeFromUpdate = new Set(validation?.excludeFromUpdate ?? []);
  const excludeFields = new Set(options.excludeFields ?? []);
  const fieldView = options.fieldView;

  const withMasks = (path: string, field: FieldDescription): FieldDescription => {
    const writableOnCreate =
      !field.system &&
      !excludeFields.has(path) &&
      !excludeFromCreate.has(path) &&
      (!fieldView || isWritePathAllowed(path, fieldView.write));
    const writableOnUpdate =
      !field.system &&
      !excludeFields.has(path) &&
      !excludeFromUpdate.has(path) &&
      (!fieldView || isWritePathAllowed(path, fieldView.write));

    const next: FieldDescription = {
      ...field,
      writableOnCreate,
      writableOnUpdate,
    };

    if (field.fields) {
      next.fields = Object.fromEntries(
        Object.entries(field.fields).map(([nestedPath, nestedField]) => [
          nestedPath,
          withMasks(`${path}.${nestedPath}`, nestedField),
        ])
      );
    }

    if (field.item?.fields) {
      next.item = {
        ...field.item,
        fields: Object.fromEntries(
          Object.entries(field.item.fields).map(([nestedPath, nestedField]) => [
            nestedPath,
            withMasks(`${path}.${nestedPath}`, nestedField),
          ])
        ),
      };
    }

    return next;
  };

  return Object.fromEntries(
    Object.entries(fields).map(([path, field]) => [path, withMasks(path, field)])
  );
};

export const describeModel = <T>(
  model: Model<T>,
  options: DescribeModelOptions = {}
): ModelDescription => {
  const fields: Record<string, FieldDescription> = {};

  for (const [path, rawSchemaPath] of Object.entries(model.schema.paths)) {
    if (isMapWildcardPath(path)) {
      continue;
    }
    fields[path] = describeSchemaPath(path, rawSchemaPath as unknown as MongooseSchemaPath);
  }

  if (options.extraProperties) {
    for (const [path, field] of Object.entries(options.extraProperties)) {
      fields[path] = field;
    }
  }

  return {
    fields,
    modelName: model.modelName,
  };
};

export const describeModelForRouter = <T>(
  model: Model<T>,
  options: DescribeModelForRouterOptions = {}
): ModelDescription => {
  const description = describeModel(model, options);
  return {
    ...description,
    fields: applyWriteMasks(description.fields, options),
  };
};

export const fieldDescriptionToOpenApiProperty = (
  field: FieldDescription
): Record<string, unknown> => {
  if (field.isArray) {
    const items = field.item
      ? fieldDescriptionToOpenApiProperty({...field.item, isArray: false})
      : {type: "string"};
    const property: Record<string, unknown> = {
      description: field.description,
      items,
      type: "array",
    };
    return property;
  }

  if (field.kind === "embedded" && field.fields) {
    const nested = modelDescriptionToOpenApiSpec({fields: field.fields, modelName: ""});
    const property: Record<string, unknown> = {
      properties: nested.properties,
      type: "object",
    };
    if (field.description) {
      property.description = field.description;
    }
    if (nested.required.length > 0) {
      property.required = nested.required;
    }
    return property;
  }

  if (field.kind === "mixed") {
    return {description: field.description};
  }

  if (field.kind === "map") {
    const property: Record<string, unknown> = {
      additionalProperties: field.item
        ? fieldDescriptionToOpenApiProperty({...field.item, isArray: false})
        : {type: "string"},
      type: "object",
    };
    if (field.description) {
      property.description = field.description;
    }
    return property;
  }

  if (field.kind === "dateOnly") {
    return {
      description: field.description,
      type: "dateonly",
    };
  }

  const openApiType =
    field.kind === "objectId" ? "string" : field.kind === "date" ? "string" : field.kind;
  const property: Record<string, unknown> = {
    type: openApiType,
  };
  if (field.description) {
    property.description = field.description;
  }
  if (field.enum) {
    property.enum = field.enum;
  }
  if (field.kind === "objectId" && !field.system) {
    property.format = "objectid";
  }
  if (field.kind === "date") {
    property.format = "date-time";
  }
  return property;
};

export const modelDescriptionToOpenApiSpec = (
  description: ModelDescription
): {properties: Record<string, unknown>; required: string[]} => {
  const nestedFields = nestDottedFieldDescriptions(description.fields);
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [path, field] of Object.entries(nestedFields)) {
    // mongoose-to-swagger omits __v from OpenAPI components; keep parity for HTTP bodies.
    if (path === "__v") {
      continue;
    }
    properties[path] = fieldDescriptionToOpenApiProperty(field);
    if (field.required) {
      required.push(path);
    }
  }

  return {properties, required};
};

export const fieldDescriptionToAdminMeta = (
  field: FieldDescription
): {
  default?: unknown;
  description?: string;
  enum?: string[];
  itemEnum?: string[];
  itemRef?: string;
  itemType?: string;
  items?: Record<string, ReturnType<typeof fieldDescriptionToAdminMeta>>;
  ref?: string;
  required: boolean;
  searchable?: boolean;
  type: string;
} => {
  const adminType = field.isArray
    ? "array"
    : field.kind === "objectId"
      ? "objectid"
      : field.kind === "embedded"
        ? "object"
        : field.kind === "mixed"
          ? "mixed"
          : field.kind === "map"
            ? "object"
            : field.kind === "dateOnly"
              ? "dateonly"
              : field.kind;

  const meta: ReturnType<typeof fieldDescriptionToAdminMeta> = {
    default: field.default,
    description: field.description,
    enum: field.enum,
    ref: field.ref,
    required: field.required,
    searchable: adminType === "string" && !field.enum,
    type: adminType,
  };

  if (field.isArray && field.item) {
    if (field.item.ref) {
      meta.ref = field.item.ref;
    }
    if (field.item.fields) {
      meta.items = Object.fromEntries(
        Object.entries(field.item.fields).map(([key, nestedField]) => [
          key,
          fieldDescriptionToAdminMeta(nestedField),
        ])
      );
    } else {
      meta.itemType =
        field.item.kind === "objectId"
          ? "objectid"
          : field.item.kind === "embedded"
            ? "object"
            : field.item.kind;
      meta.itemEnum = field.item.enum;
      meta.itemRef = field.item.ref;
    }
  }

  if (field.kind === "embedded" && field.fields && !field.isArray) {
    meta.items = Object.fromEntries(
      Object.entries(field.fields).map(([key, nestedField]) => [
        key,
        fieldDescriptionToAdminMeta(nestedField),
      ])
    );
  }

  return meta;
};

export const modelDescriptionToAdminFields = (
  description: ModelDescription
): Record<string, ReturnType<typeof fieldDescriptionToAdminMeta>> => {
  const nestedFields = nestDottedFieldDescriptions(description.fields);
  return Object.fromEntries(
    Object.entries(nestedFields).map(([path, field]) => [path, fieldDescriptionToAdminMeta(field)])
  );
};

export const fieldDescriptionToZodType = (
  field: FieldDescription,
  z: typeof import("zod").z
): import("zod").ZodType => {
  let zodType: import("zod").ZodType;

  if (field.isArray) {
    const itemType = field.item
      ? fieldDescriptionToZodType({...field.item, isArray: false}, z)
      : z.any();
    zodType = z.array(itemType);
    if (field.item?.kind === "embedded") {
      zodType = zodType.describe("Array of subdocuments");
    }
    if (field.description) {
      zodType = zodType.describe(field.description);
    }
    return zodType;
  }

  if (field.kind === "embedded" && field.fields) {
    zodType = z.record(z.string(), z.any()).describe("Embedded document");
    if (field.description) {
      zodType = zodType.describe(field.description);
    }
    return zodType;
  }

  switch (field.kind) {
    case "string":
      zodType =
        field.enum && field.enum.length > 0
          ? z.enum(field.enum as [string, ...string[]])
          : z.string();
      break;
    case "number":
      zodType = z.number();
      break;
    case "boolean":
      zodType = z.boolean();
      break;
    case "date":
    case "dateOnly":
      zodType = z.string().describe("ISO 8601 date string");
      break;
    case "objectId":
      zodType = z.string().describe(field.ref ? `ObjectId reference to ${field.ref}` : "ObjectId");
      break;
    case "map":
      zodType = z.record(z.string(), z.any());
      break;
    default:
      zodType = z.record(z.string(), z.any());
      break;
  }

  if (field.description) {
    zodType = zodType.describe(field.description);
  }

  return zodType;
};
