import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import type {ErrorObject} from "ajv";
import type {NextFunction, Request, Response} from "express";
import mongoose from "mongoose";

import {ADMIN_LIST_CHOICE_EMPTY_VALUE} from "./adminTypes";
import {modelRouter} from "./api";
import {type UserModel as AuthUserModel, addAuthRoutes, setupAuth} from "./auth";
import type {OpenApiSchemaProperty} from "./openApiBuilder";
import {
  buildQuerySchemaFromFields,
  configureOpenApiValidator,
  createModelValidators,
  createValidator,
  getOpenApiValidatorConfig,
  getSchemaFromModel,
  isEscapedRegexLiteral,
  isOpenApiValidatorConfigured,
  resetOpenApiValidatorConfig,
  validateModelRequestBody,
  validateQueryParams,
  validateRequestBody,
  validateResponseData,
} from "./openApiValidator";
import {Permissions} from "./permissions";
import {authAsUser, FoodModel, getBaseServer, RequiredModel, setupDb, UserModel} from "./tests";

// RequiredModel has a clean schema that AJV can compile (no non-standard types).
// It has: name (String, required), about (String, optional)
const requiredRouterOptions = {
  permissions: {
    create: [Permissions.IsAuthenticated],
    delete: [Permissions.IsAdmin],
    list: [Permissions.IsAuthenticated],
    read: [Permissions.IsAuthenticated],
    update: [Permissions.IsAuthenticated],
  },
  queryFields: ["name"],
  sort: "-name" as const,
};

const setupFreshApp = async () => {
  const freshApp = getBaseServer();
  setupAuth(freshApp, UserModel as unknown as AuthUserModel);
  addAuthRoutes(freshApp, UserModel as unknown as AuthUserModel);
  return freshApp;
};

describe("openApiValidator", () => {
  beforeEach(async () => {
    resetOpenApiValidatorConfig();
    await setupDb();
    await RequiredModel.deleteMany({});
  });

  afterEach(() => {
    resetOpenApiValidatorConfig();
  });

  describe("isConfigured flag", () => {
    it("is false by default", () => {
      expect(isOpenApiValidatorConfigured()).toBe(false);
    });

    it("becomes true after configureOpenApiValidator()", () => {
      configureOpenApiValidator();
      expect(isOpenApiValidatorConfigured()).toBe(true);
    });

    it("resets to false after resetOpenApiValidatorConfig()", () => {
      configureOpenApiValidator();
      expect(isOpenApiValidatorConfigured()).toBe(true);
      resetOpenApiValidatorConfig();
      expect(isOpenApiValidatorConfigured()).toBe(false);
    });
  });

  describe("no-op when not configured", () => {
    it("does not strip or validate when not configured", async () => {
      const freshApp = await setupFreshApp();
      freshApp.use("/required", modelRouter(RequiredModel, requiredRouterOptions));
      const admin = await authAsUser(freshApp, "admin");

      // When not configured, validation is a no-op — valid requests pass through
      const res = await admin.post("/required").send({name: "Apple"}).expect(201);
      expect(res.body.data.name).toBe("Apple");
    });
  });

  describe("active after configuration", () => {
    it("strips extra properties when removeAdditional is true", async () => {
      configureOpenApiValidator({removeAdditional: true});

      const freshApp = await setupFreshApp();
      freshApp.use("/required", modelRouter(RequiredModel, requiredRouterOptions));
      const admin = await authAsUser(freshApp, "admin");

      const res = await admin
        .post("/required")
        .send({fakeField: "this should be stripped", name: "Apple"})
        .expect(201);

      expect(res.body.data.name).toBe("Apple");
      expect(res.body.data.fakeField).toBeUndefined();
    });

    it("rejects missing required fields", async () => {
      configureOpenApiValidator();

      const freshApp = await setupFreshApp();
      freshApp.use("/required", modelRouter(RequiredModel, requiredRouterOptions));
      const admin = await authAsUser(freshApp, "admin");

      const res = await admin.post("/required").send({about: "no name"}).expect(400);
      expect(res.body.title).toBe("Request validation failed");
    });

    it("allows PATCH bodies that omit mongoose required fields", async () => {
      configureOpenApiValidator();

      const freshApp = await setupFreshApp();
      freshApp.use("/required", modelRouter(RequiredModel, requiredRouterOptions));
      const admin = await authAsUser(freshApp, "admin");
      const created = await admin.post("/required").send({name: "Apple"}).expect(201);

      const patched = await admin
        .patch(`/required/${created.body.data._id}`)
        .send({about: "partial"})
        .expect(200);
      expect(patched.body.data.name).toBe("Apple");
      expect(patched.body.data.about).toBe("partial");
    });
  });

  describe("onAdditionalPropertiesRemoved hook", () => {
    it("fires callback with removed property names", async () => {
      const removedProps: string[] = [];

      configureOpenApiValidator({
        onAdditionalPropertiesRemoved: (props) => {
          removedProps.push(...props);
        },
        removeAdditional: true,
      });

      const freshApp = await setupFreshApp();
      freshApp.use("/required", modelRouter(RequiredModel, requiredRouterOptions));
      const admin = await authAsUser(freshApp, "admin");

      await admin
        .post("/required")
        .send({extraA: "stripped", extraB: "also stripped", name: "Apple"})
        .expect(201);

      expect(removedProps).toContain("extraA");
      expect(removedProps).toContain("extraB");
    });
  });

  describe("per-route validation: false override", () => {
    it("skips validation when validation is false", async () => {
      configureOpenApiValidator({removeAdditional: true});

      const freshApp = await setupFreshApp();
      freshApp.use(
        "/required",
        modelRouter(RequiredModel, {
          ...requiredRouterOptions,
          validation: false,
        })
      );
      const admin = await authAsUser(freshApp, "admin");

      // With validation: false, extra properties are NOT stripped by validator
      // RequiredModel does not have strict: "throw" so the extra field will just be ignored by Mongoose
      const res = await admin
        .post("/required")
        .send({fakeField: "not stripped", name: "Apple"})
        .expect(201);

      expect(res.body.data.name).toBe("Apple");
    });
  });

  describe("per-route validation: object-form options", () => {
    it("applies object validation options with per-operation control", async () => {
      configureOpenApiValidator({removeAdditional: true});

      const removedProps: string[] = [];
      const errorsCaught: ErrorObject[][] = [];

      const freshApp = await setupFreshApp();
      freshApp.use(
        "/required",
        modelRouter(RequiredModel, {
          ...requiredRouterOptions,
          validation: {
            excludeFromCreate: ["about"],
            onAdditionalPropertiesRemoved: (props) => {
              removedProps.push(...props);
            },
            onError: (errors) => {
              errorsCaught.push(errors);
            },
            validateCreate: true,
            validateQuery: true,
            validateUpdate: true,
          },
        })
      );
      const admin = await authAsUser(freshApp, "admin");

      const res = await admin.post("/required").send({name: "Validated"}).expect(201);
      expect(res.body.data.name).toBe("Validated");
    });

    it("disables create validation when validateCreate is false", async () => {
      configureOpenApiValidator({removeAdditional: true});

      const freshApp = await setupFreshApp();
      freshApp.use(
        "/required",
        modelRouter(RequiredModel, {
          ...requiredRouterOptions,
          validation: {
            excludeFromUpdate: ["about"],
            validateCreate: false,
            validateUpdate: true,
          },
        })
      );
      const admin = await authAsUser(freshApp, "admin");

      // Even with extra field, should pass since create validation is disabled
      const res = await admin
        .post("/required")
        .send({extraField: "ignored", name: "NoCreateValidation"})
        .expect(201);
      expect(res.body.data.name).toBe("NoCreateValidation");
    });
  });

  describe("sanitization of non-standard mongoose-to-swagger types", () => {
    it("validates models with ObjectId and DateOnly fields after sanitization", async () => {
      configureOpenApiValidator({removeAdditional: true});

      const freshApp = await setupFreshApp();
      freshApp.use(
        "/food",
        modelRouter(FoodModel, {
          permissions: {
            create: [Permissions.IsAuthenticated],
            delete: [Permissions.IsAdmin],
            list: [Permissions.IsAuthenticated],
            read: [Permissions.IsAuthenticated],
            update: [Permissions.IsAuthenticated],
          },
          queryFields: ["name", "calories", "hidden"],
          sort: "-created",
        })
      );
      const admin = await authAsUser(freshApp, "admin");

      const res = await admin
        .post("/food")
        .send({calories: 100, likesIds: [], name: "Apple", source: {name: "Test"}})
        .expect(201);

      expect(res.body.data.name).toBe("Apple");
    });
  });

  describe("buildQuerySchemaFromFields", () => {
    it("always includes limit, page, and sort", () => {
      const schema = buildQuerySchemaFromFields(FoodModel, []);
      expect(schema.limit).toBeDefined();
      expect(schema.page).toBeDefined();
      expect(schema.sort).toBeDefined();
    });

    it("includes queryFields from model schema", () => {
      const schema = buildQuerySchemaFromFields(FoodModel, ["name", "calories"]);
      expect(schema.name).toBeDefined();
      expect(schema.calories).toBeDefined();
      expect(schema.hidden).toBeUndefined();
    });

    it("does not mark query fields as required", () => {
      const schema = buildQuerySchemaFromFields(FoodModel, ["name"]);
      expect(schema.name.required).toBeUndefined();
    });
  });

  describe("choice list query validation", () => {
    const priorityListSchema = new mongoose.Schema({
      name: {required: true, type: String},
      priority: {enum: ["low", "high"], type: String},
    });
    const PriorityListModel =
      mongoose.models.OpenApiPriorityList ??
      mongoose.model("OpenApiPriorityList", priorityListSchema);

    const assertQueryAccepted = (query: Record<string, unknown>): void => {
      configureOpenApiValidator({coerceTypes: true});
      const schema = buildQuerySchemaFromFields(PriorityListModel, ["priority"]);
      const middleware = validateQueryParams(schema);
      let nextCalled = false;
      const req = {method: "GET", path: "/test", query: {...query}} as unknown as Request;
      middleware(req, {} as Response, () => {
        nextCalled = true;
      });
      expect(nextCalled).toBe(true);
    };

    it("accepts scalar and $in choice query shapes", () => {
      assertQueryAccepted({limit: "25", page: "1", priority: "high"});
      assertQueryAccepted({limit: "25", page: "1", priority: {$in: ["high"]}});
      assertQueryAccepted({
        limit: "25",
        page: "1",
        priority: {$in: ["high", ADMIN_LIST_CHOICE_EMPTY_VALUE]},
      });
    });

    it("rejects invalid choice query shapes", () => {
      configureOpenApiValidator({coerceTypes: true});
      const schema = buildQuerySchemaFromFields(PriorityListModel, ["priority"]);
      const middleware = validateQueryParams(schema);
      const req = {
        method: "GET",
        path: "/test",
        query: {limit: "25", page: "1", priority: {$in: ["high", "missing"]}},
      } as unknown as Request;

      expect(() => {
        middleware(req, {} as Response, () => {});
      }).toThrow();
    });
  });

  describe("isEscapedRegexLiteral", () => {
    it("accepts literal text and escaped metacharacters", () => {
      expect(isEscapedRegexLiteral("alice")).toBe(true);
      expect(isEscapedRegexLiteral("\\.\\*")).toBe(true);
    });

    it("rejects executable regex patterns", () => {
      expect(isEscapedRegexLiteral(".*")).toBe(false);
      expect(isEscapedRegexLiteral("^x")).toBe(false);
      expect(isEscapedRegexLiteral("[a-z]")).toBe(false);
    });
  });

  describe("query operator hardening", () => {
    const assertQueryRejected = (query: Record<string, unknown>): void => {
      configureOpenApiValidator({coerceTypes: true, removeAdditional: false});
      const schema = buildQuerySchemaFromFields(FoodModel, ["name"]);
      const middleware = validateQueryParams(schema);
      const req = {method: "GET", path: "/test", query: {...query}} as unknown as Request;

      expect(() => {
        middleware(req, {} as Response, () => {});
      }).toThrow();
    };

    const assertQueryAccepted = (query: Record<string, unknown>): void => {
      configureOpenApiValidator({coerceTypes: true, removeAdditional: false});
      const schema = buildQuerySchemaFromFields(FoodModel, ["name"]);
      const middleware = validateQueryParams(schema);
      let nextCalled = false;
      const req = {method: "GET", path: "/test", query: {...query}} as unknown as Request;
      middleware(req, {} as Response, () => {
        nextCalled = true;
      });
      expect(nextCalled).toBe(true);
    };

    it("accepts escaped literal regex operators", () => {
      assertQueryAccepted({
        name: {$options: "i", $regex: "Green Beans"},
      });
      assertQueryAccepted({
        name: {$options: "i", $regex: "\\.\\*"},
      });
    });

    it("rejects executable regex operators even when removeAdditional is false", () => {
      assertQueryRejected({
        name: {$options: "i", $regex: ".*"},
      });
      assertQueryRejected({
        name: {$options: "i", $regex: "^x"},
      });
    });

    it("rejects extra nested operators on $in objects", () => {
      assertQueryRejected({
        name: {$in: ["Apple"], $ne: "Banana"},
      });
    });

    it("rejects extra nested operators on range objects", () => {
      configureOpenApiValidator({coerceTypes: true, removeAdditional: false});
      const schema = buildQuerySchemaFromFields(FoodModel, ["calories"]);
      const middleware = validateQueryParams(schema);
      const req = {
        method: "GET",
        path: "/test",
        query: {calories: {$gte: 1, $where: "1"}},
      } as unknown as Request;

      expect(() => {
        middleware(req, {} as Response, () => {});
      }).toThrow();
    });
  });

  describe("validateRequestBody middleware", () => {
    it("is a no-op when not configured", () => {
      resetOpenApiValidatorConfig();

      const middleware = validateRequestBody({
        name: {required: true, type: "string"},
      });

      let nextCalled = false;
      const req = {body: {}} as unknown as Request;
      const res = {} as Response;
      const next = () => {
        nextCalled = true;
      };

      middleware(req, res, next);
      expect(nextCalled).toBe(true);
    });

    it("validates when configured", () => {
      configureOpenApiValidator();

      const middleware = validateRequestBody({
        name: {required: true, type: "string"},
      });

      const req = {body: {}, method: "POST", path: "/test"} as unknown as Request;
      const res = {} as Response;

      expect(() => {
        middleware(req, res, () => {});
      }).toThrow();
    });

    it("calls onError callback instead of throwing when provided at option level", () => {
      configureOpenApiValidator();

      let capturedErrors: ErrorObject[] = [];
      const middleware = validateRequestBody(
        {name: {required: true, type: "string"}},
        {
          onError: (errors) => {
            capturedErrors = errors;
          },
        }
      );

      let nextCalled = false;
      const req = {body: {}, method: "POST", path: "/test"} as unknown as Request;
      const res = {} as Response;
      middleware(req, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
      expect(capturedErrors.length).toBeGreaterThan(0);
    });

    it("calls global onValidationError when no per-route handler", () => {
      let capturedErrors: ErrorObject[] = [];
      configureOpenApiValidator({
        onValidationError: (errors) => {
          capturedErrors = errors;
        },
      });

      const middleware = validateRequestBody({name: {required: true, type: "string"}});

      let nextCalled = false;
      const req = {body: {}, method: "POST", path: "/test"} as unknown as Request;
      const res = {} as Response;
      middleware(req, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
      expect(capturedErrors.length).toBeGreaterThan(0);
    });

    it("skips validation when enabled=false on options", () => {
      configureOpenApiValidator();

      const middleware = validateRequestBody(
        {name: {required: true, type: "string"}},
        {enabled: false}
      );

      let nextCalled = false;
      const req = {body: {}, method: "POST", path: "/test"} as unknown as Request;
      const res = {} as Response;
      middleware(req, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
    });

    it("respects validateRequests=false in global config", () => {
      configureOpenApiValidator({validateRequests: false});

      const middleware = validateRequestBody({name: {required: true, type: "string"}});

      let nextCalled = false;
      const req = {body: {}, method: "POST", path: "/test"} as unknown as Request;
      const res = {} as Response;
      middleware(req, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
    });
  });

  describe("validateQueryParams middleware", () => {
    it("is a no-op when not configured", () => {
      resetOpenApiValidatorConfig();

      const middleware = validateQueryParams({
        page: {type: "number"},
      });

      let nextCalled = false;
      const req = {method: "GET", path: "/test", query: {}} as unknown as Request;
      const res = {} as Response;
      middleware(req, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
    });

    it("coerces types when configured", () => {
      configureOpenApiValidator({coerceTypes: true});

      const middleware = validateQueryParams({
        page: {type: "number"},
      });

      const req = {method: "GET", path: "/test", query: {page: "3"}} as unknown as Request;
      const res = {} as Response;
      middleware(req, res, () => {});

      expect<unknown>(req.query.page).toBe(3);
    });

    it("throws validation error when query does not match", () => {
      configureOpenApiValidator({coerceTypes: false});

      const middleware = validateQueryParams({
        page: {required: true, type: "number"},
      });

      const req = {method: "GET", path: "/test", query: {}} as unknown as Request;
      const res = {} as Response;
      // Required top-level property missing triggers an error
      // We need required: [] at schema level via required: true on property. Confirm via calling.
      expect(() => {
        middleware(req, res, () => {});
      }).toThrow();
    });

    it("uses onError callback for query validation", () => {
      let captured: ErrorObject[] = [];
      configureOpenApiValidator({coerceTypes: false});

      const middleware = validateQueryParams(
        {page: {required: true, type: "number"}},
        {
          onError: (errors) => {
            captured = errors;
          },
        }
      );

      let nextCalled = false;
      const req = {method: "GET", path: "/test", query: {}} as unknown as Request;
      const res = {} as Response;
      middleware(req, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
      expect(captured.length).toBeGreaterThan(0);
    });

    it("skips query validation when enabled=false", () => {
      configureOpenApiValidator();

      const middleware = validateQueryParams(
        {page: {required: true, type: "number"}},
        {enabled: false}
      );

      let nextCalled = false;
      const req = {method: "GET", path: "/test", query: {}} as unknown as Request;
      const res = {} as Response;
      middleware(req, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
    });
  });

  describe("validateResponseData", () => {
    it("returns valid when validateResponses is disabled", () => {
      configureOpenApiValidator({validateResponses: false});
      const result = validateResponseData({foo: "bar"}, {name: {type: "string"}});
      expect(result.valid).toBe(true);
    });

    it("validates response shape when validateResponses is enabled", () => {
      configureOpenApiValidator({validateResponses: true});
      const result = validateResponseData(
        {name: "Apple"},
        {name: {required: true, type: "string"}}
      );
      expect(result.valid).toBe(true);
    });

    it("returns errors for invalid response shape", () => {
      configureOpenApiValidator({coerceTypes: false, validateResponses: true});
      const result = validateResponseData({name: 42}, {name: {required: true, type: "string"}});
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });
  });

  describe("createValidator", () => {
    it("runs body then query validation and calls next once both pass", () => {
      configureOpenApiValidator({coerceTypes: true});

      const middleware = createValidator({
        body: {name: {required: true, type: "string"}},
        query: {page: {type: "number"}},
      });

      let nextCalled = false;
      const req = {
        body: {name: "ok"},
        method: "POST",
        path: "/test",
        query: {page: "2"},
      } as unknown as Request;
      const res = {} as Response;
      middleware(req, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
      expect<unknown>(req.query.page).toBe(2);
    });

    it("skips when neither body nor query schemas are provided", () => {
      configureOpenApiValidator();

      const middleware = createValidator({});

      let nextCalled = false;
      const req = {body: {}, method: "POST", path: "/test", query: {}} as unknown as Request;
      const res = {} as Response;
      middleware(req, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
    });

    it("runs only query validation when only query provided", () => {
      configureOpenApiValidator({coerceTypes: true});

      const middleware = createValidator({
        query: {page: {type: "number"}},
      });

      let nextCalled = false;
      const req = {method: "GET", path: "/test", query: {page: "5"}} as unknown as Request;
      const res = {} as Response;
      middleware(req, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
      expect<unknown>(req.query.page).toBe(5);
    });

    it("runs only body validation when no query schema is provided", () => {
      configureOpenApiValidator({coerceTypes: true});

      const middleware = createValidator({
        body: {count: {type: "number"}, name: {required: true, type: "string"}},
      });

      const req = {
        body: {count: "3", name: "ok"},
        method: "POST",
        path: "/test",
        query: {unchecked: "kept"},
      } as unknown as Request;
      const res = {} as Response;

      const nextCalls: unknown[][] = [];
      middleware(req, res, ((...args: unknown[]) => {
        nextCalls.push(args);
      }) as NextFunction);

      expect(nextCalls).toEqual([[]]);
      expect(req.body.count).toBe(3);
      // Query params are untouched when no query schema is configured.
      expect(req.query.unchecked).toBe("kept");
    });

    it("throws body validation errors when only a body schema is provided", () => {
      configureOpenApiValidator({});

      const middleware = createValidator({
        body: {name: {required: true, type: "string"}},
      });

      const req = {body: {}, method: "POST", path: "/test", query: {}} as unknown as Request;
      const res = {} as Response;

      expect(() => middleware(req, res, (() => {}) as NextFunction)).toThrow(
        "Request validation failed"
      );
    });

    it("propagates body validation error via next", () => {
      let capturedErrors: ErrorObject[] = [];
      configureOpenApiValidator({
        onValidationError: (errors) => {
          capturedErrors = errors;
        },
      });

      const middleware = createValidator({
        body: {name: {required: true, type: "string"}},
        query: {page: {type: "number"}},
      });

      const req = {body: {}, method: "POST", path: "/test", query: {}} as unknown as Request;
      const res = {} as Response;

      let nextCalled = false;
      middleware(req, res, () => {
        nextCalled = true;
      });

      expect(capturedErrors.length).toBeGreaterThan(0);
      expect(nextCalled).toBe(true);
    });
  });

  describe("createModelValidators", () => {
    beforeEach(() => {
      configureOpenApiValidator();
    });

    it("returns create and update middleware", () => {
      const validators = createModelValidators(RequiredModel);
      expect(typeof validators.create).toBe("function");
      expect(typeof validators.update).toBe("function");
    });

    it("create validator rejects body with wrong type", () => {
      configureOpenApiValidator({coerceTypes: false});
      const {create} = createModelValidators(RequiredModel);

      const req = {body: {name: 123}, method: "POST", path: "/required"} as unknown as Request;
      const res = {} as Response;
      expect(() => {
        create(req, res, () => {});
      }).toThrow();
    });

    it("update validator allows a partial body", () => {
      const {update} = createModelValidators(RequiredModel);

      let nextCalled = false;
      const req = {body: {about: "info"}, method: "PATCH", path: "/required"} as unknown as Request;
      const res = {} as Response;
      update(req, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
    });

    it("supports onAdditionalPropertiesRemoved option", () => {
      configureOpenApiValidator({removeAdditional: true});
      const removedProps: string[] = [];
      const {create} = createModelValidators(RequiredModel, {
        onAdditionalPropertiesRemoved: (props) => {
          removedProps.push(...props);
        },
      });

      // Extra property gets stripped and hook is called
      const req = {
        body: {extra: "strip me", name: "Apple"},
        method: "POST",
        path: "/required",
      } as unknown as Request;
      create(req, {} as Response, () => {});
      expect(removedProps).toContain("extra");
    });

    it("supports onError option", () => {
      configureOpenApiValidator({coerceTypes: false});
      let errorHandled: ErrorObject[] = [];
      const {create} = createModelValidators(RequiredModel, {
        onError: (errors) => {
          errorHandled = errors;
        },
      });

      // Wrong type triggers error handler
      const req = {body: {name: 42}, method: "POST", path: "/required"} as unknown as Request;
      create(req, {} as Response, () => {});
      expect(errorHandled.length).toBeGreaterThan(0);
    });
  });

  describe("validateModelRequestBody", () => {
    beforeEach(() => {
      configureOpenApiValidator();
    });

    it("creates a validator from a Mongoose model", () => {
      const middleware = validateModelRequestBody(RequiredModel);

      const req = {body: {}, method: "POST", path: "/required"} as unknown as Request;
      const res = {} as Response;
      expect(() => {
        middleware(req, res, () => {});
      }).toThrow();
    });

    it("respects excludeFields option", () => {
      const middleware = validateModelRequestBody(RequiredModel, {
        excludeFields: ["name"],
      });

      // Without 'name' required, empty body passes
      let nextCalled = false;
      const req = {body: {}, method: "POST", path: "/required"} as unknown as Request;
      const res = {} as Response;
      middleware(req, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
    });

    it("does not require mongoose required fields when partial is true", () => {
      const middleware = validateModelRequestBody(RequiredModel, {partial: true});

      let nextCalled = false;
      const req = {
        body: {about: "only about"},
        method: "PATCH",
        path: "/required",
      } as unknown as Request;
      const res = {} as Response;
      middleware(req, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
    });
  });

  describe("getSchemaFromModel", () => {
    it("returns properties for a Mongoose model", () => {
      const schema = getSchemaFromModel(RequiredModel);
      expect(schema.name).toBeDefined();
      expect(schema.about).toBeDefined();
    });

    it("puts enum constraints on array items, not the array property", () => {
      const enumArraySchema = new mongoose.Schema({
        values: {
          default: ["alpha", "beta"],
          enum: ["alpha", "beta"],
          type: [String],
        },
      });
      const EnumArrayModel =
        mongoose.models.OpenApiValidatorEnumArray ??
        mongoose.model("OpenApiValidatorEnumArray", enumArraySchema);

      const schema = getSchemaFromModel(EnumArrayModel);
      expect(schema.values).toEqual({
        items: {enum: ["alpha", "beta"], type: "string"},
        type: "array",
      });
    });
  });

  describe("enum array request bodies", () => {
    const enumArraySchema = new mongoose.Schema({
      label: {required: true, type: String},
      values: {
        enum: ["alpha", "beta"],
        type: [String],
      },
    });
    const EnumArrayModel =
      mongoose.models.OpenApiValidatorEnumArrayRoute ??
      mongoose.model("OpenApiValidatorEnumArrayRoute", enumArraySchema);

    const enumArrayRouterOptions = {
      permissions: {
        create: [Permissions.IsAuthenticated],
        delete: [Permissions.IsAdmin],
        list: [Permissions.IsAuthenticated],
        read: [Permissions.IsAuthenticated],
        update: [Permissions.IsAuthenticated],
      },
      queryFields: ["label"],
      sort: "-label" as const,
    };

    it("accepts enum array values on create when validation is enabled", async () => {
      configureOpenApiValidator();

      const freshApp = await setupFreshApp();
      freshApp.use("/enum-arrays", modelRouter(EnumArrayModel, enumArrayRouterOptions));
      const admin = await authAsUser(freshApp, "admin");

      const res = await admin
        .post("/enum-arrays")
        .send({label: "sample", values: ["alpha", "beta"]})
        .expect(201);

      expect(res.body.data.values).toEqual(["alpha", "beta"]);
    });
  });

  describe("getOpenApiValidatorConfig", () => {
    it("returns a shallow copy of the config", () => {
      configureOpenApiValidator({removeAdditional: false});
      const config = getOpenApiValidatorConfig();
      expect(config.removeAdditional).toBe(false);

      // Mutating the returned copy should not affect internal state
      config.removeAdditional = true;
      expect(getOpenApiValidatorConfig().removeAdditional).toBe(false);
    });
  });

  describe("schema sanitization and validator caching", () => {
    const runMiddleware = (
      middleware: (req: Request, res: Response, next: NextFunction) => void,
      req: Partial<Request>
    ): boolean => {
      let nextCalled = false;
      middleware(req as unknown as Request, {} as unknown as Response, () => {
        nextCalled = true;
      });
      return nextCalled;
    };

    // An unresolvable $ref makes ajv.compile throw, so getValidator catches the error
    // and returns null. Built via `unknown` to keep the non-standard keyword out of the
    // typed surface (and out of the explicit-any baseline).
    const uncompilableSchema = {
      broken: {$ref: "#/components/schemas/DoesNotExist"},
    } as unknown as Record<string, OpenApiSchemaProperty>;

    it("maps an unrecognized mongoose type to string so the schema still compiles", () => {
      configureOpenApiValidator();

      // "buffer" is neither a valid JSON Schema type nor present in MONGOOSE_TYPE_MAP,
      // so sanitizeSchemaForAjv falls through to the `type = "string"` branch.
      const middleware = validateRequestBody({raw: {type: "buffer"}});

      expect(
        runMiddleware(middleware, {body: {raw: "some-string"}, method: "POST", path: "/t"})
      ).toBe(true);
    });

    it("reuses the cached validator on subsequent requests with the same schema", () => {
      configureOpenApiValidator();

      const middleware = validateRequestBody({name: {type: "string"}});
      const req: Partial<Request> = {body: {name: "ok"}, method: "POST", path: "/t"};

      // First request compiles and caches the validator; the second must hit the cache.
      expect(runMiddleware(middleware, req)).toBe(true);
      expect(runMiddleware(middleware, req)).toBe(true);
    });

    it("skips query validation when the schema cannot be compiled", () => {
      configureOpenApiValidator();

      const middleware = validateQueryParams(uncompilableSchema);

      expect(runMiddleware(middleware, {method: "GET", path: "/t", query: {broken: "x"}})).toBe(
        true
      );
    });

    it("skips response validation when the schema cannot be compiled", () => {
      configureOpenApiValidator({validateResponses: true});

      const result = validateResponseData({broken: "x"}, uncompilableSchema);

      expect(result.valid).toBe(true);
    });
  });
});
