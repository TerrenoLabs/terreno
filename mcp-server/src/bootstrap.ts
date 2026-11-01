import type {Tool} from "@modelcontextprotocol/server";

import {
  composePackageGuidelinesForRules,
  filterGuidelineIdsForRootRules,
  type GuidelinePackageId,
  loadPackageGuidelineMarkdown,
  resolveBootstrapGuidelinePackages,
} from "./packageGuidelines.js";

interface BootstrapArgs {
  appName: string;
  appDisplayName: string;
  description?: string;
}

export const bootstrapTools: Tool[] = [
  {
    description:
      "Bootstrap AI coding assistant rules for a Terreno project. Creates rulesync sources that generate rules for Cursor, Claude Code, GitHub Copilot, and AGENTS.md readers (Codex, Windsurf, and others) with Terreno-specific guidelines adapted for the project.",
    inputSchema: {
      properties: {
        appDisplayName: {
          description: "Human-readable display name (e.g., 'My Todo App', 'Task Manager')",
          type: "string",
        },
        appName: {
          description:
            "The application name in kebab-case (e.g., 'my-app', 'todo-app'). Used in rule file headers.",
          type: "string",
        },
        description: {
          description: "A brief description of the app (optional)",
          type: "string",
        },
        packages: {
          description:
            'Optional list of Terreno packages to include in merged guidelines (e.g. ["api","ui","rtk","syncdb"]). Use names like `api`, `ui`, `rtk`, `syncdb`, `admin-backend`, `admin-frontend`, or `@terreno/api`. Omit admin packages if the app does not use the admin panel.',
          items: {type: "string"},
          type: "array",
        },
      },
      required: ["appName", "appDisplayName"],
      type: "object",
    },
    name: "terreno_bootstrap_ai_rules",
  },
];

export interface BootstrapAiRulesArgs extends BootstrapArgs {
  /** Optional `@terreno/*` package ids to include (e.g. `["api","ui"]`). Omits others from merged guidelines. */
  packages?: string[];
}
/**
 * rulesync targets the generated config and root rule share. Every entry must be a target
 * rulesync 9 accepts (it dropped `windsurf`; Windsurf reads the `agentsmd` output).
 */
export const RULESYNC_TARGETS = ["cursor", "claudecode", "copilot", "agentsmd"] as const;

/**
 * Warning shown before every `rulesync generate`: with `delete: true` rulesync overwrites the
 * root files and deletes anything else in the rule directories it owns.
 */
export const RULESYNC_OVERWRITE_WARNING =
  "`rulesync generate` overwrites the root `CLAUDE.md`, `AGENTS.md`, and `.github/copilot-instructions.md` and deletes every file under `.claude/rules/`, `.cursor/rules/`, `.github/instructions/`, and `.agents/memories/` that it did not generate. Move any edits you made to those root files, and any hand-written files in those directories, into `.rulesync/rules/10-project.md` (or other `.rulesync/rules/*.md` sources) first, or they are lost.";

/** Command that regenerates editor files; pinned to the rulesync major the output is tested on. */
export const RULESYNC_GENERATE_COMMAND = "bunx rulesync@9 generate";

const RULESYNC_TARGETS_FRONTMATTER = `[${RULESYNC_TARGETS.map((t) => `"${t}"`).join(", ")}]`;

const generateRulesyncConfig = (): string => {
  return JSON.stringify(
    {
      $schema:
        "https://raw.githubusercontent.com/dyoshikawa/rulesync/refs/heads/main/config-schema.json",
      delete: true,
      features: ["rules"],
      targets: [...RULESYNC_TARGETS],
      verbose: false,
    },
    null,
    2
  );
};

const REACT_BEST_PRACTICES_MARKDOWN = `## React Best Practices

- Use functional components with \`React.FC\` type
- Import hooks directly: \`import {useEffect, useMemo} from 'react'\`
- Always provide return types for functions
- Add explanatory comment above each \`useEffect\`
- Wrap callbacks in \`useCallback\`
- Prefer const arrow functions
- Use inline styles over \`StyleSheet.create\`
- Use Luxon for date operations
- Place static content and interfaces at beginning of file
- Minimize \`use client\`, \`useEffect\`, and \`setState\`
- Always support React-Native Web
`;

const buildSharedRootRulesMarkdownBody = (
  args: BootstrapArgs,
  rootPackageIds: readonly GuidelinePackageId[]
): string => {
  const {appDisplayName, description} = args;
  const appDescription =
    description || `A full-stack application built with the Terreno framework.`;
  const pkgRef = composePackageGuidelinesForRules(rootPackageIds);
  const pkgSection =
    pkgRef.trim().length > 0
      ? `## Package Reference\n\n${pkgRef}`
      : "## Package Reference\n\n_(No package guidelines matched the selected packages.)_";

  return `# ${appDisplayName}

${appDescription}

## Project Structure

- **frontend/** - Expo/React Native frontend using @terreno/ui, @terreno/syncdb, and @terreno/rtk (SDK + Better Auth)
- **backend/** - Express/Mongoose backend using @terreno/api

## Development

Uses [Bun](https://bun.sh/) as the package manager.

\`\`\`bash
# Install dependencies
cd backend && bun install
cd frontend && bun install

# Backend
cd backend && bun run dev    # Start backend on port 4000

# Frontend
cd frontend && bun run web   # Start web frontend on port 8082
cd frontend && bun run sdk   # Regenerate SDK after backend changes
\`\`\`

## Adding Features

1. Create model in \`backend/src/models/\`
2. Create route in \`backend/src/api/\`
3. Register route in \`backend/src/server.ts\`
4. Regenerate SDK: \`cd frontend && bun run sdk\`
5. Create screens in \`frontend/app/\`

## Backend Conventions

- Use \`modelRouter\` for CRUD endpoints
- Use \`APIError\` for error responses
- Use \`logger.info/warn/error/debug\` for logging
- Use \`Model.findExactlyOne\` or \`Model.findOneOrNone\` (not \`Model.findOne\`)

## Frontend Conventions

- Use \`@terreno/syncdb/react\` hooks (\`useQuery\`, \`useMutate\`) for synced collection CRUD
- Use generated SDK hooks from \`@/store/openApiSdk\` for non-synced routes only
- Use @terreno/ui components (Box, Page, Button, TextField, etc.)
- Never modify \`openApiSdk.ts\` manually - regenerate with \`bun run sdk\`
- Use Redux Toolkit for state management (Better Auth session and the RTK Query SDK)

## AI Assistance

This project is configured to use the Terreno MCP server for AI-assisted development.
Use the MCP tools and prompts for:
- Generating new models and routes
- Creating screens and forms
- Following Terreno patterns and best practices

## Code Style

### TypeScript/JavaScript
- Use ES module syntax and TypeScript for all code
- Prefer interfaces over types; avoid enums, use maps
- Prefer const arrow functions over \`function\` keyword
- Use descriptive variable names with auxiliary verbs (e.g., \`isLoading\`)
- Use camelCase directories (e.g., \`components/authWizard\`)
- Favor named exports
- Use the RORO pattern (Receive an Object, Return an Object)

### Dates and Time
- Always use Luxon instead of Date or dayjs

### Error Handling
- Check error conditions at start of functions and return early
- Limit nested if statements
- Use multiline syntax with curly braces for all conditionals

### Testing
- Use bun test with expect for testing

### Logging
- Frontend: Use \`console.info\`, \`console.debug\`, \`console.warn\`, or \`console.error\` for permanent logs
- Backend: Use \`logger.info/warn/error/debug\` for permanent logs
- Use \`console.log\` only for debugging (to be removed)

### Development Practices
- Don't apologize for errors: fix them
- Prioritize modularity, DRY, performance, and security
- Focus on readability over performance
- Write complete, functional code without TODOs when possible
- Comments should describe purpose, not effect

${pkgSection}

${REACT_BEST_PRACTICES_MARKDOWN}`;
};

const generateRootRulesFile = (
  args: BootstrapArgs,
  packageIds: readonly GuidelinePackageId[]
): string => {
  const {appDisplayName} = args;
  const body = buildSharedRootRulesMarkdownBody(args, filterGuidelineIdsForRootRules(packageIds));
  return `---
root: true
targets: ${RULESYNC_TARGETS_FRONTMATTER}
description: "${appDisplayName} root guidelines"
globs: ["**/*"]
---

${body}`;
};

const appendAdminBackendGuidelines = (packageIds: readonly GuidelinePackageId[]): string => {
  if (!packageIds.includes("admin-backend")) {
    return "";
  }
  const md = loadPackageGuidelineMarkdown("admin-backend");
  return md ? `\n\n${md}\n` : "";
};

const appendAdminFrontendGuidelines = (packageIds: readonly GuidelinePackageId[]): string => {
  if (!packageIds.includes("admin-frontend")) {
    return "";
  }
  const md = loadPackageGuidelineMarkdown("admin-frontend");
  return md ? `\n\n${md}\n` : "";
};

const generateBackendRulesFile = (
  args: BootstrapArgs,
  packageIds: readonly GuidelinePackageId[]
): string => {
  const {appDisplayName} = args;
  const admin = appendAdminBackendGuidelines(packageIds);
  return `---
description: "${appDisplayName} backend guidelines"
globs: ["**/*"]
---

# ${appDisplayName} Backend

Express/Mongoose backend using @terreno/api.

## Development

\`\`\`bash
bun run dev      # Start on port 4000
bun run test     # Run tests
bun run lint     # Lint code
\`\`\`

## Backend Conventions

- Use \`modelRouter\` for CRUD endpoints
- Use \`APIError\` for error responses: \`throw new APIError({status: 400, title: "Message"})\`
- Use \`logger.info/warn/error/debug\` for logging
- Use \`Model.findExactlyOne\` or \`Model.findOneOrNone\` (not \`Model.findOne\`)
- All model types live in \`src/types/models/\`
- In routes: \`req.user\` is \`UserDocument | undefined\`
${admin}## Runtime Configuration

Use \`AppConfig.getConfig()\` or \`AppConfig.getConfig("section.field")\` to read config values.
Use \`AppConfig.updateConfig(updates)\` to write. All values are persisted in MongoDB.

## Adding a New Model

1. Create model in \`src/models/yourModel.ts\`
2. Create types in \`src/types/models/yourModelTypes.ts\`
3. Export from \`src/models/index.ts\` and \`src/types/models/index.ts\`
4. Create route in \`src/api/yourModel.ts\`
5. Register route in \`src/server.ts\`
6. Optionally add to \`AdminApp\` in \`src/server.ts\` for admin panel access
`;
};

const generateFrontendRulesFile = (
  args: BootstrapArgs,
  packageIds: readonly GuidelinePackageId[]
): string => {
  const {appDisplayName} = args;
  const admin = appendAdminFrontendGuidelines(packageIds);
  return `---
description: "${appDisplayName} frontend guidelines"
globs: ["**/*"]
---

# ${appDisplayName} Frontend

Expo/React Native frontend using @terreno/ui, @terreno/syncdb, and @terreno/rtk.

## Development

\`\`\`bash
bun run web      # Start web frontend on port 8082
bun run sdk      # Regenerate SDK from backend OpenAPI spec
bun run lint     # Lint code
\`\`\`

## Frontend Conventions

- Use \`@terreno/syncdb/react\` hooks (\`useQuery\`, \`useMutate\`) for synced collection CRUD
- Use generated SDK hooks from \`@/store/openApiSdk\` for non-synced routes only
- Use @terreno/ui components (Box, Page, Button, TextField, etc.)
- Never modify \`openApiSdk.ts\` manually - regenerate with \`bun run sdk\`
- Use Luxon for date operations
- Better Auth session: \`generateBetterAuthSlice\` + \`lib/betterAuth.ts\`
${admin}## Expo SDK upgrades

- For Expo/React Native dependency upgrades, install and use the official \`upgrading-expo\` skill from \`expo/skills\` (\`bunx skills add expo/skills\` when using the Skills CLI). It covers \`expo install\`, doctor, caches, and SDK breaking changes.
- Terreno-specific upgrade notes ship with \`@terreno/mcp\` as bundled markdown; call the \`terreno_get_upgrade_guide\` tool (hosted Terreno MCP) for lockstep \`@terreno/*\` release notes.

## MCP servers (dev)

- **terreno** (HTTP): codegen, docs search, bootstrap tools.
- **terreno-local** (stdio): Mongo introspection, dev logs, RTK state (via \`registerTerrenoDevStore\`).
- **expo** (HTTP): Expo docs + local simulator automation when \`EXPO_UNSTABLE_MCP_SERVER=1\` dev server is running.
- **playwright**: web UI automation for \`expo start --web\`.

## Adding a New Screen

1. Regenerate SDK if backend changed: \`bun run sdk\`
2. Create screen in \`app/\` directory
3. Use @terreno/ui components for layout
4. Use SDK hooks for non-synced routes; use syncdb hooks for synced collections
`;
};

interface AiRulesFile {
  path: string;
  content: string;
}

export const generateAiRulesFiles = (args: BootstrapAiRulesArgs): AiRulesFile[] => {
  const packageIds = resolveBootstrapGuidelinePackages(args.packages);
  // Strip frontmatter for direct output files
  const stripFrontmatter = (content: string): string => {
    return content.replace(/^---[\s\S]*?---\n\n?/, "");
  };

  const backendContent = stripFrontmatter(generateBackendRulesFile(args, packageIds));
  const frontendContent = stripFrontmatter(generateFrontendRulesFile(args, packageIds));

  return [
    // .rulesync/rules/ source file (the source of truth for root rules in every editor)
    {content: generateRootRulesFile(args, packageIds), path: ".rulesync/rules/00-root.md"},

    // Direct output files for backend (AGENTS.md and CLAUDE.md in backend/)
    {content: backendContent, path: "backend/AGENTS.md"},
    {content: backendContent, path: "backend/CLAUDE.md"},

    // Direct output files for frontend (AGENTS.md and CLAUDE.md in frontend/)
    {content: frontendContent, path: "frontend/AGENTS.md"},
    {content: frontendContent, path: "frontend/CLAUDE.md"},

    // Rulesync config (only syncs root level files)
    {content: generateRulesyncConfig(), path: "rulesync.jsonc"},
  ];
};

const handleBootstrapAiRulesToolCall = (
  args: Record<string, unknown>
): {content: Array<{type: "text"; text: string}>} => {
  const bootstrapArgs = args as unknown as BootstrapAiRulesArgs;

  if (!bootstrapArgs.appName || !bootstrapArgs.appDisplayName) {
    return {
      content: [
        {
          text: "Error: appName and appDisplayName are required parameters",
          type: "text",
        },
      ],
    };
  }

  const files = generateAiRulesFiles(bootstrapArgs);

  const fileList = files.map((f) => `- \`${f.path}\``).join("\n");

  const instructions = `# Bootstrap AI Rules for ${bootstrapArgs.appDisplayName}

## Files to Create

The following AI coding assistant configuration files need to be created:

${fileList}

## Instructions

1. **Create all the files listed above.** Each file's content is provided below.

2. **If \`.rulesync/rules/01-claudecode-root.md\` exists from an earlier bootstrap, delete it.** The root rule now covers Claude Code.

3. **Before generating, move hand-written rules into \`.rulesync/rules/\`.** ${RULESYNC_OVERWRITE_WARNING}

4. **Delete the stale \`.cursorrules\`** that \`create-terreno-app\` wrote. \`.cursor/rules/00-root.mdc\` supersedes it, and the root rule contains everything it said.

5. **Generate the editor files with rulesync:**
   \`\`\`bash
   ${RULESYNC_GENERATE_COMMAND}
   \`\`\`

   This generates root-level files from \`.rulesync/rules/\`:
   - \`.cursor/rules/00-root.mdc\` (Cursor)
   - \`CLAUDE.md\` (Claude Code; replaces the one \`create-terreno-app\` wrote)
   - \`.github/copilot-instructions.md\` (GitHub Copilot)
   - \`AGENTS.md\` (Codex, Windsurf, and other AGENTS.md readers)

## How It Works

- **\`.rulesync/rules/00-root.md\`** - Source of truth for root-level AI coding guidelines (Terreno-owned; regenerated on re-bootstrap)
- **\`rulesync.jsonc\`** - rulesync config: \`rules\` feature, targets ${RULESYNC_TARGETS.map((t) => `\`${t}\``).join(", ")}, \`delete: true\`
- **\`backend/AGENTS.md\` & \`backend/CLAUDE.md\`** - Direct context files for backend
- **\`frontend/AGENTS.md\` & \`frontend/CLAUDE.md\`** - Direct context files for frontend

## Keeping Rules Updated

- **Project rules**: Add your own sources such as \`.rulesync/rules/10-project.md\` (scope with \`globs\`, e.g. \`["backend/**"]\`) and run \`${RULESYNC_GENERATE_COMMAND}\`. Re-bootstrapping never overwrites them.
- **Terreno rules**: Re-run \`terreno_bootstrap_ai_rules\` to refresh \`00-root.md\` and the \`backend/\`/\`frontend/\` files, then run \`${RULESYNC_GENERATE_COMMAND}\`
- Never hand-edit the root-level generated files (\`CLAUDE.md\`, \`AGENTS.md\`, \`.cursor/rules/\`, \`.github/copilot-instructions.md\`); rulesync replaces them

---

## File Contents

`;

  const fileContents = files
    .map((f) => {
      const lang = f.path.endsWith(".json") || f.path.endsWith(".jsonc") ? "json" : "markdown";
      return `### \`${f.path}\`

\`\`\`${lang}
${f.content}
\`\`\`
`;
    })
    .join("\n");

  return {
    content: [{text: instructions + fileContents, type: "text"}],
  };
};
export const handleBootstrapToolCall = (
  name: string,
  args: Record<string, unknown>
): {content: Array<{type: "text"; text: string}>} => {
  if (name === "terreno_bootstrap_ai_rules") {
    return handleBootstrapAiRulesToolCall(args);
  }

  return {
    content: [{text: `Unknown bootstrap tool: ${name}`, type: "text"}],
  };
};

// Prompt for bootstrapping
interface BootstrapPrompt {
  name: string;
  description: string;
  arguments: Array<{
    name: string;
    description: string;
    required?: boolean;
  }>;
}

export const bootstrapPrompts: BootstrapPrompt[] = [
  {
    arguments: [
      {
        description: "Application name in kebab-case (e.g., 'my-app', 'todo-manager')",
        name: "appName",
        required: true,
      },
      {
        description: "Human-readable display name (e.g., 'My App', 'Todo Manager')",
        name: "appDisplayName",
        required: true,
      },
    ],
    description:
      "Bootstrap a new Terreno app: instruct the assistant to run bunx create-terreno-app, then terreno_bootstrap_ai_rules",
    name: "terreno_bootstrap",
  },
];

export const handleBootstrapPromptRequest = (
  name: string,
  args: Record<string, string>
): {messages: Array<{role: "user"; content: {type: "text"; text: string}}>} => {
  if (name !== "terreno_bootstrap") {
    return {
      messages: [
        {
          content: {
            text: `Unknown bootstrap prompt: ${name}`,
            type: "text",
          },
          role: "user",
        },
      ],
    };
  }

  const {appName, appDisplayName} = args;

  const prompt = `Please bootstrap a new Terreno application with the following details:

- **App Name** (kebab-case): ${appName}
- **Display Name**: ${appDisplayName}

Scaffold the app with the published CLI (not an MCP tool):

\`\`\`bash
bunx create-terreno-app ${appName} --display-name "${appDisplayName}"
\`\`\`

Then follow the CLI next-step commands: install, seed, start MongoDB as a replica set, start the backend, and in another terminal run frontend \`bun run sdk\` then \`bun run web\`.

The application should include:
- Better Auth login (email/password via \`@terreno/ui\` LoginScreen)
- Tab-based navigation with Home and Profile screens
- \`@terreno/syncdb\` client wired in the root layout (empty \`SYNC_COLLECTIONS\` until you add synced models)
- Redux with Better Auth session + RTK Query SDK for non-synced routes
- OpenAPI SDK generation from backend spec
- Cursor rules for AI assistance
- MCP integration for development assistance

**IMPORTANT: After the CLI writes the app, also run the \`terreno_bootstrap_ai_rules\` tool** with the same appName and appDisplayName to set up AI coding assistant rules for Cursor, Claude Code, GitHub Copilot, and AGENTS.md readers. This will create:
- \`.rulesync/rules/00-root.md\`, the root rule source for every editor
- AGENTS.md and CLAUDE.md files for \`backend/\` and \`frontend/\`
- rulesync.jsonc for keeping rules in sync

Before generating, delete the stale root \`.cursorrules\` (\`.cursor/rules/00-root.mdc\` supersedes it). ${RULESYNC_OVERWRITE_WARNING}

Then generate the editor files from the rulesync sources:
\`\`\`bash
${RULESYNC_GENERATE_COMMAND}
\`\`\``;

  return {
    messages: [
      {
        content: {
          text: prompt,
          type: "text",
        },
        role: "user",
      },
    ],
  };
};
