import {describe, expect, it} from "bun:test";

import {
  expectDocumentedResponse,
  type OpenApiResponseSpec,
  validateDocumentedResponse,
} from "../tests/openApiResponseSchema";

const spec: OpenApiResponseSpec = {
  components: {
    schemas: {
      Tag: {
        properties: {label: {type: "string"}},
        required: ["label"],
        type: "object",
      },
    },
  },
  paths: {
    "/items/{id}": {
      get: {
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  properties: {
                    data: {
                      properties: {
                        created: {format: "date-time", type: "string"},
                        note: {nullable: true, type: "string"},
                        tags: {items: {$ref: "#/components/schemas/Tag"}, type: "array"},
                      },
                      required: ["tags"],
                      type: "object",
                    },
                  },
                  required: ["data"],
                  type: "object",
                },
              },
            },
          },
          "204": {description: "No content"},
        },
      },
    },
    "/plain": {get: {}},
  },
} as unknown as OpenApiResponseSpec;

const valid = {
  data: {created: "2026-01-02T03:04:05.000Z", note: null, tags: [{label: "a"}]},
};

describe("validateDocumentedResponse", () => {
  it("accepts a body that matches the documented schema, refs and nullable included", () => {
    const result = validateDocumentedResponse({
      method: "GET",
      path: "/items/{id}",
      response: {body: valid, status: 200},
      spec,
    });

    expect(result).toEqual({errors: [], valid: true});
  });

  it("reports every violation with its JSON pointer, following component refs", () => {
    const result = validateDocumentedResponse({
      method: "get",
      path: "/items/{id}",
      response: {body: {data: {created: "yesterday", tags: [{}]}}, status: 200},
      spec,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        '/data/created must match format "date-time"',
        "/data/tags/0 must have required property 'label'",
      ])
    );
  });

  it("labels root-level violations", () => {
    const result = validateDocumentedResponse({
      method: "get",
      path: "/items/{id}",
      response: {body: {}, status: 200},
      spec,
    });

    expect(result.errors).toEqual(["(root) must have required property 'data'"]);
  });

  it("throws when the route, status, or media type is not documented", () => {
    const check = (path: string, status: number, contentType?: string): (() => unknown) => {
      return () =>
        validateDocumentedResponse({
          contentType,
          method: "get",
          path,
          response: {body: {}, status},
          spec,
        });
    };

    expect(check("/missing", 200)).toThrow("GET /missing is not documented in the OpenAPI spec");
    expect(check("/items/{id}", 404)).toThrow(
      "GET /items/{id} has no documented 404 response (documented: 200, 204)"
    );
    expect(check("/plain", 200)).toThrow(
      "GET /plain has no documented 200 response (documented: none)"
    );
    expect(check("/items/{id}", 204)).toThrow(
      "GET /items/{id} 204 response has no application/json schema"
    );
    expect(check("/items/{id}", 200, "text/csv")).toThrow(
      "GET /items/{id} 200 response has no text/csv schema"
    );
  });
});

describe("expectDocumentedResponse", () => {
  it("passes silently for a documented body", () => {
    expect(() =>
      expectDocumentedResponse({
        method: "get",
        path: "/items/{id}",
        response: {body: valid, status: 200},
        spec,
      })
    ).not.toThrow();
  });

  it("throws with the violations and the body", () => {
    expect(() =>
      expectDocumentedResponse({
        method: "get",
        path: "/items/{id}",
        response: {body: {data: {tags: "nope"}}, status: 200},
        spec,
      })
    ).toThrow(
      'GET /items/{id} 200 response does not match its OpenAPI schema:\n- /data/tags must be array\nBody: {"data":{"tags":"nope"}}'
    );
  });
});
