import {afterEach, beforeEach, describe, expect, it, spyOn} from "bun:test";
import {
  ADMIN_MODEL_ACCESS,
  AuditApp,
  addAuthRoutes,
  apiErrorMiddleware,
  apiUnauthorizedMiddleware,
  BackgroundTask,
  createAccess,
  findOneOrNoneFor,
  flushAuditRecorderForTests,
  Membership,
  modelRouter,
  Organization,
  orgScopedPlugin,
  Permissions,
  resetAuditRecorderForTests,
  setupAuth,
  type TerrenoApp,
  type TerrenoPlugin,
  terrenoStatements,
  type UserModel as UserModelType,
  VersionConfig,
} from "@terreno/api";
import {
  authAsUser,
  FoodModel,
  getBaseServer,
  RequiredModel,
  setupDb,
  UserModel,
} from "@terreno/api/testing";
import {assert} from "chai";
import type express from "express";
import mongoose from "mongoose";
import supertest from "supertest";
import type TestAgent from "supertest/lib/agent";

import type {AdminAuditEvent, AdminModelConfig, AdminOptions} from "./adminApp";
import {AdminApp, getArrayEmbeddedSchemaType} from "./adminApp";

const buildApp = (
  models: AdminModelConfig[] = [],
  adminOverrides?: Partial<AdminOptions>
): express.Application => {
  const app = getBaseServer();
  setupAuth(app, UserModel as unknown as UserModelType);
  addAuthRoutes(app, UserModel as unknown as UserModelType);

  const admin = new AdminApp({
    basePath: "/admin",
    models,
    ...adminOverrides,
  });
  admin.register(app);

  app.use(apiUnauthorizedMiddleware);
  app.use(apiErrorMiddleware);

  return app;
};

const foodModelConfig: AdminModelConfig = {
  displayName: "Foods",
  listFields: ["name", "calories"],
  model: FoodModel,
  routePath: "/foods",
};

const enumArraySchema = new mongoose.Schema({
  values: {
    description: "Allowed enum values",
    type: [{enum: ["alpha", "beta"], type: String}],
  },
});
const EnumArrayModel =
  mongoose.models.AdminEnumArray ?? mongoose.model("AdminEnumArray", enumArraySchema);

const orgScopedFoodSchema = new mongoose.Schema(
  {
    calories: {description: "Calories", type: Number},
    name: {description: "Food name", type: String},
  },
  {strict: "throw"}
);
orgScopedFoodSchema.plugin(orgScopedPlugin);
const OrgScopedFoodModel =
  mongoose.models.AdminOrgScopedFood ?? mongoose.model("AdminOrgScopedFood", orgScopedFoodSchema);

const priorityTodoSchema = new mongoose.Schema({
  priority: {enum: ["low", "high"], type: String},
  title: {required: true, type: String},
});
const PriorityTodoModel =
  mongoose.models.AdminPriorityTodo ?? mongoose.model("AdminPriorityTodo", priorityTodoSchema);

const frameworkRefHolderSchema = new mongoose.Schema({
  organizationId: {
    ref: "TerrenoOrganization",
    type: mongoose.Schema.Types.ObjectId,
  },
  organizationIds: [
    {
      ref: "TerrenoOrganization",
      type: mongoose.Schema.Types.ObjectId,
    },
  ],
});
const FrameworkRefHolderModel =
  mongoose.models.AdminFrameworkRefHolder ??
  mongoose.model("AdminFrameworkRefHolder", frameworkRefHolderSchema);

describe("getArrayEmbeddedSchemaType", () => {
  it("supports the legacy Mongoose 8 caster property", () => {
    const embeddedSchemaType = new mongoose.Schema({value: String}).path("value");
    const legacyArrayPath = {caster: embeddedSchemaType} as unknown as mongoose.SchemaType;

    expect(getArrayEmbeddedSchemaType(legacyArrayPath)).toBe(embeddedSchemaType);
  });
});

describe("AdminApp /admin/config", () => {
  let app: express.Application;
  let adminAgent: TestAgent;
  let notAdminAgent: TestAgent;

  beforeEach(async () => {
    await setupDb();
    app = buildApp([
      {
        ...foodModelConfig,
        fieldOrder: ["name", "calories", "tags"],
        fieldOverrides: {name: {widget: "markdown"}},
        hiddenFields: ["hidden"],
      },
    ]);
    adminAgent = await authAsUser(app, "admin");
    notAdminAgent = await authAsUser(app, "notAdmin");
  });

  afterEach(async () => {
    await FoodModel.deleteMany({});
    await VersionConfig.deleteMany({});
  });

  it("returns metadata for configured models to admins", async () => {
    const res = await adminAgent.get("/admin/config").expect(200);

    expect(res.body.schemaVersion).toBe(2);
    expect(res.body.home?.title).toBe("Administration");
    expect(res.body.home?.slots?.main).toEqual(["modelsGrid"]);
    expect(res.body.models).toHaveLength(1);
    const [foodMeta] = res.body.models;
    expect(foodMeta.name).toBe("Food");
    expect(foodMeta.displayName).toBe("Foods");
    expect(foodMeta.listFields).toEqual(["name", "calories"]);
    expect(foodMeta.routePath).toBe("/admin/foods");
    expect(foodMeta.defaultSort).toBe("-created");
    expect(foodMeta.fieldOrder).toEqual(["name", "calories", "tags"]);
    expect(res.body.capabilities).toEqual({
      actions: true,
      fieldsets: true,
      filters: true,
      realtime: false,
    });
    expect(res.body.widgetIds).toEqual([]);
  });

  it("exposes plugin widgetIds and aggregates models from TerrenoApp registrations", async () => {
    const plugin: TerrenoPlugin = {
      adminContribution: () => ({
        homeWidgets: [{displayName: "Overrides", id: "feature-flags-overrides"}],
        models: [
          {
            admin: {displayName: "Flags", listFields: ["key"]},
            model: FoodModel,
            routePath: "/feature-flags",
          },
        ],
      }),
      register() {},
    };
    const terrenoApp = {
      getPlugins: () => [plugin],
      getRegistrations: () => [
        modelRouter("/foods", FoodModel, {
          admin: {displayName: "Registered Foods", listFields: ["name"]},
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
        }),
      ],
    } as unknown as TerrenoApp;

    const appWithAggregation = getBaseServer();
    setupAuth(appWithAggregation, UserModel as unknown as UserModelType);
    addAuthRoutes(appWithAggregation, UserModel as unknown as UserModelType);
    new AdminApp({basePath: "/admin"}).register(appWithAggregation, undefined, terrenoApp);
    appWithAggregation.use(apiUnauthorizedMiddleware);
    appWithAggregation.use(apiErrorMiddleware);

    const agent = await authAsUser(appWithAggregation, "admin");
    const res = await agent.get("/admin/config").expect(200);

    expect(res.body.widgetIds).toEqual(["feature-flags-overrides"]);
    expect(res.body.models.map((m: {routePath: string}) => m.routePath).sort()).toEqual([
      "/admin/feature-flags",
      "/admin/foods",
    ]);
    const foods = res.body.models.find((m: {routePath: string}) => m.routePath === "/admin/foods");
    expect(foods?.displayName).toBe("Registered Foods");
    expect(foods?.name).toBe("Food");
    const flags = res.body.models.find(
      (m: {routePath: string}) => m.routePath === "/admin/feature-flags"
    );
    expect(flags?.name).toBe("Food-feature-flags");
  });

  it("gives each mounted path unique config names and per-path searchFields", async () => {
    const localApp = buildApp([
      {
        ...foodModelConfig,
        searchFields: ["name"],
      },
      {
        displayName: "Archived Foods",
        listFields: ["name", "calories"],
        model: FoodModel,
        routePath: "/archived-foods",
        searchFields: [],
      },
    ]);
    await FoodModel.create({calories: 100, name: "GreenApple"});
    await FoodModel.create({calories: 2, name: "Banana"});
    const agent = await authAsUser(localApp, "admin");
    const config = await agent.get("/admin/config").expect(200);
    const names = config.body.models.map((m: {name: string}) => m.name).sort();
    expect(names).toEqual(["Food", "Food-archived-foods"]);

    const byName = await agent.get("/admin/foods?q=apple").expect(200);
    expect(byName.body.data).toHaveLength(1);
    expect(byName.body.data[0].name).toBe("GreenApple");

    const archivedIgnoresNameSearch = await agent.get("/admin/archived-foods?q=apple").expect(200);
    expect(archivedIgnoresNameSearch.body.data).toHaveLength(2);
  });

  it("includes recordTitleField in config when set on the model", async () => {
    const appWithTitle = buildApp([{...foodModelConfig, recordTitleField: "name"}]);
    const agent = await authAsUser(appWithTitle, "admin");
    const res = await agent.get("/admin/config").expect(200);
    expect(res.body.models[0].recordTitleField).toBe("name");
  });

  it("applies fieldOverrides to generated config", async () => {
    const res = await adminAgent.get("/admin/config").expect(200);
    const [foodMeta] = res.body.models;
    expect(foodMeta.fields.name.widget).toBe("markdown");
  });

  it("removes hidden fields from config and listFields", async () => {
    app = buildApp([
      {
        ...foodModelConfig,
        hiddenFields: ["hidden"],
        listFields: ["name", "hidden", "calories"],
      },
    ]);
    const agent = await authAsUser(app, "admin");
    const res = await agent.get("/admin/config").expect(200);
    const [foodMeta] = res.body.models;
    expect(foodMeta.fields.hidden).toBeUndefined();
    expect(foodMeta.listFields).toEqual(["name", "calories"]);
  });

  it("extracts item sub-field metadata for array fields", async () => {
    const res = await adminAgent.get("/admin/config").expect(200);
    const [foodMeta] = res.body.models;
    // likesIds is an array of subdocuments with likes + userId sub-fields
    expect(foodMeta.fields.likesIds.type).toBe("array");
    expect(foodMeta.fields.likesIds.items).toBeDefined();
    expect(foodMeta.fields.likesIds.items.userId).toBeDefined();
    expect(foodMeta.fields.likesIds.items.likes).toBeDefined();
  });

  it("extracts ref information for ObjectId fields", async () => {
    const res = await adminAgent.get("/admin/config").expect(200);
    const [foodMeta] = res.body.models;
    expect(foodMeta.fields.ownerId.ref).toBe("User");
  });

  it("extracts ref information for array of ObjectId references", async () => {
    const res = await adminAgent.get("/admin/config").expect(200);
    const [foodMeta] = res.body.models;
    expect(foodMeta.fields.eatenBy.ref).toBe("User");
  });

  it("extracts itemType for primitive string arrays", async () => {
    const res = await adminAgent.get("/admin/config").expect(200);
    const [foodMeta] = res.body.models;
    // tags is [String] — should expose itemType so the frontend renders a primitive list
    expect(foodMeta.fields.tags.type).toBe("array");
    expect(foodMeta.fields.tags.itemType).toBe("string");
    expect(foodMeta.fields.tags.items).toBeUndefined();
  });

  it("extracts itemEnum for enum arrays", async () => {
    const enumApp = buildApp([
      {
        displayName: "Enum arrays",
        listFields: ["values"],
        model: EnumArrayModel,
        routePath: "/enum-arrays",
      },
    ]);
    const enumAgent = await authAsUser(enumApp, "admin");
    const res = await enumAgent.get("/admin/config").expect(200);
    expect(res.body.models[0].fields.values.itemEnum).toEqual(["alpha", "beta"]);
  });

  it("accepts enum array values on admin create", async () => {
    const enumApp = buildApp([
      {
        displayName: "Enum arrays",
        listFields: ["values"],
        model: EnumArrayModel,
        routePath: "/enum-arrays",
      },
    ]);
    const enumAgent = await authAsUser(enumApp, "admin");
    const res = await enumAgent
      .post("/admin/enum-arrays")
      .send({values: ["alpha", "beta"]})
      .expect(201);
    expect(res.body.data.values).toEqual(["alpha", "beta"]);
  });

  it("extracts itemType and itemRef for arrays of ObjectId references", async () => {
    const res = await adminAgent.get("/admin/config").expect(200);
    const [foodMeta] = res.body.models;
    // eatenBy is [{type: ObjectId, ref: "User"}] — should expose both itemType and itemRef
    expect(foodMeta.fields.eatenBy.type).toBe("array");
    expect(foodMeta.fields.eatenBy.itemType).toBe("objectid");
    expect(foodMeta.fields.eatenBy.itemRef).toBe("User");
  });

  it("keeps framework model refs aligned with public admin config names", async () => {
    const refApp = buildApp([
      {
        displayName: "Organizations",
        listFields: ["name"],
        model: Organization,
        routePath: "/organizations",
      },
      {
        displayName: "Framework ref holders",
        listFields: ["organizationId", "organizationIds"],
        model: FrameworkRefHolderModel,
        routePath: "/framework-ref-holders",
      },
    ]);
    const refAgent = await authAsUser(refApp, "admin");
    const res = await refAgent.get("/admin/config").expect(200);
    const organizationMeta = res.body.models.find(
      (model: {routePath: string}) => model.routePath === "/admin/organizations"
    );
    const holderMeta = res.body.models.find(
      (model: {routePath: string}) => model.routePath === "/admin/framework-ref-holders"
    );

    assert.equal(organizationMeta?.name, "Organization");
    assert.equal(holderMeta?.fields.organizationId.ref, "Organization");
    assert.equal(holderMeta?.fields.organizationIds.ref, "Organization");
    assert.equal(holderMeta?.fields.organizationIds.itemRef, "Organization");
  });

  it("returns 403 for non-admin users", async () => {
    const res = await notAdminAgent.get("/admin/config").expect(403);
    expect(res.body.title).toInclude("Admin access required");
  });

  it("returns 401 for unauthenticated users", async () => {
    await supertest(app).get("/admin/config").expect(401);
  });

  it("defaults basePath to /admin when not provided", async () => {
    const altApp = getBaseServer();
    setupAuth(altApp, UserModel as unknown as UserModelType);
    addAuthRoutes(altApp, UserModel as unknown as UserModelType);
    new AdminApp({models: [foodModelConfig]}).register(altApp);
    altApp.use(apiUnauthorizedMiddleware);
    altApp.use(apiErrorMiddleware);

    const agent = await authAsUser(altApp, "admin");
    const res = await agent.get("/admin/config").expect(200);
    expect(res.body.models[0].routePath).toBe("/admin/foods");
  });

  it("uses a custom defaultSort when provided", async () => {
    app = buildApp([{...foodModelConfig, defaultSort: "name"}]);
    const agent = await authAsUser(app, "admin");
    const res = await agent.get("/admin/config").expect(200);
    expect(res.body.models[0].defaultSort).toBe("name");
  });

  it("does not inject version config into the custom screen navigation", async () => {
    const res = await adminAgent.get("/admin/config").expect(200);
    expect(res.body.customScreens).toEqual([]);
  });

  it("normalizes home.slots so recentActivity is last in sidebar", async () => {
    app = buildApp([foodModelConfig], {
      home: {
        slots: {sidebar: ["recentActivity", "versionConfig"]},
        title: "Ops",
      },
    });
    const agent = await authAsUser(app, "admin");
    const res = await agent.get("/admin/config").expect(200);
    expect(res.body.home.title).toBe("Ops");
    expect(res.body.home.slots.sidebar).toEqual(["versionConfig", "recentActivity"]);
  });

  it("filters screens and platform tools from the caller's RBAC grants", async () => {
    const accessControl = createAccess({
      connection: mongoose.connection,
      resolvePermissions: async () => ({
        admin: ["access"],
        adminFood: ["read"],
        adminScreen: ["allowed"],
      }),
      statements: {
        ...terrenoStatements,
        adminFood: ADMIN_MODEL_ACCESS,
        adminScreen: ["allowed", "hidden"],
      },
    });
    const localApp = buildApp([{...foodModelConfig, adminAccess: {}}], {
      accessControl,
      customScreens: [
        {
          adminAccess: {action: "allowed", resource: "adminScreen"},
          displayName: "Allowed",
          name: "allowed",
        },
        {
          adminAccess: {action: "hidden", resource: "adminScreen"},
          displayName: "Hidden",
          name: "hidden",
        },
      ],
      scripts: [
        {
          description: "Seed",
          name: "seed",
          runner: async () => ({results: [], success: true}),
        },
      ],
    });
    const agent = await authAsUser(localApp, "admin");

    const response = await agent.get("/admin/config").expect(200);

    assert.deepEqual(
      response.body.models.map((model: {name: string}) => model.name),
      ["Food"]
    );
    assert.deepInclude(response.body.models[0].permissions, {
      create: false,
      delete: false,
      update: false,
    });
    assert.deepEqual(response.body.customScreens, [{displayName: "Allowed", name: "allowed"}]);
    assert.deepEqual(response.body.platformTools, {
      configuration: false,
      roles: false,
      runScripts: false,
      scripts: false,
      version: false,
      viewScripts: false,
    });
    assert.deepEqual(response.body.scripts, []);
  });

  it("enforces writeOwned with the configured ownership callback", async () => {
    const accessControl = createAccess({
      connection: mongoose.connection,
      resolvePermissions: async () => ({
        admin: ["access"],
        adminFood: ["read", "writeOwned"],
      }),
      statements: {...terrenoStatements, adminFood: ADMIN_MODEL_ACCESS},
    });
    const localApp = buildApp(
      [
        {
          ...foodModelConfig,
          adminAccess: {
            isOwned: ({instance, user}) =>
              String((instance as {ownerId?: unknown}).ownerId) === String(user.id),
          },
        },
      ],
      {accessControl}
    );
    const agent = await authAsUser(localApp, "admin");
    const actor = await findOneOrNoneFor(UserModel, {email: "admin@example.com"});
    assert.exists(actor);
    const owned = await FoodModel.create({calories: 1, name: "Owned", ownerId: actor?._id});
    const other = await FoodModel.create({
      calories: 2,
      name: "Other",
      ownerId: new mongoose.Types.ObjectId(),
    });

    await agent.patch(`/admin/foods/${owned._id}`).send({calories: 3}).expect(200);
    await agent.patch(`/admin/foods/${other._id}`).send({calories: 4}).expect(403);
    const ownedRead = await agent.get(`/admin/foods/${owned._id}`).expect(200);
    const otherRead = await agent.get(`/admin/foods/${other._id}`).expect(200);
    assert.deepEqual(ownedRead.body.data._adminCapabilities, {delete: true, update: true});
    assert.deepEqual(otherRead.body.data._adminCapabilities, {delete: false, update: false});
    await agent.delete(`/admin/foods/${other._id}`).expect(403);
    await agent
      .post("/admin/foods")
      .send({calories: 5, name: "Created", ownerId: actor?._id})
      .expect(201);
    await agent
      .post("/admin/foods")
      .send({calories: 6, name: "Foreign", ownerId: new mongoose.Types.ObjectId()})
      .expect(201);
    await agent.post("/admin/foods").send({calories: 7, name: "Unassigned"}).expect(201);
  });

  it("supports completely custom per-model authorization", async () => {
    const accessControl = createAccess({
      connection: mongoose.connection,
      resolvePermissions: async () => ({admin: ["access"]}),
      statements: terrenoStatements,
    });
    const localApp = buildApp(
      [
        {
          ...foodModelConfig,
          adminAccess: {
            authorize: ({action}) => action === "list" || action === "read",
          },
        },
      ],
      {accessControl}
    );
    const agent = await authAsUser(localApp, "admin");

    const config = await agent.get("/admin/config").expect(200);
    assert.deepInclude(config.body.models[0].permissions, {
      create: false,
      delete: false,
      update: false,
    });
    await agent.get("/admin/foods").expect(200);
    await agent.post("/admin/foods").send({calories: 1, name: "Denied"}).expect(405);
  });
});

describe("AdminApp adminAccess role matrix", () => {
  const ADMIN_EMAIL = "admin@example.com";
  const MEMBER_EMAIL = "notAdmin@example.com";
  const matrixStatements = {
    ...terrenoStatements,
    adminFood: ADMIN_MODEL_ACCESS,
    adminScreen: ["showcase"],
  };

  const buildMatrixApp = (
    grantsByEmail: Record<string, Record<string, string[]>>
  ): express.Application => {
    const accessControl = createAccess({
      connection: mongoose.connection,
      resolvePermissions: async ({user}) => {
        const email = "email" in user && typeof user.email === "string" ? user.email : "";
        return grantsByEmail[email] ?? {};
      },
      statements: matrixStatements,
    });
    return buildApp(
      [
        {
          ...foodModelConfig,
          adminAccess: {
            isOwned: ({instance, user}) => {
              return String((instance as {ownerId?: unknown}).ownerId) === String(user.id);
            },
          },
        },
      ],
      {
        accessControl,
        customScreens: [
          {
            adminAccess: {action: "showcase", resource: "adminScreen"},
            displayName: "Showcase",
            name: "showcase",
          },
        ],
        scripts: [
          {
            description: "Seed",
            name: "seed",
            runner: async () => ({results: [], success: true}),
          },
        ],
      }
    );
  };

  beforeEach(async () => {
    await setupDb();
  });

  afterEach(async () => {
    await FoodModel.deleteMany({});
  });

  it("denies the admin shell when the caller lacks admin:access", async () => {
    const app = buildMatrixApp({
      [ADMIN_EMAIL]: {admin: ["access"], adminFood: ["read"]},
      [MEMBER_EMAIL]: {},
    });
    const member = await authAsUser(app, "notAdmin");
    await member.get("/admin/config").expect(403);
    await member.get("/admin/foods").expect(405);
  });

  it("does not open the admin page with other admin permissions alone", async () => {
    const app = buildMatrixApp({
      [ADMIN_EMAIL]: {admin: ["runScripts", "viewBackgroundTasks"], adminFood: ["read", "write"]},
    });
    const agent = await authAsUser(app, "admin");
    await agent.get("/admin/config").expect(403);
    await agent.get("/admin/foods").expect(405);
  });

  it("hides models and mutations when the caller only has admin:access", async () => {
    const app = buildMatrixApp({
      [ADMIN_EMAIL]: {admin: ["access"]},
    });
    const agent = await authAsUser(app, "admin");
    const config = await agent.get("/admin/config").expect(200);
    assert.deepEqual(config.body.models, []);
    assert.deepEqual(config.body.customScreens, []);
    await agent.get("/admin/foods").expect(405);
    await agent.post("/admin/foods").send({calories: 1, name: "Nope"}).expect(405);
  });

  it("allows reads and denies writes for a read-only role", async () => {
    const app = buildMatrixApp({
      [ADMIN_EMAIL]: {admin: ["access"], adminFood: ["read"]},
    });
    const agent = await authAsUser(app, "admin");
    const actor = await findOneOrNoneFor(UserModel, {email: ADMIN_EMAIL});
    assert.exists(actor);
    const food = await FoodModel.create({calories: 1, name: "Owned", ownerId: actor?._id});

    const config = await agent.get("/admin/config").expect(200);
    assert.deepInclude(config.body.models[0].permissions, {
      create: false,
      delete: false,
      update: false,
    });
    await agent.get("/admin/foods").expect(200);
    await agent.get(`/admin/foods/${food._id}`).expect(200);
    await agent.post("/admin/foods").send({calories: 2, name: "Denied"}).expect(405);
    await agent.patch(`/admin/foods/${food._id}`).send({calories: 3}).expect(405);
    await agent.delete(`/admin/foods/${food._id}`).expect(405);
  });

  it("allows full CRUD for a write role, including records the caller does not own", async () => {
    const app = buildMatrixApp({
      [ADMIN_EMAIL]: {admin: ["access"], adminFood: ["read", "write"]},
    });
    const agent = await authAsUser(app, "admin");
    const other = await FoodModel.create({
      calories: 1,
      name: "Other",
      ownerId: new mongoose.Types.ObjectId(),
    });

    const config = await agent.get("/admin/config").expect(200);
    assert.deepInclude(config.body.models[0].permissions, {
      create: true,
      delete: true,
      update: true,
    });
    await agent.post("/admin/foods").send({calories: 2, name: "Created"}).expect(201);
    const patched = await agent.patch(`/admin/foods/${other._id}`).send({calories: 9}).expect(200);
    assert.equal(patched.body.data.calories, 9);
    await agent.delete(`/admin/foods/${other._id}`).expect(204);
  });

  it("scopes writeOwned updates and deletes to owned records for that role", async () => {
    const app = buildMatrixApp({
      [ADMIN_EMAIL]: {admin: ["access"], adminFood: ["read", "writeOwned"]},
    });
    const agent = await authAsUser(app, "admin");
    const actor = await findOneOrNoneFor(UserModel, {email: ADMIN_EMAIL});
    assert.exists(actor);
    const owned = await FoodModel.create({calories: 1, name: "Owned", ownerId: actor?._id});
    const other = await FoodModel.create({
      calories: 2,
      name: "Other",
      ownerId: new mongoose.Types.ObjectId(),
    });

    const ownedRead = await agent.get(`/admin/foods/${owned._id}`).expect(200);
    const otherRead = await agent.get(`/admin/foods/${other._id}`).expect(200);
    assert.deepEqual(ownedRead.body.data._adminCapabilities, {delete: true, update: true});
    assert.deepEqual(otherRead.body.data._adminCapabilities, {delete: false, update: false});
    await agent.patch(`/admin/foods/${owned._id}`).send({calories: 4}).expect(200);
    await agent.patch(`/admin/foods/${other._id}`).send({calories: 5}).expect(403);
    await agent.delete(`/admin/foods/${other._id}`).expect(403);
    await agent.delete(`/admin/foods/${owned._id}`).expect(204);
    await agent.post("/admin/foods").send({calories: 6, name: "Unassigned"}).expect(201);
  });

  it("applies different adminAccess grants to different users on the same app", async () => {
    const app = buildMatrixApp({
      [ADMIN_EMAIL]: {admin: ["access"], adminFood: ["read", "write"]},
      [MEMBER_EMAIL]: {admin: ["access"], adminFood: ["read"]},
    });
    const writer = await authAsUser(app, "admin");
    const reader = await authAsUser(app, "notAdmin");
    const writerUser = await findOneOrNoneFor(UserModel, {email: ADMIN_EMAIL});
    assert.exists(writerUser);
    const food = await FoodModel.create({calories: 1, name: "Shared", ownerId: writerUser?._id});

    const writerConfig = await writer.get("/admin/config").expect(200);
    const readerConfig = await reader.get("/admin/config").expect(200);
    assert.deepInclude(writerConfig.body.models[0].permissions, {
      create: true,
      delete: true,
      update: true,
    });
    assert.deepInclude(readerConfig.body.models[0].permissions, {
      create: false,
      delete: false,
      update: false,
    });
    await writer.patch(`/admin/foods/${food._id}`).send({calories: 8}).expect(200);
    await reader.patch(`/admin/foods/${food._id}`).send({calories: 9}).expect(405);
    await reader.get("/admin/foods").expect(200);
    await reader.post("/admin/foods").send({calories: 3, name: "Reader"}).expect(405);
  });

  it("exposes platform tools and custom screens only for roles that grant them", async () => {
    const app = buildMatrixApp({
      [ADMIN_EMAIL]: {
        admin: ["access", "runScripts", "viewBackgroundTasks"],
        adminScreen: ["showcase"],
        configuration: ["read"],
        rbac: ["read"],
      },
      [MEMBER_EMAIL]: {admin: ["access"], adminFood: ["read"]},
    });
    const operator = await authAsUser(app, "admin");
    const reader = await authAsUser(app, "notAdmin");

    const operatorConfig = await operator.get("/admin/config").expect(200);
    const readerConfig = await reader.get("/admin/config").expect(200);
    const operatorScreens = operatorConfig.body.customScreens.map(
      (screen: {name: string}) => screen.name
    );
    const readerScreens = readerConfig.body.customScreens.map(
      (screen: {name: string}) => screen.name
    );
    assert.include(operatorScreens, "showcase");
    assert.notInclude(readerScreens, "showcase");
    assert.deepEqual(operatorConfig.body.platformTools, {
      configuration: true,
      roles: true,
      runScripts: true,
      scripts: true,
      version: true,
      viewScripts: true,
    });
    assert.deepEqual(
      operatorConfig.body.scripts.map((script: {name: string}) => script.name),
      ["seed"]
    );
    assert.deepEqual(readerConfig.body.customScreens, []);
    assert.deepEqual(readerConfig.body.platformTools, {
      configuration: false,
      roles: false,
      runScripts: false,
      scripts: false,
      version: false,
      viewScripts: false,
    });
    assert.deepEqual(readerConfig.body.scripts, []);
    assert.deepEqual(
      readerConfig.body.models.map((model: {name: string}) => model.name),
      ["Food"]
    );
  });

  it("lets authorize allow writes for one user and deny them for another", async () => {
    const accessControl = createAccess({
      connection: mongoose.connection,
      resolvePermissions: async () => ({admin: ["access"]}),
      statements: terrenoStatements,
    });
    const app = buildApp(
      [
        {
          ...foodModelConfig,
          adminAccess: {
            authorize: ({action, user}) => {
              const email =
                user && "email" in user && typeof user.email === "string" ? user.email : "";
              if (email === ADMIN_EMAIL) {
                return true;
              }
              return action === "list" || action === "read";
            },
          },
        },
      ],
      {accessControl}
    );
    const writer = await authAsUser(app, "admin");
    const reader = await authAsUser(app, "notAdmin");

    const writerConfig = await writer.get("/admin/config").expect(200);
    const readerConfig = await reader.get("/admin/config").expect(200);
    assert.deepInclude(writerConfig.body.models[0].permissions, {
      create: true,
      delete: true,
      update: true,
    });
    assert.deepInclude(readerConfig.body.models[0].permissions, {
      create: false,
      delete: false,
      update: false,
    });
    await writer.post("/admin/foods").send({calories: 1, name: "Allowed"}).expect(201);
    await reader.post("/admin/foods").send({calories: 1, name: "Denied"}).expect(405);
    await reader.get("/admin/foods").expect(200);
  });
});

describe("AdminApp model CRUD routes", () => {
  let app: express.Application;
  let adminAgent: TestAgent;
  let notAdminAgent: TestAgent;

  beforeEach(async () => {
    await setupDb();
    app = buildApp([{...foodModelConfig, hiddenFields: ["hidden"]}]);
    adminAgent = await authAsUser(app, "admin");
    notAdminAgent = await authAsUser(app, "notAdmin");
  });

  afterEach(async () => {
    await FoodModel.deleteMany({});
    await PriorityTodoModel.deleteMany({});
  });

  it("creates documents via POST and strips hidden fields from response", async () => {
    const res = await adminAgent
      .post("/admin/foods")
      .send({calories: 120, hidden: true, name: "Apple"})
      .expect(201);

    expect(res.body.data.name).toBe("Apple");
    expect(res.body.data.calories).toBe(120);
    expect(res.body.data.hidden).toBeUndefined();
  });

  it("lists documents via GET and strips hidden fields from results", async () => {
    await FoodModel.create({calories: 120, hidden: true, name: "Apple"});
    await FoodModel.create({calories: 95, hidden: false, name: "Banana"});

    const res = await adminAgent.get("/admin/foods").expect(200);
    expect(res.body.data).toHaveLength(2);
    for (const item of res.body.data) {
      expect(item.hidden).toBeUndefined();
    }
  });

  it("applies declared multi-choice filters through the admin list route", async () => {
    app = buildApp([
      {
        ...foodModelConfig,
        filters: [
          {
            choices: [
              {label: "Apple", value: "Apple"},
              {label: "Banana", value: "Banana"},
              {label: "Carrot", value: "Carrot"},
            ],
            field: "name",
            kind: "choice",
          },
        ],
      },
    ]);
    const agent = await authAsUser(app, "admin");
    await FoodModel.create({calories: 120, name: "Apple"});
    await FoodModel.create({calories: 95, name: "Banana"});
    await FoodModel.create({calories: 40, name: "Carrot"});

    const query = new URLSearchParams([
      ["name[$in][0]", "Apple"],
      ["name[$in][1]", "Banana"],
    ]).toString();
    const res = await agent.get(`/admin/foods?${query}`).expect(200);

    expect(res.body.data.map((item: {name: string}) => item.name).sort()).toEqual([
      "Apple",
      "Banana",
    ]);
  });

  it("filters optional priority to high only and excludes unset priority", async () => {
    app = buildApp([
      {
        displayName: "Priority todos",
        filters: [
          {
            choices: [
              {label: "High", value: "high"},
              {label: "Low", value: "low"},
            ],
            field: "priority",
            kind: "choice",
            label: "Priority",
          },
        ],
        listFields: ["title", "priority"],
        model: PriorityTodoModel,
        routePath: "/priority-todos",
      },
    ]);
    const agent = await authAsUser(app, "admin");
    await PriorityTodoModel.create({priority: "high", title: "high one"});
    await PriorityTodoModel.create({priority: "low", title: "low one"});
    await PriorityTodoModel.create({title: "unset"});

    const scalarRes = await agent.get("/admin/priority-todos?priority=high").expect(200);
    expect(scalarRes.body.data.map((item: {title: string}) => item.title)).toEqual(["high one"]);

    const inRes = await agent
      .get(
        `/admin/priority-todos?${new URLSearchParams([["priority[$in][0]", "high"]]).toString()}`
      )
      .expect(200);
    expect(inRes.body.data.map((item: {title: string}) => item.title)).toEqual(["high one"]);
  });

  it("filters optional priority empty sentinel to missing or null values", async () => {
    app = buildApp([
      {
        displayName: "Priority todos",
        filters: [
          {
            choices: [
              {label: "High", value: "high"},
              {label: "Low", value: "low"},
            ],
            field: "priority",
            kind: "choice",
            label: "Priority",
          },
        ],
        listFields: ["title", "priority"],
        model: PriorityTodoModel,
        routePath: "/priority-todos",
      },
    ]);
    const agent = await authAsUser(app, "admin");
    await PriorityTodoModel.create({priority: "high", title: "high one"});
    await PriorityTodoModel.create({priority: "low", title: "low one"});
    await PriorityTodoModel.create({title: "unset"});
    await PriorityTodoModel.create({priority: null, title: "null priority"});

    const query = new URLSearchParams([["priority[$in][0]", "__empty__"]]).toString();
    const res = await agent.get(`/admin/priority-todos?${query}`).expect(200);
    expect(res.body.data.map((item: {title: string}) => item.title).sort()).toEqual([
      "null priority",
      "unset",
    ]);
  });

  it("combines empty sentinel with concrete priority values", async () => {
    app = buildApp([
      {
        displayName: "Priority todos",
        filters: [
          {
            choices: [
              {label: "High", value: "high"},
              {label: "Low", value: "low"},
            ],
            field: "priority",
            kind: "choice",
            label: "Priority",
          },
        ],
        listFields: ["title", "priority"],
        model: PriorityTodoModel,
        routePath: "/priority-todos",
      },
    ]);
    const agent = await authAsUser(app, "admin");
    await PriorityTodoModel.create({priority: "high", title: "high one"});
    await PriorityTodoModel.create({priority: "low", title: "low one"});
    await PriorityTodoModel.create({title: "unset"});

    const query = new URLSearchParams([
      ["priority[$in][0]", "high"],
      ["priority[$in][1]", "__empty__"],
    ]).toString();
    const res = await agent.get(`/admin/priority-todos?${query}`).expect(200);
    expect(res.body.data.map((item: {title: string}) => item.title).sort()).toEqual([
      "high one",
      "unset",
    ]);
  });

  it("filters empty priority with search without leaving the wire sentinel on the query", async () => {
    app = buildApp([
      {
        displayName: "Priority todos",
        filters: [
          {
            choices: [
              {label: "High", value: "high"},
              {label: "Low", value: "low"},
            ],
            field: "priority",
            kind: "choice",
            label: "Priority",
          },
        ],
        listFields: ["title", "priority"],
        model: PriorityTodoModel,
        routePath: "/priority-todos",
        searchFields: ["title"],
      },
    ]);
    const agent = await authAsUser(app, "admin");
    await PriorityTodoModel.create({priority: "high", title: "alpha task"});
    await PriorityTodoModel.create({priority: "low", title: "beta task"});
    await PriorityTodoModel.create({title: "gamma task"});
    await PriorityTodoModel.create({title: "delta task"});
    await PriorityTodoModel.create({priority: null, title: "epsilon task"});

    const query = new URLSearchParams([
      ["priority[$in][0]", "__empty__"],
      ["q", "task"],
    ]).toString();
    const res = await agent.get(`/admin/priority-todos?${query}`).expect(200);
    expect(res.body.data.map((item: {title: string}) => item.title).sort()).toEqual([
      "delta task",
      "epsilon task",
      "gamma task",
    ]);
  });

  it("combines empty and concrete priority filters with search", async () => {
    app = buildApp([
      {
        displayName: "Priority todos",
        filters: [
          {
            choices: [
              {label: "High", value: "high"},
              {label: "Low", value: "low"},
            ],
            field: "priority",
            kind: "choice",
            label: "Priority",
          },
        ],
        listFields: ["title", "priority"],
        model: PriorityTodoModel,
        routePath: "/priority-todos",
        searchFields: ["title"],
      },
    ]);
    const agent = await authAsUser(app, "admin");
    await PriorityTodoModel.create({priority: "high", title: "alpha task"});
    await PriorityTodoModel.create({priority: "low", title: "beta task"});
    await PriorityTodoModel.create({title: "gamma task"});
    await PriorityTodoModel.create({priority: "high", title: "high hidden"});

    const query = new URLSearchParams([
      ["priority[$in][0]", "high"],
      ["priority[$in][1]", "__empty__"],
      ["q", "task"],
    ]).toString();
    const res = await agent.get(`/admin/priority-todos?${query}`).expect(200);
    expect(res.body.data.map((item: {title: string}) => item.title).sort()).toEqual([
      "alpha task",
      "gamma task",
    ]);
  });

  it("exposes allowEmpty on optional choice filters in admin config", async () => {
    app = buildApp([
      {
        displayName: "Priority todos",
        filters: [
          {
            choices: [{label: "High", value: "high"}],
            field: "priority",
            kind: "choice",
          },
        ],
        listFields: ["title", "priority"],
        model: PriorityTodoModel,
        routePath: "/priority-todos",
      },
    ]);
    const agent = await authAsUser(app, "admin");
    const res = await agent.get("/admin/config").expect(200);
    const model = res.body.models.find((entry: {routePath: string}) =>
      entry.routePath.endsWith("/priority-todos")
    );
    expect(model.filters[0].allowEmpty).toBe(true);
  });

  it("reads a document via GET /:id", async () => {
    const food = await FoodModel.create({calories: 120, name: "Apple"});
    const res = await adminAgent.get(`/admin/foods/${food._id}`).expect(200);
    expect(res.body.data.name).toBe("Apple");
  });

  it("updates a document via PATCH /:id", async () => {
    const food = await FoodModel.create({calories: 120, name: "Apple"});
    const res = await adminAgent
      .patch(`/admin/foods/${food._id}`)
      .send({calories: 150})
      .expect(200);
    expect(res.body.data.calories).toBe(150);
  });

  it("deletes a document via DELETE /:id", async () => {
    const food = await FoodModel.create({calories: 120, name: "Apple"});
    await adminAgent.delete(`/admin/foods/${food._id}`).expect(204);
    expect(await FoodModel.findById(food._id)).toBeNull();
  });

  it("rejects non-admin users from model list", async () => {
    const res = await notAdminAgent.get("/admin/foods");
    // modelRouter with IsAdmin permission blocks non-admin users
    expect([401, 403, 405]).toContain(res.status);
  });

  it("scrubs responses even when the parent model has no hidden or exclude fields", async () => {
    app = buildApp([foodModelConfig]);
    const agent = await authAsUser(app, "admin");
    await FoodModel.create({calories: 120, hidden: true, name: "Apple"});
    const res = await agent.get("/admin/foods").expect(200);
    expect(res.body.data[0].name).toBe("Apple");
    expect(res.body.data[0].hidden).toBe(true);
  });

  it("recursively removes hidden fields from array item values", async () => {
    await RequiredModel.deleteMany({});
    app = buildApp([
      {
        displayName: "Required",
        hiddenFields: ["about"],
        listFields: ["name"],
        model: RequiredModel,
        routePath: "/required",
      },
    ]);
    const agent = await authAsUser(app, "admin");
    await RequiredModel.create({about: "secret", name: "first"});
    await RequiredModel.create({about: "secret2", name: "second"});
    const res = await agent.get("/admin/required").expect(200);
    expect(res.body.data).toHaveLength(2);
    for (const doc of res.body.data) {
      expect(doc.about).toBeUndefined();
      expect(doc.name).toBeDefined();
    }
    await RequiredModel.deleteMany({});
  });
});

describe("AdminApp /admin/version-config", () => {
  let app: express.Application;
  let adminAgent: TestAgent;
  let notAdminAgent: TestAgent;

  beforeEach(async () => {
    await setupDb();
    await VersionConfig.deleteMany({});
    app = buildApp([]);
    adminAgent = await authAsUser(app, "admin");
    notAdminAgent = await authAsUser(app, "notAdmin");
  });

  afterEach(async () => {
    await VersionConfig.deleteMany({});
  });

  it("returns default values when no config exists", async () => {
    const res = await adminAgent.get("/admin/version-config").expect(200);
    expect(res.body.mobileRequiredVersion).toBe(0);
    expect(res.body.webWarningVersion).toBe(0);
    expect(res.body.requiredMessage).toInclude("update");
  });

  it("returns the stored config when present", async () => {
    await VersionConfig.create({
      _singleton: "config",
      mobileRequiredVersion: 5,
      mobileWarningVersion: 3,
      updateUrl: "https://example.com/update",
    });
    const res = await adminAgent.get("/admin/version-config").expect(200);
    expect(res.body.mobileRequiredVersion).toBe(5);
    expect(res.body.mobileWarningVersion).toBe(3);
    expect(res.body.updateUrl).toBe("https://example.com/update");
  });

  it("creates or updates the config via PUT", async () => {
    const res = await adminAgent
      .put("/admin/version-config")
      .send({
        mobileRequiredVersion: 10,
        mobileWarningVersion: 8,
        updateUrl: "https://example.com/upgrade",
      })
      .expect(200);
    expect(res.body.mobileRequiredVersion).toBe(10);
    expect(res.body.updateUrl).toBe("https://example.com/upgrade");

    const stored = await VersionConfig.findOne({_singleton: "config"});
    expect(stored?.mobileRequiredVersion).toBe(10);
  });

  it("unsets fields passed as null via PUT", async () => {
    await adminAgent
      .put("/admin/version-config")
      .send({updateUrl: "https://example.com/upgrade"})
      .expect(200);

    const res = await adminAgent.put("/admin/version-config").send({updateUrl: null}).expect(200);

    expect(res.body.updateUrl).toBeUndefined();
  });

  it("ignores unknown fields via PUT", async () => {
    const res = await adminAgent
      .put("/admin/version-config")
      .send({bogusField: "nope", mobileRequiredVersion: 2})
      .expect(200);
    expect(res.body.mobileRequiredVersion).toBe(2);
    expect(res.body.bogusField).toBeUndefined();
  });

  it("returns 403 for non-admins (GET)", async () => {
    await notAdminAgent.get("/admin/version-config").expect(403);
  });

  it("returns 403 for non-admins (PUT)", async () => {
    await notAdminAgent.put("/admin/version-config").send({}).expect(403);
  });

  it("requires configuration:update to PUT version-config when accessControl is set", async () => {
    const accessControl = createAccess({
      connection: mongoose.connection,
      sources: [
        {
          getGrants: async () => ({permissions: {admin: ["access"]}}),
          name: "admin-access-only",
        },
      ],
      statements: terrenoStatements,
    });
    await accessControl.roles.seedDefaults();
    const localApp = buildApp([], {accessControl});
    const agent = await authAsUser(localApp, "admin");
    await agent.get("/admin/version-config").expect(403);
    await agent.put("/admin/version-config").send({mobileRequiredVersion: 3}).expect(403);
  });

  it("allows configuration:update to PUT version-config", async () => {
    const accessControl = createAccess({
      connection: mongoose.connection,
      sources: [
        {
          getGrants: async () => ({
            permissions: {admin: ["access"], configuration: ["read", "update"]},
          }),
          name: "config-admin",
        },
      ],
      statements: terrenoStatements,
    });
    await accessControl.roles.seedDefaults();
    const localApp = buildApp([], {accessControl});
    const agent = await authAsUser(localApp, "admin");
    const res = await agent
      .put("/admin/version-config")
      .send({mobileRequiredVersion: 3})
      .expect(200);
    expect(res.body.mobileRequiredVersion).toBe(3);
  });

  it("returns 401 for unauthenticated users", async () => {
    await supertest(app).get("/admin/version-config").expect(401);
  });
});

describe("AdminApp search route", () => {
  let app: express.Application;
  let adminAgent: TestAgent;
  let notAdminAgent: TestAgent;

  beforeEach(async () => {
    await setupDb();
    app = buildApp([foodModelConfig]);
    adminAgent = await authAsUser(app, "admin");
    notAdminAgent = await authAsUser(app, "notAdmin");
  });

  afterEach(async () => {
    await FoodModel.deleteMany({});
  });

  it("returns empty results when q is empty", async () => {
    const res = await adminAgent.get("/admin/foods/search").expect(200);
    expect(res.body.data).toEqual([]);
  });

  it("returns results matching searchable string fields", async () => {
    await FoodModel.create({calories: 120, name: "Apple"});
    await FoodModel.create({calories: 95, name: "Banana"});
    const res = await adminAgent.get("/admin/foods/search?q=App").expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe("Apple");
  });

  it("escapes regex special characters in search query", async () => {
    await FoodModel.create({calories: 100, name: "Rice.Bowl"});
    const res = await adminAgent.get("/admin/foods/search?q=Rice.Bowl").expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe("Rice.Bowl");
  });

  it("filters by explicit fields when provided", async () => {
    await FoodModel.create({calories: 100, name: "Apple"});
    const res = await adminAgent.get("/admin/foods/search?q=Apple&fields=calories").expect(200);
    // calories isn't a searchable string field so the result should be empty
    expect(res.body.data).toEqual([]);
  });

  it("exercises ObjectId query branch when query looks like an ObjectId", async () => {
    const user = await UserModel.findOne({email: "admin@example.com"});
    await FoodModel.create({calories: 100, name: "Kale", ownerId: user?._id});
    // Whether any results come back depends on which fields the admin config
    // identifies as ObjectId-typed; the important thing for coverage is that
    // the ObjectId branch runs without throwing.
    const res = await adminAgent.get(`/admin/foods/search?q=${user?._id}`).expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("returns 403 for non-admins", async () => {
    await notAdminAgent.get("/admin/foods/search?q=x").expect(403);
  });

  it("returns 401 for unauthenticated users", async () => {
    await supertest(app).get("/admin/foods/search?q=x").expect(401);
  });
});

describe("AdminApp with scripts that use context", () => {
  let app: express.Application;
  let adminAgent: TestAgent;

  afterEach(async () => {
    const {BackgroundTask} = await import("@terreno/api");
    await BackgroundTask.deleteMany({});
  });

  it("reports progress, logs, and checks cancellation via ctx", async () => {
    await setupDb();
    const {BackgroundTask} = await import("@terreno/api");

    const appWithScript = getBaseServer();
    setupAuth(appWithScript, UserModel as unknown as UserModelType);
    addAuthRoutes(appWithScript, UserModel as unknown as UserModelType);

    const admin = new AdminApp({
      basePath: "/admin",
      models: [],
      scripts: [
        {
          description: "Exercises ctx",
          name: "ctx-script",
          runner: async (_wetRun, ctx) => {
            await ctx?.addLog("info", "hello");
            await ctx?.updateProgress(50, "Halfway", "Processing");
            await ctx?.checkCancellation();
            return {results: ["ok"], success: true};
          },
        },
      ],
    });
    admin.register(appWithScript);
    appWithScript.use(apiUnauthorizedMiddleware);
    appWithScript.use(apiErrorMiddleware);

    app = appWithScript;
    adminAgent = await authAsUser(app, "admin");
    const res = await adminAgent.post("/admin/scripts/ctx-script/run").expect(201);

    // Wait for script completion
    await new Promise((resolve) => setTimeout(resolve, 150));

    const task = await BackgroundTask.findById(res.body.taskId);
    expect(task?.status).toBe("completed");
    // addLog("info", "hello") should have persisted
    expect(task?.logs.some((l: {message: string}) => l.message === "hello")).toBe(true);
    expect(task?.progress?.percentage).toBe(100);
  });
});

describe("AdminApp admin UI v2 routes", () => {
  let app: express.Application;
  let adminAgent: TestAgent;
  let notAdminAgent: TestAgent;

  beforeEach(async () => {
    await setupDb();
    app = buildApp([{...foodModelConfig, hiddenFields: ["hidden"]}]);
    adminAgent = await authAsUser(app, "admin");
    notAdminAgent = await authAsUser(app, "notAdmin");
  });

  afterEach(async () => {
    await FoodModel.deleteMany({});
    await BackgroundTask.deleteMany({});
  });

  it("rejects bulk-patch with an empty ids array", async () => {
    const res = await adminAgent
      .post("/admin/foods/bulk-patch")
      .send({ids: [], patch: {calories: 1}})
      .expect(400);
    expect(res.body.title).toInclude("at least one");
  });

  it("bulk-patches allowlisted fields for many ids", async () => {
    const a = await FoodModel.create({calories: 1, name: "A"});
    const b = await FoodModel.create({calories: 2, name: "B"});
    const res = await adminAgent
      .post("/admin/foods/bulk-patch")
      .send({
        ids: [String(a._id), String(b._id)],
        patch: {calories: 50},
      })
      .expect(200);
    expect(res.body.updated).toBe(2);
    expect(res.body.failures).toBeUndefined();
    const updated = await FoodModel.find({_id: {$in: [a._id, b._id]}})
      .lean()
      .exec();
    for (const row of updated) {
      expect(row.calories).toBe(50);
    }
  });

  it("rejects bulk-patch with more than 1000 ids", async () => {
    const ids = Array.from({length: 1001}, (_, index) => index.toString(16).padStart(24, "0"));
    const res = await adminAgent
      .post("/admin/foods/bulk-patch")
      .send({ids, patch: {calories: 1}})
      .expect(400);
    expect(res.body.title).toInclude("1000");
  });

  it("rejects bulk-patch keys outside the allowlist", async () => {
    const a = await FoodModel.create({calories: 1, name: "A"});
    const res = await adminAgent
      .post("/admin/foods/bulk-patch")
      .send({
        ids: [String(a._id)],
        patch: {thisFieldIsNotAllowlisted: true},
      })
      .expect(400);
    expect(res.body.title).toInclude("allowlisted");
  });

  it("enqueues a background task and returns taskId", async () => {
    const res = await adminAgent
      .post("/admin/background-tasks")
      .send({kind: "reindex-search", metadata: {scope: "foods"}})
      .expect(201);
    expect(typeof res.body.taskId).toBe("string");
    const task = await BackgroundTask.findById(res.body.taskId);
    expect(task?.taskType).toBe("reindex-search");
    expect(task?.status).toBe("pending");
  });

  it("returns 403 for background-tasks when not admin", async () => {
    await notAdminAgent.post("/admin/background-tasks").send({kind: "x"}).expect(403);
  });

  it("requires admin:runScripts to enqueue background tasks when accessControl is set", async () => {
    const accessControl = createAccess({
      connection: mongoose.connection,
      sources: [
        {
          getGrants: async () => ({permissions: {admin: ["access"]}}),
          name: "admin-access-only",
        },
      ],
      statements: terrenoStatements,
    });
    await accessControl.roles.seedDefaults();
    const localApp = buildApp([foodModelConfig], {accessControl});
    const agent = await authAsUser(localApp, "admin");
    await agent.post("/admin/background-tasks").send({kind: "reindex-search"}).expect(403);
  });

  it("allows admin:runScripts to enqueue background tasks", async () => {
    const accessControl = createAccess({
      connection: mongoose.connection,
      sources: [
        {
          getGrants: async () => ({
            permissions: {admin: ["access", "runScripts"]},
          }),
          name: "admin-run-scripts",
        },
      ],
      statements: terrenoStatements,
    });
    await accessControl.roles.seedDefaults();
    const localApp = buildApp([foodModelConfig], {accessControl});
    const agent = await authAsUser(localApp, "admin");
    await agent.post("/admin/background-tasks").send({kind: "reindex-search"}).expect(201);
  });

  it("strips readonly fields from PATCH updates", async () => {
    app = buildApp([
      {
        ...foodModelConfig,
        readonlyFields: ["name"],
      },
    ]);
    const agent = await authAsUser(app, "admin");
    const food = await FoodModel.create({calories: 10, name: "KeepMe"});
    await agent.patch(`/admin/foods/${food._id}`).send({calories: 99, name: "Changed"}).expect(200);
    const reRead = await FoodModel.findById(food._id).lean();
    expect(reRead?.name).toBe("KeepMe");
    expect(reRead?.calories).toBe(99);
  });

  it("strips readonly fields from POST create", async () => {
    app = buildApp([
      {
        ...foodModelConfig,
        readonlyFields: ["name"],
      },
    ]);
    const agent = await authAsUser(app, "admin");
    const res = await agent
      .post("/admin/foods")
      .send({calories: 5, name: "IgnoredName"})
      .expect(201);
    expect(res.body.data.name).toBeUndefined();
    expect(res.body.data.calories).toBe(5);
    const stored = await FoodModel.findById(res.body.data._id).lean();
    expect(stored?.name).toBeUndefined();
    expect(stored?.calories).toBe(5);
  });

  it("disables DELETE when permissions.delete is false", async () => {
    app = buildApp([
      {
        ...foodModelConfig,
        permissions: {delete: false},
      },
    ]);
    const agent = await authAsUser(app, "admin");
    const food = await FoodModel.create({calories: 1, name: "Nope"});
    const res = await agent.delete(`/admin/foods/${food._id}`);
    expect([403, 405]).toContain(res.status);
  });
});

describe("AdminApp onAdminAudit", () => {
  let app: express.Application;
  let adminAgent: TestAgent;
  const auditEvents: AdminAuditEvent[] = [];

  beforeEach(async () => {
    await setupDb();
    auditEvents.length = 0;
    app = buildApp([{...foodModelConfig, hiddenFields: ["hidden"]}], {
      onAdminAudit: async (event): Promise<void> => {
        auditEvents.push(event);
      },
    });
    adminAgent = await authAsUser(app, "admin");
  });

  afterEach(async () => {
    await FoodModel.deleteMany({});
  });

  it("invokes onAdminAudit with verb created after POST", async () => {
    await adminAgent.post("/admin/foods").send({calories: 5, name: "Audited"}).expect(201);
    expect(auditEvents.some((e) => e.verb === "created" && e.modelName === "Food")).toBe(true);
  });

  it("invokes onAdminAudit with verb updated after PATCH", async () => {
    const food = await FoodModel.create({calories: 10, name: "PatchMe"});
    await adminAgent.patch(`/admin/foods/${food._id}`).send({calories: 42}).expect(200);
    expect(auditEvents.some((e) => e.verb === "updated" && e.modelName === "Food")).toBe(true);
  });

  it("invokes onAdminAudit with verb deleted after DELETE", async () => {
    const food = await FoodModel.create({calories: 1, name: "DeleteMe"});
    await adminAgent.delete(`/admin/foods/${food._id}`).expect(204);
    expect(auditEvents.some((e) => e.verb === "deleted" && e.modelName === "Food")).toBe(true);
  });
});

describe("AdminApp onAdminAudit is best-effort", () => {
  beforeEach(async () => {
    await setupDb();
  });

  afterEach(async () => {
    await FoodModel.deleteMany({});
  });

  const throwingAudit = {
    onAdminAudit: async (): Promise<void> => {
      throw new Error("audit sink failure");
    },
  };

  it("returns 201 on POST when onAdminAudit throws", async () => {
    const localApp = buildApp([foodModelConfig], throwingAudit);
    const agent = await authAsUser(localApp, "admin");
    const res = await agent
      .post("/admin/foods")
      .send({calories: 5, name: "StillCreated"})
      .expect(201);
    const stored = await FoodModel.findById(res.body.data._id).lean();
    expect(stored?.name).toBe("StillCreated");
  });

  it("returns 200 on PATCH when onAdminAudit throws", async () => {
    const localApp = buildApp([foodModelConfig], throwingAudit);
    const agent = await authAsUser(localApp, "admin");
    const food = await FoodModel.create({calories: 10, name: "PatchMe"});
    const res = await agent.patch(`/admin/foods/${food._id}`).send({calories: 99}).expect(200);
    expect(res.body.data.calories).toBe(99);
    const stored = await FoodModel.findById(food._id).lean();
    expect(stored?.calories).toBe(99);
  });

  it("returns 204 on DELETE when onAdminAudit throws", async () => {
    const localApp = buildApp([foodModelConfig], throwingAudit);
    const agent = await authAsUser(localApp, "admin");
    const food = await FoodModel.create({calories: 1, name: "DeleteMe"});
    await agent.delete(`/admin/foods/${food._id}`).expect(204);
    expect(await FoodModel.findById(food._id)).toBeNull();
  });
});

const deleteAuditEventModel = (): void => {
  if (mongoose.connection.models.TerrenoAuditEvent) {
    mongoose.connection.deleteModel("TerrenoAuditEvent");
  }
};

const buildAppWithAuditPlugin = (adminOverrides?: Partial<AdminOptions>): express.Application => {
  const app = getBaseServer();
  setupAuth(app, UserModel as unknown as UserModelType);
  addAuthRoutes(app, UserModel as unknown as UserModelType);
  new AuditApp().register(app);
  const admin = new AdminApp({
    basePath: "/admin",
    models: [foodModelConfig],
    ...adminOverrides,
  });
  admin.register(app);
  app.use(apiUnauthorizedMiddleware);
  app.use(apiErrorMiddleware);
  return app;
};

describe("AdminApp AuditEvent auto-write", () => {
  beforeEach(async () => {
    deleteAuditEventModel();
    resetAuditRecorderForTests();
    await setupDb();
    await mongoose.connection.collection("auditevents").deleteMany({});
  });

  afterEach(async () => {
    await FoodModel.deleteMany({});
    await mongoose.connection.collection("auditevents").deleteMany({});
    resetAuditRecorderForTests();
    deleteAuditEventModel();
  });

  it("persists source admin AuditEvent on POST without onAdminAudit", async () => {
    const localApp = buildAppWithAuditPlugin();
    const agent = await authAsUser(localApp, "admin");
    await agent.post("/admin/foods").send({calories: 5, name: "AuditedFood"}).expect(201);
    await flushAuditRecorderForTests();
    const events = await mongoose.connection.collection("auditevents").find({}).toArray();
    assert.equal(events.length, 1);
    assert.equal(events[0]?.source, "admin");
    assert.equal(events[0]?.verb, "created");
    assert.equal(events[0]?.modelName, "Food");
    assert.equal(events[0]?.recordLabel, "AuditedFood");
  });

  it("omits hiddenFields from admin AuditEvent diffs", async () => {
    const hiddenApp = getBaseServer();
    setupAuth(hiddenApp, UserModel as unknown as UserModelType);
    addAuthRoutes(hiddenApp, UserModel as unknown as UserModelType);
    new AuditApp().register(hiddenApp);
    new AdminApp({
      basePath: "/admin",
      models: [{...foodModelConfig, hiddenFields: ["calories"]}],
    }).register(hiddenApp);
    hiddenApp.use(apiUnauthorizedMiddleware);
    hiddenApp.use(apiErrorMiddleware);
    const agent = await authAsUser(hiddenApp, "admin");
    const food = await FoodModel.create({calories: 42, name: "HiddenCals"});
    await agent.delete(`/admin/foods/${food._id}`).expect(204);
    await flushAuditRecorderForTests();
    const events = await mongoose.connection.collection("auditevents").find({}).toArray();
    assert.equal(events.length, 1);
    const before = events[0]?.before as Record<string, unknown> | undefined;
    assert.equal(before?.name, "HiddenCals");
    assert.isUndefined(before?.calories);
  });

  it("runs onAdminAudit and persists AuditEvent when both are configured", async () => {
    const extra: AdminAuditEvent[] = [];
    const localApp = buildAppWithAuditPlugin({
      onAdminAudit: async (event): Promise<void> => {
        extra.push(event);
      },
    });
    const agent = await authAsUser(localApp, "admin");
    await agent.post("/admin/foods").send({calories: 8, name: "BothSinks"}).expect(201);
    await flushAuditRecorderForTests();
    assert.equal(extra.length, 1);
    assert.equal(extra[0]?.verb, "created");
    const events = await mongoose.connection.collection("auditevents").find({}).toArray();
    assert.equal(events.length, 1);
    assert.equal(events[0]?.source, "admin");
  });

  it("returns 201 on POST when AuditEvent persistence throws", async () => {
    const localApp = buildAppWithAuditPlugin();
    const AuditEvent = mongoose.connection.models.TerrenoAuditEvent;
    const createSpy = spyOn(AuditEvent, "create").mockImplementation(() => {
      throw new Error("recorder boom");
    });
    const agent = await authAsUser(localApp, "admin");
    const res = await agent
      .post("/admin/foods")
      .send({calories: 5, name: "StillCreated"})
      .expect(201);
    await flushAuditRecorderForTests();
    createSpy.mockRestore();
    const stored = await FoodModel.findById(res.body.data._id).lean();
    assert.equal(stored?.name, "StillCreated");
  });

  it("returns 405 for admin create on AuditEvent when AuditApp is a plugin", async () => {
    const auditPlugin = new AuditApp();
    const terrenoApp = {
      getPlugins: () => [auditPlugin],
      getRegistrations: () => [],
    } as unknown as TerrenoApp;
    const app = getBaseServer();
    setupAuth(app, UserModel as unknown as UserModelType);
    addAuthRoutes(app, UserModel as unknown as UserModelType);
    auditPlugin.register(app);
    new AdminApp({basePath: "/admin", models: [foodModelConfig]}).register(
      app,
      undefined,
      terrenoApp
    );
    app.use(apiUnauthorizedMiddleware);
    app.use(apiErrorMiddleware);
    const agent = await authAsUser(app, "admin");
    const config = await agent.get("/admin/config").expect(200);
    const auditMeta = (
      config.body.models as Array<{name: string; permissions: object; routePath: string}>
    ).find((model) => model.name === "AuditEvent" || model.routePath.includes("audit-events"));
    assert.ok(
      auditMeta,
      JSON.stringify(config.body.models.map((model: {name: string}) => model.name))
    );
    assert.equal(auditMeta?.name, "AuditEvent");
    assert.deepEqual(auditMeta.permissions, {create: false, delete: false, update: false});
    const create = await agent.post("/admin/audit-events").send({
      modelName: "Todo",
      operation: "create",
      source: "admin",
      verb: "created",
    });
    assert.equal(create.status, 405, JSON.stringify(create.body));
  });

  it("keeps AuditEvent admin name and adminAuditEvent RBAC after Mongoose rename", async () => {
    const auditPlugin = new AuditApp();
    const terrenoApp = {
      getPlugins: () => [auditPlugin],
      getRegistrations: () => [],
    } as unknown as TerrenoApp;
    const accessControl = createAccess({
      connection: mongoose.connection,
      resolvePermissions: async () => ({
        admin: ["access"],
        adminAuditEvent: ["list", "read"],
      }),
      statements: {
        ...terrenoStatements,
        adminAuditEvent: ["list", "read"],
      },
    });
    const app = getBaseServer();
    setupAuth(app, UserModel as unknown as UserModelType);
    addAuthRoutes(app, UserModel as unknown as UserModelType);
    auditPlugin.register(app);
    new AdminApp({
      accessControl,
      basePath: "/admin",
      models: [foodModelConfig],
    }).register(app, undefined, terrenoApp);
    app.use(apiUnauthorizedMiddleware);
    app.use(apiErrorMiddleware);
    const agent = await authAsUser(app, "admin");
    const config = await agent.get("/admin/config").expect(200);
    const auditMeta = (config.body.models as Array<{name: string; routePath: string}>).find(
      (model) => model.routePath.includes("audit-events")
    );
    assert.equal(auditMeta?.name, "AuditEvent");
    const list = await agent.get("/admin/audit-events").expect(200);
    assert.isArray(list.body.data);
  });

  it("lists AuditEvent without an organization even when organizations is enabled", async () => {
    const auditPlugin = new AuditApp();
    const terrenoApp = {
      getPlugins: () => [auditPlugin],
      getRegistrations: () => [],
    } as unknown as TerrenoApp;
    const app = getBaseServer();
    setupAuth(app, UserModel as unknown as UserModelType);
    addAuthRoutes(app, UserModel as unknown as UserModelType);
    auditPlugin.register(app);
    new AdminApp({
      basePath: "/admin",
      models: [foodModelConfig],
      organizations: true,
    }).register(app, undefined, terrenoApp);
    app.use(apiUnauthorizedMiddleware);
    app.use(apiErrorMiddleware);
    const agent = await authAsUser(app, "admin");
    const config = await agent.get("/admin/config").expect(200);
    const auditMeta = (
      config.body.models as Array<{name: string; organizationScoped?: boolean; routePath: string}>
    ).find((model) => model.name === "AuditEvent" || model.routePath.includes("audit-events"));
    assert.ok(
      auditMeta,
      JSON.stringify(config.body.models.map((model: {name: string}) => model.name))
    );
    assert.equal(auditMeta?.name, "AuditEvent");
    assert.strictEqual(auditMeta?.organizationScoped, false);
    const list = await agent.get("/admin/audit-events").expect(200);
    assert.isArray(list.body.data);
  });
});

describe("AdminApp per-model queryFilter", () => {
  beforeEach(async () => {
    await setupDb();
  });

  afterEach(async () => {
    await FoodModel.deleteMany({});
    await VersionConfig.deleteMany({});
  });

  it("returns an empty list when queryFilter returns null", async () => {
    const localApp = buildApp([
      {
        ...foodModelConfig,
        queryFilter: (): null => null,
      },
    ]);
    await FoodModel.create({calories: 1, name: "HiddenRow"});
    const agent = await authAsUser(localApp, "admin");
    const res = await agent.get("/admin/foods").expect(200);
    expect(res.body.data).toEqual([]);
  });

  it("merges queryFilter constraints into list queries for that model only", async () => {
    const localApp = buildApp([
      {
        ...foodModelConfig,
        queryFilter: (_user, query): Record<string, unknown> => ({
          ...(query ?? {}),
          name: "FilteredOnly",
        }),
      },
    ]);
    await FoodModel.create({calories: 1, name: "Other"});
    await FoodModel.create({calories: 2, name: "FilteredOnly"});
    const agent = await authAsUser(localApp, "admin");
    const res = await agent.get("/admin/foods").expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe("FilteredOnly");
  });

  it("fails closed on list and mutating CRUD when the model is missing from RBAC statements", async () => {
    await setupDb();
    const accessControl = createAccess({
      connection: mongoose.connection,
      sources: [
        {
          getGrants: async () => ({permissions: {admin: ["access"]}}),
          name: "admin-access",
        },
      ],
      statements: terrenoStatements,
    });
    await accessControl.roles.seedDefaults();

    const localApp = buildApp([foodModelConfig], {accessControl});
    const agent = await authAsUser(localApp, "admin");

    await agent.get("/admin/foods").expect(405);
    await agent.get("/admin/foods/search?q=x").expect(403);
    await agent.post("/admin/foods").send({calories: 1, name: "Nope"}).expect(405);
  });

  it("applies queryFilter to admin search so autocomplete cannot leak out-of-scope rows", async () => {
    const localApp = buildApp([
      {
        ...foodModelConfig,
        queryFilter: (_user, query): Record<string, unknown> => ({
          ...(query ?? {}),
          name: "FilteredOnly",
        }),
      },
    ]);
    await FoodModel.create({calories: 1, name: "OtherApple"});
    await FoodModel.create({calories: 2, name: "FilteredOnly"});
    const agent = await authAsUser(localApp, "admin");
    const res = await agent.get("/admin/foods/search?q=e").expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe("FilteredOnly");
  });

  it("accepts Mongo operators from queryFilter without treating them as client filters", async () => {
    const localApp = buildApp([
      {
        ...foodModelConfig,
        queryFilter: (): Record<string, unknown> => ({
          $or: [{name: "Alpha"}, {name: "Beta"}],
        }),
      },
    ]);
    await FoodModel.create({calories: 1, name: "Alpha"});
    await FoodModel.create({calories: 2, name: "Other"});
    const agent = await authAsUser(localApp, "admin");
    const res = await agent.get("/admin/foods").expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe("Alpha");
  });

  it("applies q against searchFields derived from listFields when none are configured", async () => {
    const localApp = buildApp([foodModelConfig]);
    await FoodModel.create({calories: 1, name: "GreenApple"});
    await FoodModel.create({calories: 2, name: "Banana"});
    const agent = await authAsUser(localApp, "admin");
    const res = await agent.get("/admin/foods?q=apple").expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe("GreenApple");
  });

  it("applies q as a case-insensitive partial match across searchFields", async () => {
    const localApp = buildApp([
      {
        ...foodModelConfig,
        searchFields: ["name"],
      },
    ]);
    await FoodModel.create({calories: 1, name: "GreenApple"});
    await FoodModel.create({calories: 2, name: "Banana"});
    const agent = await authAsUser(localApp, "admin");
    const res = await agent.get("/admin/foods?q=apple").expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe("GreenApple");
  });

  it("allows default -created sort even when created is not in listDisplay", async () => {
    const localApp = buildApp([
      {
        displayName: "Foods",
        listFields: ["name"],
        model: FoodModel,
        routePath: "/foods",
      },
    ]);
    const agent = await authAsUser(localApp, "admin");
    await agent.get("/admin/foods?sort=-created").expect(200);
  });

  it("strips excludeFields from admin create and update bodies", async () => {
    const localApp = buildApp([
      {
        ...foodModelConfig,
        excludeFields: ["calories"],
      },
    ]);
    const agent = await authAsUser(localApp, "admin");
    const created = await agent
      .post("/admin/foods")
      .send({calories: 999, name: "Stripped"})
      .expect(201);
    expect(created.body.data.calories).toBeUndefined();
    const createdId = created.body.data._id as string;
    const stored = await FoodModel.findById(createdId).lean();
    expect(stored?.calories).toBeUndefined();

    await FoodModel.updateOne({_id: createdId}, {calories: 12});
    const patched = await agent
      .patch(`/admin/foods/${createdId}`)
      .send({calories: 50, name: "Renamed"})
      .expect(200);
    expect(patched.body.data.name).toBe("Renamed");
    const after = await FoodModel.findById(createdId).lean();
    expect(after?.calories).toBe(12);
  });
});

describe("AdminApp organization scoping", () => {
  beforeEach(async () => {
    const [admin] = await setupDb();
    admin.roles = ["operator"];
    await admin.save();
    await Promise.all([
      Membership.deleteMany({}),
      Organization.deleteMany({}),
      OrgScopedFoodModel.deleteMany({}),
    ]);
  });

  it("requires org context and scopes list/create when organizations is enabled", async () => {
    const accessControl = createAccess({
      connection: mongoose.connection,
      organizations: true,
      sources: [
        {
          getGrants: async () => ({
            permissions: {
              admin: ["access"],
              adminOrgScopedFood: ["read", "write"],
            },
          }),
          name: "org-scoped-food-admin",
        },
      ],
      statements: {
        ...terrenoStatements,
        adminOrgScopedFood: ADMIN_MODEL_ACCESS,
      },
      userModel: UserModel as unknown as UserModelType,
    });
    await accessControl.roles.seedDefaults();
    const localApp = buildApp(
      [
        {
          displayName: "Org foods",
          listFields: ["name", "calories"],
          model: OrgScopedFoodModel,
          routePath: "/org-foods",
        },
      ],
      {accessControl, organizations: true}
    );
    const agent = await authAsUser(localApp, "admin");
    const admin = await UserModel.findOne({email: "admin@example.com"}).orFail();
    const [firstOrg, secondOrg] = await Organization.create([
      {name: "First Org", ownerId: admin._id},
      {name: "Second Org", ownerId: admin._id},
    ]);
    await OrgScopedFoodModel.create([
      {calories: 1, name: "First", organizationId: firstOrg._id},
      {calories: 2, name: "Second", organizationId: secondOrg._id},
    ]);

    await agent.get("/admin/org-foods").expect(400);
    const list = await agent
      .get("/admin/org-foods")
      .set("X-Organization-Id", String(firstOrg._id))
      .expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].name).toBe("First");
    await agent.get("/admin/org-foods/search?q=Second").expect(400);
    const search = await agent
      .get("/admin/org-foods/search?q=Second")
      .set("X-Organization-Id", String(firstOrg._id))
      .expect(200);
    expect(search.body.data).toHaveLength(0);
    const second = await OrgScopedFoodModel.findOne({name: "Second"}).orFail();
    await agent
      .get(`/admin/org-foods/${second._id}`)
      .set("X-Organization-Id", String(firstOrg._id))
      .expect(403);
    await agent
      .patch(`/admin/org-foods/${second._id}`)
      .set("X-Organization-Id", String(firstOrg._id))
      .send({calories: 99})
      .expect(403);
    await agent
      .delete(`/admin/org-foods/${second._id}`)
      .set("X-Organization-Id", String(firstOrg._id))
      .expect(403);
    await agent
      .post("/admin/org-foods/bulk-patch")
      .send({ids: [second._id], patch: {calories: 99}})
      .expect(400);
    const bulk = await agent
      .post("/admin/org-foods/bulk-patch")
      .set("X-Organization-Id", String(firstOrg._id))
      .send({ids: [second._id], patch: {calories: 99}})
      .expect(200);
    expect(bulk.body.updated).toBe(0);
    expect(bulk.body.failures).toHaveLength(1);

    const created = await agent
      .post("/admin/org-foods")
      .set("X-Organization-Id", String(firstOrg._id))
      .send({calories: 3, name: "Created", organizationId: secondOrg._id})
      .expect(201);
    expect(String(created.body.data.organizationId)).toBe(String(firstOrg._id));
    const stored = await OrgScopedFoodModel.findById(created.body.data._id).lean();
    expect(String(stored?.organizationId)).toBe(String(firstOrg._id));
  });

  it("infers a single org-admin membership and denies another organization", async () => {
    const admin = await UserModel.findOne({email: "admin@example.com"}).orFail();
    admin.roles = [];
    await admin.save();
    const accessControl = createAccess({
      connection: mongoose.connection,
      organizations: true,
      sources: [
        {
          getGrants: async () => ({
            permissions: {
              admin: ["access"],
              adminOrgScopedFood: ["read", "write"],
            },
          }),
          name: "org-scoped-food-admin",
        },
      ],
      statements: {
        ...terrenoStatements,
        adminOrgScopedFood: ADMIN_MODEL_ACCESS,
      },
      userModel: UserModel as unknown as UserModelType,
    });
    await accessControl.roles.seedDefaults();
    const localApp = buildApp(
      [
        {
          displayName: "Org foods",
          listFields: ["name", "calories"],
          model: OrgScopedFoodModel,
          routePath: "/org-foods",
        },
      ],
      {accessControl, organizations: true}
    );
    const [firstOrg, secondOrg] = await Organization.create([
      {name: "Admin Org", ownerId: admin._id},
      {name: "Other Org", ownerId: admin._id},
    ]);
    await Membership.create({
      organizationId: firstOrg._id,
      roleName: "org-admin",
      userId: admin._id,
    });
    await OrgScopedFoodModel.create([
      {calories: 1, name: "Admin row", organizationId: firstOrg._id},
      {calories: 2, name: "Other row", organizationId: secondOrg._id},
    ]);
    const agent = await authAsUser(localApp, "admin");

    const inferred = await agent.get("/admin/org-foods").expect(200);
    expect(inferred.body.data).toHaveLength(1);
    expect(inferred.body.data[0].name).toBe("Admin row");
    await agent.get("/admin/org-foods").set("X-Organization-Id", String(secondOrg._id)).expect(403);
  });

  it("leaves org-scoped models unscoped when organizations is omitted", async () => {
    const localApp = buildApp([
      {
        displayName: "Org foods",
        listFields: ["name", "calories"],
        model: OrgScopedFoodModel,
        routePath: "/org-foods",
      },
    ]);
    const agent = await authAsUser(localApp, "admin");
    const admin = await UserModel.findOne({email: "admin@example.com"}).orFail();
    const organization = await Organization.create({name: "Optional", ownerId: admin._id});
    await OrgScopedFoodModel.create({
      calories: 1,
      name: "Visible",
      organizationId: organization._id,
    });

    const list = await agent.get("/admin/org-foods").expect(200);
    expect(list.body.data).toHaveLength(1);
  });
});

describe("AdminApp user elevation and scoped bulk-patch", () => {
  beforeEach(async () => {
    await setupDb();
  });

  afterEach(async () => {
    await FoodModel.deleteMany({});
    await VersionConfig.deleteMany({});
  });

  it("allows admin CRUD to set the User admin flag", async () => {
    const localApp = buildApp([
      {
        displayName: "Users",
        listFields: ["email", "admin"],
        model: UserModel,
        routePath: "/users",
      },
    ]);
    const agent = await authAsUser(localApp, "admin");
    const target = await UserModel.findOne({email: "notAdmin@example.com"});
    expect(target).toBeTruthy();

    await agent
      .patch(`/admin/users/${String(target?._id)}`)
      .send({admin: true})
      .expect(200);

    const after = await UserModel.findById(target?._id);
    expect(after?.admin).toBe(true);
  });

  it("requires rbac:assignRoles to set User admin when accessControl is enabled", async () => {
    const accessControl = createAccess({
      connection: mongoose.connection,
      sources: [
        {
          getGrants: async () => ({
            permissions: {
              admin: ["access"],
              user: ["create", "list", "read", "update"],
            },
          }),
          name: "admin-without-assign",
        },
      ],
      statements: terrenoStatements,
      userModel: UserModel as unknown as UserModelType,
    });
    await accessControl.roles.seedDefaults();

    const localApp = buildApp(
      [
        {
          displayName: "Users",
          listFields: ["email", "admin"],
          model: UserModel,
          routePath: "/users",
        },
      ],
      {accessControl}
    );
    const agent = await authAsUser(localApp, "admin");
    const target = await UserModel.findOne({email: "notAdmin@example.com"});
    expect(target).toBeTruthy();
    expect(target?.admin).toBe(false);

    await agent
      .patch(`/admin/users/${String(target?._id)}`)
      .send({admin: true})
      .expect(403);

    const afterDenied = await UserModel.findById(target?._id);
    expect(afterDenied?.admin).toBe(false);

    await agent
      .patch(`/admin/users/${String(target?._id)}`)
      .send({admin: false, name: "Kept"})
      .expect(200);
    const afterEcho = await UserModel.findById(target?._id);
    expect(afterEcho?.admin).toBe(false);
    expect(afterEcho?.name).toBe("Kept");

    const created = await agent
      .post("/admin/users")
      .send({admin: false, email: "form-echo-admin@example.com"})
      .expect(201);
    expect(created.body.data.admin).toBe(false);
    expect(await UserModel.findOne({email: "form-echo-admin@example.com"})).toBeTruthy();

    await UserModel.updateOne({_id: target?._id}, {admin: true});
    await agent
      .patch(`/admin/users/${String(target?._id)}`)
      .send({admin: "false"})
      .expect(403);
    expect((await UserModel.findById(target?._id))?.admin).toBe(true);
  });

  it("does not let assignRoles grant the legacy admin flag", async () => {
    const accessControl = createAccess({
      connection: mongoose.connection,
      sources: [
        {
          getGrants: async () => ({
            permissions: {
              admin: ["access"],
              rbac: ["assignRoles"],
              user: ["create", "list", "read", "update"],
            },
          }),
          name: "assigner-without-legacy-admin",
        },
      ],
      statements: terrenoStatements,
      userModel: UserModel as unknown as UserModelType,
    });
    await accessControl.roles.seedDefaults();

    const localApp = buildApp(
      [
        {
          displayName: "Users",
          listFields: ["email", "admin"],
          model: UserModel,
          routePath: "/users",
        },
      ],
      {accessControl}
    );
    const agent = await authAsUser(localApp, "notAdmin");
    const target = await UserModel.findOne({email: "notAdmin@example.com"});
    expect(target?.admin).toBe(false);

    await agent
      .patch(`/admin/users/${String(target?._id)}`)
      .send({admin: true})
      .expect(403);
    expect((await UserModel.findById(target?._id))?.admin).toBe(false);
  });

  it("does not let assignRoles revoke the legacy admin flag", async () => {
    const accessControl = createAccess({
      connection: mongoose.connection,
      sources: [
        {
          getGrants: async () => ({
            permissions: {
              admin: ["access"],
              rbac: ["assignRoles"],
              user: ["create", "list", "read", "update"],
            },
          }),
          name: "assigner-without-legacy-admin",
        },
      ],
      statements: terrenoStatements,
      userModel: UserModel as unknown as UserModelType,
    });
    await accessControl.roles.seedDefaults();

    const localApp = buildApp(
      [
        {
          displayName: "Users",
          listFields: ["email", "admin"],
          model: UserModel,
          routePath: "/users",
        },
      ],
      {accessControl}
    );
    const agent = await authAsUser(localApp, "notAdmin");
    const target = await UserModel.findOne({email: "admin@example.com"});
    expect(target?.admin).toBe(true);

    await agent
      .patch(`/admin/users/${String(target?._id)}`)
      .send({admin: false})
      .expect(403);
    expect((await UserModel.findById(target?._id))?.admin).toBe(true);
  });

  it("does not let manageRoles mint the legacy admin flag", async () => {
    const accessControl = createAccess({
      connection: mongoose.connection,
      sources: [
        {
          getGrants: async () => ({
            permissions: {
              admin: ["access"],
              rbac: ["assignRoles", "manageRoles"],
              user: ["create", "list", "read", "update"],
            },
          }),
          name: "manager-without-legacy-admin",
        },
      ],
      statements: terrenoStatements,
      userModel: UserModel as unknown as UserModelType,
    });
    await accessControl.roles.seedDefaults();

    const localApp = buildApp(
      [
        {
          displayName: "Users",
          listFields: ["email", "admin"],
          model: UserModel,
          routePath: "/users",
        },
      ],
      {accessControl}
    );
    const agent = await authAsUser(localApp, "notAdmin");
    const target = await UserModel.findOne({email: "notAdmin@example.com"});
    expect(target?.admin).toBe(false);

    await agent
      .patch(`/admin/users/${String(target?._id)}`)
      .send({admin: true})
      .expect(403);
    expect((await UserModel.findById(target?._id))?.admin).toBe(false);

    await agent
      .post("/admin/users")
      .send({admin: true, email: "minted-admin@example.com"})
      .expect(403);
    expect(await UserModel.findOne({email: "minted-admin@example.com"})).toBeNull();
  });

  it("does not let manageRoles revoke the legacy admin flag", async () => {
    const accessControl = createAccess({
      connection: mongoose.connection,
      sources: [
        {
          getGrants: async () => ({
            permissions: {
              admin: ["access"],
              rbac: ["assignRoles", "manageRoles"],
              user: ["create", "list", "read", "update"],
            },
          }),
          name: "manager-without-legacy-admin",
        },
      ],
      statements: terrenoStatements,
      userModel: UserModel as unknown as UserModelType,
    });
    await accessControl.roles.seedDefaults();

    const localApp = buildApp(
      [
        {
          displayName: "Users",
          listFields: ["email", "admin"],
          model: UserModel,
          routePath: "/users",
        },
      ],
      {accessControl}
    );
    const agent = await authAsUser(localApp, "notAdmin");
    const target = await UserModel.findOne({email: "admin@example.com"});
    expect(target?.admin).toBe(true);

    await agent
      .patch(`/admin/users/${String(target?._id)}`)
      .send({admin: false})
      .expect(403);
    expect((await UserModel.findById(target?._id))?.admin).toBe(true);
  });

  it("does not persist organizationIds on RBAC admin User writes", async () => {
    const accessControl = createAccess({
      connection: mongoose.connection,
      sources: [
        {
          getGrants: async () => ({
            permissions: {
              admin: ["access"],
              rbac: ["assignRoles"],
              user: ["create", "list", "read", "update"],
            },
          }),
          name: "admin-user-editor",
        },
      ],
      statements: terrenoStatements,
      userModel: UserModel as unknown as UserModelType,
    });
    await accessControl.roles.seedDefaults();

    const localApp = buildApp(
      [
        {
          bulkPatchAllowlist: ["name", "organizationIds"],
          displayName: "Users",
          listFields: ["email", "admin"],
          model: UserModel,
          routePath: "/users",
        },
      ],
      {accessControl}
    );
    const agent = await authAsUser(localApp, "admin");
    const target = await UserModel.findOne({email: "notAdmin@example.com"});
    expect(target).toBeTruthy();

    await agent
      .patch(`/admin/users/${String(target?._id)}`)
      .send({name: "Org-stripped", organizationIds: ["other-tenant"]})
      .expect(200);
    const afterPatch = await UserModel.findById(target?._id);
    expect(afterPatch?.name).toBe("Org-stripped");
    expect(
      (afterPatch as {organizationIds?: string[]} | null)?.organizationIds ?? []
    ).not.toContain("other-tenant");

    const created = await agent
      .post("/admin/users")
      .send({email: "org-stripped@example.com", organizationIds: ["other-tenant"]})
      .expect(201);
    expect(created.body.data.organizationIds ?? []).not.toContain("other-tenant");
    const createdDoc = await UserModel.findOne({email: "org-stripped@example.com"});
    expect(
      (createdDoc as {organizationIds?: string[]} | null)?.organizationIds ?? []
    ).not.toContain("other-tenant");

    await agent
      .post("/admin/users/bulk-patch")
      .send({
        ids: [String(target?._id)],
        patch: {organizationIds: ["bulk-tenant"]},
      })
      .expect(400);
    expect(
      ((await UserModel.findById(target?._id)) as {organizationIds?: string[]} | null)
        ?.organizationIds ?? []
    ).not.toContain("bulk-tenant");
  });

  it("checks each bulk-patch target document against RBAC scopes", async () => {
    const foodStatements = {
      ...terrenoStatements,
      food: ["create", "list", "read", "update", "delete"],
    } as const;
    const accessControl = createAccess({
      connection: mongoose.connection,
      scopes: {
        "food.update": {
          check: ({doc, user}) => {
            if (!doc) {
              return true;
            }
            const ownerId = (doc as {ownerId?: unknown}).ownerId;
            return String(ownerId) === String(user.id);
          },
        },
      },
      sources: [
        {
          getGrants: async () => ({
            permissions: {admin: ["access"], food: ["list", "read", "update"]},
          }),
          name: "scoped-food-update",
        },
      ],
      statements: foodStatements,
    });
    await accessControl.roles.seedDefaults();

    const localApp = buildApp([{...foodModelConfig, bulkPatchAllowlist: ["calories", "name"]}], {
      accessControl,
    });
    const agent = await authAsUser(localApp, "admin");
    const actor = await UserModel.findOne({email: "admin@example.com"});
    const other = await UserModel.findOne({email: "notAdmin@example.com"});
    expect(actor).toBeTruthy();
    expect(other).toBeTruthy();

    const owned = await FoodModel.create({
      calories: 1,
      name: "Owned",
      ownerId: actor?._id,
    });
    const foreign = await FoodModel.create({
      calories: 2,
      name: "Foreign",
      ownerId: other?._id,
    });

    const res = await agent
      .post("/admin/foods/bulk-patch")
      .send({
        ids: [String(owned._id), String(foreign._id)],
        patch: {calories: 50},
      })
      .expect(200);

    expect(res.body.updated).toBe(1);
    expect(res.body.failures).toEqual([{id: String(foreign._id), title: "Forbidden"}]);
    expect((await FoodModel.findById(owned._id).lean())?.calories).toBe(50);
    expect((await FoodModel.findById(foreign._id).lean())?.calories).toBe(2);
  });

  it("returns assigned User roles in the admin update response", async () => {
    if (!UserModel.schema.path("roles")) {
      UserModel.schema.add({
        roles: {default: [], description: "RBAC role names", type: [String]},
      });
    }
    const accessControl = createAccess({
      connection: mongoose.connection,
      sources: [
        {
          getGrants: async () => ({
            permissions: {
              admin: ["access"],
              rbac: ["assignRoles", "manageRoles"],
              user: ["create", "list", "read", "update"],
            },
          }),
          name: "admin-user-role-editor",
        },
      ],
      statements: terrenoStatements,
      userModel: UserModel as unknown as UserModelType,
    });
    await accessControl.roles.seedDefaults();

    const localApp = buildApp(
      [
        {
          displayName: "Users",
          listFields: ["email", "roles"],
          model: UserModel,
          routePath: "/users",
        },
      ],
      {accessControl}
    );
    const agent = await authAsUser(localApp, "admin");
    const target = await UserModel.findOne({email: "notAdmin@example.com"});
    expect(target).toBeTruthy();

    const response = await agent
      .patch(`/admin/users/${String(target?._id)}`)
      .send({roles: ["member"]})
      .expect(200);

    expect(response.body.data.roles).toEqual(["member"]);
  });

  it("deletes a newly created User when role assignment fails", async () => {
    const accessControl = createAccess({
      connection: mongoose.connection,
      sources: [
        {
          getGrants: async () => ({
            permissions: {
              admin: ["access"],
              rbac: ["assignRoles"],
              user: ["create", "list", "read", "update"],
            },
          }),
          name: "admin-user-create",
        },
      ],
      statements: terrenoStatements,
      userModel: UserModel as unknown as UserModelType,
    });
    await accessControl.roles.seedDefaults();

    const localApp = buildApp(
      [
        {
          displayName: "Users",
          listFields: ["email"],
          model: UserModel,
          routePath: "/users",
        },
      ],
      {accessControl}
    );
    const agent = await authAsUser(localApp, "admin");
    const email = "rollback-roles@example.com";

    const res = await agent.post("/admin/users").send({email, roles: ["does-not-exist"]});
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await UserModel.findOne({email})).toBeNull();
  });

  it("does not persist other User fields when role assignment fails on update", async () => {
    if (!UserModel.schema.path("roles")) {
      UserModel.schema.add({
        roles: {default: [], description: "RBAC role names", type: [String]},
      });
    }
    const accessControl = createAccess({
      connection: mongoose.connection,
      sources: [
        {
          getGrants: async () => ({
            permissions: {
              admin: ["access"],
              rbac: ["assignRoles"],
              user: ["create", "list", "read", "update"],
            },
          }),
          name: "admin-user-update-rollback",
        },
      ],
      statements: terrenoStatements,
      userModel: UserModel as unknown as UserModelType,
    });
    await accessControl.roles.seedDefaults();

    const localApp = buildApp(
      [
        {
          displayName: "Users",
          listFields: ["email", "name", "roles"],
          model: UserModel,
          routePath: "/users",
        },
      ],
      {accessControl}
    );
    const agent = await authAsUser(localApp, "admin");
    const target = await UserModel.findOne({email: "notAdmin@example.com"});
    expect(target).toBeTruthy();
    const originalName = target?.name;

    const res = await agent
      .patch(`/admin/users/${String(target?._id)}`)
      .send({name: "Should-not-stick", roles: ["does-not-exist"]});
    expect(res.status).toBeGreaterThanOrEqual(400);

    const after = await UserModel.findById(target?._id);
    expect(after?.name).toBe(originalName);
  });

  it("does not persist bulk-patch fields when role assignment fails", async () => {
    if (!UserModel.schema.path("roles")) {
      UserModel.schema.add({
        roles: {default: [], description: "RBAC role names", type: [String]},
      });
    }
    const accessControl = createAccess({
      connection: mongoose.connection,
      sources: [
        {
          getGrants: async () => ({
            permissions: {
              admin: ["access"],
              rbac: ["assignRoles"],
              user: ["create", "list", "read", "update"],
            },
          }),
          name: "admin-user-bulk-rollback",
        },
      ],
      statements: terrenoStatements,
      userModel: UserModel as unknown as UserModelType,
    });
    await accessControl.roles.seedDefaults();

    const localApp = buildApp(
      [
        {
          bulkPatchAllowlist: ["name", "roles"],
          displayName: "Users",
          listFields: ["email", "name", "roles"],
          model: UserModel,
          routePath: "/users",
        },
      ],
      {accessControl}
    );
    const agent = await authAsUser(localApp, "admin");
    const target = await UserModel.findOne({email: "notAdmin@example.com"});
    expect(target).toBeTruthy();
    const originalName = target?.name;

    const res = await agent.post("/admin/users/bulk-patch").send({
      ids: [String(target?._id)],
      patch: {name: "Should-not-stick", roles: ["does-not-exist"]},
    });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(0);
    expect(res.body.failures?.length).toBeGreaterThan(0);

    const after = await UserModel.findById(target?._id);
    expect(after?.name).toBe(originalName);
  });
});
