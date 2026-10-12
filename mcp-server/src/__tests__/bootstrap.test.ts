import {describe, expect, test} from "bun:test";
import {existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {assert} from "chai";

import {
  bootstrapPrompts,
  bootstrapTools,
  generateAiRulesFiles,
  handleBootstrapPromptRequest,
  handleBootstrapToolCall,
  RULESYNC_GENERATE_COMMAND,
  RULESYNC_OVERWRITE_WARNING,
  RULESYNC_TARGETS,
} from "../bootstrap.js";

const RULESYNC_RULE_PREFIX = ".rulesync/rules/";

const findFile = (files: Array<{path: string; content: string}>, path: string): string => {
  const file = files.find((f) => f.path === path);
  assert.exists(file, `missing ${path}`);
  return file?.content ?? "";
};

const parseFrontmatter = (content: string): string => {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  return match?.[1] ?? "";
};

const writeFiles = (root: string, files: Array<{path: string; content: string}>): void => {
  for (const file of files) {
    const target = join(root, file.path);
    mkdirSync(dirname(target), {recursive: true});
    writeFileSync(target, file.content);
  }
};

const runRulesyncGenerate = (cwd: string): {exitCode: number; output: string} => {
  const rulesyncDir = dirname(Bun.resolveSync("rulesync/package.json", import.meta.dir));
  const result = Bun.spawnSync({
    cmd: [process.execPath, join(rulesyncDir, "dist/cli/index.js"), "generate"],
    cwd,
    env: {...process.env, NO_COLOR: "1"},
  });
  return {
    exitCode: result.exitCode,
    output: `${result.stdout.toString()}${result.stderr.toString()}`,
  };
};

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
      expect(text).toContain("backend/AGENTS.md");
      expect(text).toContain("backend/CLAUDE.md");
      expect(text).toContain("frontend/AGENTS.md");
      expect(text).toContain("frontend/CLAUDE.md");
      expect(text).toContain("rulesync.jsonc");
    });

    test("instructions run rulesync generate, not the removed sync command", () => {
      const result = handleBootstrapToolCall("terreno_bootstrap_ai_rules", {
        appDisplayName: "R App",
        appName: "r-app",
      });
      const text = result.content[0].text;
      assert.equal(RULESYNC_GENERATE_COMMAND, "bunx rulesync@9 generate");
      assert.include(text, RULESYNC_GENERATE_COMMAND);
      assert.notInclude(text, "rulesync sync");
      assert.notInclude(text, "npm install -g rulesync");
      assert.notInclude(text, ".windsurfrules");
      assert.include(text, ".rulesync/rules/10-project.md");
    });

    test("instructions warn that generate overwrites hand edits before running it", () => {
      const text = handleBootstrapToolCall("terreno_bootstrap_ai_rules", {
        appDisplayName: "Warn App",
        appName: "warn-app",
      }).content[0].text;
      for (const path of [
        "CLAUDE.md",
        "AGENTS.md",
        ".claude/rules/",
        ".cursor/rules/",
        ".github/instructions/",
        ".rulesync/rules/10-project.md",
      ]) {
        assert.include(RULESYNC_OVERWRITE_WARNING, path);
      }
      const warningAt = text.indexOf(RULESYNC_OVERWRITE_WARNING);
      const cursorrulesAt = text.indexOf("Delete the stale `.cursorrules`");
      const generateAt = text.indexOf(`   ${RULESYNC_GENERATE_COMMAND}`);
      assert.isAbove(warningAt, -1);
      assert.isAbove(cursorrulesAt, -1);
      assert.isAbove(generateAt, warningAt);
      assert.isAbove(generateAt, cursorrulesAt);
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

  describe("generateAiRulesFiles - rulesync output", () => {
    const files = generateAiRulesFiles({appDisplayName: "Sync Rules", appName: "sync-rules"});

    test("rulesync.jsonc lists only targets rulesync 9 accepts", () => {
      const config = JSON.parse(findFile(files, "rulesync.jsonc"));
      assert.deepEqual(config.targets, ["cursor", "claudecode", "copilot", "agentsmd"]);
      assert.deepEqual(config.targets, [...RULESYNC_TARGETS]);
      assert.notInclude(config.targets, "windsurf");
      assert.deepEqual(config.features, ["rules"]);
      assert.isTrue(config.delete);
      assert.notProperty(config, "baseDirs");
    });

    test("root rule keeps everything create-terreno-app's CLAUDE.md and .cursorrules say", () => {
      // Lines from create-terreno-app/src/generate.ts (generateClaudeMd, generateCursorRules);
      // rulesync replaces CLAUDE.md and supersedes .cursorrules with the root rule.
      const root = findFile(files, ".rulesync/rules/00-root.md");
      for (const line of [
        "# Sync Rules",
        "## Project Structure",
        "cd backend && bun install",
        "cd frontend && bun install",
        "cd backend && bun run dev",
        "port 8082",
        "cd frontend && bun run sdk",
        "## Adding Features",
        "1. Create model in `backend/src/models/`",
        "2. Create route in `backend/src/api/`",
        "3. Register route in `backend/src/server.ts`",
        "4. Regenerate SDK: `cd frontend && bun run sdk`",
        "5. Create screens in `frontend/app/`",
        "## Backend Conventions",
        "- Use `modelRouter` for CRUD endpoints",
        "- Use `APIError` for error responses",
        "## Frontend Conventions",
        "- Use generated SDK hooks from `@/store/openApiSdk` for non-synced routes only",
        "- Never modify `openApiSdk.ts` manually - regenerate with `bun run sdk`",
        "Use Redux Toolkit for state management",
        "## AI Assistance",
        "- Use Luxon",
        "- Use functional components with `React.FC` type",
        "- Wrap callbacks in `useCallback`",
      ]) {
        assert.include(root, line);
      }
      const minimal = findFile(
        generateAiRulesFiles({appDisplayName: "Min", appName: "min", packages: ["api"]}),
        ".rulesync/rules/00-root.md"
      );
      assert.include(minimal, "## Adding Features");
      assert.include(minimal, "## Frontend Conventions");
    });

    test("emits one root rule that covers every configured target", () => {
      const ruleFiles = files.filter((f) => f.path.startsWith(RULESYNC_RULE_PREFIX));
      assert.deepEqual(
        ruleFiles.map((f) => f.path),
        [".rulesync/rules/00-root.md"]
      );
      const frontmatter = parseFrontmatter(findFile(files, ".rulesync/rules/00-root.md"));
      assert.include(frontmatter, "root: true");
      assert.include(frontmatter, 'targets: ["cursor", "claudecode", "copilot", "agentsmd"]');
      for (const file of files) {
        assert.notInclude(file.content, "localRoot", file.path);
        assert.notInclude(file.content, "windsurf", file.path);
      }
    });

    test("rulesync generate succeeds and keeps consumer rules across a re-bootstrap", () => {
      const root = mkdtempSync(join(tmpdir(), "terreno-airules-"));
      try {
        writeFiles(root, files);
        writeFiles(root, [
          {
            content:
              '---\ntargets: ["*"]\ndescription: "Acme backend"\nglobs: ["backend/**"]\n---\n\n# Acme backend\n\n- Store money as integer cents.\n',
            path: ".rulesync/rules/10-project.md",
          },
        ]);

        const first = runRulesyncGenerate(root);
        assert.equal(first.exitCode, 0, first.output);
        for (const generated of [
          "CLAUDE.md",
          "AGENTS.md",
          ".cursor/rules/00-root.mdc",
          ".github/copilot-instructions.md",
          ".claude/rules/10-project.md",
          ".cursor/rules/10-project.mdc",
        ]) {
          assert.isTrue(existsSync(join(root, generated)), `missing ${generated}`);
        }
        assert.isFalse(existsSync(join(root, "CLAUDE.local.md")));

        // Re-bootstrap rewrites the Terreno-owned files; the consumer source survives.
        writeFiles(root, files);
        const second = runRulesyncGenerate(root);
        assert.equal(second.exitCode, 0, second.output);
        assert.isTrue(existsSync(join(root, ".rulesync/rules/10-project.md")));
        assert.isTrue(existsSync(join(root, ".claude/rules/10-project.md")));
        assert.isTrue(existsSync(join(root, "backend/CLAUDE.md")));
        assert.isTrue(existsSync(join(root, "frontend/AGENTS.md")));
      } finally {
        rmSync(root, {force: true, recursive: true});
      }
    }, 30_000);
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
      expect(text).toContain(RULESYNC_GENERATE_COMMAND);
      expect(text).not.toContain("npm install -g rulesync");
      expect(text).not.toContain("windsurfrules");
      expect(text).toContain(RULESYNC_OVERWRITE_WARNING);
      expect(text).toContain("delete the stale root `.cursorrules`");
      expect(text.indexOf(RULESYNC_OVERWRITE_WARNING)).toBeLessThan(
        text.indexOf(RULESYNC_GENERATE_COMMAND)
      );
    });

    test("should return unknown message for unknown prompt", () => {
      const result = handleBootstrapPromptRequest("unknown_prompt", {});
      expect(result.messages[0].content.text).toContain("Unknown bootstrap prompt");
    });
  });
});
