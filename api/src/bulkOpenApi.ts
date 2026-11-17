/**
 * OpenAPI documentation for a modelRouter's `POST /bulk` (see `bulk.ts`), so generated SDKs
 * (syncdb `--api-out`) get a typed hook for it.
 */
import type express from "express";
import merge from "lodash/merge";
import type {Model} from "mongoose";

import type {ModelRouterOptions} from "./api";
import type {BulkMethod} from "./bulk";
import {apiErrorContent, defaultOpenApiErrorResponses} from "./openApi";
import {getOpenApiSpecForModel} from "./populate";

const passThrough: express.RequestHandler = (_req, _res, next) => next();

/** Builds the OpenAPI middleware for `POST /bulk`, or a pass-through when OpenAPI is off. */
export const bulkOpenApiMiddleware = <T>({
  model,
  options,
  maxItems,
  methods,
}: {
  model: Model<T>;
  options: Partial<ModelRouterOptions<T>>;
  maxItems: number;
  methods: BulkMethod[];
}): express.RequestHandler => {
  if (!options.openApi?.path) {
    return passThrough;
  }

  const tag = model.collection.collectionName;
  const {properties, required} = getOpenApiSpecForModel(model, {
    extraModelProperties: options.openApiExtraModelProperties,
    populatePaths: options.populatePaths,
  });
  const modelResponse = {
    properties,
    required: [...required, "_id", "created", "updated"],
    type: "object",
  };

  return options.openApi.path(
    merge(
      {
        description:
          "Run many create/update/delete operations through this router's permissions, hooks, " +
          "and responseHandler. With atomic (default true) the batch commits or rolls back " +
          "together; with atomic: false each item reports its own status.",
        operationId: `${tag}_bulk`,
        requestBody: {
          content: {
            "application/json": {
              schema: {
                properties: {
                  atomic: {
                    default: true,
                    description:
                      "Commit every operation in one transaction (requires a replica set)",
                    type: "boolean",
                  },
                  operations: {
                    items: {
                      properties: {
                        body: {
                          description: "Document fields for create and update",
                          properties,
                          type: "object",
                        },
                        id: {description: "Document id for update and delete", type: "string"},
                        method: {enum: methods, type: "string"},
                      },
                      required: ["method"],
                      type: "object",
                    },
                    maxItems,
                    minItems: 1,
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
                  properties: {
                    data: {
                      items: {
                        properties: {
                          data: modelResponse,
                          error: {$ref: "#/components/schemas/APIError"},
                          id: {type: "string"},
                          index: {type: "number"},
                          method: {enum: methods, type: "string"},
                          status: {type: "number"},
                        },
                        required: ["index", "method", "status"],
                        type: "object",
                      },
                      type: "array",
                    },
                  },
                  required: ["data"],
                  type: "object",
                },
              },
            },
            description: "One result per operation, in input order",
          },
          ...defaultOpenApiErrorResponses,
          401: {content: apiErrorContent, description: "The user must be authenticated"},
        },
        summary: `Bulk write ${tag}`,
        tags: [tag],
      },
      options.openApiOverwrite?.bulk ?? {}
    )
  );
};
