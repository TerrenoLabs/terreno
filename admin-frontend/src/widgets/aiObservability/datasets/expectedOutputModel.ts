/** One step into a JSON value: an object key or an array index. */
export type ValuePath = Array<string | number>;

/** The subset of JSON Schema the dataset expected-output form understands. */
export interface JsonSchema {
  description?: string;
  enum?: unknown[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  title?: string;
  type?: string | string[];
}

export interface FormFieldNode {
  description?: string;
  enumValues?: string[];
  kind: "boolean" | "number" | "text";
  label: string;
  multiline: boolean;
  path: ValuePath;
  type: "field";
}

export interface FormGroupNode {
  children: FormNode[];
  /** Schema for one new list entry, when this node is a list. */
  itemSchema?: JsonSchema;
  path: ValuePath;
  title?: string;
  type: "group" | "list";
}

export type FormNode = FormFieldNode | FormGroupNode;

const schemaTypeName = (schema?: JsonSchema): string | undefined => {
  if (!schema?.type) {
    return undefined;
  }
  if (Array.isArray(schema.type)) {
    return schema.type.find((entry) => entry !== "null");
  }
  return schema.type;
};

/** "privacyLeak" and "privacy_leak" both read as "Privacy Leak". */
const labelFromKey = (key: string, schema?: JsonSchema): string => {
  if (schema?.title && schema.title.trim().length > 0) {
    return schema.title.trim();
  }
  const spaced = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  if (spaced.length === 0) {
    return key;
  }
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

export const readPath = (root: unknown, path: ValuePath): unknown => {
  let current = root;
  for (const segment of path) {
    if (!isRecord(current) && !Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
};

/** Returns a new value with `path` set to `next`. An empty path replaces the root. */
export const setAtPath = (root: unknown, path: ValuePath, next: unknown): unknown => {
  if (path.length === 0) {
    return next;
  }
  const [head, ...rest] = path;
  if (typeof head === "number") {
    const list = Array.isArray(root) ? [...root] : [];
    list[head] = setAtPath(list[head], rest, next);
    return list;
  }
  const record = isRecord(root) ? {...root} : {};
  record[head] = setAtPath(record[head], rest, next);
  return record;
};

/** Drops one array entry. `path` points at the array. */
export const removeAtIndex = (root: unknown, path: ValuePath, index: number): unknown => {
  const current = readPath(root, path);
  const list = Array.isArray(current) ? current.filter((_, itemIndex) => itemIndex !== index) : [];
  return setAtPath(root, path, list);
};

const enumValues = (schema?: JsonSchema): string[] | undefined => {
  if (!schema?.enum || schema.enum.length === 0) {
    return undefined;
  }
  return schema.enum.map((entry) => String(entry));
};

/** A blank value that matches the schema, used for a new golden row or a new list entry. */
const blankFromSchema = (schema?: JsonSchema): unknown => {
  const kind = schemaTypeName(schema);
  if (schema?.properties || kind === "object") {
    const record: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(schema?.properties ?? {})) {
      record[key] = blankFromSchema(child);
    }
    return record;
  }
  if (kind === "array") {
    return [];
  }
  if (kind === "boolean") {
    return false;
  }
  if (kind === "number" || kind === "integer") {
    return null;
  }
  return "";
};

/**
 * Fills missing schema fields without overwriting a value that is already there.
 * A value whose type does not match the schema is replaced by the blank schema shape.
 */
const mergeWithSchema = (schema: JsonSchema | undefined, value: unknown): unknown => {
  if (!schema) {
    return value;
  }
  const kind = schemaTypeName(schema);
  if (schema.properties || kind === "object") {
    const source = isRecord(value) ? value : {};
    const record: Record<string, unknown> = {...source};
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      record[key] = mergeWithSchema(child, source[key]);
    }
    return record;
  }
  if (kind === "array") {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.map((entry) => mergeWithSchema(schema.items, entry));
  }
  if (kind === "boolean") {
    return typeof value === "boolean" ? value : false;
  }
  if (kind === "number" || kind === "integer") {
    return typeof value === "number" ? value : null;
  }
  if (enumValues(schema)) {
    return typeof value === "string" ? value : "";
  }
  if (kind === "string" && (typeof value === "number" || typeof value === "boolean")) {
    return String(value);
  }
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return "";
  }
  return value;
};

/** Same shape as `value`, with every leaf cleared. Used to start a new item from a sibling. */
export const emptyLike = (value: unknown): unknown => {
  if (typeof value === "string") {
    return "";
  }
  if (typeof value === "number") {
    return null;
  }
  if (typeof value === "boolean") {
    return false;
  }
  if (Array.isArray(value)) {
    const first = value[0];
    if (first === undefined) {
      return [];
    }
    return [emptyLike(first)];
  }
  if (isRecord(value)) {
    const record: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      record[key] = emptyLike(child);
    }
    return record;
  }
  return "";
};

/** Value the form edits. Schema wins the shape; otherwise a missing value is an empty string. */
export const prepareFormValue = (schema: JsonSchema | undefined, value: unknown): unknown => {
  if (schema) {
    return mergeWithSchema(schema, value);
  }
  if (value === undefined) {
    return "";
  }
  return value;
};

const textIsLong = (value: unknown): boolean => {
  return typeof value === "string" && (value.length > 80 || value.includes("\n"));
};

const buildField = ({
  label,
  path,
  schema,
  value,
}: {
  label: string;
  path: ValuePath;
  schema?: JsonSchema;
  value: unknown;
}): FormFieldNode => {
  const kindName = schemaTypeName(schema);
  const choices = enumValues(schema);
  if (choices) {
    return {
      description: schema?.description,
      enumValues: choices,
      kind: "text",
      label,
      multiline: false,
      path,
      type: "field",
    };
  }
  // A declared schema type picks the control; the stored value's type only decides untyped fields.
  const isUntyped = kindName === undefined;
  if (kindName === "boolean" || (isUntyped && typeof value === "boolean")) {
    return {
      description: schema?.description,
      kind: "boolean",
      label,
      multiline: false,
      path,
      type: "field",
    };
  }
  if (kindName === "number" || kindName === "integer" || (isUntyped && typeof value === "number")) {
    return {
      description: schema?.description,
      kind: "number",
      label,
      multiline: false,
      path,
      type: "field",
    };
  }
  return {
    description: schema?.description,
    kind: "text",
    label,
    multiline: path.length === 0 || textIsLong(value),
    path,
    type: "field",
  };
};

const buildNode = ({
  label,
  path,
  schema,
  value,
}: {
  label?: string;
  path: ValuePath;
  schema?: JsonSchema;
  value: unknown;
}): FormNode => {
  const kindName = schemaTypeName(schema);
  const objectSchema = Boolean(schema?.properties) || kindName === "object";
  const arraySchema = kindName === "array";
  if (objectSchema || (schema === undefined && isRecord(value))) {
    const source = isRecord(value) ? value : {};
    const propertyNames = Object.keys(schema?.properties ?? {});
    const extraNames = Object.keys(source).filter((key) => !propertyNames.includes(key));
    const children = [...propertyNames, ...extraNames].map((key) => {
      const childSchema = schema?.properties?.[key];
      return buildNode({
        label: labelFromKey(key, childSchema),
        path: [...path, key],
        schema: childSchema,
        value: source[key],
      });
    });
    return {children, path, title: label, type: "group"};
  }
  if (arraySchema || (schema === undefined && Array.isArray(value))) {
    const list = Array.isArray(value) ? value : [];
    const children = list.map((entry, index) => {
      return buildNode({
        label: `Item ${index + 1}`,
        path: [...path, index],
        schema: schema?.items,
        value: entry,
      });
    });
    return {
      children,
      itemSchema: schema?.items,
      path,
      title: label,
      type: "list",
    };
  }
  return buildField({label: label ?? "Expected output", path, schema, value});
};

/** Form tree for `value`, using `schema` when the dataset declared an expected shape. */
export const buildForm = (schema: JsonSchema | undefined, value: unknown): FormNode => {
  return buildNode({path: [], schema, value});
};

/** Appends one blank entry to the list at `path`. */
export const appendListItem = (
  root: unknown,
  path: ValuePath,
  itemSchema?: JsonSchema
): unknown => {
  const current = readPath(root, path);
  const list = Array.isArray(current) ? [...current] : [];
  const last = list[list.length - 1];
  const nextItem = last === undefined ? blankFromSchema(itemSchema) : emptyLike(last);
  list.push(nextItem);
  return setAtPath(root, path, list);
};
