const PLACEHOLDER = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;

export const compileTemplate = (template: string, variables: Record<string, string>): string => {
  return template.replace(PLACEHOLDER, (_match, key: string) => {
    if (Object.hasOwn(variables, key)) {
      return variables[key];
    }
    return "";
  });
};
