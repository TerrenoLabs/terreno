import {describe, expect, test} from "bun:test";
import {
  componentToSlug,
  extractTypeString,
  formatComponentMarkdown,
  generateComponentListMarkdown,
  loadTypeDocJson,
  parseComponentsFromTypeDoc,
  resources,
  type TypeDocRoot,
} from "../resources.js";

describe("resources", () => {
  test("should have all required resources", () => {
    const resourceUris = resources.map((r) => r.uri);

    expect(resourceUris).toContain("terreno://docs/overview");
    expect(resourceUris).toContain("terreno://docs/api");
    expect(resourceUris).toContain("terreno://docs/ui");
    expect(resourceUris).toContain("terreno://docs/syncdb");
    expect(resourceUris).toContain("terreno://docs/patterns");
    expect(resourceUris).not.toContain("terreno://docs/rtk");
  });

  test("should have valid resource structure", () => {
    for (const resource of resources) {
      expect(resource.uri).toBeDefined();
      expect(resource.name).toBeDefined();
      expect(resource.description).toBeDefined();
      expect(resource.mimeType).toBe("text/markdown");
      expect(resource.content).toBeDefined();
      expect(resource.content.length).toBeGreaterThan(100);
    }
  });

  describe("overview resource", () => {
    const overview = resources.find((r) => r.uri === "terreno://docs/overview");

    test("should contain monorepo overview", () => {
      expect(overview?.content).toContain("Terreno");
      expect(overview?.content).toContain("@terreno/api");
      expect(overview?.content).toContain("@terreno/ui");
      expect(overview?.content).toContain("@terreno/syncdb");
    });

    test("should contain development commands", () => {
      expect(overview?.content).toContain("bun install");
      expect(overview?.content).toContain("bun run compile");
    });

    test("should contain code style guidelines", () => {
      expect(overview?.content).toContain("TypeScript");
      expect(overview?.content).toContain("Luxon");
    });
  });

  describe("api resource", () => {
    const api = resources.find((r) => r.uri === "terreno://docs/api");

    test("should contain modelRouter documentation", () => {
      expect(api?.content).toContain("modelRouter");
      expect(api?.content).toContain("CRUD");
    });

    test("should contain permissions documentation", () => {
      expect(api?.content).toContain("Permissions");
      expect(api?.content).toContain("IsAuthenticated");
      expect(api?.content).toContain("IsOwner");
      expect(api?.content).toContain("IsAdmin");
    });

    test("should contain APIError documentation", () => {
      expect(api?.content).toContain("APIError");
      expect(api?.content).toContain("status");
    });

    test("should contain lifecycle hooks", () => {
      expect(api?.content).toContain("preCreate");
      expect(api?.content).toContain("postCreate");
    });

    test("should contain transformer documentation", () => {
      expect(api?.content).toContain("Transformer");
      expect(api?.content).toContain("AdminOwnerTransformer");
    });
  });

  describe("ui resource", () => {
    const ui = resources.find((r) => r.uri === "terreno://docs/ui");

    test("should contain component documentation", () => {
      expect(ui?.content).toContain("Box");
      expect(ui?.content).toContain("Button");
      expect(ui?.content).toContain("Text");
    });

    test("should contain form field documentation", () => {
      expect(ui?.content).toContain("TextField");
      expect(ui?.content).toContain("EmailField");
      expect(ui?.content).toContain("SelectField");
    });

    test("should contain theme documentation", () => {
      expect(ui?.content).toContain("useTheme");
      expect(ui?.content).toContain("TerrenoProvider");
    });

    test("should contain modal documentation", () => {
      expect(ui?.content).toContain("Modal");
      expect(ui?.content).toContain("ActionSheet");
    });
  });

  describe("syncdb resource", () => {
    const syncdb = resources.find((r) => r.uri === "terreno://docs/syncdb");

    test("covers the request client, generated hooks, and session", () => {
      expect(syncdb?.content).toContain("createApiClient");
      expect(syncdb?.content).toContain("--api-out store/apiSdk.ts");
      expect(syncdb?.content).toContain("useGetAuthMeQuery");
      expect(syncdb?.content).toContain("SessionProvider");
      expect(syncdb?.content).toContain('from "@terreno/syncdb/config"');
    });

    test("does not teach RTK Query or Redux setup", () => {
      for (const resource of resources) {
        expect(resource.content).not.toContain('from "@terreno/rtk"');
        expect(resource.content).not.toContain("@/store/openApiSdk");
      }
    });
  });

  describe("patterns resource", () => {
    const patterns = resources.find((r) => r.uri === "terreno://docs/patterns");

    test("should contain backend patterns", () => {
      expect(patterns?.content).toContain("Model Definition");
      expect(patterns?.content).toContain("Route Setup");
    });

    test("should contain frontend patterns", () => {
      expect(patterns?.content).toContain("Screen");
      expect(patterns?.content).toContain("Form");
    });

    test("should teach SyncDB, not RTK hooks, for collection CRUD", () => {
      expect(patterns?.content).toContain('from "@terreno/syncdb/react"');
      expect(patterns?.content).toContain('useQuery<Todo>("todos"');
      expect(patterns?.content).toContain('useMutate("todos")');
      expect(patterns?.content).toContain('sync: {scope: {type: "owner"}}');
      expect(patterns?.content).not.toContain("useGetTodosQuery");
      expect(patterns?.content).not.toContain("useCreateTodoMutation");
    });

    test("should contain error handling patterns", () => {
      expect(patterns?.content).toContain("Error Handling");
      expect(patterns?.content).toContain("APIError");
    });
  });
});

describe("loadTypeDocJson", () => {
  test("should return null or object without throwing", () => {
    const result = loadTypeDocJson();
    expect(result === null || typeof result === "object").toBe(true);
  });
});

describe("extractTypeString", () => {
  test("returns unknown for null/undefined", () => {
    expect(extractTypeString(null)).toBe("unknown");
    expect(extractTypeString(undefined)).toBe("unknown");
  });

  test("handles intrinsic types", () => {
    expect(extractTypeString({name: "string", type: "intrinsic"})).toBe("string");
    expect(extractTypeString({name: "number", type: "intrinsic"})).toBe("number");
  });

  test("handles literal types", () => {
    expect(extractTypeString({type: "literal", value: "primary"})).toBe('"primary"');
    expect(extractTypeString({type: "literal", value: 42})).toBe("42");
  });

  test("handles union types", () => {
    expect(
      extractTypeString({
        type: "union",
        types: [
          {type: "literal", value: "a"},
          {type: "literal", value: "b"},
        ],
      })
    ).toBe('"a" | "b"');
  });

  test("handles union type with empty types", () => {
    expect(extractTypeString({type: "union"})).toBe("unknown");
  });

  test("handles array types", () => {
    expect(
      extractTypeString({
        elementType: {name: "string", type: "intrinsic"},
        type: "array",
      })
    ).toBe("string[]");
  });

  test("handles reference types without type arguments", () => {
    expect(extractTypeString({name: "ReactNode", type: "reference"})).toBe("ReactNode");
  });

  test("handles reference types with type arguments", () => {
    expect(
      extractTypeString({
        name: "Array",
        type: "reference",
        typeArguments: [{name: "string", type: "intrinsic"}],
      })
    ).toBe("Array<string>");
  });

  test("handles reflection with signatures as function", () => {
    expect(
      extractTypeString({
        declaration: {signatures: [{}]},
        type: "reflection",
      })
    ).toBe("function");
  });

  test("handles reflection without signatures as object", () => {
    expect(
      extractTypeString({
        declaration: {},
        type: "reflection",
      })
    ).toBe("object");
  });

  test("falls back to name for unknown types", () => {
    expect(extractTypeString({name: "Custom", type: "weird"})).toBe("Custom");
  });

  test("falls back to unknown when no name", () => {
    expect(extractTypeString({type: "weird"})).toBe("unknown");
  });

  test("falls back to unknown for reference without name", () => {
    expect(extractTypeString({type: "reference"})).toBe("unknown");
  });
});

describe("componentToSlug", () => {
  test("lowercases and replaces spaces with dashes", () => {
    expect(componentToSlug("Button")).toBe("button");
    expect(componentToSlug("Text Field")).toBe("text-field");
    expect(componentToSlug("Multi   Word Name")).toBe("multi-word-name");
  });
});

describe("parseComponentsFromTypeDoc", () => {
  test("returns empty array when Common module is missing", () => {
    expect(
      parseComponentsFromTypeDoc({
        children: [{children: [], id: 0, name: "Other"}],
      })
    ).toEqual([]);
  });

  test("returns empty array when typedoc has no children", () => {
    expect(parseComponentsFromTypeDoc({})).toEqual([]);
  });

  test("returns empty array when Common has no children", () => {
    expect(parseComponentsFromTypeDoc({children: [{id: 0, name: "Common"}]})).toEqual([]);
  });

  test("filters to only *Props interfaces and extracts props", () => {
    const typeDoc = {
      children: [
        {
          children: [
            {
              children: [
                {
                  comment: {
                    blockTags: [
                      {
                        content: [{text: '```ts\n"primary"\n```'}],
                        tag: "@default",
                      },
                    ],
                    summary: [{text: "Visual variant"}],
                  },
                  flags: {isOptional: true},
                  name: "variant",
                  type: {
                    type: "union",
                    types: [
                      {type: "literal", value: "primary"},
                      {type: "literal", value: "secondary"},
                    ],
                  },
                },
                {
                  flags: {},
                  name: "text",
                  type: {name: "string", type: "intrinsic"},
                },
              ],
              kind: 256,
              name: "ButtonProps",
            },
            {
              kind: 256,
              name: "NotAPropsInterface",
            },
            {
              kind: 256,
              name: "OtherProps",
            },
          ],
          name: "Common",
        },
      ],
    };

    const components = parseComponentsFromTypeDoc(typeDoc as unknown as TypeDocRoot);
    expect(components.length).toBe(2);
    const button = components.find((c) => c.name === "Button");
    expect(button).toBeDefined();
    expect(button?.interfaceName).toBe("ButtonProps");
    expect(button?.props.length).toBe(2);

    const variantProp = button?.props.find((p) => p.name === "variant");
    expect(variantProp?.required).toBe(false);
    expect(variantProp?.type).toBe('"primary" | "secondary"');
    expect(variantProp?.description).toBe("Visual variant");
    expect(variantProp?.defaultValue).toBe('"primary"');

    const textProp = button?.props.find((p) => p.name === "text");
    expect(textProp?.required).toBe(true);
    expect(textProp?.type).toBe("string");
  });

  test("handles interface with no children", () => {
    const typeDoc = {
      children: [
        {
          children: [{id: 1, kind: 256, name: "EmptyProps", variant: "declaration"}],
          id: 0,
          name: "Common",
        },
      ],
    };
    const components = parseComponentsFromTypeDoc(typeDoc);
    expect(components.length).toBe(1);
    expect(components[0].props).toEqual([]);
  });
});

describe("formatComponentMarkdown", () => {
  test("formats a component with props as markdown", () => {
    const md = formatComponentMarkdown({
      interfaceName: "ButtonProps",
      name: "Button",
      props: [
        {
          defaultValue: '"primary"',
          description: "Visual variant",
          name: "variant",
          required: false,
          type: '"primary" | "secondary"',
        },
        {
          description: "",
          name: "text",
          required: true,
          type: "string",
        },
      ],
    });

    expect(md).toContain("# Button");
    expect(md).toContain("**Interface:** `ButtonProps`");
    expect(md).toContain("## Props");
    expect(md).toContain("`variant`");
    expect(md).toContain("Visual variant");
    expect(md).toContain('(default: `"primary"`)');
    expect(md).toContain("`text`");
    expect(md).toContain("| Yes |");
  });

  test("formats a component without props", () => {
    const md = formatComponentMarkdown({
      interfaceName: "SpacerProps",
      name: "Spacer",
      props: [],
    });

    expect(md).toContain("# Spacer");
    expect(md).toContain("**Interface:** `SpacerProps`");
    expect(md).not.toContain("## Props");
  });
});

describe("generateComponentListMarkdown", () => {
  test("generates markdown for a list of components", () => {
    const md = generateComponentListMarkdown([
      {
        interfaceName: "ButtonProps",
        name: "Button",
        props: [
          {description: "", name: "text", required: true, type: "string"},
          {description: "", name: "onClick", required: false, type: "function"},
        ],
      },
      {
        interfaceName: "AvatarProps",
        name: "Avatar",
        props: [],
      },
    ]);

    expect(md).toContain("# @terreno/ui Component Reference");
    expect(md).toContain("**Total Components:** 2");
    expect(md).toContain("| Avatar |");
    expect(md).toContain("| Button |");
    // Alphabetical: Avatar before Button
    expect(md.indexOf("Avatar")).toBeLessThan(md.indexOf("Button"));
    expect(md).toContain("**Required:** `text`");
    expect(md).toContain("**Optional:** `onClick`");
    expect(md).toContain("*No props*");
  });
});
