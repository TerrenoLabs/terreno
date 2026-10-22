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
      "Bootstrap AI coding assistant rules for a Terreno project. Creates configuration files for Cursor, Windsurf, Claude Code, and GitHub Copilot with Terreno-specific guidelines adapted for the project.",
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
            'Optional list of Terreno packages to include in merged guidelines (e.g. ["api","ui","syncdb"]). Use names like `api`, `ui`, `syncdb`, `admin-backend`, `admin-frontend`, or `@terreno/api`. Omit admin packages if the app does not use the admin panel.',
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
const generateRulesyncConfig = (): string => {
  return JSON.stringify(
    {
      $schema:
        "https://raw.githubusercontent.com/dyoshikawa/rulesync/refs/heads/main/config-schema.json",
      baseDirs: ["."],
      delete: true,
      features: ["rules"],
      targets: ["cursor", "windsurf", "claudecode", "copilot"],
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

- **frontend/** - Expo/React Native frontend using @terreno/ui and @terreno/syncdb (data, request client, generated API hooks, Better Auth session)
- **backend/** - Express/Mongoose backend using @terreno/api

## Development

Uses [Bun](https://bun.sh/) as the package manager.

\`\`\`bash
# Backend
cd backend && bun run dev    # Start backend on port 4000

# Frontend
cd frontend && bun run web   # Start web frontend
cd frontend && bun run sdk   # Regenerate store/apiSdk.ts after backend changes
\`\`\`

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
targets: ["cursor", "windsurf", "copilot"]
description: "${appDisplayName} root guidelines"
globs: ["**/*"]
---

${body}`;
};

const generateClaudeCodeRootRulesFile = (
  args: BootstrapArgs,
  packageIds: readonly GuidelinePackageId[]
): string => {
  const {appDisplayName} = args;
  const body = buildSharedRootRulesMarkdownBody(args, filterGuidelineIdsForRootRules(packageIds));
  return `---
localRoot: true
targets: ["claudecode"]
description: "${appDisplayName} Claude Code guidelines"
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
root: true
targets: ["cursor", "windsurf", "copilot"]
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

const _generateBackendClaudeRulesFile = (args: BootstrapArgs): string => {
  const {appDisplayName} = args;
  return `---
localRoot: true
targets: ["claudecode"]
description: "${appDisplayName} backend Claude Code guidelines"
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

## Adding a New Model

1. Create model in \`src/models/yourModel.ts\`
2. Create types in \`src/types/models/yourModelTypes.ts\`
3. Export from \`src/models/index.ts\` and \`src/types/models/index.ts\`
4. Create route in \`src/api/yourModel.ts\`
5. Register route in \`src/server.ts\`
`;
};

const generateFrontendRulesFile = (
  args: BootstrapArgs,
  packageIds: readonly GuidelinePackageId[]
): string => {
  const {appDisplayName} = args;
  const admin = appendAdminFrontendGuidelines(packageIds);
  return `---
root: true
targets: ["cursor", "windsurf", "copilot"]
description: "${appDisplayName} frontend guidelines"
globs: ["**/*"]
---

# ${appDisplayName} Frontend

Expo/React Native frontend using @terreno/ui and @terreno/syncdb.

## Development

\`\`\`bash
bun run web      # Start web frontend on port 8082
bun run sdk      # Regenerate store/apiSdk.ts from the backend OpenAPI spec
bun run lint     # Lint code
\`\`\`

## Frontend Conventions

- Use \`@terreno/syncdb/react\` hooks (\`useQuery\`, \`useMutate\`) for synced collection CRUD
- Use generated hooks from \`@/store/apiSdk\` (\`useGetAuthMeQuery\`, \`usePatchAuthMeMutation\`, ...) for non-synced routes only
- Use @terreno/ui components (Box, Page, Button, TextField, etc.)
- Never modify \`apiSdk.ts\` manually - regenerate with \`bun run sdk\`
- Use Luxon for date operations
- Session: \`SessionProvider\` / \`useSession()\` from \`@terreno/syncdb/auth\` + \`lib/betterAuth.ts\` (no Redux)
- Request client: \`store/apiClient.ts\` (\`createApiClient\` from \`@terreno/syncdb/api\`, \`baseUrl\` from \`@terreno/syncdb/config\`)
${admin}## Expo SDK upgrades

- For Expo/React Native dependency upgrades, install and use the official \`upgrading-expo\` skill from \`expo/skills\` (\`bunx skills add expo/skills\` when using the Skills CLI). It covers \`expo install\`, doctor, caches, and SDK breaking changes.
- Terreno-specific upgrade notes ship with \`@terreno/mcp\` as bundled markdown; call the \`terreno_get_upgrade_guide\` tool (hosted Terreno MCP) for lockstep \`@terreno/*\` release notes.

## MCP servers (dev)

- **terreno** (HTTP): codegen, docs search, bootstrap tools.
- **terreno-local** (stdio): Mongo introspection, dev logs, and runtime syncdb state for a client created with \`debug: true\`.
- **expo** (HTTP): Expo docs + local simulator automation when \`EXPO_UNSTABLE_MCP_SERVER=1\` dev server is running.
- **playwright**: web UI automation for \`expo start --web\`.

## Adding a New Screen

1. Regenerate API hooks if backend changed: \`bun run sdk\`
2. Create screen in \`app/\` directory
3. Use @terreno/ui components for layout
4. Use \`@/store/apiSdk\` hooks for non-synced routes; use syncdb hooks for synced collections
`;
};

const _generateFrontendClaudeRulesFile = (args: BootstrapArgs): string => {
  const {appDisplayName} = args;
  return `---
localRoot: true
targets: ["claudecode"]
description: "${appDisplayName} frontend Claude Code guidelines"
globs: ["**/*"]
---

# ${appDisplayName} Frontend

Expo/React Native frontend using @terreno/ui and @terreno/syncdb.

## Development

\`\`\`bash
bun run web      # Start web frontend on port 8082
bun run sdk      # Regenerate store/apiSdk.ts from the backend OpenAPI spec
bun run lint     # Lint code
\`\`\`

## Frontend Conventions

- Use \`@terreno/syncdb/react\` hooks for synced collection CRUD
- Use generated hooks from \`@/store/apiSdk\` (\`useGetAuthMeQuery\`, \`usePatchAuthMeMutation\`, ...) for non-synced routes only
- Use @terreno/ui components (Box, Page, Button, TextField, etc.)
- Never modify \`apiSdk.ts\` manually - regenerate with \`bun run sdk\`
- Use Luxon for date operations
- Session: \`SessionProvider\` / \`useSession()\` from \`@terreno/syncdb/auth\` + \`lib/betterAuth.ts\` (no Redux)
- Request client: \`store/apiClient.ts\` (\`createApiClient\` from \`@terreno/syncdb/api\`, \`baseUrl\` from \`@terreno/syncdb/config\`)

## Adding a New Screen

1. Regenerate API hooks if backend changed: \`bun run sdk\`
2. Create screen in \`app/\` directory
3. Use @terreno/ui components for layout
4. Use \`@/store/apiSdk\` hooks for non-synced routes; use syncdb hooks for synced collections
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
    // .rulesync/rules/ source files (these are the source of truth for root)
    {content: generateRootRulesFile(args, packageIds), path: ".rulesync/rules/00-root.md"},
    {
      content: generateClaudeCodeRootRulesFile(args, packageIds),
      path: ".rulesync/rules/01-claudecode-root.md",
    },

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

2. **Install rulesync** (required for syncing root-level rules to all AI tools):
   \`\`\`bash
   npm install -g rulesync
   \`\`\`

3. **Run rulesync to generate root-level AI tool configs:**
   \`\`\`bash
   rulesync sync
   \`\`\`
   
   This generates root-level files from \`.rulesync/rules/\`:
   - \`.cursorrules\`, \`.windsurfrules\`, \`.github/copilot-instructions.md\`, \`.claude/CLAUDE.local.md\`, \`AGENTS.md\`

## How It Works

- **\`.rulesync/rules/\`** - Source of truth for root-level AI coding guidelines
- **\`rulesync.jsonc\`** - Configuration for rulesync tool (root only)
- **\`backend/AGENTS.md\` & \`backend/CLAUDE.md\`** - Direct context files for backend
- **\`frontend/AGENTS.md\` & \`frontend/CLAUDE.md\`** - Direct context files for frontend

## Keeping Rules Updated

- **Root rules**: Edit \`.rulesync/rules/\` and run \`rulesync sync\`
- **Backend/Frontend rules**: Edit \`backend/AGENTS.md\` or \`frontend/AGENTS.md\` directly (and copy to CLAUDE.md)

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
- Better Auth session via \`SessionProvider\` / \`useSession()\` from \`@terreno/syncdb/auth\` (no Redux)
- Request client (\`store/apiClient.ts\`) plus generated hooks in \`store/apiSdk.ts\` for non-synced routes (\`bun run sdk\` runs \`terreno-syncdb-codegen --api-out\`)
- Cursor rules for AI assistance
- MCP integration for development assistance

**IMPORTANT: After the CLI writes the app, also run the \`terreno_bootstrap_ai_rules\` tool** with the same appName and appDisplayName to set up AI coding assistant rules for Cursor, Windsurf, Claude Code, and GitHub Copilot. This will create:
- AGENTS.md files for each directory
- .cursorrules and .windsurfrules files
- GitHub Copilot instructions
- Claude Code local rules
- rulesync.jsonc for keeping rules in sync

Then install rulesync to keep AI rules synchronized:
\`\`\`bash
npm install -g rulesync
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
