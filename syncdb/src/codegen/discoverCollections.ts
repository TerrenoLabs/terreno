import {refName, toPascalCase} from "./hookNames";
import type {DiscoveredCollection, OpenApiDocument, OpenApiSchema} from "./types";

const jsonContentSchema = (
  content?: Record<string, {schema?: OpenApiSchema}>
): OpenApiSchema | undefined => content?.["application/json"]?.schema;

const resolveSchema = (spec: OpenApiDocument, schema: OpenApiSchema | undefined): OpenApiSchema => {
  if (!schema) {
    return {properties: {}, type: "object"};
  }
  if (schema.$ref) {
    const name = refName(schema.$ref);
    const resolved = name ? spec.components?.schemas?.[name] : undefined;
    if (resolved) {
      return resolved;
    }
  }
  return schema;
};

const listItemSchema = (
  spec: OpenApiDocument,
  operationSchema: OpenApiSchema | undefined
): OpenApiSchema | undefined => {
  if (!operationSchema) {
    return undefined;
  }
  const resolved = resolveSchema(spec, operationSchema);
  const data = resolved.properties?.data;
  if (!data) {
    return undefined;
  }
  const resolvedData = resolveSchema(spec, data);
  return resolvedData.items;
};

const fallbackEntityName = (collection: string): string => {
  const pascal = toPascalCase(collection);
  // `gpt/histories` → GptHistory, not GptHistorie.
  if (pascal.endsWith("ies") && pascal.length > 3) {
    return `${pascal.slice(0, -3)}y`;
  }
  if (pascal.endsWith("s") && pascal.length > 1) {
    return pascal.slice(0, -1);
  }
  return pascal;
};

const findCollectionPath = ({
  collection,
  spec,
}: {
  collection: string;
  spec: OpenApiDocument;
}): string | undefined => {
  const candidates = [`/${collection}`, `/${collection}/`];
  for (const path of candidates) {
    if (spec.paths?.[path]) {
      return path;
    }
  }
  return undefined;
};

const fromExtension = (
  spec: OpenApiDocument,
  path: string,
  collection: string
): DiscoveredCollection => {
  const item = spec.paths?.[path];
  const entitySchemaRaw = listItemSchema(
    spec,
    jsonContentSchema(item?.get?.responses?.["200"]?.content)
  );
  if (!entitySchemaRaw) {
    throw new Error(
      `List operation GET ${path} has no JSON 200 data.items schema for collection "${collection}"`
    );
  }
  const entityName = refName(entitySchemaRaw.$ref) ?? fallbackEntityName(collection);
  const createSchemaRaw = jsonContentSchema(item?.post?.requestBody?.content);
  const collectionPath = path.endsWith("/") ? path.slice(0, -1) : path;
  const exactIdPath = `${collectionPath}/{id}`;
  const pathNames = Object.keys(spec.paths ?? {});
  const idPath = pathNames.includes(exactIdPath)
    ? exactIdPath
    : pathNames.find((candidate) => {
        if (!candidate.startsWith(`${collectionPath}/`)) {
          return false;
        }
        return /^\{[^/]+\}$/.test(candidate.slice(collectionPath.length + 1));
      });
  const patchOp = idPath ? spec.paths?.[idPath]?.patch : undefined;
  const updateSchemaRaw = jsonContentSchema(patchOp?.requestBody?.content);
  return {
    collection,
    createName: refName(createSchemaRaw?.$ref) ?? `Create${entityName}Body`,
    createSchema: resolveSchema(spec, createSchemaRaw),
    entityName,
    entitySchema: resolveSchema(spec, entitySchemaRaw),
    updateName: refName(updateSchemaRaw?.$ref) ?? `Update${entityName}Body`,
    updateSchema: resolveSchema(spec, updateSchemaRaw),
  };
};

const fromCollectionFlag = ({
  collection,
  spec,
}: {
  collection: string;
  spec: OpenApiDocument;
}): DiscoveredCollection => {
  const path = findCollectionPath({collection, spec});
  if (!path) {
    throw new Error(
      `No OpenAPI path for collection "${collection}" (tried /${collection} and /${collection}/). ` +
        "Add x-terreno-sync to the list operation, or pass a collection whose list path exists."
    );
  }
  return fromExtension(spec, path, collection);
};

export const discoverCollections = ({
  spec,
  collections,
}: {
  spec: OpenApiDocument;
  collections?: string[];
}): DiscoveredCollection[] => {
  const fromSpec: DiscoveredCollection[] = [];
  const allow = collections && collections.length > 0 ? new Set(collections) : undefined;
  let sawExtension = false;
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    const extension = item.get?.["x-terreno-sync"];
    if (!extension?.collection) {
      continue;
    }
    sawExtension = true;
    if (allow && !allow.has(extension.collection)) {
      continue;
    }
    fromSpec.push(fromExtension(spec, path, extension.collection));
  }

  if (fromSpec.length === 0) {
    if (collections && collections.length > 0 && !sawExtension) {
      return collections.map((collection) => fromCollectionFlag({collection, spec}));
    }
    if (collections && collections.length > 0 && sawExtension) {
      throw new Error(
        `No synced collections matched --collections ${collections.join(",")}. ` +
          "Check x-terreno-sync on list operations in the OpenAPI spec."
      );
    }
    throw new Error(
      "No synced collections found. Add x-terreno-sync to list operations " +
        "(modelRouter sync: {...}) or pass --collections todos,notes."
    );
  }

  return fromSpec;
};
