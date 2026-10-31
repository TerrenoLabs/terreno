import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {render, waitFor} from "@testing-library/react-native";
import {Text} from "react-native";

import type {OpenAPIContextType, OpenAPISpec} from "./Common";
import {OpenAPIProvider, useOpenAPISpec} from "./OpenAPIContext";

const TEST_SPEC: OpenAPISpec = {
  paths: {
    "/todoItems/": {
      get: {
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  properties: {
                    data: {
                      items: {
                        properties: {
                          metadata: {
                            properties: {
                              color: {description: "Color metadata", type: "string"},
                            },
                            type: "object",
                          },
                          title: {description: "Title for the todo", type: "string"},
                        },
                        required: ["title"],
                        type: "object",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

const ContextReader = ({onContext}: {onContext: (context: OpenAPIContextType) => void}) => {
  const context = useOpenAPISpec();
  onContext(context);
  return <Text>Context reader</Text>;
};

const HookOutsideProvider = () => {
  useOpenAPISpec();
  return <Text>unreachable</Text>;
};

describe("OpenAPIContext", () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const originalError = console.error;

  beforeEach(() => {
    globalThis.fetch = mock(async () => ({
      json: async () => TEST_SPEC,
    })) as unknown as typeof globalThis.fetch;
    console.warn = mock(() => {});
    console.error = mock(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    console.error = originalError;
  });

  describe("OpenAPIProvider", () => {
    it("renders children", () => {
      const {getByText} = render(
        <OpenAPIProvider>
          <Text>Child content</Text>
        </OpenAPIProvider>
      );
      expect(getByText("Child content")).toBeTruthy();
    });

    it("renders with specUrl prop", () => {
      const {getByText} = render(
        <OpenAPIProvider specUrl="https://api.example.com/openapi.json">
          <Text>Content with spec URL</Text>
        </OpenAPIProvider>
      );
      expect(getByText("Content with spec URL")).toBeTruthy();
    });

    it("renders correctly with undefined specUrl", () => {
      const {toJSON} = render(
        <OpenAPIProvider specUrl={undefined}>
          <Text>No spec URL</Text>
        </OpenAPIProvider>
      );
      expect(toJSON()).toMatchSnapshot();
    });

    it("fetches spec and resolves model fields", async () => {
      let capturedContext = null as OpenAPIContextType | null;
      render(
        <OpenAPIProvider specUrl="https://api.example.com/openapi.json">
          <ContextReader
            onContext={(context) => {
              capturedContext = context;
            }}
          />
        </OpenAPIProvider>
      );

      await waitFor(() => {
        expect(capturedContext?.spec).toEqual(TEST_SPEC);
      });

      const modelFields = capturedContext?.getModelFields("Todo Items");
      expect(modelFields?.type).toBe("object");
      expect(modelFields?.required).toEqual(["title"]);
      expect(modelFields?.properties?.title).toEqual({
        description: "Title for the todo",
        type: "string",
      });
    });

    it("resolves nested model fields using dot notation", async () => {
      let capturedContext = null as OpenAPIContextType | null;
      render(
        <OpenAPIProvider specUrl="https://api.example.com/openapi.json">
          <ContextReader
            onContext={(context) => {
              capturedContext = context;
            }}
          />
        </OpenAPIProvider>
      );

      await waitFor(() => {
        expect(capturedContext?.spec).toEqual(TEST_SPEC);
      });

      expect(capturedContext?.getModelField("Todo Items", "metadata.color")).toEqual({
        description: "Color metadata",
        type: "string",
      });
    });

    it("warns when model path is missing", async () => {
      let capturedContext = null as OpenAPIContextType | null;
      render(
        <OpenAPIProvider specUrl="https://api.example.com/openapi.json">
          <ContextReader
            onContext={(context) => {
              capturedContext = context;
            }}
          />
        </OpenAPIProvider>
      );

      await waitFor(() => {
        expect(capturedContext?.spec).toEqual(TEST_SPEC);
      });

      expect(capturedContext?.getModelFields("Unknown Model")).toBeNull();
      expect(console.warn).toHaveBeenCalledWith("No OpenAPI model found for Unknown Model");
    });

    it("warns when model field is missing", async () => {
      let capturedContext = null as OpenAPIContextType | null;
      render(
        <OpenAPIProvider specUrl="https://api.example.com/openapi.json">
          <ContextReader
            onContext={(context) => {
              capturedContext = context;
            }}
          />
        </OpenAPIProvider>
      );

      await waitFor(() => {
        expect(capturedContext?.spec).toEqual(TEST_SPEC);
      });

      expect(capturedContext?.getModelField("Todo Items", "missingField")).toBeUndefined();
      expect(console.warn).toHaveBeenCalledWith(
        "No OpenAPI field found for Todo Items:missingField"
      );
    });

    it("logs an error when spec fetch fails", async () => {
      globalThis.fetch = mock(async () => {
        throw new Error("network down");
      }) as unknown as typeof globalThis.fetch;

      render(
        <OpenAPIProvider specUrl="https://api.example.com/openapi.json">
          <Text>Fetch failing</Text>
        </OpenAPIProvider>
      );

      await waitFor(() => {
        expect(console.error).toHaveBeenCalledWith(
          "Error fetching OpenAPI spec: Error: network down"
        );
      });
    });
  });

  describe("useOpenAPISpec", () => {
    it("throws when used outside OpenAPIProvider", () => {
      expect(() => render(<HookOutsideProvider />)).toThrow(
        "useOpenAPISpec must be used within an OpenAPIProvider"
      );
    });
  });
});
