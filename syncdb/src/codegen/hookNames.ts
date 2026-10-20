export const toPascalCase = (value: string): string =>
  value
    .split(/[-_/]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");

/**
 * Friendly generated names (IP decision: no collision with RTK codegen).
 * Collection `todos`, entity `Todo` → useTodos / useTodosWindow / useTodo / useCreateTodo / …
 */
export const friendlyHookNames = ({
  collection,
  entityName,
}: {
  collection: string;
  entityName: string;
}): {
  list: string;
  read: string;
  create: string;
  update: string;
  remove: string;
  window: string;
} => {
  const plural = toPascalCase(collection);
  return {
    create: `useCreate${entityName}`,
    list: `use${plural}`,
    read: `use${entityName}`,
    remove: `useDelete${entityName}`,
    update: `useUpdate${entityName}`,
    window: `use${plural}Window`,
  };
};

export const refName = (ref: string | undefined): string | undefined => {
  if (!ref) {
    return undefined;
  }
  const match = ref.match(/\/([^/]+)$/);
  return match?.[1];
};

const WORD = /[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|[^A-Za-z0-9]|$)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g;

/** lodash-style camelCase (the rule `@rtk-query/codegen-openapi` used for names). */
const toCamelCase = (value: string): string => {
  const words = value.match(WORD) ?? [];
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      return index === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");
};

/**
 * Operation name: the camelCased `operationId` when present, otherwise
 * `<method> <path>` with `{param}` read as `by param` — `PATCH /gpt/histories/{id}`
 * → `patchGptHistoriesById`, matching the RTK codegen names apps already use.
 */
export const operationName = ({
  method,
  operationId,
  path,
}: {
  method: string;
  operationId?: string;
  path: string;
}): string => {
  if (operationId) {
    return toCamelCase(operationId);
  }
  return toCamelCase(`${method} ${path.replace(/\{([^}]+)\}/g, " by $1 ")}`);
};

export const upperFirst = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);
