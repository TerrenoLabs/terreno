import {describe, expect, test} from "bun:test";
import {assert} from "chai";

import {
  bootstrapPrompts,
  bootstrapTools,
  handleBootstrapPromptRequest,
  handleBootstrapToolCall,
} from "../bootstrap.js";

describe("bootstrap", () => {
  describe("bootstrapTools", () => {
    test("exports terreno_bootstrap_ai_rules and not terreno_bootstrap_app", () => {
      const names = bootstrapTools.map((t) => t.name);
      assert.include(names, "terreno_bootstrap_ai_rules");
      assert.notInclude(names, "terreno_bootstrap_app");
    });

    test("should have valid input schema structure", () => {
      for (const tool of bootstrapTools) {
        expect(tool.inputSchema.type).toBe("object");
        expect(tool.inputSchema.required).toContain("appName");
        expect(tool.inputSchema.required).toContain("appDisplayName");
      }
    });

    test("terreno_bootstrap_ai_rules should expose optional packages in inputSchema", () => {
      const tool = bootstrapTools.find((t) => t.name === "terreno_bootstrap_ai_rules");
      expect(tool).toBeDefined();
      const props = tool?.inputSchema.properties as Record<string, {type?: string}> | undefined;
      expect(props?.packages?.type).toBe("array");
    });
  });

  describe("bootstrapPrompts", () => {
    test("should export terreno_bootstrap prompt", () => {
      const names = bootstrapPrompts.map((p) => p.name);
      expect(names).toContain("terreno_bootstrap");
    });

    test("should have required arguments", () => {
      const prompt = bootstrapPrompts.find((p) => p.name === "terreno_bootstrap");
      expect(prompt).toBeDefined();
      const argNames = prompt?.arguments.map((a) => a.name);
      expect(argNames).toContain("appName");
      expect(argNames).toContain("appDisplayName");
    });
  });

  describe("handleBootstrapToolCall - terreno_bootstrap_ai_rules", () => {
    test("should return error when appName is missing", () => {
      const result = handleBootstrapToolCall("terreno_bootstrap_ai_rules", {
        appDisplayName: "My App",
      });
      expect(result.content[0].text).toContain("Error");
    });

    test("should return error when appDisplayName is missing", () => {
      const result = handleBootstrapToolCall("terreno_bootstrap_ai_rules", {
        appName: "my-app",
      });
      expect(result.content[0].text).toContain("Error");
    });

    test("should generate all AI rules files with required args", () => {
      const result = handleBootstrapToolCall("terreno_bootstrap_ai_rules", {
        appDisplayName: "Rules App",
        appName: "rules-app",
      });
      const text = result.content[0].text;

      expect(text).toContain("# Bootstrap AI Rules for Rules App");
      expect(text).toContain(".rulesync/rules/00-root.md");
      expect(text).toContain(".rulesync/rules/01-claudecode-root.md");
      expect(text).toContain("backend/AGENTS.md");
      expect(text).toContain("backend/CLAUDE.md");
      expect(text).toContain("frontend/AGENTS.md");
      expect(text).toContain("frontend/CLAUDE.md");
      expect(text).toContain("rulesync.jsonc");
    });

    test("should include setup instructions for rulesync", () => {
      const result = handleBootstrapToolCall("terreno_bootstrap_ai_rules", {
        appDisplayName: "R App",
        appName: "r-app",
      });
      expect(result.content[0].text).toContain("rulesync sync");
      expect(result.content[0].text).toContain("npm install -g rulesync");
    });

    test("should strip frontmatter from backend/frontend AGENTS files", () => {
      const result = handleBootstrapToolCall("terreno_bootstrap_ai_rules", {
        appDisplayName: "Strip App",
        appName: "strip-app",
      });
      const text = result.content[0].text;

      const backendAgentsMatch = text.match(
        /### `backend\/AGENTS\.md`\n\n```markdown\n([\s\S]*?)\n```/
      );
      expect(backendAgentsMatch).toBeTruthy();
      if (backendAgentsMatch) {
        expect(backendAgentsMatch[1].startsWith("---")).toBe(false);
        expect(backendAgentsMatch[1]).toContain("Strip App Backend");
      }
    });

    test("packages filter omits admin-backend guidelines from backend rules", () => {
      const filtered = handleBootstrapToolCall("terreno_bootstrap_ai_rules", {
        appDisplayName: "No Admin BE",
        appName: "no-admin-be",
        packages: ["api", "ui", "rtk"],
      });
      const filteredText = filtered.content[0].text;
      expect(filteredText).not.toContain("## Admin panel backend");

      const full = handleBootstrapToolCall("terreno_bootstrap_ai_rules", {
        appDisplayName: "With Admin BE",
        appName: "with-admin-be",
      });
      const fullText = full.content[0].text;
      expect(fullText).toContain("## Admin panel backend");
    });

    test("packages filter omits admin-frontend guidelines from frontend rules", () => {
      const filtered = handleBootstrapToolCall("terreno_bootstrap_ai_rules", {
        appDisplayName: "No Admin FE",
        appName: "no-admin-fe",
        packages: ["api", "ui", "rtk"],
      });
      const filteredText = filtered.content[0].text;
      expect(filteredText).not.toContain("## Admin panel frontend");

      const full = handleBootstrapToolCall("terreno_bootstrap_ai_rules", {
        appDisplayName: "With Admin FE",
        appName: "with-admin-fe",
      });
      const fullText = full.content[0].text;
      expect(fullText).toContain("## Admin panel frontend");
    });

    test("admin-only packages leave the root package reference without guidelines", () => {
      const result = handleBootstrapToolCall("terreno_bootstrap_ai_rules", {
        appDisplayName: "Admin Only",
        appName: "admin-only",
        packages: ["admin-backend", "admin-frontend"],
      });
      const text = result.content[0].text;
      expect(text).toContain(
        "## Package Reference\n\n_(No package guidelines matched the selected packages.)_"
      );
      expect(text).toContain("## Admin panel backend");
      expect(text).toContain("## Admin panel frontend");
    });

    test("includes SyncDB MCP debugging guidance when syncdb is selected", () => {
      const withSyncDb = handleBootstrapToolCall("terreno_bootstrap_ai_rules", {
        appDisplayName: "Sync App",
        appName: "sync-app",
        packages: ["syncdb"],
      });
      assert.include(withSyncDb.content[0].text, "get_syncdb_state");
      assert.include(withSyncDb.content[0].text, "debug-syncdb-with-mcp");

      const withoutSyncDb = handleBootstrapToolCall("terreno_bootstrap_ai_rules", {
        appDisplayName: "API App",
        appName: "api-app",
        packages: ["api"],
      });
      assert.notInclude(withoutSyncDb.content[0].text, "get_syncdb_state");
    });
  });

  describe("handleBootstrapToolCall - unknown", () => {
    test("should return error for unknown bootstrap tool", () => {
      const result = handleBootstrapToolCall("bootstrap_unknown", {});
      expect(result.content[0].text).toContain("Unknown bootstrap tool");
    });

    test("treats terreno_bootstrap_app as unknown", () => {
      const result = handleBootstrapToolCall("terreno_bootstrap_app", {
        appDisplayName: "Gone App",
        appName: "gone-app",
      });
      assert.include(result.content[0].text, "Unknown bootstrap tool");
      assert.notInclude(result.content[0].text, "Files to Create");
    });
  });

  describe("handleBootstrapPromptRequest", () => {
    test("should generate bootstrap prompt", () => {
      const result = handleBootstrapPromptRequest("terreno_bootstrap", {
        appDisplayName: "Prompt App",
        appName: "prompt-app",
      });
      const text = result.messages[0].content.text;

      expect(text).toContain("prompt-app");
      expect(text).toContain("Prompt App");
      expect(text).toContain("bunx create-terreno-app");
      expect(text).not.toContain("terreno_bootstrap_app");
      expect(text).toContain("terreno_bootstrap_ai_rules");
      expect(text).toContain("rulesync");
    });

    test("should return unknown message for unknown prompt", () => {
      const result = handleBootstrapPromptRequest("unknown_prompt", {});
      expect(result.messages[0].content.text).toContain("Unknown bootstrap prompt");
    });
  });
});
