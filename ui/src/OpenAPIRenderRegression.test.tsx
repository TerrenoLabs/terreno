import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {act, render, waitFor} from "@testing-library/react-native";
import {assert} from "chai";
import React, {useEffect, useState} from "react";
import {Text, View} from "react-native";

import type {OpenAPISpec} from "./Common";
import {OpenAPIProvider, useOpenAPISpec} from "./OpenAPIContext";

const SPEC_V0: OpenAPISpec = {
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

const SPEC_V1: OpenAPISpec = {
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
                          title: {description: "Updated title description", type: "string"},
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

const specByUrl: Record<string, OpenAPISpec> = {
  "https://api.example.com/openapi-v0.json": SPEC_V0,
  "https://api.example.com/openapi-v1.json": SPEC_V1,
};

const ParentNoise: React.FC<{children: React.ReactElement}> = ({children}) => {
  const [, setNoise] = useState(0);

  // Trigger parent rerenders without changing the loaded OpenAPI spec.
  useEffect((): void => {
    setNoise((value) => value + 1);
  }, []);

  return children;
};

let fieldProbeRenderCount = 0;

const FieldProbe: React.FC = React.memo(() => {
  fieldProbeRenderCount += 1;
  const {getModelField} = useOpenAPISpec();
  const field = getModelField("Todo Items", "title");
  return <View accessibilityLabel={field?.description ?? "missing"} testID="field-probe" />;
});

const ContextProbe: React.FC<{
  onContext?: (context: ReturnType<typeof useOpenAPISpec>) => void;
}> = ({onContext}) => {
  const context = useOpenAPISpec();
  onContext?.(context);
  return <Text>probe</Text>;
};

describe("OpenAPI context rerender regression coverage", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fieldProbeRenderCount = 0;
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      const spec = specByUrl[url];
      if (!spec) {
        throw new Error(`Unexpected OpenAPI spec URL: ${url}`);
      }
      return {
        json: async () => spec,
      };
    }) as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("skips equivalent OpenAPI consumer renders and updates field lookups when the spec changes", async () => {
    const result = render(
      <ParentNoise>
        <OpenAPIProvider specUrl="https://api.example.com/openapi-v0.json">
          <FieldProbe />
        </OpenAPIProvider>
      </ParentNoise>
    );

    await waitFor(() => {
      expect(result.getByLabelText("Title for the todo")).toBeTruthy();
    });
    assert.equal(fieldProbeRenderCount, 2);

    await act(async () => {
      result.rerender(
        <ParentNoise>
          <OpenAPIProvider specUrl="https://api.example.com/openapi-v0.json">
            <FieldProbe />
          </OpenAPIProvider>
        </ParentNoise>
      );
    });
    assert.equal(fieldProbeRenderCount, 2);

    await act(async () => {
      result.rerender(
        <ParentNoise>
          <OpenAPIProvider specUrl="https://api.example.com/openapi-v1.json">
            <FieldProbe />
          </OpenAPIProvider>
        </ParentNoise>
      );
    });

    await waitFor(() => {
      expect(result.getByLabelText("Updated title description")).toBeTruthy();
    });
    assert.equal(fieldProbeRenderCount, 3);
    assert.isNull(result.queryByLabelText("Title for the todo"));
  });

  it("keeps stable OpenAPI action references across equivalent provider renders", async () => {
    let capturedContext = null as ReturnType<typeof useOpenAPISpec> | null;

    const result = render(
      <OpenAPIProvider specUrl="https://api.example.com/openapi-v0.json">
        <ContextProbe
          onContext={(context) => {
            capturedContext = context;
          }}
        />
      </OpenAPIProvider>
    );

    await waitFor(() => {
      expect(capturedContext?.spec).toEqual(SPEC_V0);
    });
    const initialGetModelField = capturedContext?.getModelField;
    const initialGetModelFields = capturedContext?.getModelFields;

    await act(async () => {
      result.rerender(
        <OpenAPIProvider specUrl="https://api.example.com/openapi-v0.json">
          <ContextProbe
            onContext={(context) => {
              capturedContext = context;
            }}
          />
        </OpenAPIProvider>
      );
    });

    expect(capturedContext?.getModelField).toBe(initialGetModelField);
    expect(capturedContext?.getModelFields).toBe(initialGetModelFields);
  });
});
