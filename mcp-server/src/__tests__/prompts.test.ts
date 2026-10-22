import {describe, expect, test} from "bun:test";
import {handlePromptRequest, prompts} from "../prompts.js";

describe("prompts", () => {
  test("should export all required prompts", () => {
    const promptNames = prompts.map((p) => p.name);

    expect(promptNames).toContain("terreno_create_crud_feature");
    expect(promptNames).toContain("terreno_create_api_endpoint");
    expect(promptNames).toContain("terreno_create_ui_component");
    expect(promptNames).toContain("terreno_create_form_screen");
    expect(promptNames).toContain("terreno_add_authentication");
    expect(promptNames).toContain("terreno_style_guide");
    expect(promptNames).toContain("terreno_migrate_to_terreno_app");
    expect(promptNames).toContain("terreno_upgrade");
    expect(promptNames).toContain("terreno_bootstrap");
  });

  test("should have valid prompt structure", () => {
    for (const prompt of prompts) {
      expect(prompt.name).toBeDefined();
      expect(prompt.description).toBeDefined();

      if (prompt.arguments) {
        for (const arg of prompt.arguments) {
          expect(arg.name).toBeDefined();
          expect(arg.description).toBeDefined();
        }
      }
    }
  });

  describe("terreno_create_crud_feature", () => {
    test("should generate CRUD feature prompt", () => {
      const result = handlePromptRequest("terreno_create_crud_feature", {
        fields: "title:string,price:number",
        name: "Product",
      });

      const content = result.messages[0].content.text;

      expect(content).toContain("Product");
      expect(content).toContain("title: string");
      expect(content).toContain("price: number");
      expect(content).toContain("Model File");
      expect(content).toContain("Routes File");
      expect(content).toContain("List Screen");
      expect(content).toContain("Detail Screen");
      expect(content).toContain("Form Screen");
    });

    test("should include owner documentation when hasOwner is yes", () => {
      const result = handlePromptRequest("terreno_create_crud_feature", {
        fields: "title:string",
        hasOwner: "yes",
        name: "Todo",
      });

      const content = result.messages[0].content.text;

      expect(content).toContain("ownerId");
      expect(content).toContain("IsOwner");
      expect(content).toContain("OwnerQueryFilter");
      expect(content).toContain("preCreate");
    });

    test("should include code style requirements", () => {
      const result = handlePromptRequest("terreno_create_crud_feature", {
        fields: "name:string",
        name: "Item",
      });

      const content = result.messages[0].content.text;

      expect(content).toContain("const arrow functions");
      expect(content).toContain("Luxon");
      expect(content).toContain("interfaces");
      expect(content).toContain("useCallback");
    });
  });

  describe("terreno_create_api_endpoint", () => {
    test("should generate API endpoint prompt", () => {
      const result = handlePromptRequest("terreno_create_api_endpoint", {
        description: "Verify user email address",
        method: "POST",
        path: "/users/:id/verify",
      });

      const content = result.messages[0].content.text;

      expect(content).toContain("/users/:id/verify");
      expect(content).toContain("POST");
      expect(content).toContain("Verify user email address");
      expect(content).toContain("createOpenApiBuilder");
      expect(content).toContain("APIError");
      expect(content).toContain("authenticateMiddleware");
    });

    test("should include OpenAPI documentation requirements", () => {
      const result = handlePromptRequest("terreno_create_api_endpoint", {
        description: "Test endpoint",
        method: "GET",
        path: "/test",
      });

      const content = result.messages[0].content.text;

      expect(content).toContain("withTags");
      expect(content).toContain("withSummary");
      expect(content).toContain("response");
    });
  });

  describe("terreno_create_ui_component", () => {
    test("should generate display component prompt", () => {
      const result = handlePromptRequest("terreno_create_ui_component", {
        name: "UserCard",
        type: "display",
      });

      const content = result.messages[0].content.text;

      expect(content).toContain("UserCard");
      expect(content).toContain("display");
      expect(content).toContain("Display components");
      expect(content).toContain("React.FC");
    });

    test("should generate interactive component prompt", () => {
      const result = handlePromptRequest("terreno_create_ui_component", {
        name: "ToggleSwitch",
        type: "interactive",
      });

      const content = result.messages[0].content.text;

      expect(content).toContain("interactive");
      expect(content).toContain("Interactive components");
    });

    test("should generate form component prompt", () => {
      const result = handlePromptRequest("terreno_create_ui_component", {
        name: "SearchInput",
        type: "form",
      });

      const content = result.messages[0].content.text;

      expect(content).toContain("form");
      expect(content).toContain("Form components");
    });

    test("should generate layout component prompt", () => {
      const result = handlePromptRequest("terreno_create_ui_component", {
        name: "GridContainer",
        type: "layout",
      });

      const content = result.messages[0].content.text;

      expect(content).toContain("layout");
      expect(content).toContain("Layout components");
    });

    test("should include component best practices", () => {
      const result = handlePromptRequest("terreno_create_ui_component", {
        name: "Test",
        type: "display",
      });

      const content = result.messages[0].content.text;

      expect(content).toContain("useTheme");
      expect(content).toContain("useCallback");
      expect(content).toContain("useMemo");
    });
  });

  describe("terreno_create_form_screen", () => {
    test("should generate form screen prompt", () => {
      const result = handlePromptRequest("terreno_create_form_screen", {
        endpoint: "createProduct",
        fields: "title:text,price:number,description:textarea",
        name: "CreateProduct",
      });

      const content = result.messages[0].content.text;

      expect(content).toContain("CreateProductScreen");
      expect(content).toContain("useCreateProductMutation");
      expect(content).toContain('from "@/store/apiSdk"');
      expect(content).toContain("title: text");
      expect(content).toContain("price: number");
      expect(content).toContain("description: textarea");
    });

    test("should include required imports", () => {
      const result = handlePromptRequest("terreno_create_form_screen", {
        endpoint: "updateUser",
        fields: "name:text,email:email",
        name: "EditUser",
      });

      const content = result.messages[0].content.text;

      expect(content).toContain("TextField");
      expect(content).toContain("EmailField");
      expect(content).toContain("Button");
      expect(content).toContain("Page");
    });

    test("should include validation requirements", () => {
      const result = handlePromptRequest("terreno_create_form_screen", {
        endpoint: "createTest",
        fields: "name:text",
        name: "Test",
      });

      const content = result.messages[0].content.text;

      expect(content).toContain("Validation");
      expect(content).toContain("validate");
      expect(content).toContain("errors");
      expect(content).toContain(".unwrap()");
    });
  });

  describe("terreno_add_authentication", () => {
    test("should generate authentication prompt with email", () => {
      const result = handlePromptRequest("terreno_add_authentication", {
        features: "email",
      });

      const content = result.messages[0].content.text;

      expect(content).toContain("email");
      expect(content).toContain("User Model");
      expect(content).toContain("Better Auth Configuration");
      expect(content).toContain("Login Screen");
      expect(content).toContain("Signup Screen");
    });

    test("should include password reset when requested", () => {
      const result = handlePromptRequest("terreno_add_authentication", {
        features: "email,passwordReset",
      });

      const content = result.messages[0].content.text;

      expect(content).toContain("passwordReset");
      expect(content).toContain("Password Reset");
      expect(content).toContain("Better Auth password reset");
    });

    test("should include auth state management", () => {
      const result = handlePromptRequest("terreno_add_authentication", {});

      const content = result.messages[0].content.text;

      expect(content).toContain('import {useSession} from "@terreno/syncdb/auth";');
      expect(content).toContain("SessionProvider");
      expect(content).toContain("createApiClient");
      expect(content).toContain("await refresh();");
      expect(content).toContain("await logout();");
      expect(content).toContain("isAuthenticated");
      expect(content).not.toContain("@terreno/rtk");
      expect(content).not.toContain("generateBetterAuthSlice");
    });
  });

  describe("terreno_style_guide", () => {
    test("should return style guide", () => {
      const result = handlePromptRequest("terreno_style_guide", {});

      const content = result.messages[0].content.text;

      expect(content).toContain("Code Style Guide");
    });

    test("should include TypeScript guidelines", () => {
      const result = handlePromptRequest("terreno_style_guide", {});

      const content = result.messages[0].content.text;

      expect(content).toContain("TypeScript");
      expect(content).toContain("interface");
      expect(content).toContain("const arrow functions");
    });

    test("should include React guidelines", () => {
      const result = handlePromptRequest("terreno_style_guide", {});

      const content = result.messages[0].content.text;

      expect(content).toContain("React");
      expect(content).toContain("useCallback");
      expect(content).toContain("useMemo");
    });

    test("should include logging guidelines", () => {
      const result = handlePromptRequest("terreno_style_guide", {});

      const content = result.messages[0].content.text;

      expect(content).toContain("Logging");
      expect(content).toContain("console.info");
      expect(content).toContain("logger");
    });

    test("should include testing guidelines", () => {
      const result = handlePromptRequest("terreno_style_guide", {});

      const content = result.messages[0].content.text;

      expect(content).toContain("Testing");
      expect(content).toContain("bun test");
      expect(content).toContain("expect");
    });
  });

  describe("unknown prompt", () => {
    test("should return error for unknown prompt", () => {
      const result = handlePromptRequest("unknown_prompt", {});

      expect(result.messages[0].content.text).toContain("Unknown prompt");
    });
  });

  describe("terreno_migrate_to_terreno_app", () => {
    test("should return generic guide without serverFile", () => {
      const result = handlePromptRequest("terreno_migrate_to_terreno_app", {});
      const content = result.messages[0].content.text;

      expect(content.length).toBeGreaterThan(0);
      expect(content).not.toContain("Your Task");
    });

    test("should include task-specific instructions when serverFile is provided", () => {
      const result = handlePromptRequest("terreno_migrate_to_terreno_app", {
        serverFile: "src/myServer.ts",
      });
      const content = result.messages[0].content.text;

      expect(content).toContain("src/myServer.ts");
      expect(content).toContain("Your Task");
      expect(content).toContain("TerrenoApp.create");
      expect(content).toContain("HealthApp");
    });
  });

  describe("terreno_upgrade", () => {
    test("should include workflow steps", () => {
      const result = handlePromptRequest("terreno_upgrade", {targetVersion: "0.21.0"});
      const content = result.messages[0].content.text;
      expect(content).toContain("0.21.0");
      expect(content).toContain("terreno_get_upgrade_guide");
      expect(content).toContain("upgrading-expo");
      expect(content).toContain("upgrading-terreno");
    });
  });

  describe("terreno_bootstrap", () => {
    test("should delegate to bootstrap prompt handler", () => {
      const result = handlePromptRequest("terreno_bootstrap", {
        appDisplayName: "My Bootstrap App",
        appName: "my-bootstrap-app",
      });
      const content = result.messages[0].content.text;

      expect(content).toContain("my-bootstrap-app");
      expect(content).toContain("My Bootstrap App");
      expect(content).toContain("bunx create-terreno-app");
      expect(content).not.toContain("terreno_bootstrap_app");
      expect(content).toContain("terreno_bootstrap_ai_rules");
    });
  });
});
