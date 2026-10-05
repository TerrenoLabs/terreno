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
