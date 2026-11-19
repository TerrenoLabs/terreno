import {describe, expect, it} from "bun:test";

import {discoverOperations} from "./discoverOperations";
import type {OpenApiDocument} from "./types";

// The shape @terreno/api documents for a modelRouter with `bulk: true` (api/src/bulkOpenApi.ts).
const bulkSpec = {
  info: {title: "test", version: "1"},
  openapi: "3.0.0",
  paths: {
    "/food/bulk": {
      post: {
        operationId: "foods_bulk",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                properties: {
                  atomic: {type: "boolean"},
                  operations: {
                    items: {
                      properties: {
                        body: {properties: {name: {type: "string"}}, type: "object"},
                        id: {type: "string"},
                        method: {enum: ["create", "update", "delete"], type: "string"},
                      },
                      required: ["method"],
                      type: "object",
                    },
                    type: "array",
                  },
                },
                required: ["operations"],
                type: "object",
              },
            },
          },
          required: true,
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  properties: {data: {items: {type: "object"}, type: "array"}},
                  type: "object",
                },
              },
            },
            description: "One result per operation",
          },
        },
        tags: ["foods"],
      },
    },
  },
} as unknown as OpenApiDocument;

describe("discoverOperations with a modelRouter bulk route", () => {
  it("discovers POST /food/bulk so the codegen emits a hook for it", () => {
    const operations = discoverOperations({spec: bulkSpec});
    const bulk = operations.find((operation) => operation.path === "/food/bulk");
    expect(bulk).toBeDefined();
    expect(bulk?.method).toBe("post");
    expect(bulk?.name).toBe("foodsBulk");
    expect(bulk?.body).toBeDefined();
    expect(bulk?.response).toBeDefined();
  });
});
