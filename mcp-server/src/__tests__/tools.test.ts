import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import {spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {assert} from "chai";
import {handleToolCall, toCollectionName, tools} from "../tools.js";

// Run the CLI source with bun so the test does not depend on install-time bin links.
const blocksCli = fileURLToPath(new URL("../../../blocks/src/cli.ts", import.meta.url));

describe("tools", () => {
  test("should export all required tools", async () => {
    const toolNames = tools.map((t) => t.name);

    expect(toolNames).toContain("terreno_generate_model");
    expect(toolNames).toContain("terreno_generate_route");
    expect(toolNames).toContain("terreno_generate_screen");
    expect(toolNames).toContain("terreno_generate_form_fields");
    expect(toolNames).toContain("terreno_validate_model_schema");
    expect(toolNames).toContain("terreno_validate_ui_blocks");
    expect(toolNames).toContain("terreno_install_admin");
    expect(toolNames).toContain("terreno_bootstrap_ai_rules");
    expect(toolNames).toContain("terreno_search_docs");
    expect(toolNames).toContain("terreno_get_component_docs");
    expect(toolNames).toContain("terreno_get_upgrade_guide");
    expect(toolNames).toContain("terreno_search_update_notes");
    expect(toolNames).toContain("terreno_get_update_note");
    expect(toolNames).toContain("terreno_ask_update_help");
  });

  test("should have valid tool structure", async () => {
    for (const tool of tools) {
      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.properties).toBeDefined();
    }
  });

  describe("terreno_generate_model", () => {
    test("should generate basic model", async () => {
      const result = await handleToolCall("terreno_generate_model", {
        fields: [
          {name: "title", required: true, type: "String"},
          {name: "price", required: true, type: "Number"},
        ],
        name: "Product",
      });

      const content = result.content[0].text;

      expect(content).toContain("interface ProductDocument");
      expect(content).toContain("interface ProductModel");
      expect(content).toContain("productSchema");
      expect(content).toContain('strict: "throw"');
      expect(content).toContain("addDefaultPlugins");
      expect(content).toContain("title: { type: String");
      expect(content).toContain("price: { type: Number");
    });

    test("should generate model with owner", async () => {
      const result = await handleToolCall("terreno_generate_model", {
        fields: [{name: "title", required: true, type: "String"}],
        hasOwner: true,
        name: "Todo",
      });

      const content = result.content[0].text;

      expect(content).toContain("ownerId");
      expect(content).toContain('ref: "User"');
      expect(content).toContain("mongoose.Types.ObjectId");
    });

    test("should generate model with soft delete", async () => {
      const result = await handleToolCall("terreno_generate_model", {
        fields: [{name: "name", type: "String"}],
        name: "Item",
        softDelete: true,
      });

      const content = result.content[0].text;

      expect(content).toContain("isDeletedPlugin");
    });

    test("should handle field with reference", async () => {
      const result = await handleToolCall("terreno_generate_model", {
        fields: [{name: "userId", ref: "User", required: true, type: "ObjectId"}],
        name: "Order",
      });

      const content = result.content[0].text;

      expect(content).toContain("mongoose.Schema.Types.ObjectId");
      expect(content).toContain('ref: "User"');
    });

    test("should handle field with default value", async () => {
      const result = await handleToolCall("terreno_generate_model", {
        fields: [{default: "true", name: "active", type: "Boolean"}],
        name: "Setting",
      });

      const content = result.content[0].text;

      expect(content).toContain("default: true");
    });
  });

  describe("terreno_generate_route", () => {
    test("should generate basic route", async () => {
      const result = await handleToolCall("terreno_generate_route", {
        modelName: "Product",
        routePath: "/products",
      });

      const content = result.content[0].text;

      expect(content).toContain("addProductRoutes");
      expect(content).toContain("modelRouter");
      expect(content).toContain('"/products"');
      expect(content).toContain("Permissions.IsAuthenticated");
    });

    test("should generate route with custom permissions", async () => {
      const result = await handleToolCall("terreno_generate_route", {
        modelName: "Post",
        permissions: {
          create: "authenticated",
          delete: "admin",
          list: "any",
          read: "any",
          update: "owner",
        },
        routePath: "/posts",
      });

      const content = result.content[0].text;

      expect(content).toContain("Permissions.IsAny");
      expect(content).toContain("Permissions.IsOwner");
      expect(content).toContain("Permissions.IsAdmin");
    });

    test("should generate route with owner filter", async () => {
      const result = await handleToolCall("terreno_generate_route", {
        modelName: "Task",
        ownerFiltered: true,
        routePath: "/tasks",
      });

      const content = result.content[0].text;

      expect(content).toContain("OwnerQueryFilter");
      expect(content).toContain("preCreate");
      expect(content).toContain("ownerId");
      expect(content).toContain("UserDocument");
    });

    test("should generate route with query fields", async () => {
      const result = await handleToolCall("terreno_generate_route", {
        modelName: "Item",
        queryFields: ["status", "category"],
        routePath: "/items",
      });

      const content = result.content[0].text;

      expect(content).toContain('queryFields: ["status","category"]');
    });

    test("should generate route with sort", async () => {
      const result = await handleToolCall("terreno_generate_route", {
        modelName: "Event",
        routePath: "/events",
        sort: "-startDate",
      });

      const content = result.content[0].text;

      expect(content).toContain('sort: "-startDate"');
    });
  });

  describe("terreno_generate_screen", () => {
    test("should generate empty screen", async () => {
      const result = await handleToolCall("terreno_generate_screen", {
        name: "Dashboard",
        type: "empty",
      });

      const content = result.content[0].text;

      expect(content).toContain("DashboardScreen");
      expect(content).toContain("Page");
      expect(content).toContain("Box");
      expect(content).toContain("Text");
    });

    test("should generate list screen", async () => {
      const result = await handleToolCall("terreno_generate_screen", {
        fields: ["title", "price"],
        modelName: "Product",
        name: "ProductList",
        type: "list",
      });

      const content = result.content[0].text;

      expect(content).toContain("ProductListScreen");
      expect(content).toContain('import { useQuery, useSyncStatus } from "@terreno/syncdb/react";');
      expect(content).toContain('useQuery<ProductRow>("products")');
      expect(content).toContain("item.title");
      expect(content).toContain("isSyncing");
      expect(content).not.toContain("openApiSdk");
      expect(content).toContain("SYNC_COLLECTIONS");
      expect(content).toContain("@/store/apiSdk");
    });

    test("should generate form screen", async () => {
      const result = await handleToolCall("terreno_generate_screen", {
        fields: ["title", "description"],
        modelName: "Product",
        name: "CreateProduct",
        type: "form",
      });

      const content = result.content[0].text;

      expect(content).toContain("CreateProductScreen");
      expect(content).toContain('const {create} = useMutate("products");');
      expect(content).toContain("create({data: { title, description }});");
      expect(content).not.toContain("openApiSdk");
      expect(content).toContain("useState");
      expect(content).toContain("TextField");
      expect(content).toContain("handleSubmit");
      expect(content).toContain("FormErrors");
    });

    test("should generate detail screen", async () => {
      const result = await handleToolCall("terreno_generate_screen", {
        fields: ["title", "price", "description"],
        modelName: "Product",
        name: "ProductDetail",
        type: "detail",
      });

      const content = result.content[0].text;

      expect(content).toContain("ProductDetailScreen");
      expect(content).toContain('useEntity<ProductRow>("products", id ?? "")');
      expect(content).not.toContain("openApiSdk");
      expect(content).toContain("useLocalSearchParams");
      expect(content).toContain("item.title");
      expect(content).toContain("item.price");
    });
  });

  describe("terreno_generate_form_fields", () => {
    test("should generate text field", async () => {
      const result = await handleToolCall("terreno_generate_form_fields", {
        fields: [{label: "Full Name", name: "name", type: "text"}],
      });

      const content = result.content[0].text;

      expect(content).toContain("TextField");
      expect(content).toContain('title="Full Name"');
      expect(content).toContain("value={name}");
      expect(content).toContain("onChange={setName}");
    });

    test("should generate email field", async () => {
      const result = await handleToolCall("terreno_generate_form_fields", {
        fields: [{name: "email", required: true, type: "email"}],
      });

      const content = result.content[0].text;

      expect(content).toContain("EmailField");
      expect(content).toContain("errorText={errors.email}");
    });

    test("should generate select field with options", async () => {
      const result = await handleToolCall("terreno_generate_form_fields", {
        fields: [
          {
            name: "country",
            options: [
              {label: "USA", value: "us"},
              {label: "Canada", value: "ca"},
            ],
            type: "select",
          },
        ],
      });

      const content = result.content[0].text;

      expect(content).toContain("SelectField");
      expect(content).toContain("USA");
      expect(content).toContain("Canada");
      expect(content).toContain("onChange={setCountry}");
      expect(content).not.toContain("onChangeValue");
      expect(content).not.toContain('label="Country"');
    });

    test("should generate boolean field", async () => {
      const result = await handleToolCall("terreno_generate_form_fields", {
        fields: [{name: "active", type: "boolean"}],
      });

      const content = result.content[0].text;

      expect(content).toContain("BooleanField");
      expect(content).toContain("useState(false)");
    });

    test("should generate date field", async () => {
      const result = await handleToolCall("terreno_generate_form_fields", {
        fields: [{name: "birthDate", type: "date"}],
      });

      const content = result.content[0].text;

      expect(content).toContain("DateTimeField");
      expect(content).toContain('type="date"');
    });

    test("should generate multiple fields", async () => {
      const result = await handleToolCall("terreno_generate_form_fields", {
        fields: [
          {name: "name", type: "text"},
          {name: "email", type: "email"},
          {name: "age", type: "number"},
        ],
      });

      const content = result.content[0].text;

      expect(content).toContain("TextField");
      expect(content).toContain("EmailField");
      expect(content).toContain("NumberField");
    });
  });

  describe("terreno_validate_model_schema", () => {
    test("should pass valid schema", async () => {
      const validSchema = `
        const schema = new mongoose.Schema({
          name: { type: String }
        }, {
          strict: "throw",
          toJSON: { virtuals: true },
          toObject: { virtuals: true },
        });
        addDefaultPlugins(schema);
        interface MyDocument extends mongoose.Document {}
      `;

      const result = await handleToolCall("terreno_validate_model_schema", {
        schema: validSchema,
      });

      expect(result.content[0].text).toContain("✓");
    });

    test("should detect missing strict throw", async () => {
      const schema = `
        const schema = new mongoose.Schema({
          name: { type: String }
        });
      `;

      const result = await handleToolCall("terreno_validate_model_schema", {schema});

      expect(result.content[0].text).toContain("strict");
    });

    test("should detect missing virtuals", async () => {
      const schema = `
        const schema = new mongoose.Schema({}, {
          strict: "throw"
        });
      `;

      const result = await handleToolCall("terreno_validate_model_schema", {schema});

      expect(result.content[0].text).toContain("virtuals");
    });

    test("should detect missing plugins", async () => {
      const schema = `
        const schema = new mongoose.Schema({}, {
          strict: "throw",
          toJSON: { virtuals: true }
        });
      `;

      const result = await handleToolCall("terreno_validate_model_schema", {schema});

      expect(result.content[0].text).toContain("plugins");
    });

    test("should detect findOne usage", async () => {
      const schema = `
        schema.statics.findByEmail = function(email) {
          return this.findOne({ email });
        };
      `;

      const result = await handleToolCall("terreno_validate_model_schema", {schema});

      expect(result.content[0].text).toContain("findOne");
      expect(result.content[0].text).toContain("findOneOrThrow");
    });

    const conventionalOptions = `{
          strict: "throw",
          toJSON: {virtuals: true},
          toObject: {virtuals: true},
        }`;

    test("accepts Document and Model types imported from src/types/models/", async () => {
      // The example backend layout: types live in src/types/models/todoTypes.ts.
      const schema = `
        import mongoose from "mongoose";
        import type {TodoDocument, TodoModel} from "../types/models/todoTypes";
        import {addDefaultPlugins} from "./modelPlugins";

        const todoSchema = new mongoose.Schema<TodoDocument, TodoModel>({
          title: {description: "Title", type: String},
        }, ${conventionalOptions});
        addDefaultPlugins(todoSchema);
      `;

      const result = await handleToolCall("terreno_validate_model_schema", {schema});

      expect(result.content[0].text).not.toContain("Missing TypeScript interfaces");
      expect(result.content[0].text).toContain("✓");
    });

    test("accepts Document and Model types imported from modelInterfaces", async () => {
      const schema = `
        import mongoose from "mongoose";
        import {
          UserDocument,
          UserModel,
        } from "../modelInterfaces";

        const userSchema = new mongoose.Schema<UserDocument, UserModel>({}, ${conventionalOptions});
        addDefaultPlugins(userSchema);
      `;

      const result = await handleToolCall("terreno_validate_model_schema", {schema});

      expect(result.content[0].text).not.toContain("Missing TypeScript interfaces");
    });

    test("accepts the create-terreno-app types barrel and inline type aliases", async () => {
      const fromTypes = `
        import type {UserDocument, UserModel} from "../types";
        const userSchema = new mongoose.Schema<UserDocument, UserModel>({}, ${conventionalOptions});
        addDefaultPlugins(userSchema);
      `;
      const inlineAlias = `
        export type NoteDocument = DefaultDoc & {body: string};
        const noteSchema = new mongoose.Schema<NoteDocument>({}, ${conventionalOptions});
        addDefaultPlugins(noteSchema);
      `;

      for (const schema of [fromTypes, inlineAlias]) {
        const result = await handleToolCall("terreno_validate_model_schema", {schema});
        expect(result.content[0].text).not.toContain("Missing TypeScript interfaces");
      }
    });

    test("still reports missing types when the model has none", async () => {
      // mongoose's own Document types are not the model's Document type.
      const schema = `
        import mongoose, {type HydratedDocument, Document} from "mongoose";
        const todoSchema = new mongoose.Schema({
          title: {description: "Title", type: String},
        }, ${conventionalOptions});
        addDefaultPlugins(todoSchema);
      `;

      const result = await handleToolCall("terreno_validate_model_schema", {schema});

      expect(result.content[0].text).toContain("Missing TypeScript interfaces");
      expect(result.content[0].text).toContain("src/types/models/");
    });

    test("should detect Date usage", async () => {
      const schema = `
        const timestamp = new Date();
      `;

      const result = await handleToolCall("terreno_validate_model_schema", {schema});

      expect(result.content[0].text).toContain("Luxon");
    });
  });

  describe("unknown tool", () => {
    test("should return error for unknown tool", async () => {
      const result = await handleToolCall("unknown_tool", {});

      expect(result.content[0].text).toContain("Unknown tool");
    });
  });

  describe("terreno_generate_model edge cases", () => {
    test("should generate interface types for non-string fields", async () => {
      const result = await handleToolCall("terreno_generate_model", {
        fields: [
          {name: "count", required: true, type: "Number"},
          {name: "isActive", required: true, type: "Boolean"},
          {name: "startDate", required: false, type: "Date"},
          {name: "ownerId", ref: "User", required: true, type: "ObjectId"},
          {name: "tags", required: false, type: "Array"},
        ],
        name: "Event",
      });
      const content = result.content[0].text;

      expect(content).toContain("count: number");
      expect(content).toContain("isActive: boolean");
      expect(content).toContain("startDate?: Date");
      expect(content).toContain("ownerId: mongoose.Types.ObjectId");
      expect(content).toContain("tags?: unknown[]");
      expect(content).toContain('ref: "User"');
    });

    test("should support hasOwner and softDelete options", async () => {
      const result = await handleToolCall("terreno_generate_model", {
        fields: [{name: "title", required: true, type: "String"}],
        hasOwner: true,
        name: "Article",
        softDelete: true,
      });
      const content = result.content[0].text;

      expect(content).toContain("ownerId: mongoose.Types.ObjectId");
      expect(content).toContain('ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User"');
      expect(content).toContain("isDeletedPlugin");
      expect(content).toContain("articleSchema.plugin(isDeletedPlugin)");
    });

    test("should support unique and default field props", async () => {
      const result = await handleToolCall("terreno_generate_model", {
        fields: [
          {name: "email", required: true, type: "String", unique: true},
          {default: "0", name: "count", required: false, type: "Number"},
        ],
        name: "Account",
      });
      const content = result.content[0].text;

      expect(content).toContain("unique: true");
      expect(content).toContain("default: 0");
    });
  });

  describe("terreno_generate_route edge cases", () => {
    test("should generate route with ownerFiltered", async () => {
      const result = await handleToolCall("terreno_generate_route", {
        modelName: "Task",
        ownerFiltered: true,
        permissions: {
          create: "owner",
          delete: "admin",
          list: "any",
          read: "authOrReadOnly",
          update: "authenticated",
        },
        queryFields: ["title", "status"],
        routePath: "/tasks",
      });
      const content = result.content[0].text;

      expect(content).toContain("OwnerQueryFilter");
      expect(content).toContain("UserDocument");
      expect(content).toContain("Permissions.IsOwner");
      expect(content).toContain("Permissions.IsAdmin");
      expect(content).toContain("Permissions.IsAny");
      expect(content).toContain("Permissions.IsAuthenticatedOrReadOnly");
      expect(content).toContain('queryFields: ["title","status"]');
      expect(content).toContain("preCreate");
    });
  });

  describe("terreno_generate_screen edge cases", () => {
    test("should fall back to empty template when type needs modelName but none given", async () => {
      const result = await handleToolCall("terreno_generate_screen", {
        name: "Orphan",
        type: "list",
      });
      const content = result.content[0].text;

      expect(content).toContain('Screen type "list" not fully supported');
      expect(content).toContain("OrphanScreen");
    });
  });

  describe("terreno_generate_form_fields edge cases", () => {
    test("should generate password field", async () => {
      const result = await handleToolCall("terreno_generate_form_fields", {
        fields: [{label: "Password", name: "password", required: true, type: "password"}],
      });
      const content = result.content[0].text;

      // PasswordField is a placeholder with no props; TextField type="password" is the real one.
      expect(content).not.toContain("PasswordField");
      expect(content).toContain('type="password"');
      expect(content).toContain('title="Password"');
      expect(content).toContain("errorText={errors.password}");
    });

    test("should generate textarea field", async () => {
      const result = await handleToolCall("terreno_generate_form_fields", {
        fields: [{name: "bio", type: "textarea"}],
      });
      const content = result.content[0].text;

      expect(content).toContain("TextArea");
    });

    test("should generate datetime field", async () => {
      const result = await handleToolCall("terreno_generate_form_fields", {
        fields: [{name: "scheduledAt", type: "datetime"}],
      });
      const content = result.content[0].text;

      expect(content).toContain("DateTimeField");
      expect(content).toContain('type="datetime"');
    });

    test("should generate select field with empty options", async () => {
      const result = await handleToolCall("terreno_generate_form_fields", {
        fields: [{name: "category", type: "select"}],
      });
      const content = result.content[0].text;

      expect(content).toContain("SelectField");
      expect(content).toContain("options={[]}");
    });
  });

  describe("toCollectionName", () => {
    test("derives kebab-case plural collection names from model names", () => {
      expect(toCollectionName("Product")).toBe("products");
      expect(toCollectionName("TodoItem")).toBe("todo-items");
      expect(toCollectionName("Category")).toBe("categories");
      expect(toCollectionName("Day")).toBe("days");
      expect(toCollectionName("Settings")).toBe("settings");
    });

    test("screen tool honors an explicit collection", async () => {
      const result = await handleToolCall("terreno_generate_screen", {
        collection: "catalog-products",
        modelName: "Product",
        name: "Catalog",
        type: "list",
      });
      expect(result.content[0].text).toContain('useQuery<ProductRow>("catalog-products")');
    });
  });

  describe("terreno_install_admin", () => {
    test("should generate admin panel files and instructions", async () => {
      const result = await handleToolCall("terreno_install_admin", {
        models: [
          {
            displayName: "Todos",
            listFields: ["title", "completed"],
            modelName: "Todo",
            routePath: "/todos",
          },
          {
            displayName: "Users",
            listFields: ["email"],
            modelName: "User",
            routePath: "/users",
          },
        ],
      });
      const content = result.content[0].text;

      expect(content).toContain("# Install Admin Panel");
      expect(content).toContain("frontend/app/(tabs)/admin/_layout.tsx");
      expect(content).toContain("<AdminProvider");
      expect(content).toContain("getAuthHeaders={getAdminAuthHeaders}");
      expect(content).toContain('import {baseUrl} from "@terreno/syncdb/config";');
      expect(content).toContain('import {authProvider} from "@/store/syncdb";');
      expect(content).toContain("await authProvider.getToken()");
      expect(content).not.toContain("@terreno/rtk");
      expect(content).not.toContain("api={");
      expect(content).toContain("frontend/app/(tabs)/admin/index.tsx");
      expect(content).toContain("frontend/app/(tabs)/admin/[model].tsx");
      expect(content).toContain("frontend/app/(tabs)/admin/[model]/create.tsx");
      expect(content).toContain("frontend/app/(tabs)/admin/[model]/[id].tsx");
      expect(content).toContain("AdminModelList");
      expect(content).toContain("AdminModelTable");
      expect(content).toContain("AdminModelForm");
      expect(content).toContain("@terreno/admin-backend");
      expect(content).toContain("@terreno/admin-frontend");
      expect(content).toContain("import {Todo, User} from");
      expect(content).toContain('displayName: "Todos"');
      expect(content).toContain('routePath: "/todos"');
      expect(content).toContain('["title","completed"]');
    });
  });

  describe("handleToolCall - bootstrap dispatch", () => {
    test("does not expose terreno_bootstrap_app", async () => {
      const result = await handleToolCall("terreno_bootstrap_app", {
        appDisplayName: "Dispatch App",
        appName: "dispatch-app",
      });
      assert.include(result.content[0].text, "Unknown tool");
    });

    test("should delegate terreno_bootstrap_ai_rules to bootstrap handler", async () => {
      const result = await handleToolCall("terreno_bootstrap_ai_rules", {
        appDisplayName: "Rules App",
        appName: "rules-app",
      });
      expect(result.content[0].text).toContain("Bootstrap AI Rules for Rules App");
    });
  });

  describe("terreno_search_docs and terreno_get_component_docs", () => {
    test("should reject terreno_search_docs when queries is not an array of strings", async () => {
      const bad = await handleToolCall("terreno_search_docs", {queries: "modelRouter"});
      expect(bad.content[0].text).toContain("must be an array of strings");

      const bad2 = await handleToolCall("terreno_search_docs", {queries: [1, 2]});
      expect(bad2.content[0].text).toContain("must be an array of strings");
    });

    test("should run terreno_search_docs with valid arguments", async () => {
      const ok = await handleToolCall("terreno_search_docs", {
        packages: ["api"],
        queries: ["Terreno"],
        tokenLimit: 2000,
      });
      expect(ok.content[0].text).toContain("Terreno documentation search results");
    }, 15_000);

    test("should run terreno_get_component_docs with component name", async () => {
      const out = await handleToolCall("terreno_get_component_docs", {component: "Button"});
      expect(out.content[0].text.length).toBeGreaterThan(0);
    });
  });

  describe("terreno_get_upgrade_guide", () => {
    test("should require fromVersion and toVersion", async () => {
      const out = await handleToolCall("terreno_get_upgrade_guide", {fromVersion: "0.20.0"});
      expect(out.content[0].text).toContain("fromVersion");
    });

    test("should return bundled upgrade markdown for a range", async () => {
      const out = await handleToolCall("terreno_get_upgrade_guide", {
        fromVersion: "0.20.0",
        toVersion: "0.20.0",
      });
      expect(out.content[0].text).toContain("0.20.0");
    });

    test("should describe a fully covered range", async () => {
      const out = await handleToolCall("terreno_get_upgrade_guide", {
        fromVersion: "0.19.0",
        toVersion: "0.20.0",
      });
      expect(out.content[0].text).toContain("Recorded notes in 0.19.0 → 0.20.0: 0.20.0");
    });

    test("should describe a partially covered range", async () => {
      const out = await handleToolCall("terreno_get_upgrade_guide", {
        fromVersion: "0.21.0",
        toVersion: "0.31.0",
      });
      expect(out.content[0].text).toContain("Recorded notes in 0.21.0 → 0.31.0: 0.30.0, 0.31.0");
      expect(out.content[0].text).toContain("No bundled notes for 0.22.0");
    });

    test("should name versions when a range has no notes", async () => {
      const out = await handleToolCall("terreno_get_upgrade_guide", {
        fromVersion: "99.0.0",
        toVersion: "99.1.0",
      });
      expect(out.content[0].text).toContain("No upgrade notes recorded for 99.0.0 → 99.1.0");
      expect(out.content[0].text).toContain("Do not conclude that nothing changed");
    });

    test("should reject an inverted version range", async () => {
      const out = await handleToolCall("terreno_get_upgrade_guide", {
        fromVersion: "0.21.0",
        toVersion: "0.20.0",
      });
      expect(out.content[0].text).toContain("Invalid version range");
    });
  });

  describe("terreno_validate_ui_blocks", () => {
    const cliReport = (document: string): string => {
      const result = spawnSync(process.execPath, [blocksCli, "validate", "-"], {
        encoding: "utf8",
        input: document,
      });
      return result.stdout;
    };

    test("lists a document argument", () => {
      const tool = tools.find((entry) => entry.name === "terreno_validate_ui_blocks");
      expect(tool?.inputSchema).toEqual({
        properties: {
          document: {
            description: "Whole-reply YAML or JSON block document",
            type: "string",
          },
        },
        required: ["document"],
        type: "object",
      });
    });

    test("matches the CLI report for a valid document", async () => {
      const document = "v: 1\nblocks:\n  - type: heading\n    text: Hello\n";
      const out = await handleToolCall("terreno_validate_ui_blocks", {document});
      expect(out.content[0].text).toBe(cliReport(document));
    });

    test("matches the CLI report for an invalid document", async () => {
      const document = "v: 1\nblocks:\n  - type: heading\n    color: red\n";
      const out = await handleToolCall("terreno_validate_ui_blocks", {document});
      expect(out.content[0].text).toBe(cliReport(document));
      expect(out.content[0].text).toContain("UNKNOWN_KEY");
    });

    test("asks for a document when the argument is missing", async () => {
      const out = await handleToolCall("terreno_validate_ui_blocks", {});
      expect(out.content[0].text).toBe("document is required\n");
    });

    test("matches the CLI report for a document that does not parse", async () => {
      const document = "v: 1\nblocks: [\n";
      const out = await handleToolCall("terreno_validate_ui_blocks", {document});
      expect(out.content[0].text.length).toBeGreaterThan(0);
      expect(out.content[0].text).toBe(cliReport(document));
    });

    test("matches the CLI report for a valid document with warnings", async () => {
      const document = [
        "v: 1",
        "datasets:",
        "  signups:",
        "    columns:",
        "      - name: month",
        "        type: string",
        "      - name: count",
        "        type: number",
        "    rows:",
        "      - [Jan, 1]",
        "blocks:",
        "  - type: chart",
        "    kind: line",
        "    data: signups",
        "    x: month",
        "    y: count",
        "",
      ].join("\n");
      const out = await handleToolCall("terreno_validate_ui_blocks", {document});
      expect(out.content[0].text).toContain("LINE_SINGLE_POINT");
      expect(out.content[0].text).toBe(cliReport(document));
    });
  });
  describe("update note tools", () => {
    let docsDir: string;
    let previousDocsDir: string | undefined;
    let previousHelpApiUrl: string | undefined;

    beforeEach((): void => {
      docsDir = mkdtempSync(join(tmpdir(), "terreno-mcp-update-tools-"));
      mkdirSync(join(docsDir, "upgrades"), {recursive: true});
      writeFileSync(join(docsDir, "upgrades", "57.3.0.md"), "# Billing\n\nStripe webhooks moved.");
      writeFileSync(join(docsDir, "upgrades", "57.4.0.md"), "# Popover\n\nPopover added.");
      previousDocsDir = process.env.TERRENO_MCP_DOCS_DIR;
      previousHelpApiUrl = process.env.TERRENO_HELP_API_URL;
      process.env.TERRENO_MCP_DOCS_DIR = docsDir;
      Reflect.deleteProperty(process.env, "TERRENO_HELP_API_URL");
    });

    afterEach((): void => {
      rmSync(docsDir, {force: true, recursive: true});
      if (previousDocsDir === undefined) {
        Reflect.deleteProperty(process.env, "TERRENO_MCP_DOCS_DIR");
      } else {
        process.env.TERRENO_MCP_DOCS_DIR = previousDocsDir;
      }
      if (previousHelpApiUrl !== undefined) {
        process.env.TERRENO_HELP_API_URL = previousHelpApiUrl;
      }
    });

    test("searches bundled notes with string queries and a question", async () => {
      const out = await handleToolCall("terreno_search_update_notes", {
        includeArchived: true,
        limit: 1,
        queries: ["stripe", 42],
        question: "billing",
        source: "bundled",
      });
      const payload = JSON.parse(out.content[0].text) as {
        hits: Array<{id: string}>;
        sources: string[];
      };
      expect(payload.sources).toEqual(["bundled-upgrades"]);
      expect(payload.hits.map((hit) => hit.id)).toEqual(["upgrade:57.3.0"]);
    });

    test("falls back to auto search for an unknown source and no queries", async () => {
      const out = await handleToolCall("terreno_search_update_notes", {
        queries: "billing",
        source: "everywhere",
      });
      const payload = JSON.parse(out.content[0].text) as {
        hits: Array<{id: string}>;
        sources: string[];
      };
      // Without TERRENO_HELP_API_URL, auto mode searches only bundled notes, newest first.
      expect(payload.sources).toEqual(["bundled-upgrades"]);
      expect(payload.hits.map((hit) => hit.id)).toEqual(["upgrade:57.4.0", "upgrade:57.3.0"]);
    });

    test("requires an id to fetch an update note", async () => {
      const out = await handleToolCall("terreno_get_update_note", {id: "   "});
      expect(out.content[0].text).toContain("Provide an `id`");
    });

    test("fetches a bundled upgrade note by prefixed id or bare version", async () => {
      for (const id of ["upgrade:57.3.0", " 57.3.0 "]) {
        const out = await handleToolCall("terreno_get_update_note", {id});
        const detail = JSON.parse(out.content[0].text) as {
          body: string;
          id: string;
          kind: string;
        };
        expect(detail.id).toBe("upgrade:57.3.0");
        expect(detail.kind).toBe("upgrade");
        expect(detail.body).toContain("Stripe webhooks moved.");
      }
    });

    test("answers update help questions with matches", async () => {
      const out = await handleToolCall("terreno_ask_update_help", {limit: 3, question: "popover"});
      expect(out.content[0].text).toContain("Question: popover");
      expect(out.content[0].text).toContain("upgrade:57.4.0");
    });

    test("explains when no update notes match the question", async () => {
      const out = await handleToolCall("terreno_ask_update_help", {question: "qqqzzzxxyy"});
      expect(out.content[0].text).toContain('No update notes matched: "qqqzzzxxyy"');
      expect(out.content[0].text).toContain("Sources searched: bundled-upgrades");
    });

    test("asks for a question when none is given", async () => {
      const out = await handleToolCall("terreno_ask_update_help", {question: 7});
      expect(out.content[0].text).toBe("Provide a non-empty `question` string.");
    });
  });
});
