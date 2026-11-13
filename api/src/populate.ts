import isArray from "lodash/isArray";
import type {Document, Model, Schema} from "mongoose";
import m2s from "mongoose-to-swagger";

import {APIError} from "./errors";
import {describeModel, modelDescriptionToOpenApiSpec} from "./schemaMetadata";

const m2sOptions = {
  props: ["readOnly", "required", "enum", "default"],
};

interface OpenApiSchemaNode {
  description?: string;
  items?: OpenApiSchemaNode;
  properties?: Record<string, OpenApiSchemaNode>;
  type?: string;
}

interface SchemaPathInfo {
  instance: string;
  schema?: Schema;
}

export interface PopulatePath {
  // Mongoose style path population.
  // "ownerId" // populates the User that matches `ownerId`
  // "ownerId.organizationId" Nested. Populates the User that matches `ownerId`, as well as their organization.
  path: string;
  // If provided, type generation will use the already registered component.
  // If not provided and path is provided, will use the path and optionally fields to
  // automatically generate the types. If only generatePathFields is provided, the type will be
  // any.
  openApiComponent?: string;
  // An array of strings to filter on the populated objects, following Mongoose's select
  // rules. If each field starts a preceding "-", will act as a block list and only remove those
  // fields. If each field does not start with a "-", will act as an allow list and only
  // return those fields.
  fields?: string[];
}

// Keeps only the specified dot-notation keys from an object.
const filterKeys = (obj: Record<string, unknown>, keysToKeep?: string[]): Record<string, unknown> => {
  if (!keysToKeep) {
    return obj;
  }

  const result: Record<string, unknown> = {};

  const filterNestedKeys = (
    currentObj: Record<string, unknown>,
    currentResult: Record<string, unknown>,
    remainingKeys: string[]
  ) => {
    const currentKey = remainingKeys[0];
    const nestedKeys = currentKey.split(".");

    if (nestedKeys.length > 1) {
      const [firstKey, ...rest] = nestedKeys;
      if (firstKey === "__proto__" || firstKey === "constructor" || firstKey === "prototype") {
        return;
      }
      if (!currentResult[firstKey]) {
        currentResult[firstKey] = {};
      }
      filterNestedKeys(currentObj[firstKey] as Record<string, unknown>, currentResult[firstKey] as Record<string, unknown>, [
        rest.join("."),
        ...remainingKeys.slice(1),
      ]);
    } else {
      // biome-ignore lint/suspicious/noPrototypeBuiltins: we need to use the prototype to check if the object has the property
      if (Object.prototype.hasOwnProperty.call(currentObj, currentKey)) {
        currentResult[currentKey] = currentObj[currentKey];
      }
      if (remainingKeys.length > 1) {
        filterNestedKeys(currentObj, currentResult, remainingKeys.slice(1));
      }
    }
  };

  filterNestedKeys(obj, result, keysToKeep);
  return result;
};

// Helper function to get the path in the OpenAPI schema, so we can swap out the type for the
// populated model component or generated type.
const getPathInSchema = (schema: OpenApiSchemaNode, path: string): string => {
  const keys = path.split(".");
  let currentSchema = schema;
  let fullPath = "";

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];

    if (currentSchema.properties?.[key]) {
      fullPath += fullPath ? `.${key}` : key;
      currentSchema = currentSchema.properties[key];

      // If it's an array, add 'items' to the path
      if (currentSchema.type === "array" && currentSchema.items) {
        fullPath += ".items";
        currentSchema = currentSchema.items;
      }
    } else if (i === keys.length - 1 && currentSchema.type === "array") {
      // If we're at the last key and it's an array, we don't need to add anything
      break;
    } else {
      throw new APIError({status: 500, title: `Path ${path} not found in schema at key ${key}`});
    }
  }

  return fullPath;
};

// Corrects Mixed-type fields in OpenAPI properties so they accept any value.
export const fixMixedFields = (schema: Schema | null, properties: Record<string, OpenApiSchemaNode> | Record<string, unknown> | null): void => {
  if (!properties || !schema) {
    return;
  }

  const props = properties as Record<string, OpenApiSchemaNode>;
  for (const key of Object.keys(props)) {
    const schemaPath = schema.path(key) as unknown as SchemaPathInfo | undefined;
    if (!schemaPath) {
      continue;
    }

    // Direct Mixed field
    if (schemaPath.instance === "Mixed") {
      props[key] = {description: props[key]?.description};
      continue;
    }

    // Array of sub-documents — check each sub-field for Mixed
    if (schemaPath.instance === "Array" && schemaPath.schema) {
      const itemProperties = props[key]?.items?.properties;
      if (itemProperties) {
        fixMixedFields(schemaPath.schema, itemProperties);
      }
    }
  }
};

export const getOpenApiSpecForModel = <T>(
  model: Model<T>,
  {
    populatePaths,
    extraModelProperties,
  }: {populatePaths?: PopulatePath[]; extraModelProperties?: Record<string, unknown>} = {}
): {properties: Record<string, unknown>; required: string[]} => {
  const description = describeModel(model);
  const {properties, required} = modelDescriptionToOpenApiSpec(description);
  const modelProperties = properties as Record<string, OpenApiSchemaNode>;
  const modelSwagger = {
    properties: modelProperties,
    required,
  };

  fixMixedFields(model.schema, modelProperties);

  if (populatePaths && isArray(populatePaths)) {
    for (const populatePath of populatePaths) {
      // Get the referenced populate model from the model schema
      let populateModel = model.schema.path(populatePath.path)?.options?.ref;
      const populatePathIsArray = Array.isArray(model.schema.path(populatePath.path).options.type);
      if (populatePathIsArray) {
        populateModel = model.schema.path(populatePath.path).options.type[0].ref;
      }
      if (!populateModel) {
        continue;
      }

      // Get the properties of the referenced model
      const properties = filterKeys(
        m2s(model.db.model(populateModel), m2sOptions).properties,
        populatePath.fields
      );

      // Get the OpenAPI path for the current populate path
      const openApiPath = getPathInSchema(modelSwagger, populatePath.path);

      // Determine the schema to set
      let schemaToSet;
      if (populatePath.openApiComponent) {
        schemaToSet = {
          $ref: `#/components/schemas/${populatePath.openApiComponent}`,
        };
      } else {
        schemaToSet = {
          properties,
          type: "object",
        };
      }

      // Navigate through the nested structure and set the schema
      const pathParts = openApiPath.split(".");
      let currentSchema: Record<string, OpenApiSchemaNode> = modelSwagger.properties;
      for (let i = 0; i < pathParts.length; i++) {
        const part = pathParts[i];
        if (i === pathParts.length - 1) {
          // We're at the last part, merge the schema
          if (currentSchema[part]?.properties) {
            currentSchema[part].properties = {
              ...currentSchema[part].properties,
              ...(schemaToSet.properties || {[part]: schemaToSet}),
            };
          } else {
            currentSchema[part] = schemaToSet as OpenApiSchemaNode;
          }
        } else {
          // We're still navigating, ensure the path exists
          if (!currentSchema[part]) {
            currentSchema[part] = {};
          }
          if (part === "items" && i < pathParts.length - 1) {
            // If we're at 'items' and it's not the last part, it should be an object
            if (!currentSchema[part].properties) {
              currentSchema[part] = {properties: {}, type: "object"};
            }
          }
          const nextSchema = currentSchema[part].properties ?? currentSchema[part];
          currentSchema = nextSchema as Record<string, OpenApiSchemaNode>;
        }
      }
    }
  }

  // Add virtuals to the modelSwagger property
  for (const virtual of Object.keys(model.schema.virtuals)) {
    // Skip Mongoose internals
    if (virtual === "id" || virtual === "__v") {
      continue;
    }
    modelSwagger.properties[virtual] = {
      type: "any",
    };
  }

  // Check subschemas for virtuals (one level deep)
  if (model.schema.childSchemas.length > 0) {
    for (const childSchema of model.schema.childSchemas) {
      for (const virtual of Object.keys(childSchema.schema.virtuals)) {
        if (virtual === "id" || virtual === "__v") {
          continue;
        }
        const childPath = childSchema.model.path;
        if (!childPath || !modelSwagger.properties[childPath]?.properties) {
          continue;
        }
        modelSwagger.properties[childPath].properties[virtual] = {
          type: "any",
        };
      }
    }
  }

  return {
    properties: {...modelSwagger.properties, ...extraModelProperties},
    required: modelSwagger.required ?? [],
  };
};

// Helper function to unpopulate a document that has been populated.
// This is helpful for supporting backwards compatibility. E.g. you use populatePaths
// to populate a document but if the version header for the request is below the version
// that the populatePath was added, we remove the population and just return the _id.
export const unpopulate = <T>(doc: Document<T>, path: string): Document<T> => {
  if (!path) {
    throw new APIError({status: 500, title: "path is required for unpopulate"});
  }
  const pathParts = path.split(".");

  // Traversal treats documents as plain nested records: the populated shapes are only known
  // at runtime, so each level is narrowed as it is visited.
  type NestedRecord = Record<string, unknown>;
  const asRecord = (value: unknown): NestedRecord => value as NestedRecord;
  const idOf = (value: unknown): unknown => (value as {_id?: unknown} | null)?._id;

  // Recursive because we need to support nested paths.
  const recursiveUnpopulate = (current: NestedRecord, parts: string[]): NestedRecord => {
    const part = parts[0];
    // Never read from or assign to a prototype through a configured path.
    if (part === "__proto__" || part === "constructor" || part === "prototype") {
      return asRecord(doc);
    }
    const value = current[part];

    // If the path doesn't exist, return the original doc
    if (!value) {
      return asRecord(doc);
    }

    if (parts.length === 1) {
      // Base case: we've reached the last part of the path
      if (Array.isArray(value)) {
        // If the field is an array, recursively unpopulate each element
        current[part] = value.map((item) => idOf(item) ?? item);
      } else if (idOf(value)) {
        // If the field is a populated document, revert to _id
        current[part] = idOf(value);
      }
    } else {
      // Recursive case: continue down the path
      if (Array.isArray(value)) {
        for (const item of value) {
          recursiveUnpopulate(asRecord(item), parts.slice(1)); // Recursively handle each item in the array
        }
      } else {
        recursiveUnpopulate(asRecord(value), parts.slice(1)); // Recursively handle the next part
      }
    }

    return current;
  };

  return recursiveUnpopulate(asRecord(doc), pathParts) as unknown as Document<T>;
};
