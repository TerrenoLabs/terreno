import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import type express from "express";
import type {Router} from "express";
import supertest from "supertest";
import type TestAgent from "supertest/lib/agent";

import {type ModelRouterOptions, modelRouter, type OpenApiMiddleware} from "./api";
import type {UserModel as AuthUserModel} from "./auth";
import {createOpenApiBuilder, OpenApiMiddlewareBuilder} from "./openApiBuilder";
import {Permissions} from "./permissions";
import {TerrenoApp} from "./terrenoApp";
import {type Food, FoodModel, UserModel} from "./tests";

/** The subset of an OpenAPI parameter object the assertions below inspect. */
interface OpenApiParameter {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema: {type: string};
}

function addRoutesWithBuilder(
  router: Router,
  options?: Partial<ModelRouterOptions<unknown>>
): void {
  // Add a custom endpoint using the OpenApiMiddlewareBuilder
  const statsMiddleware = createOpenApiBuilder(options ?? {})
    .withTags(["Stats"])
    .withSummary("Get food statistics")
    .withOperationId("getFoodStats")
    .withDescription("Returns aggregated statistics about food items")
    .withQueryParameter(
      "category",
      {type: "string"},
      {
        description: "Filter by food category",
        required: false,
      }
    )
    .withResponse<{count: number; avgCalories: number}>(200, {
      avgCalories: {description: "Average calories", type: "number"},
      count: {description: "Total number of food items", type: "number"},
    })
    .build();

  router.get("/food/stats", statsMiddleware, async (_req, res) => {
    res.json({avgCalories: 250, count: 10});
  });

  // Add endpoint with request body
  const createReportMiddleware = createOpenApiBuilder(options ?? {})
    .withTags(["Reports"])
    .withSummary("Create a food report")
    .withDescription("Generates a report based on provided criteria")
    .withRequestBody<{
      startDate: string;
      endDate: string;
      includeDeleted: boolean;
    }>({
      endDate: {
        description: "Report end date",
        format: "date",
        required: true,
        type: "string",
      },
      includeDeleted: {
        description: "Whether to include deleted items",
        type: "boolean",
      },
      startDate: {
        description: "Report start date",
        format: "date",
        required: true,
        type: "string",
      },
    })
    .withResponse<{reportId: string}>(
      201,
      {
        reportId: {description: "Generated report ID", type: "string"},
      },
      {description: "Report created successfully"}
    )
    .build();

  router.post("/food/reports", createReportMiddleware, async (_req, res) => {
    res.status(201).json({reportId: "report-123"});
  });

  // Add endpoint with array response
  const listCategoriesMiddleware = createOpenApiBuilder(options ?? {})
    .withTags(["Categories"])
    .withSummary("List food categories")
    .withArrayResponse<{id: string; name: string; count: number}>(
      200,
      {
        count: {description: "Number of items in category", type: "number"},
        id: {description: "Category ID", type: "string"},
        name: {description: "Category name", type: "string"},
      },
      {description: "List of categories"}
    )
    .build();

  router.get("/food/categories", listCategoriesMiddleware, async (_req, res) => {
    res.json([
      {count: 5, id: "1", name: "Fruits"},
      {count: 3, id: "2", name: "Vegetables"},
    ]);
  });

  // Add endpoint with path parameter
  const getCategoryMiddleware = createOpenApiBuilder(options ?? {})
    .withTags(["Categories"])
    .withSummary("Get category by ID")
    .withPathParameter(
      "categoryId",
      {type: "string"},
      {
        description: "The category identifier",
      }
    )
    .withResponse<{id: string; name: string}>(200, {
      id: {type: "string"},
      name: {type: "string"},
    })
    .withResponse(404, "Category not found")
    .build();

  router.get("/food/categories/:categoryId", getCategoryMiddleware, async (req, res) => {
    res.json({id: req.params.categoryId, name: "Fruits"});
  });

  // Standard modelRouter for food
  router.use(
    "/food",
    modelRouter(FoodModel, {
      ...(options as Partial<ModelRouterOptions<Food>>),
      allowAnonymous: true,
      permissions: {
        create: [Permissions.IsAny],
        delete: [Permissions.IsAny],
        list: [Permissions.IsAny],
        read: [Permissions.IsAny],
        update: [Permissions.IsAny],
      },
    })
  );
}

describe("OpenApiMiddlewareBuilder", () => {
  let server: TestAgent;
  let app: express.Application;

  beforeEach(async () => {
    process.env.REFRESH_TOKEN_SECRET = "testsecret1234";
    process.env.ENABLE_SWAGGER = "true";

    app = new TerrenoApp({
      configureApp: addRoutesWithBuilder,
      skipListen: true,
      userModel: UserModel as unknown as AuthUserModel,
    }).build();
  });

  describe("builder pattern", () => {
    it("returns a builder instance from createOpenApiBuilder", () => {
      const builder = createOpenApiBuilder({});
      expect(builder).toBeInstanceOf(OpenApiMiddlewareBuilder);
    });

    it("supports method chaining", () => {
      const builder = createOpenApiBuilder({});
      const result = builder
        .withTags(["test"])
        .withSummary("Test summary")
        .withDescription("Test description");

      expect(result).toBe(builder);
    });

    it("returns noop middleware when openApi is not configured", () => {
      const middleware = createOpenApiBuilder({}).build();
      expect(typeof middleware).toBe("function");
      expect(middleware.length).toBe(3); // Express middleware signature
    });
  });

  describe("OpenAPI spec generation", () => {
    it("includes custom endpoint with query parameter in OpenAPI spec", async () => {
      server = supertest(app);
      const res = await server.get("/openapi.json").expect(200);

      const statsPath = res.body.paths["/food/stats"];
      expect(statsPath).toBeDefined();
      expect(statsPath.get).toBeDefined();
      expect(statsPath.get.tags).toContain("Stats");
      expect(statsPath.get.summary).toBe("Get food statistics");
      expect(statsPath.get.description).toBe("Returns aggregated statistics about food items");

      // Check query parameter
      const categoryParam = statsPath.get.parameters.find(
        (p: OpenApiParameter) => p.name === "category"
      );
      expect(categoryParam).toBeDefined();
      expect(categoryParam.in).toBe("query");
      expect(categoryParam.schema.type).toBe("string");
      expect(categoryParam.description).toBe("Filter by food category");
      expect(categoryParam.required).toBe(false);
    });

    it("includes the explicit operationId in OpenAPI spec", async () => {
      server = supertest(app);
      const res = await server.get("/openapi.json").expect(200);

      const statsPath = res.body.paths["/food/stats"];
      expect(statsPath.get.operationId).toBe("getFoodStats");
    });

    it("includes request body schema in OpenAPI spec", async () => {
      server = supertest(app);
      const res = await server.get("/openapi.json").expect(200);

      const reportsPath = res.body.paths["/food/reports"];
      expect(reportsPath).toBeDefined();
      expect(reportsPath.post).toBeDefined();
      expect(reportsPath.post.tags).toContain("Reports");

      const requestBody = reportsPath.post.requestBody;
      expect(requestBody).toBeDefined();
      expect(requestBody.required).toBe(true);

      const schema = requestBody.content["application/json"].schema;
      expect(schema.type).toBe("object");
      expect(schema.properties.startDate.type).toBe("string");
      expect(schema.properties.startDate.format).toBe("date");
      expect(schema.properties.endDate.type).toBe("string");
      expect(schema.properties.includeDeleted.type).toBe("boolean");
      expect(schema.required).toContain("startDate");
      expect(schema.required).toContain("endDate");
      expect(schema.required).not.toContain("includeDeleted");
    });

    it("includes response schema in OpenAPI spec", async () => {
      server = supertest(app);
      const res = await server.get("/openapi.json").expect(200);

      const statsPath = res.body.paths["/food/stats"];
      const response200 = statsPath.get.responses["200"];
      expect(response200).toBeDefined();
      expect(response200.description).toBe("Success");

      const schema = response200.content["application/json"].schema;
      expect(schema.type).toBe("object");
      expect(schema.properties.count.type).toBe("number");
      expect(schema.properties.avgCalories.type).toBe("number");
    });

    it("includes array response schema in OpenAPI spec", async () => {
      server = supertest(app);
      const res = await server.get("/openapi.json").expect(200);

      const categoriesPath = res.body.paths["/food/categories"];
      expect(categoriesPath).toBeDefined();

      const response200 = categoriesPath.get.responses["200"];
      expect(response200.description).toBe("List of categories");

      const schema = response200.content["application/json"].schema;
      expect(schema.type).toBe("array");
      expect(schema.items.type).toBe("object");
      expect(schema.items.properties.id.type).toBe("string");
      expect(schema.items.properties.name.type).toBe("string");
      expect(schema.items.properties.count.type).toBe("number");
    });

    it("includes path parameter in OpenAPI spec", async () => {
      server = supertest(app);
      const res = await server.get("/openapi.json").expect(200);

      const categoryPath = res.body.paths["/food/categories/{categoryId}"];
      expect(categoryPath).toBeDefined();

      const pathParam = categoryPath.get.parameters.find(
        (p: OpenApiParameter) => p.name === "categoryId"
      );
      expect(pathParam).toBeDefined();
      expect(pathParam.in).toBe("path");
      expect(pathParam.required).toBe(true);
      expect(pathParam.schema.type).toBe("string");
      expect(pathParam.description).toBe("The category identifier");
    });

    it("includes custom response without body in OpenAPI spec", async () => {
      server = supertest(app);
      const res = await server.get("/openapi.json").expect(200);

      // Test with the 201 response from reports endpoint which has a custom description
      const reportsPath = res.body.paths["/food/reports"];
      const response201 = reportsPath.post.responses["201"];
      expect(response201).toBeDefined();
      expect(response201.description).toBe("Report created successfully");
      expect(response201.content).toBeDefined();
    });

    it("includes default error responses", async () => {
      server = supertest(app);
      const res = await server.get("/openapi.json").expect(200);

      const statsPath = res.body.paths["/food/stats"];
      const responses = statsPath.get.responses;

      // Default error responses should be merged
      expect(responses["400"]).toBeDefined();
      expect(responses["401"]).toBeDefined();
      expect(responses["403"]).toBeDefined();
      expect(responses["404"]).toBeDefined();
      expect(responses["405"]).toBeDefined();
    });
  });

  describe("endpoint functionality", () => {
    it("stats endpoint returns correct data", async () => {
      server = supertest(app);
      const res = await server.get("/food/stats").expect(200);
      expect(res.body).toEqual({
        avgCalories: 250,
        count: 10,
        requestId: res.headers["x-request-id"],
      });
    });

    it("reports endpoint returns correct data", async () => {
      server = supertest(app);
      const res = await server
        .post("/food/reports")
        .send({endDate: "2024-12-31", startDate: "2024-01-01"})
        .expect(201);
      expect(res.body).toEqual({
        reportId: "report-123",
        requestId: res.headers["x-request-id"],
      });
    });

    it("categories endpoint returns array data", async () => {
      server = supertest(app);
      const res = await server.get("/food/categories").expect(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0]).toHaveProperty("id");
      expect(res.body[0]).toHaveProperty("name");
    });

    it("category by id endpoint returns correct data", async () => {
      server = supertest(app);
      const res = await server.get("/food/categories/cat-123").expect(200);
      expect(res.body).toEqual({
        id: "cat-123",
        name: "Fruits",
        requestId: res.headers["x-request-id"],
      });
    });
  });

  describe("snapshot tests", () => {
    it("matches OpenAPI spec snapshot", async () => {
      server = supertest(app);
      const res = await server.get("/openapi.json").expect(200);
      expect(res.body).toMatchSnapshot();
    });
  });
});

describe("OpenApiMiddlewareBuilder without OpenAPI", () => {
  it("build returns noop middleware when openApi.path is not configured", () => {
    const builder = new OpenApiMiddlewareBuilder({});
    const middleware = builder
      .withTags(["test"])
      .withSummary("Test")
      .withResponse(200, {id: {type: "string"}})
      .build();

    // Middleware should be a function
    expect(typeof middleware).toBe("function");

    // Should call next() without error
    let nextCalled = false;
    middleware({} as express.Request, {} as express.Response, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
  });

  it("build returns noop middleware when options is empty", () => {
    const middleware = createOpenApiBuilder({}).build();

    let nextCalled = false;
    middleware({} as express.Request, {} as express.Response, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
  });
});

describe("OpenApiMiddlewareBuilder configuration", () => {
  it("correctly extracts required fields from request body schema", () => {
    // We can't easily test this without a mock openApi.path, but we can at least
    // verify the builder accepts the configuration
    const builder = createOpenApiBuilder({}).withRequestBody<{
      required1: string;
      required2: string;
      optional: string;
    }>({
      optional: {type: "string"},
      required1: {required: true, type: "string"},
      required2: {required: true, type: "string"},
    });

    expect(builder).toBeInstanceOf(OpenApiMiddlewareBuilder);
  });

  it("supports custom media types for request body", () => {
    const builder = createOpenApiBuilder({}).withRequestBody(
      {data: {type: "string"}},
      {mediaType: "application/xml"}
    );

    expect(builder).toBeInstanceOf(OpenApiMiddlewareBuilder);
  });

  it("supports custom media types for response", () => {
    const builder = createOpenApiBuilder({}).withResponse(
      200,
      {data: {type: "string"}},
      {mediaType: "text/plain"}
    );

    expect(builder).toBeInstanceOf(OpenApiMiddlewareBuilder);
  });

  it("lists top-level required response fields only when given", () => {
    const captured: Record<string, unknown>[] = [];
    const openApi = {
      path: (schema: Record<string, unknown> = {}): express.RequestHandler => {
        captured.push(schema);
        return (_req, _res, next) => next();
      },
    } as unknown as OpenApiMiddleware;

    createOpenApiBuilder({openApi})
      .withResponse(200, {data: {nullable: true, type: "object"}}, {required: ["data"]})
      .withValidation({enabled: false})
      .build();
    createOpenApiBuilder({openApi})
      .withResponse(200, {ok: {type: "boolean"}})
      .withValidation({enabled: false})
      .build();

    interface CapturedOperation {
      responses: Record<number, {content: Record<string, {schema: Record<string, unknown>}>}>;
    }
    const schemaOf = (index: number): Record<string, unknown> | undefined =>
      (captured[index] as unknown as CapturedOperation | undefined)?.responses[200]?.content[
        "application/json"
      ]?.schema;
    expect(schemaOf(0)).toEqual({
      properties: {data: {nullable: true, type: "object"}},
      required: ["data"],
      type: "object",
    });
    expect(schemaOf(1)).toEqual({properties: {ok: {type: "boolean"}}, type: "object"});
  });

  it("supports optional request body", () => {
    const builder = createOpenApiBuilder({}).withRequestBody(
      {data: {type: "string"}},
      {required: false}
    );

    expect(builder).toBeInstanceOf(OpenApiMiddlewareBuilder);
  });

  it("supports multiple query parameters", () => {
    const builder = createOpenApiBuilder({})
      .withQueryParameter("limit", {type: "number"}, {required: false})
      .withQueryParameter("offset", {type: "number"}, {required: false})
      .withQueryParameter("search", {type: "string"});

    expect(builder).toBeInstanceOf(OpenApiMiddlewareBuilder);
  });

  it("supports multiple path parameters", () => {
    const builder = createOpenApiBuilder({})
      .withPathParameter("userId", {type: "string"})
      .withPathParameter("postId", {type: "string"});

    expect(builder).toBeInstanceOf(OpenApiMiddlewareBuilder);
  });

  it("supports multiple responses", () => {
    const builder = createOpenApiBuilder({})
      .withResponse(200, {data: {type: "string"}})
      .withResponse(201, {id: {type: "string"}})
      .withResponse(204, "No content")
      .withResponse(404, "Not found");

    expect(builder).toBeInstanceOf(OpenApiMiddlewareBuilder);
  });
});

describe("OpenApiMiddlewareBuilder withValidation / buildWithSchemas", () => {
  const resetValidatorConfig = (): void => {
    const {resetOpenApiValidatorConfig} = require("./openApiValidator");
    resetOpenApiValidatorConfig();
  };

  beforeEach(() => {
    resetValidatorConfig();
  });

  afterEach(() => {
    resetValidatorConfig();
  });

  it("buildWithSchemas returns bodySchema and querySchema", () => {
    const result = createOpenApiBuilder({})
      .withRequestBody({name: {required: true, type: "string"}})
      .withQueryParameter("page", {type: "number"})
      .buildWithSchemas();

    expect(result.bodySchema).toBeDefined();
    expect(result.bodySchema?.name).toBeDefined();
    expect(result.querySchema).toBeDefined();
    expect(result.querySchema?.page).toBeDefined();
    expect(typeof result.middleware).toBe("function");
  });

  it("buildWithSchemas returns undefined schemas when no body/query defined", () => {
    const result = createOpenApiBuilder({}).buildWithSchemas();
    expect(result.bodySchema).toBeUndefined();
    expect(result.querySchema).toBeUndefined();
  });

  it("withValidation with defaults enables body and query validation", () => {
    const result = createOpenApiBuilder({})
      .withRequestBody({name: {required: true, type: "string"}})
      .withQueryParameter("page", {type: "number"})
      .withValidation()
      .buildWithSchemas();

    expect(result.validationEnabled).toBe(true);
  });

  it("withValidation with enabled=false disables validation", () => {
    const result = createOpenApiBuilder({})
      .withRequestBody({name: {required: true, type: "string"}})
      .withValidation({enabled: false})
      .buildWithSchemas();

    expect(result.validationEnabled).toBe(false);
  });

  it("build() returns a single composed middleware when validation is enabled with body and query", () => {
    const result = createOpenApiBuilder({})
      .withRequestBody({name: {required: true, type: "string"}})
      .withQueryParameter("page", {type: "number"})
      .withValidation()
      .build();

    expect(typeof result).toBe("function");
    expect(Array.isArray(result)).toBe(false);
  });

  it("build() returns a single middleware when validation is disabled", () => {
    const result = createOpenApiBuilder({})
      .withRequestBody({name: {required: true, type: "string"}})
      .build();

    expect(typeof result).toBe("function");
  });

  it("build() falls back to single middleware when there is nothing to validate", () => {
    const result = createOpenApiBuilder({}).withValidation().build();

    expect(typeof result).toBe("function");
  });

  it("withValidation options body=false and query=false is respected", () => {
    const result = createOpenApiBuilder({})
      .withRequestBody({name: {required: true, type: "string"}})
      .withQueryParameter("page", {type: "number"})
      .withValidation({body: false, query: false})
      .build();

    // No body/query validation = just the openApi middleware (single fn)
    expect(typeof result).toBe("function");
  });

  // The composed handler must still run every validator in order and surface a
  // validator's synchronous throw, which routes previously got from Express
  // spreading an array of middleware.
  describe("composed validation middleware", () => {
    const buildTestApp = (): express.Express => {
      const {configureOpenApiValidator} = require("./openApiValidator");
      configureOpenApiValidator({logValidationErrors: false});

      const {apiErrorMiddleware} = require("./errors");
      const expressLib = require("express") as typeof import("express");

      const app = expressLib();
      app.use(expressLib.json());
      app.post(
        "/widgets",
        createOpenApiBuilder({})
          .withRequestBody({name: {required: true, type: "string"}})
          .withQueryParameter("page", {type: "number"})
          .withValidation()
          .build(),
        (req, res) => {
          res.json({name: (req.body as {name: string}).name});
        }
      );
      app.use(apiErrorMiddleware);
      return app;
    };

    it("passes a valid request through to the route handler", async () => {
      const response = await supertest(buildTestApp())
        .post("/widgets?page=2")
        .send({name: "valid"});

      expect(response.status).toBe(200);
      expect(response.body.name).toBe("valid");
    });

    it("rejects a body missing a required field with a 400", async () => {
      const response = await supertest(buildTestApp()).post("/widgets").send({});

      expect(response.status).toBe(400);
    });

    it("keeps the documented path in /openapi.json when validation is composed", async () => {
      process.env.REFRESH_TOKEN_SECRET = "testsecret1234";
      process.env.ENABLE_SWAGGER = "true";

      const {configureOpenApiValidator} = require("./openApiValidator");
      configureOpenApiValidator({logValidationErrors: false});

      const addValidatedWidgetRoute = (
        router: express.Router,
        options?: Partial<ModelRouterOptions<unknown>>
      ): void => {
        const middleware = createOpenApiBuilder(options ?? {})
          .withTags(["Widgets"])
          .withSummary("Create a widget")
          .withRequestBody({name: {required: true, type: "string"}})
          .withQueryParameter("page", {type: "number"})
          .withValidation()
          .build();
        router.post("/widgets", middleware, (_req, res) => {
          res.json({ok: true});
        });
      };

      const documentedApp = new TerrenoApp({
        configureApp: addValidatedWidgetRoute,
        skipListen: true,
        userModel: UserModel as unknown as AuthUserModel,
      }).build();

      const spec = await supertest(documentedApp).get("/openapi.json").expect(200);
      expect(spec.body.paths["/widgets"]).toBeDefined();
      expect(spec.body.paths["/widgets"].post).toBeDefined();
      expect(spec.body.paths["/widgets"].post.summary).toBe("Create a widget");
      expect(spec.body.paths["/widgets"].post.requestBody).toBeDefined();
    });
  });
});
