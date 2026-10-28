import packageJson from "../package.json" with {type: "json"};

/** Pinned so `npx -y` does not resolve a moving `@latest` target in generated MCP configs. */
export const PLAYWRIGHT_MCP_PACKAGE_VERSION = "0.0.76";

/** Bun-safe Mongo stack — caret ranges resolve to mongoose 9.10 / mongodb 7.6 / bson 7.3 and crash Bun. */
export const MONGOOSE_VERSION = "9.7.4";
export const MONGODB_VERSION = "7.2.0";
export const BSON_VERSION = "7.2.0";

export const PACKAGE_VERSION = packageJson.version;
const TERRENO_DEP_VERSION = `^${PACKAGE_VERSION}`;

/** Better Auth client + Expo plugin, pinned together (the monorepo overrides both to 1.6.25). */
export const BETTER_AUTH_VERSION = "^1.6.25";

/**
 * Regenerates `store/apiSdk.ts` (typed hooks for every non-synced route) from the running
 * backend's OpenAPI spec with the `@terreno/syncdb` codegen.
 */
export const API_SDK_SCRIPT =
  // biome-ignore lint/suspicious/noTemplateCurlyInString: shell default expansion in a package.json script
  "terreno-syncdb-codegen --schema ${OPENAPI_URL:-http://localhost:4000/openapi.json} --api-out ./store/apiSdk.ts";

export interface BootstrapArgs {
  appName: string;
  appDisplayName: string;
  description?: string;
  mcpServerUrl?: string;
}

export interface GeneratedFile {
  path: string;
  content: string;
}

const generateCursorRules = (args: BootstrapArgs): string => {
  const {appDisplayName} = args;
  return `# ${appDisplayName}

A full-stack application built with the Terreno framework.

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
- Favor named exports
- Use the RORO pattern (Receive an Object, Return an Object)

### Dates and Time
- Always use Luxon instead of Date or dayjs

### Error Handling
- Check error conditions at start of functions and return early
- Limit nested if statements
- Use multiline syntax with curly braces for all conditionals

### React Best Practices
- Use functional components with \`React.FC\` type
- Add explanatory comment above each \`useEffect\`
- Wrap callbacks in \`useCallback\`
- Use React context, local state, or \`useStoredState\` for app state (no Redux)

### Backend Conventions
- Use \`modelRouter\` for CRUD endpoints
- Use \`APIError\` for error responses
- Use \`logger.info/warn/error/debug\` for logging
- Use \`Model.findExactlyOne\` or \`Model.findOneOrNone\` (not \`Model.findOne\`)

### Frontend Conventions
- Use \`@terreno/syncdb/react\` hooks (\`useQuery\`, \`useMutate\`) for synced collection CRUD
- Use generated hooks from \`@/store/apiSdk\` (\`useGetAuthMeQuery\`, \`usePatchAuthMeMutation\`, ...) for non-synced routes only
- Read the session with \`useSession()\` from \`@terreno/syncdb/auth\` (\`userId\`, \`isLoading\`, \`logout\`, \`refresh\`)
- Use @terreno/ui components (Box, Page, Button, TextField, etc.)
- Never modify \`apiSdk.ts\` manually - regenerate with \`bun run sdk\`

## AI Assistance

This project is configured to use the Terreno MCP server for AI-assisted development.
Use the MCP tools and prompts for:
- Generating new models and routes
- Creating screens and forms
- Following Terreno patterns and best practices
`;
};

const generateMcpSettings = (args: BootstrapArgs): string => {
  const mcpUrl = args.mcpServerUrl || "https://mcp.terreno.app";
  return JSON.stringify(
    {
      mcpServers: {
        expo: {
          type: "http",
          url: "https://mcp.expo.dev/mcp",
        },
        playwright: {
          args: ["-y", `@playwright/mcp@${PLAYWRIGHT_MCP_PACKAGE_VERSION}`],
          command: "npx",
        },
        terreno: {
          type: "http",
          url: `${mcpUrl}/mcp`,
        },
        // Generated apps do not depend on @terreno/mcp, and no npm package is named
        // `terreno-mcp-local`, so bunx must be told which package provides the bin.
        "terreno-local": {
          args: ["-p", "@terreno/mcp", "terreno-mcp-local"],
          command: "bunx",
        },
      },
    },
    null,
    2
  );
};

const generateRootGitignore = (): string => {
  return [
    "# Dependencies",
    "node_modules/",
    "",
    "# Local env (use .env.example as a template)",
    "backend/.env",
    "frontend/.env",
    "",
    "# Local Terreno dev logs (winston JSONL + optional browser fallback)",
    ".terreno/",
    "",
    "# Build outputs",
    "dist/",
    "build/",
    "",
    "# OS",
    ".DS_Store",
    "",
  ].join("\n");
};

const DEPLOYMENT_BASELINE_DOC =
  "https://github.com/TerrenoLabs/terreno/blob/master/docs/explanation/deployment-baseline.md";
const DEPLOY_BACKEND_CLOUD_RUN_DOC =
  "https://github.com/TerrenoLabs/terreno/blob/master/docs/how-to/deploy-backend-to-cloud-run.md";
const BUILD_FOR_WEB_DOC =
  "https://github.com/TerrenoLabs/terreno/blob/master/docs/how-to/build-for-web.md";
const SET_UP_TERRENO_MCP_DOC =
  "https://github.com/TerrenoLabs/terreno/blob/master/docs/how-to/set-up-terreno-mcp.md";

const generateRootReadme = (args: BootstrapArgs): string => {
  const {appDisplayName, appName} = args;
  const dbName = appName.replace(/-/g, "_");
  return `# ${appDisplayName}

Full-stack Terreno app generated by [\`create-terreno-app\`](https://www.npmjs.com/package/create-terreno-app).

## Project structure

- **backend/** — Express/Mongoose API (\`@terreno/api\`, Better Auth, admin, sync)
- **frontend/** — Expo universal app (\`@terreno/ui\`, \`@terreno/syncdb\`)

## Local development

1. **MongoDB replica set** (required for sync/realtime). For local dev, run a single-node replica set and point \`MONGO_URI\` at it. See the [deployment baseline](${DEPLOYMENT_BASELINE_DOC}).

2. **Install dependencies**

\`\`\`bash
cd backend && bun install
cd ../frontend && bun install
\`\`\`

3. **Configure env** — copy \`backend/.env.example\` and \`frontend/.env.example\` to \`.env\` (or use the generated, gitignored local defaults in \`backend/.env\` / \`frontend/.env\`).

4. **Seed login users**

\`\`\`bash
cd backend && bun run seed
\`\`\`

Creates \`test@example.com\` and \`admin@example.com\` (password \`testpassword123\`).

5. **Start the stack**

\`\`\`bash
# Terminal 1 — API (default port 4000)
cd backend && bun run dev

# Terminal 2 — web UI (port 8082)
cd frontend && bun run web
\`\`\`

After backend route changes, regenerate the typed API hooks in \`frontend/store/apiSdk.ts\` (the backend must be running):

\`\`\`bash
cd frontend && bun run sdk
\`\`\`

## AI-assisted development

\`.cursor/mcp.json\` and \`.mcp.json\` connect your editor to the hosted Terreno MCP and \`terreno-mcp-local\` (logs, last error, client state, database); see [Set up Terreno MCP](${SET_UP_TERRENO_MCP_DOC}).

## Deploy

Read the [deployment baseline](${DEPLOYMENT_BASELINE_DOC}) first (MongoDB replica set, auth secrets, \`EXPO_PUBLIC_*\` at build time, \`/health\`, and more).

### Backend (Docker / Cloud Run)

This repo includes a **consumer** \`Dockerfile\` at the project root. It builds only \`backend/\` — not the Terreno monorepo.

\`\`\`bash
docker build -t ${appName}-backend .
docker run --rm -p 8080:8080 \\
  -e MONGO_URI='mongodb+srv://...' \\
  -e BETTER_AUTH_SECRET='...' \\
  -e BETTER_AUTH_URL='https://api.example.com' \\
  ${appName}-backend
\`\`\`

Cloud Run and other platforms set \`PORT\`; the server listens on that port and exposes \`GET /health\`.

Step-by-step GCP deploy: [Deploy backend to Cloud Run](${DEPLOY_BACKEND_CLOUD_RUN_DOC}).

### Frontend (static web)

Set \`EXPO_PUBLIC_API_URL\` **before** export — it is inlined into the bundle at build time:

\`\`\`bash
cd frontend
EXPO_PUBLIC_API_URL=https://api.example.com bun expo export --platform web
\`\`\`

Full walkthrough: [Build for web](${BUILD_FOR_WEB_DOC}).

## Default local database name

\`MONGO_URI\` defaults to \`mongodb://127.0.0.1:27017/${dbName}?replicaSet=rs0\` in \`backend/.env\`.
`;
};

const generateRootDockerfile = (): string => {
  return `# Consumer Terreno backend image — builds backend/ only (not the Terreno monorepo).
# Pin 1.4.4 so the image includes the patched Brotli decoder (CVE-2026-111497).
# Floating oven/bun:1 can resolve to an affected release.
FROM oven/bun:1.4.4-slim AS builder
WORKDIR /app

COPY backend/package.json ./
RUN bun install

COPY backend/ ./

FROM oven/bun:1.4.4-slim
WORKDIR /app

RUN apt-get update \\
  && apt-get install -y --no-install-recommends curl \\
  && rm -rf /var/lib/apt/lists/* \\
  && useradd -r -u 1001 appuser

COPY --from=builder /app/ ./

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \\
  CMD curl -fsS "http://127.0.0.1:\${PORT}/health" | grep -q '"healthy":true' || exit 1

RUN chown -R appuser:appuser /app
USER appuser

CMD ["bun", "run", "start"]
`;
};

const generateRootDockerignore = (): string => {
  return [
    ".git",
    ".gitignore",
    "**/node_modules",
    "**/dist",
    "backend/.env",
    "frontend/.env",
    "",
  ].join("\n");
};

const generateClaudeMd = (args: BootstrapArgs): string => {
  const {appDisplayName} = args;
  return `# ${appDisplayName}

A full-stack application built with the Terreno framework.

## Project Structure

- **frontend/** - Expo/React Native frontend
- **backend/** - Express/Mongoose backend

## Development

\`\`\`bash
# Install dependencies
cd backend && bun install
cd frontend && bun install

# Start backend (port 4000)
cd backend && bun run dev

# Start frontend (port 8082)
cd frontend && bun run web

# Regenerate frontend/store/apiSdk.ts after backend changes (backend running)
cd frontend && bun run sdk
\`\`\`

## Adding Features

1. Create model in \`backend/src/models/\`
2. Create route in \`backend/src/api/\`
3. Register route in \`backend/src/server.ts\`
4. Regenerate API hooks: \`cd frontend && bun run sdk\` (writes \`store/apiSdk.ts\`)
5. Create screens in \`frontend/app/\`

## Code Style

- Use TypeScript with ES modules
- Use Luxon for dates
- Prefer const arrow functions
- Named exports preferred
- Use interfaces over types
`;
};

// Backend file generators
const generateBackendPackageJson = (args: BootstrapArgs): string => {
  const {appName} = args;
  return JSON.stringify(
    {
      dependencies: {
        "@terreno/admin-backend": TERRENO_DEP_VERSION,
        "@terreno/api": TERRENO_DEP_VERSION,
        "@terreno/api-health": TERRENO_DEP_VERSION,
        luxon: "^3.7.2",
        mongodb: MONGODB_VERSION,
        mongoose: MONGOOSE_VERSION,
        "passport-local-mongoose": "^9.0.1",
      },
      devDependencies: {
        "@biomejs/biome": "^2.3.6",
        "@types/bun": "^1.4.0",
        "@types/express": "^4.17.21",
        "@types/luxon": "^3.7.1",
        typescript: "~6.0.3",
      },
      name: `@${appName}/backend`,
      overrides: {
        bson: BSON_VERSION,
        mongodb: MONGODB_VERSION,
      },
      private: true,
      scripts: {
        build: "bun build src/index.ts --outdir ./dist --target node",
        compile: "tsc",
        dev: "PORT=4000 bun run --watch src/index.ts",
        format: "biome format --write .",
        lint: "biome check .",
        "lint:fix": "biome check --write .",
        "lint:unsafefix": "biome check --write . --unsafe",
        seed: "bun run src/scripts/seed.ts",
        start: "bun run src/index.ts",
        test: "bun test",
      },
      type: "module",
      version: "1.0.0",
    },
    null,
    2
  );
};

const generateBackendTsConfig = (): string => {
  return JSON.stringify(
    {
      compilerOptions: {
        lib: ["esnext"],
        module: "preserve",
        moduleDetection: "force",
        noEmit: true,
        skipLibCheck: true,
        strict: true,
        target: "esnext",
        types: ["bun"],
        verbatimModuleSyntax: true,
      },
      exclude: ["node_modules", "dist"],
      include: ["src"],
    },
    null,
    2
  );
};

const generateBackendBiomeJsonc = (): string => {
  return `{
  "$schema": "./node_modules/@biomejs/biome/configuration_schema.json",
  "assist": {
    "actions": {
      "source": {
        "organizeImports": "on",
        "useSortedAttributes": "on",
        "useSortedKeys": "on"
      }
    },
    "enabled": true
  },
  "files": {
    "includes": [
      "package.json",
      "src/**/*.ts",
      "src/**/*.tsx",
      "!!**/node_modules",
      "!!**/dist",
      "!!**/build",
      "!!**/coverage",
      "!!**/.git"
    ]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "javascript": {
    "formatter": {
      "arrowParentheses": "always",
      "bracketSpacing": false,
      "jsxQuoteStyle": "double",
      "quoteStyle": "double",
      "semicolons": "always",
      "trailingCommas": "es5"
    },
    // TODO: Remove once we don't need to import React from 'react' in our JSX files.
    "jsxRuntime": "reactClassic"
  },
  "linter": {
    "enabled": true,
    "rules": {
      "nursery": {
        "noFloatingPromises": "error",
        "noMisusedPromises": "error",
        "useExhaustiveSwitchCases": "error"
      },
      "recommended": true,
      "suspicious": {
        "noConsole": {
          "level": "error",
          "options": {
            "allow": ["assert", "debug", "error", "info", "warn"]
          }
        },
        "noExplicitAny": "off",
        "noImplicitAnyLet": "off"
      }
    }
  },
  "vcs": {
    "clientKind": "git",
    "defaultBranch": "master",
    "enabled": true
  }
}
`;
};

const generateBackendIndex = (): string => {
  return `import "./server";
`;
};

const generateBackendAccess = (): string => {
  return `import {
  createAccess,
  terrenoStatements,
  type UserModel as TerrenoAuthUserModel,
} from "@terreno/api";
import mongoose from "mongoose";

import {User} from "./models/user";

export const access = createAccess({
  connection: mongoose.connection,
  organizations: true,
  statements: terrenoStatements,
  userModel: User as unknown as TerrenoAuthUserModel,
});
`;
};

const generateBackendServer = (args: BootstrapArgs): string => {
  const {appDisplayName} = args;
  return `import {AdminApp} from "@terreno/admin-backend";
import {HealthApp} from "@terreno/api-health";
import {
  BetterAuthApp,
  checkModelsStrict,
  logger,
  Membership,
  RealtimeApp,
  SyncApp,
  TerrenoApp,
  type UserModel as TerrenoAuthUserModel,
} from "@terreno/api";
import type express from "express";
import mongoose from "mongoose";
import {access} from "./access";
import {userRouter} from "./api/users";
import {AppConfiguration} from "./models/appConfiguration";
import {organizationSettingsSchema} from "./models/organizationSettings";
import {User} from "./models/user";
import "./types/models/organizationSettingsTypes";
import {buildBetterAuthConfig, getWebOrigins} from "./utils/betterAuthConfig";
import {connectToMongoDB} from "./utils/database";

const isDeployed = process.env.NODE_ENV === "production";

export const start = async (skipListen = false): Promise<express.Application> => {
  await connectToMongoDB();

  logger.info(\`Starting ${appDisplayName} server on port \${process.env.PORT || 4000}\`);

  if (!isDeployed) {
    checkModelsStrict();
  }

  await access.roles.seedDefaults();

  const betterAuthConfig = buildBetterAuthConfig();

  const terraApp = new TerrenoApp({
    accessControl: access,
    corsOrigin: getWebOrigins(),
    loggingOptions: {
      disableConsoleColors: isDeployed,
      level: "debug",
      logRequests: !isDeployed,
    },
    organizations: {
      settingsSchema: organizationSettingsSchema,
    },
    skipListen,
    // noExplicitAny: User model type mismatch
    // biome-ignore lint/suspicious/noExplicitAny: User model type mismatch
    userModel: User as any,
  }).configure(AppConfiguration);

  if (betterAuthConfig) {
    terraApp.register(
      new BetterAuthApp({
        config: betterAuthConfig,
        userModel: User as unknown as TerrenoAuthUserModel,
      })
    );
  }

  return terraApp
    .register(userRouter)
    .register(
      new HealthApp({
        check: async () => {
          const mongoConnected = mongoose.connection.readyState === 1;
          return {
            details: {
              database: mongoConnected ? "connected" : "disconnected",
              uptime: process.uptime(),
            },
            healthy: mongoConnected,
          };
        },
      })
    )
    .register(
      new AdminApp({
        models: [
          {
            displayName: "Users",
            listFields: ["email", "name", "admin", "created"],
            // noExplicitAny: User model type mismatch
            // biome-ignore lint/suspicious/noExplicitAny: User model type mismatch
            model: User as any,
            routePath: "/users",
          },
        ],
      })
    )
    .register(
      new SyncApp({
        accessControl: access,
        getUserScopes: async (user) => {
          const memberships = await Membership.findActiveForUser(user.id);
          return memberships.map((membership) => String(membership.organizationId));
        },
      })
    )
    .register(
      new RealtimeApp({
        // noExplicitAny: User model type mismatch
        // biome-ignore lint/suspicious/noExplicitAny: User model type mismatch
        userModel: User as any,
      })
    )
    .start();
};

start().catch((error) => {
  logger.error(\`Fatal error starting server: \${error}\`);
});
`;
};

const generateBackendDatabase = (args: BootstrapArgs): string => {
  const {appName} = args;
  const dbName = appName.replace(/-/g, "_");
  return `import {logger} from "@terreno/api";
import mongoose from "mongoose";

export const connectToMongoDB = async (): Promise<void> => {
  if (mongoose.connection.readyState === 1) {
    logger.info("Already connected to MongoDB");
    return;
  }

  const mongoURI =
    process.env.MONGO_URI || "mongodb://127.0.0.1:27017/${dbName}?replicaSet=rs0";

  try {
    await mongoose.connect(mongoURI);
    logger.info("Connected to MongoDB");
  } catch (error: unknown) {
    logger.error(\`MongoDB connection error: \${error}\`);
    throw error;
  }

  mongoose.connection.on("error", (error: unknown) => {
    logger.error(\`MongoDB connection error: \${error}\`);
  });

  mongoose.connection.on("disconnected", () => {
    logger.warn("MongoDB disconnected");
  });
};
`;
};

const generateBackendSeed = (args: BootstrapArgs): string => {
  const {appDisplayName} = args;
  return `import {
  APIError,
  createBetterAuth,
  getMongoClientFromMongoose,
  logger,
  Membership,
  Organization,
  runSeedCli,
  seedBetterAuthUser,
  type SeedStep,
  type UserModel as TerrenoAuthUserModel,
} from "@terreno/api";
import mongoose from "mongoose";

import {access} from "../access";
import {User} from "../models/user";
import {buildBetterAuthConfig} from "../utils/betterAuthConfig";
import {connectToMongoDB} from "../utils/database";

const SEED_USERS = [
  {
    admin: false,
    email: "test@example.com",
    name: "Test User",
    password: "testpassword123",
  },
  {
    admin: true,
    email: "admin@example.com",
    name: "Admin User",
    password: "testpassword123",
  },
];

const seedSteps: SeedStep[] = [
  {
    description: "Create login-ready development users and reconcile profile fields",
    name: "users",
    run: async (context) => {
      if (context.dryRun) {
        for (const user of SEED_USERS) {
          const existing = await User.findByEmail(user.email);
          context.changes.push({
            change: existing ? "updated" : "created",
            count: 1,
            key: JSON.stringify({email: user.email}),
            model: User.modelName,
          });
        }
        return;
      }

      const config = buildBetterAuthConfig();
      if (!config) {
        throw new APIError({
          status: 500,
          title: "Seed users require Better Auth to be enabled",
        });
      }
      const auth = createBetterAuth({
        config,
        mongoClient: getMongoClientFromMongoose(),
        userModel: User as unknown as TerrenoAuthUserModel,
      });
      for (const definition of SEED_USERS) {
        const user = await seedBetterAuthUser({
          auth,
          user: definition,
          userModel: User as unknown as TerrenoAuthUserModel,
        });
        const appUser = user as unknown as {
          admin: boolean;
          save: () => Promise<unknown>;
        };
        appUser.admin = definition.admin;
        const roles = (appUser as unknown as {roles?: string[]}).roles ?? [];
        if (definition.admin && !roles.includes("operator")) {
          (appUser as unknown as {roles: string[]}).roles = [...roles, "operator"];
        }
        await appUser.save();
      }
    },
  },
  {
    description: "Create the default organization and attach the admin as org-admin",
    name: "organization",
    run: async (context) => {
      await access.roles.seedDefaults();
      const existing = await Organization.findOneOrNone({name: "${appDisplayName}"});
      if (context.dryRun) {
        context.changes.push({
          change: existing ? "updated" : "created",
          count: 1,
          key: JSON.stringify({name: "${appDisplayName}"}),
          model: Organization.modelName,
        });
        return;
      }
      const admin = await User.findByEmail("admin@example.com");
      if (!admin) {
        throw new APIError({
          status: 500,
          title: "Default organization requires admin@example.com",
        });
      }
      const organization =
        existing ??
        (await Organization.create({
          name: "${appDisplayName}",
          ownerId: admin._id,
        }));
      const membership = await Membership.findOneOrNone({
        organizationId: organization._id,
        userId: admin._id,
      });
      if (!membership) {
        await Membership.create({
          organizationId: organization._id,
          roleName: "org-admin",
          userId: admin._id,
        });
      }
    },
  },
];

const main = async (): Promise<void> => {
  const cli = await runSeedCli({
    allowProductionReset: () => process.env.ALLOW_SEED_RESET === "true",
    connect: connectToMongoDB,
    disconnect: async () => {
      await mongoose.disconnect();
    },
    name: "bun run seed",
    steps: seedSteps,
  });
  if (cli.help) {
    logger.info(cli.help);
  }
  process.exit(cli.exitCode);
};

main().catch((error: unknown) => {
  logger.error(\`Seed failed: \${error}\`);
  process.exit(1);
});
`;
};

const generateBackendBetterAuthConfig = (args: BootstrapArgs): string => {
  const {appName} = args;
  return `import type {AuthProvider, BetterAuthConfig} from "@terreno/api";

const DEFAULT_BETTER_AUTH_URL = "http://localhost:4000";
const DEFAULT_WEB_ORIGINS = ["http://localhost:8082", "http://127.0.0.1:8082"];
const APP_SCHEMES = ["${appName}://", "exp://"];

export const getAuthProvider = (): AuthProvider => {
  const provider = process.env.AUTH_PROVIDER as AuthProvider | undefined;
  return provider ?? "better-auth";
};

export const getWebOrigins = (): string[] => {
  const origins = new Set<string>(DEFAULT_WEB_ORIGINS);
  const fromEnv = process.env.CORS_ORIGINS?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  for (const origin of fromEnv ?? []) {
    origins.add(origin);
  }
  return [...origins];
};

export const buildBetterAuthConfig = (): BetterAuthConfig | undefined => {
  if (getAuthProvider() !== "better-auth") {
    return undefined;
  }

  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is required when AUTH_PROVIDER=better-auth");
  }

  return {
    baseURL: process.env.BETTER_AUTH_URL ?? DEFAULT_BETTER_AUTH_URL,
    crossDomainCookies: process.env.CROSS_DOMAIN_AUTH_COOKIES === "true",
    enabled: true,
    secret,
    trustedOrigins: [...APP_SCHEMES, ...getWebOrigins()],
  };
};
`;
};

const generateBackendModelPlugins = (): string => {
  return `import {
  createdUpdatedPlugin,
  findExactlyOne,
  findOneOrNone,
  isDeletedPlugin,
} from "@terreno/api";
import type mongoose from "mongoose";

// noExplicitAny: Leaving open for flexibility
// biome-ignore lint/suspicious/noExplicitAny: Leaving open for flexibility
export function addDefaultPlugins(schema: mongoose.Schema<any, any, any, any>): void {
  schema.plugin(createdUpdatedPlugin);
  schema.plugin(isDeletedPlugin);
  schema.plugin(findOneOrNone);
  schema.plugin(findExactlyOne);
}
`;
};

const generateBackendUserModel = (): string => {
  return `import mongoose from "mongoose";
import passportLocalMongoose from "passport-local-mongoose";
import type {UserDocument, UserModel} from "../types";
import {addDefaultPlugins} from "./modelPlugins";

const userSchema = new mongoose.Schema<UserDocument, UserModel>(
  {
    admin: {
      default: false,
      description: "Whether the user has administrator access",
      type: Boolean,
    },
    betterAuthId: {
      description: "Identifier linking to the Better Auth session provider",
      index: true,
      sparse: true,
      type: String,
    },
    email: {
      description: "The user's email address, used for authentication",
      lowercase: true,
      required: true,
      trim: true,
      type: String,
      unique: true,
    },
    name: {
      description: "The user's display name",
      required: true,
      trim: true,
      type: String,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

userSchema.plugin(passportLocalMongoose, {
  usernameField: "email",
});

addDefaultPlugins(userSchema);

userSchema.method("getDisplayName", function (this: UserDocument): string {
  return this.name;
});

export const User = mongoose.model<UserDocument, UserModel>("User", userSchema);

User.findByEmail = async function (email: string): Promise<UserDocument | null> {
  return this.findOneOrNone({email: email.toLowerCase()});
};
`;
};

const generateBackendAppConfiguration = (args: BootstrapArgs): string => {
  const {appDisplayName} = args;
  return `import {configurationPlugin, createdUpdatedPlugin} from "@terreno/api";
import mongoose, {Schema} from "mongoose";

const generalSchema = new Schema(
  {
    appName: {
      default: "${appDisplayName}",
      description: "Display name of the application",
      type: String,
    },
    maintenanceMode: {
      default: false,
      description: "When enabled, the app returns 503 for all non-admin requests",
      type: Boolean,
    },
  },
  {_id: false}
);

const debugSchema = new Schema(
  {
    websocketsDebug: {
      default: false,
      description: "Enable verbose WebSocket and realtime sync debug logging",
      type: Boolean,
    },
  },
  {_id: false}
);

export interface AppConfigDocument {
  general: {
    appName: string;
    maintenanceMode: boolean;
  };
  debug: {
    websocketsDebug: boolean;
  };
}

const appConfigSchema = new Schema<AppConfigDocument>(
  {
    general: {
      description: "General application settings",
      type: generalSchema,
    },
    debug: {
      description: "Debug and diagnostic settings",
      type: debugSchema,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

appConfigSchema.plugin(configurationPlugin);
appConfigSchema.plugin(createdUpdatedPlugin);

export const AppConfiguration = mongoose.model<AppConfigDocument>(
  "AppConfiguration",
  appConfigSchema
);
`;
};

const generateBackendOrganizationSettings = (): string => {
  return `import {createOrganizationSettingsSchema} from "@terreno/api";

export const organizationSettingsSchema = createOrganizationSettingsSchema({
  timezone: {
    description: "IANA timezone used for organization-local dates",
    type: String,
  },
});
`;
};

const generateBackendOrganizationSettingsTypes = (): string => {
  return `export interface AppOrganizationSettings {
  timezone?: string;
}

declare module "@terreno/api" {
  interface OrganizationSettings extends AppOrganizationSettings {}
}
`;
};

const generateBackendModelsIndex = (): string => {
  return `export * from "./appConfiguration";
export * from "./organizationSettings";
export * from "./user";
`;
};

const generateBackendUserRoutes = (): string => {
  return `import {Permissions, modelRouter} from "@terreno/api";
import type {Model} from "mongoose";
import {User} from "../models/user";
import type {UserDocument} from "../types";

export const userRouter = modelRouter("/users", User as unknown as Model<UserDocument>, {
  permissions: {
    create: [Permissions.IsAdmin],
    delete: [Permissions.IsAdmin],
    list: [Permissions.IsAdmin],
    read: [Permissions.IsAdmin],
    update: [Permissions.IsAdmin],
  },
  queryFields: ["email", "name"],
  sort: "name",
});
`;
};

const generateBackendTypes = (): string => {
  return `export * from "./models";
`;
};

const generateBackendTypesModels = (): string => {
  return `export * from "./organizationSettingsTypes";
export * from "./userTypes";
`;
};

const generateBackendUserTypes = (): string => {
  return `import type {APIErrorConstructor} from "@terreno/api";
import type mongoose from "mongoose";
import type {Document, Model} from "mongoose";
import type {
  PassportLocalMongooseDocument,
  PassportLocalMongooseModel,
} from "passport-local-mongoose";

type ModelQuery<T> = Partial<Record<keyof T, unknown>> & Record<string, unknown>;

export interface DefaultStatics<T> {
  findOneOrNone(
    query: ModelQuery<T>,
    errorArgs?: Partial<APIErrorConstructor>
  ): Promise<(Document & T) | null>;

  findExactlyOne(
    query: ModelQuery<T>,
    errorArgs?: Partial<APIErrorConstructor>
  ): Promise<Document & T>;
}

export interface DefaultPluginFields {
  created: Date;
  updated: Date;
  deleted: boolean;
}

export type DefaultModel<T> = Model<T & DefaultPluginFields> & DefaultStatics<T>;
export type DefaultDoc = mongoose.Document<mongoose.Types.ObjectId> & DefaultPluginFields;

export type UserMethods = {
  getDisplayName: (this: UserDocument) => string;
};

export type UserStatics = DefaultStatics<UserDocument> & {
  findByEmail: (this: UserModel, email: string) => Promise<UserDocument | null>;
};

export type UserModel = DefaultModel<UserDocument> &
  UserStatics &
  PassportLocalMongooseModel<UserDocument>;

export type UserSchema = mongoose.Schema<UserDocument, UserModel, UserMethods>;

export type UserDocument = DefaultDoc &
  UserMethods &
  PassportLocalMongooseDocument & {
    admin: boolean;
    betterAuthId?: string;
    email: string;
    name: string;
  };
`;
};

// Frontend file generators
const generateFrontendPackageJson = (args: BootstrapArgs): string => {
  const {appName} = args;
  return JSON.stringify(
    {
      dependencies: {
        "@better-auth/expo": BETTER_AUTH_VERSION,
        "@expo/vector-icons": "^15.1.1",
        "@react-native-async-storage/async-storage": "2.2.0",
        "@sentry/react": "^10.29.0",
        "@terreno/admin-frontend": TERRENO_DEP_VERSION,
        "@terreno/syncdb": TERRENO_DEP_VERSION,
        "@terreno/ui": TERRENO_DEP_VERSION,
        "better-auth": BETTER_AUTH_VERSION,
        expo: "~58.0.14",
        "expo-constants": "~58.0.12",
        "expo-network": "~58.0.3",
        "expo-router": "~58.0.23",
        "expo-secure-store": "~58.0.2",
        "expo-sqlite": "~58.0.13",
        lodash: "^4.18.1",
        luxon: "^3.7.2",
        react: "19.3.0",
        "react-dom": "19.3.0",
        "react-native": "0.88.0",
        "react-native-reanimated": "4.7.1",
      },
      devDependencies: {
        "@biomejs/biome": "^2.3.6",
        "@playwright/test": "^1.58.2",
        "@types/bun": "^1.4.0",
        "@types/lodash": "^4.17.17",
        "@types/luxon": "^3.7.1",
        "@types/react": "~19.3.0",
        typescript: "~6.0.3",
      },
      main: "expo-router/entry",
      name: `@${appName}/frontend`,
      private: true,
      scripts: {
        android: "EXPO_UNSTABLE_MCP_SERVER=1 bun expo start --android --port 8082",
        "api-sdk": API_SDK_SCRIPT,
        compile: "tsc",
        ios: "EXPO_UNSTABLE_MCP_SERVER=1 bun expo start --ios --port 8082",
        lint: "bun biome check .",
        "lint:fix": "bun biome check --write .",
        "lint:unsafefix": "biome check --write . --unsafe",
        sdk: "bun run api-sdk",
        start: "EXPO_UNSTABLE_MCP_SERVER=1 bun expo start --port 8082",
        test: "bun test",
        web: "EXPO_UNSTABLE_MCP_SERVER=1 bun expo start --web --port 8082",
      },
      version: "1.0.0",
    },
    null,
    2
  );
};

const generateFrontendAppJson = (args: BootstrapArgs): string => {
  const {appDisplayName, appName} = args;
  return JSON.stringify(
    {
      // No icon/splash/favicon keys: Expo falls back to its built-in defaults, so a freshly
      // generated app bundles without any binary assets. Add your own branding later and
      // point `icon`, `android.adaptiveIcon`, `splash`, and `web.favicon` at those files.
      expo: {
        experiments: {
          typedRoutes: true,
        },
        ios: {
          supportsTablet: true,
        },
        name: appDisplayName,
        orientation: "portrait",
        plugins: ["expo-router"],
        scheme: appName,
        slug: appName,
        userInterfaceStyle: "automatic",
        version: "1.0.0",
        web: {
          bundler: "metro",
          output: "static",
        },
      },
    },
    null,
    2
  );
};

const generateFrontendTsConfig = (): string => {
  // No `baseUrl`: it is deprecated as of TypeScript 6 and makes `tsc` abort with TS5101
  // before checking a single file. `paths` entries are relative to this tsconfig instead.
  // Module, target, JSX, and lib settings come from `expo/tsconfig.base`.
  return JSON.stringify(
    {
      compilerOptions: {
        paths: {
          "@/*": ["./*"],
          "@components/*": ["./components/*"],
          "@store/*": ["./store/*"],
          "@utils": ["./utils/index"],
          "@utils/*": ["./utils/*"],
        },
        strict: true,
        types: ["bun", "react-native", "@types/react"],
      },
      extends: "expo/tsconfig.base",
      include: ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"],
    },
    null,
    2
  );
};

const generateFrontendMetroConfig = (): string => {
  return `const {getDefaultConfig} = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // @terreno/admin-frontend imports jspdf for its consent-PDF export. jspdf's CommonJS and
  // Node builds wrap an AMD-style \`require(["html2canvas"], cb)\` call that Metro's static
  // transform cannot parse, which fails the whole bundle — including Expo Router's static
  // web render, which resolves under a "node" condition and would otherwise pick
  // jspdf.node.min.js. Pin every jspdf request to the ESM browser build on web, and drop it
  // on native, where PDF export is unavailable and jspdf's browser/Node APIs are missing.
  if (moduleName === "jspdf" || moduleName.startsWith("jspdf/dist/jspdf.node")) {
    if (platform !== "web") {
      return {type: "empty"};
    }
    try {
      const jspdfDir = path.dirname(require.resolve("jspdf/package.json", {paths: [__dirname]}));
      return {
        filePath: path.join(jspdfDir, "dist", "jspdf.es.min.js"),
        type: "sourceFile",
      };
    } catch {
      // jspdf is not installed — let Metro report the failure itself.
    }
  }

  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
`;
};

const generateFrontendBiomeJsonc = (): string => {
  return `{
  "$schema": "./node_modules/@biomejs/biome/configuration_schema.json",
  "assist": {
    "actions": {
      "source": {
        "organizeImports": "on",
        "useSortedAttributes": "on",
        "useSortedKeys": "on"
      }
    },
    "enabled": true
  },
  "files": {
    "includes": [
      "package.json",
      "app/**/*.ts",
      "app/**/*.tsx",
      "components/**/*.ts",
      "components/**/*.tsx",
      "store/**/*.ts",
      "store/**/*.tsx",
      "utils/**/*.ts",
      "utils/**/*.tsx",
      "constants/**/*.ts",
      "scripts/**/*.ts",
      "!!**/node_modules",
      "!!**/dist",
      "!!**/build",
      "!!**/coverage",
      "!!**/.expo",
      "!!**/.next",
      "!!**/generated",
      "!!**/.git"
    ]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "javascript": {
    "formatter": {
      "arrowParentheses": "always",
      "bracketSpacing": false,
      "jsxQuoteStyle": "double",
      "quoteStyle": "double",
      "semicolons": "always",
      "trailingCommas": "es5"
    },
    // TODO: Remove once we don't need to import React from 'react' in our JSX files.
    "jsxRuntime": "reactClassic"
  },
  "linter": {
    "enabled": true,
    "rules": {
      "nursery": {
        "noFloatingPromises": "error",
        "noMisusedPromises": "error",
        "useExhaustiveSwitchCases": "error"
      },
      "recommended": true,
      "suspicious": {
        "noConsole": {
          "level": "error",
          "options": {
            "allow": ["assert", "debug", "error", "info", "warn"]
          }
        },
        "noExplicitAny": "off",
        "noImplicitAnyLet": "off"
      }
    }
  },
  "vcs": {
    "clientKind": "git",
    "defaultBranch": "master",
    "enabled": true
  }
}
`;
};

const generateFrontendApiClient = (): string => {
  return `/**
 * Request client for every non-synced backend route (\`/auth/me\`, modelRouter actions, admin).
 * Synced collections go through \`syncDb\` instead. Generated hooks in \`store/apiSdk.ts\` use the
 * client that \`ApiClientProvider\` (in \`app/_layout.tsx\`) puts in context.
 */
import {type ApiClient, createApiClient} from "@terreno/syncdb/api";
import {appHeaders, baseUrl} from "@terreno/syncdb/config";
import {authProvider} from "@/store/syncdb";

/** Failures callers already handle (signed out, missing rows) are not worth a warning. */
const QUIET_STATUSES = new Set([401, 404]);

export const apiClient: ApiClient = createApiClient({
  authProvider,
  baseUrl,
  credentials: "include",
  headers: appHeaders,
  onError: (error, args): void => {
    if (QUIET_STATUSES.has(error.status)) {
      return;
    }
    console.warn(\`\${args.method ?? "GET"} \${args.url} failed: \${error.message}\`);
  },
});

/** Bearer header for \`@terreno/admin-frontend\`'s \`AdminProvider\` fetch client. */
export const getAdminAuthHeaders = async (): Promise<Record<string, string>> => {
  const token = await authProvider.getToken();
  if (!token) {
    return {};
  }
  return {Authorization: \`Bearer \${token}\`};
};
`;
};

/**
 * Starter `store/apiSdk.ts`: the `/auth/me` hooks the profile screen uses, in the exact shape
 * `terreno-syncdb-codegen --api-out` emits. `bun run sdk` replaces it with hooks for every
 * non-synced route the running backend serves.
 */
const generateFrontendApiSdk = (): string => {
  return `// GENERATED by @terreno/syncdb (terreno-syncdb-codegen --api-out). Do not edit.
// Typed request hooks for every non-synced @terreno/api route. Synced collections use the
// collection hooks from the sync SDK instead. Run \`bun run sdk\` with the backend running to
// regenerate this file from its OpenAPI spec.
// biome-ignore-all lint/suspicious/noConfusingVoidType: no-argument operations type their argument as void so callers can omit it

import type {ApiRequestArgs} from "@terreno/syncdb/api";
import {
  type UseApiMutationOptions,
  type UseApiMutationResult,
  type UseApiQueryOptions,
  type UseApiQueryResult,
  type UseLazyApiQueryOptions,
  type UseLazyApiQueryResult,
  useApiMutation,
  useApiQuery,
  useLazyApiQuery,
} from "@terreno/syncdb/react";

type ApiSdkQueryOptions<T> = Omit<UseApiQueryOptions<T, T>, "providesTags" | "transformResponse">;
type ApiSdkLazyOptions<T> = Omit<UseLazyApiQueryOptions<T, never>, "providesTags" | "toRequest">;

export type GetAuthMeArgs = void;

export type GetAuthMeRes = {
  admin?: boolean;
  email: string;
  name?: string;
  _id: string;
  id: string;
  created?: string;
  updated?: string;
};

export const getAuthMeRequest = (): ApiRequestArgs => ({
  method: "GET",
  url: \`/auth/me\`,
});

/** Get the current user */
export const useGetAuthMeQuery = (
  _arg?: GetAuthMeArgs,
  options: ApiSdkQueryOptions<GetAuthMeRes> = {}
): UseApiQueryResult<GetAuthMeRes> =>
  useApiQuery<GetAuthMeRes>(getAuthMeRequest(), {...options, providesTags: ["auth"]});

export const useLazyGetAuthMeQuery = (
  options: ApiSdkLazyOptions<GetAuthMeRes> = {}
): UseLazyApiQueryResult<GetAuthMeRes, GetAuthMeArgs> =>
  useLazyApiQuery<GetAuthMeRes, GetAuthMeArgs>({
    ...options,
    providesTags: ["auth"],
    toRequest: (): ApiRequestArgs => getAuthMeRequest(),
  });

export type PatchAuthMeArgs = {
  email?: string;
  name?: string;
};

export type PatchAuthMeRes = GetAuthMeRes;

export const patchAuthMeRequest = (arg: PatchAuthMeArgs): ApiRequestArgs => ({
  body: arg,
  method: "PATCH",
  url: \`/auth/me\`,
});

/** Update the current user */
export const usePatchAuthMeMutation = (
  options: UseApiMutationOptions<PatchAuthMeArgs, PatchAuthMeRes> = {}
): UseApiMutationResult<PatchAuthMeArgs, PatchAuthMeRes> =>
  useApiMutation<PatchAuthMeArgs, PatchAuthMeRes>(patchAuthMeRequest, {
    invalidatesTags: ["auth"],
    ...options,
  });
`;
};

const generateFrontendRootLayout = (_args: BootstrapArgs): string => {
  return `import {SessionProvider, useSession} from "@terreno/syncdb/auth";
import {baseUrl} from "@terreno/syncdb/config";
import {ApiClientProvider, SyncDbProvider} from "@terreno/syncdb/react";
import {Spinner, TerrenoProvider} from "@terreno/ui";
import {Stack} from "expo-router";
import {DefaultTheme, ThemeProvider} from "expo-router/react-navigation";
import type React from "react";
import {useEffect} from "react";
import "react-native-reanimated";
import {installDevConsoleLogger} from "@terreno/syncdb/app";
import {betterAuthClient} from "@/lib/betterAuth";
import {apiClient} from "@/store/apiClient";
import {setSyncDbReady, syncDb} from "@/store/syncdb";

// Dev-only: forwards console errors/warnings and uncaught errors to the backend's
// POST /__terreno/browser-logs so terreno-mcp-local \`read_logs\` / \`last_error\` can read them.
// No-op outside __DEV__.
installDevConsoleLogger({baseUrl});

export {ErrorBoundary} from "expo-router";

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

// Logging out signs syncDb out (stop + wipe) and drops cached API responses so the next
// user never sees the previous user's data.
const SYNC_DBS = [syncDb];

// TerrenoProvider loads the Nunito/Titillium Web families @terreno/ui renders with, so this
// app ships no font assets of its own. Add \`useFonts\` here only for extra custom faces.
// SessionProvider owns the Better Auth session (\`useSession()\`); ApiClientProvider gives the
// generated hooks in store/apiSdk.ts their request client. No Redux store.
export default function RootLayout(): React.ReactElement {
  return (
    <TerrenoProvider openAPISpecUrl={\`\${baseUrl}/openapi.json\`}>
      <ApiClientProvider client={apiClient}>
        <SessionProvider
          authClient={betterAuthClient}
          onLogout={apiClient.reset}
          syncDbs={SYNC_DBS}
        >
          <RootLayoutNav />
        </SessionProvider>
      </ApiClientProvider>
    </TerrenoProvider>
  );
}

function RootLayoutNav(): React.ReactElement {
  const {userId, isLoading: isAuthLoading} = useSession();

  // Start syncdb after login; stop on logout or user switch.
  useEffect(() => {
    if (!userId) {
      setSyncDbReady(false);
      return;
    }
    let stopped = false;
    void syncDb
      .start()
      .then(() => {
        if (!stopped) {
          setSyncDbReady(true);
        }
      })
      .catch((startError: unknown) => {
        console.error("[syncdb] start failed", startError);
        setSyncDbReady(false);
      });
    return () => {
      stopped = true;
      setSyncDbReady(false);
      void syncDb.stop();
    };
  }, [userId]);

  if (isAuthLoading) {
    return <Spinner />;
  }

  return (
    <SyncDbProvider client={syncDb}>
      <ThemeProvider value={DefaultTheme}>
        {/* Stack.Protected is the supported way to gate routes on auth state. Rendering
            Stack.Screen children behind a raw conditional (or a fragment) crashes the
            navigator, because Stack reads its screen config off the child elements. */}
        <Stack>
          <Stack.Protected guard={!userId}>
            <Stack.Screen name="login" options={{headerShown: false}} />
            <Stack.Screen name="signup" options={{headerShown: false}} />
          </Stack.Protected>
          <Stack.Protected guard={Boolean(userId)}>
            <Stack.Screen name="(tabs)" options={{headerShown: false}} />
          </Stack.Protected>
        </Stack>
      </ThemeProvider>
    </SyncDbProvider>
  );
}
`;
};

const generateFrontendLogin = (): string => {
  return `import {useSession} from "@terreno/syncdb/auth";
import {baseUrl} from "@terreno/syncdb/config";
import {LoginScreen} from "@terreno/ui";
import {useRouter} from "expo-router";
import type React from "react";
import {useCallback, useState} from "react";
import {betterAuthClient} from "@/lib/betterAuth";

const Login: React.FC = () => {
  const router = useRouter();
  const {refresh} = useSession();
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (values: Record<string, string>): Promise<void> => {
      const {email, password} = values;
      setErrorMessage(undefined);
      setIsSubmitting(true);
      try {
        const result = await betterAuthClient.signIn.email({email, password});
        if (result.error) {
          setErrorMessage(result.error.message ?? "Sign in failed.");
          return;
        }
        // Resolve the new session now instead of waiting for the next session push.
        await refresh();
        router.replace("/(tabs)");
      } catch (error: unknown) {
        console.error("[login] Sign in threw", {baseUrl, error});
        setErrorMessage("Sign in failed. Please try again.");
      } finally {
        setIsSubmitting(false);
      }
    },
    [refresh, router]
  );

  return (
    <LoginScreen
      error={errorMessage}
      fields={[
        {autoComplete: "off", label: "Email", name: "email", required: true, type: "email"},
        {label: "Password", name: "password", required: true, type: "password"},
      ]}
      loading={isSubmitting}
      onSignUpPress={() => router.push("/signup")}
      onSubmit={handleSubmit}
      title="Welcome"
    />
  );
};

export default Login;
`;
};

const generateFrontendSignup = (): string => {
  return `import {useSession} from "@terreno/syncdb/auth";
import {SignUpScreen, simplePasswordRequirements} from "@terreno/ui";
import {useRouter} from "expo-router";
import type React from "react";
import {useCallback, useState} from "react";
import {betterAuthClient} from "@/lib/betterAuth";

const SignUp: React.FC = () => {
  const router = useRouter();
  const {refresh} = useSession();
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (values: Record<string, string>): Promise<void> => {
      const {email, password, name} = values;
      setErrorMessage(undefined);
      setIsSubmitting(true);
      try {
        const result = await betterAuthClient.signUp.email({email, name, password});
        if (result.error) {
          setErrorMessage(result.error.message ?? "Sign up failed.");
          return;
        }
        // Resolve the new session now instead of waiting for the next session push.
        await refresh();
        router.replace("/(tabs)");
      } catch {
        setErrorMessage("Sign up failed. Please try again.");
      } finally {
        setIsSubmitting(false);
      }
    },
    [refresh, router]
  );

  return (
    <SignUpScreen
      error={errorMessage}
      fields={[
        {label: "Name", name: "name", required: true, type: "text"},
        {autoComplete: "off", label: "Email", name: "email", required: true, type: "email"},
        {label: "Password", name: "password", required: true, type: "password"},
      ]}
      loading={isSubmitting}
      onLoginPress={() => router.back()}
      onSubmit={handleSubmit}
      passwordRequirements={simplePasswordRequirements}
    />
  );
};

export default SignUp;
`;
};

const generateFrontendTabsLayout = (): string => {
  return `import FontAwesome from "@expo/vector-icons/FontAwesome";
import {useTheme} from "@terreno/ui";
import {Tabs} from "expo-router";
import type React from "react";
import type {ColorValue} from "react-native";

type IconColor = React.ComponentProps<typeof FontAwesome>["color"];

const TabBarIcon: React.FC<{
  name: React.ComponentProps<typeof FontAwesome>["name"];
  color: ColorValue;
}> = ({name, color}) => {
  // React Native 0.88's ColorValue also admits number and null; tab tints are theme strings.
  return (
    <FontAwesome color={color as IconColor} name={name} size={24} style={{marginBottom: -3}} />
  );
};

const TabLayout: React.FC = () => {
  const {theme} = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.surface.primary,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({color}) => <TabBarIcon color={color} name="home" />,
          title: "Home",
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          headerShown: false,
          tabBarIcon: ({color}) => <TabBarIcon color={color} name="user" />,
          title: "Profile",
        }}
      />
      <Tabs.Screen
        name="admin"
        options={{
          headerShown: false,
          tabBarIcon: ({color}) => <TabBarIcon color={color} name="cog" />,
          title: "Admin",
        }}
      />
    </Tabs>
  );
};

export default TabLayout;
`;
};

const generateFrontendTabsIndex = (args: BootstrapArgs): string => {
  const {appDisplayName} = args;
  return `import {Box, Heading, Page, Text} from "@terreno/ui";
import type React from "react";

const HomeScreen: React.FC = () => {
  return (
    <Page navigation={undefined} title="Home">
      <Box padding={4} gap={4}>
        <Heading>Welcome to ${appDisplayName}</Heading>
        <Text>Your app is ready for development!</Text>
        <Text color="secondaryDark">
          Start by adding models to the backend and screens to the frontend.
        </Text>
      </Box>
    </Page>
  );
};

export default HomeScreen;
`;
};

const generateFrontendTabsProfile = (): string => {
  return `import {useSession} from "@terreno/syncdb/auth";
import {Box, Button, Card, Heading, Page, Spinner, TapToEdit, Text, TextField} from "@terreno/ui";
import type React from "react";
import {useCallback, useEffect, useMemo, useState} from "react";
import {useGetAuthMeQuery, usePatchAuthMeMutation} from "@/store/apiSdk";

const ProfileScreen: React.FC = () => {
  const {logout} = useSession();
  const {data: user, isLoading} = useGetAuthMeQuery();
  const [updateProfile] = usePatchAuthMeMutation();
  const [name, setName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [currentPassword, setCurrentPassword] = useState<string>("");
  const [saveError, setSaveError] = useState<string | null>(null);

  // Copy the server name into local state without resetting an in-progress email edit.
  useEffect(() => {
    if (!user) {
      return;
    }
    setName(user.name || "");
  }, [user?.name]);

  // Copy the server email into local state without resetting an in-progress name edit.
  useEffect(() => {
    if (!user) {
      return;
    }
    setEmail(user.email || "");
  }, [user?.email]);

  // logout signs syncDb out, then Better Auth, and clears cached API responses.
  const handleLogout = useCallback(async (): Promise<void> => {
    await logout();
  }, [logout]);

  const handleSaveName = useCallback(
    async (value: string): Promise<void> => {
      setSaveError(null);
      try {
        await updateProfile({name: value}).unwrap();
      } catch (err) {
        console.error("Error updating name:", err);
        setSaveError("Failed to update name");
      }
    },
    [updateProfile]
  );

  // Changing the email needs the current password; an unchanged or re-cased email does not.
  const isEmailChanged = useMemo(
    (): boolean => email.trim().toLowerCase() !== (user?.email ?? "").trim().toLowerCase(),
    [email, user?.email]
  );

  const handleSaveEmail = useCallback(
    async (value: string): Promise<void> => {
      setSaveError(null);
      try {
        const body = isEmailChanged ? {currentPassword, email: value} : {email: value};
        await updateProfile(body).unwrap();
        setCurrentPassword("");
      } catch (err) {
        console.error("Error updating email:", err);
        setSaveError(
          (err as {data?: {message?: string}})?.data?.message || "Failed to update email"
        );
      }
    },
    [currentPassword, isEmailChanged, updateProfile]
  );

  const handleSavePassword = useCallback(
    async (value: string): Promise<void> => {
      if (!value) {
        return;
      }
      setSaveError(null);
      try {
        await updateProfile({password: value}).unwrap();
        setPassword("");
      } catch (err) {
        console.error("Error updating password:", err);
        setSaveError("Failed to update password");
      }
    },
    [updateProfile]
  );

  if (isLoading) {
    return (
      <Page navigation={undefined} title="Profile">
        <Box alignItems="center" flex="grow" justifyContent="center" padding={4}>
          <Spinner />
        </Box>
      </Page>
    );
  }

  return (
    <Page navigation={undefined} scroll title="Profile">
      <Box gap={4} padding={4}>
        <Heading>Profile</Heading>
        <Card>
          <Box gap={4}>
            <TapToEdit
              onSave={handleSaveName}
              setValue={setName}
              title="Name"
              type="text"
              value={name}
            />
            <TapToEdit
              onSave={handleSaveEmail}
              setValue={setEmail}
              title="Email"
              type="email"
              value={email}
            />
            {isEmailChanged && (
              <TextField
                helperText="Enter your current password to change your email"
                onChange={setCurrentPassword}
                testID="profile-current-password-input"
                title="Current password"
                type="password"
                value={currentPassword}
              />
            )}
            <TapToEdit
              helperText="Leave blank to keep your current password"
              onSave={handleSavePassword}
              setValue={setPassword}
              title="New Password"
              type="password"
              value={password}
            />
            {saveError && <Text color="error">{saveError}</Text>}
          </Box>
        </Card>
        <Box marginTop={4}>
          <Button fullWidth onClick={handleLogout} text="Logout" variant="outline" />
        </Box>
      </Box>
    </Page>
  );
};

export default ProfileScreen;
`;
};

const generateFrontendAdminLayout = (): string => {
  return `import {AdminProvider} from "@terreno/admin-frontend";
import {baseUrl} from "@terreno/syncdb/config";
import {Stack} from "expo-router";
import type React from "react";
import {getAdminAuthHeaders} from "@/store/apiClient";

// AdminProvider binds every admin request to the API origin and the Better Auth session.
const AdminLayout: React.FC = () => {
  return (
    <AdminProvider
      apiBase="/admin"
      apiOrigin={baseUrl}
      getAuthHeaders={getAdminAuthHeaders}
      routeBase="/admin"
    >
      <Stack screenOptions={{headerShown: false}} />
    </AdminProvider>
  );
};

export default AdminLayout;
`;
};

const generateFrontendAdminIndex = (): string => {
  return `import {AdminModelList} from "@terreno/admin-frontend";
import type React from "react";

const AdminListScreen: React.FC = () => {
  return <AdminModelList baseUrl="/admin" configurationPath="/admin/configuration" />;
};

export default AdminListScreen;
`;
};

const generateFrontendAdminConfiguration = (): string => {
  return `import {ConfigurationScreen} from "@terreno/admin-frontend";
import type React from "react";

const ConfigurationPage: React.FC = () => {
  return <ConfigurationScreen />;
};

export default ConfigurationPage;
`;
};

const generateFrontendNotFound = (): string => {
  return `import {Box, Heading, Text} from "@terreno/ui";
import {Link, Stack} from "expo-router";
import type React from "react";

const NotFoundScreen: React.FC = () => {
  return (
    <>
      <Stack.Screen options={{title: "Oops!"}} />
      <Box alignItems="center" flex="grow" justifyContent="center" padding={4}>
        <Heading size="xl">This screen doesn't exist.</Heading>
        <Link href="/" style={{marginTop: 15, paddingVertical: 15}}>
          <Text color="link" size="md">
            Go to home screen!
          </Text>
        </Link>
      </Box>
    </>
  );
};

export default NotFoundScreen;
`;
};

const generateFrontendTheme = (): string => {
  return `// Theme configuration for the app
// Override these values to customize the app's appearance
// Colors are based on @terreno/ui's default theme primitives

export const primitives = {
  // Primary colors (teal/cyan)
  primary000: "#EBFAFF",
  primary050: "#BCE9F7",
  primary100: "#90D8F0",
  primary200: "#73CAE8",
  primary300: "#40B8E0",
  primary400: "#0E9DCD",
  primary500: "#0086B3",
  primary600: "#0A7092",
  primary700: "#035D7E",
  primary800: "#004B64",
  primary900: "#013749",

  // Secondary colors (dark teal)
  secondary000: "#F2F9FA",
  secondary050: "#D7E5EA",
  secondary100: "#B6CDD5",
  secondary200: "#9EB7BF",
  secondary300: "#87A1AA",
  secondary400: "#608997",
  secondary500: "#2B6072",
  secondary600: "#1C4E5F",
  secondary700: "#0F3D4D",
  secondary800: "#092E3A",
  secondary900: "#041E27",

  // Accent colors (gold/yellow)
  accent000: "#FFFDF7",
  accent050: "#FCECC2",
  accent100: "#F9E0A1",
  accent200: "#F7D582",
  accent300: "#F2CB62",
  accent400: "#E5B132",
  accent500: "#D69C0E",
  accent600: "#B58201",
  accent700: "#956A00",
  accent800: "#543C00",
  accent900: "#332400",

  // Neutral colors (grays)
  neutral000: "#FFFFFF",
  neutral050: "#F2F2F2",
  neutral100: "#E6E6E6",
  neutral200: "#D9D9D9",
  neutral300: "#CDCDCD",
  neutral400: "#B3B3B3",
  neutral500: "#949494",
  neutral600: "#686868",
  neutral700: "#4E4E4E",
  neutral800: "#353535",
  neutral900: "#1C1C1C",

  // Status colors
  error000: "#FDD7D7",
  error100: "#D33232",
  error200: "#BD1111",
  success000: "#DCF2E2",
  success100: "#3EA45C",
  success200: "#1A7F36",
  warning000: "#FFE3C6",
  warning100: "#F36719",
  warning200: "#B14202",
};

// Semantic color mappings - override these to change app appearance
export const colors = {
  // Backgrounds
  background: primitives.neutral000,
  backgroundSecondary: primitives.neutral050,

  // Text
  text: primitives.neutral900,
  textSecondary: primitives.neutral600,
  textInverted: primitives.neutral000,

  // Primary action colors
  primary: primitives.primary400,
  primaryDark: primitives.primary600,
  primaryLight: primitives.primary100,

  // Secondary colors
  secondary: primitives.secondary500,
  secondaryDark: primitives.secondary700,
  secondaryLight: primitives.secondary100,

  // Accent colors
  accent: primitives.accent500,
  accentDark: primitives.accent700,
  accentLight: primitives.accent100,

  // Status colors
  error: primitives.error100,
  errorLight: primitives.error000,
  success: primitives.success100,
  successLight: primitives.success000,
  warning: primitives.warning100,
  warningLight: primitives.warning000,

  // UI elements
  border: primitives.neutral300,
  borderFocus: primitives.primary200,
  icon: primitives.neutral600,
  tint: primitives.primary400,

  // Tab bar
  tabIconDefault: primitives.neutral600,
  tabIconSelected: primitives.primary400,
};

export default colors;
`;
};

const generateFrontendEnv = (): string => {
  return `EXPO_PUBLIC_API_URL=http://localhost:4000
`;
};

const generateBackendEnvExample = (args: BootstrapArgs): string => {
  const {appName} = args;
  const dbName = appName.replace(/-/g, "_");
  return `# Copy to backend/.env and fill in production values (Secret Manager / platform secrets).
# MongoDB must be a replica set for sync and realtime — see deployment baseline docs.

MONGO_URI=mongodb://127.0.0.1:27017/${dbName}?replicaSet=rs0
AUTH_PROVIDER=better-auth
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=https://api.example.com
CORS_ORIGINS=https://app.example.com
TOKEN_SECRET=
TOKEN_ISSUER=
REFRESH_TOKEN_SECRET=
SESSION_SECRET=
PORT=8080
NODE_ENV=production
`;
};

const generateFrontendEnvExample = (): string => {
  return `# Copy to frontend/.env for local dev, or export before web build.
# EXPO_PUBLIC_* is inlined at export time — set before \`bun expo export --platform web\`.

EXPO_PUBLIC_API_URL=https://api.example.com
`;
};

const generateBackendEnv = (args: BootstrapArgs): string => {
  const {appName} = args;
  const dbName = appName.replace(/-/g, "_");
  return `MONGO_URI=mongodb://127.0.0.1:27017/${dbName}?replicaSet=rs0
AUTH_PROVIDER=better-auth
BETTER_AUTH_SECRET=${appName}-better-auth-secret-dev-only-32chars
BETTER_AUTH_URL=http://localhost:4000
TOKEN_SECRET=dev-token-secret
TOKEN_ISSUER=${appName}-dev
REFRESH_TOKEN_SECRET=dev-refresh-secret
SESSION_SECRET=dev-session-secret
PORT=4000
# TerrenoApp registers POST /__terreno/browser-logs (terreno-mcp-local read_logs) only in development.
NODE_ENV=development
`;
};

const generateFrontendBetterAuthLib = (args: BootstrapArgs): string => {
  const {appName} = args;
  return `import {createBetterAuthClient} from "@terreno/syncdb/auth";
import {baseUrl} from "@terreno/syncdb/config";
import Constants from "expo-constants";

const getAppScheme = (): string => {
  const expoExtra = Constants.expoConfig?.extra;
  return expoExtra?.scheme ?? "${appName}";
};

/**
 * Expo-ready Better Auth client (SecureStore on native, AsyncStorage on web). Feeds
 * \`SessionProvider\` (app/_layout.tsx) and the shared auth provider in store/syncdb.ts.
 */
export const betterAuthClient = createBetterAuthClient({
  baseURL: baseUrl,
  scheme: getAppScheme(),
  storagePrefix: "${appName}",
});
`;
};

const generateFrontendSyncDb = (args: BootstrapArgs): string => {
  const {appName} = args;
  return `import {
  betterAuthAdapter,
  bridgeBetterAuthReactClient,
  createSyncDb,
  type SyncDb,
} from "@terreno/syncdb";
import {baseUrl} from "@terreno/syncdb/config";
import {betterAuthClient} from "@/lib/betterAuth";

export const SYNC_DB_NAME = "${appName}";

/** Add synced collection names here as you register modelRouter sync scopes on the backend. */
export const SYNC_COLLECTIONS: string[] = [];

/**
 * Shared by the sync client and the request client (store/apiClient.ts) so both send the same
 * Better Auth session token and refresh the same way. bridgeBetterAuthReactClient turns the
 * Better Auth session atom into push updates; pollIntervalMs is only a fallback if that atom
 * is unavailable, so keep it slow.
 */
export const authProvider = betterAuthAdapter(bridgeBetterAuthReactClient(betterAuthClient), {
  pollIntervalMs: 60_000,
});

export const syncDb: SyncDb = createSyncDb({
  authProvider,
  baseUrl,
  collections: SYNC_COLLECTIONS,
  name: SYNC_DB_NAME,
});

/**
 * Tracks whether \`syncDb.start()\` has resolved for the current login. Screens gate
 * \`mutate()\` on it: \`start()\` must resolve an authenticated user before writes are safe.
 */
let syncDbReady = false;
const syncDbReadyListeners = new Set<() => void>();

export const setSyncDbReady = (ready: boolean): void => {
  if (syncDbReady === ready) {
    return;
  }
  syncDbReady = ready;
  for (const listener of syncDbReadyListeners) {
    listener();
  }
};

export const subscribeSyncDbReady = (listener: () => void): (() => void) => {
  syncDbReadyListeners.add(listener);
  return () => {
    syncDbReadyListeners.delete(listener);
  };
};

export const getSyncDbReadySnapshot = (): boolean => syncDbReady;
`;
};

const generateFrontendUtilsIndex = (): string => {
  return `export const captureException = (error: unknown): void => {
  console.error("Captured exception:", error);
};

export const captureMessage = (message: string): void => {
  console.warn("Captured message:", message);
};
`;
};

const generateBackendCiWorkflow = (_args: BootstrapArgs): string => {
  return `name: Backend CI

on:
  push:
    paths:
      - "backend/**"
      - ".github/workflows/backend-ci.yml"

jobs:
  lint-and-test:
    name: Backend Lint, Build, and Test
    runs-on: ubuntu-latest
    strategy:
      matrix:
        mongodb-version: ["6.0"]
    steps:
      - uses: actions/checkout@v6

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Cache Bun dependencies
        id: cache
        uses: actions/cache@v5
        with:
          path: |
            ~/.bun/install/cache
            node_modules
          key: bun-\${{ runner.os }}-\${{ github.ref }}-\${{ hashFiles('bun.lock', 'package.json') }}
          restore-keys: |
            bun-\${{ runner.os }}-\${{ github.ref }}-
            bun-\${{ runner.os }}-

      - name: Start MongoDB
        uses: supercharge/mongodb-github-action@1.12.1
        with:
          mongodb-version: \${{ matrix.mongodb-version }}

      - name: Install dependencies
        run: bun install
        working-directory: backend

      - name: Lint
        run: bun run lint
        working-directory: backend

      - name: Build
        run: bun run compile
        working-directory: backend

      - name: Test
        run: bun run test
        working-directory: backend
        env:
          CI: true
`;
};

const generateFrontendCiWorkflow = (_args: BootstrapArgs): string => {
  return `name: Frontend CI

on:
  push:
    paths:
      - "frontend/**"
      - ".github/workflows/frontend-ci.yml"

jobs:
  lint-and-test:
    name: Frontend Lint, Build, and Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Cache Bun dependencies
        id: cache
        uses: actions/cache@v5
        with:
          path: |
            ~/.bun/install/cache
            node_modules
          key: bun-\${{ runner.os }}-\${{ github.ref }}-\${{ hashFiles('bun.lock', 'package.json') }}
          restore-keys: |
            bun-\${{ runner.os }}-\${{ github.ref }}-
            bun-\${{ runner.os }}-

      - name: Install dependencies
        run: bun install
        working-directory: frontend

      - name: Lint
        run: bun run lint
        working-directory: frontend

      - name: TypeScript compile
        run: bun run compile
        working-directory: frontend

      - name: Test
        run: bun run test
        working-directory: frontend
        env:
          CI: true
`;
};

export const getFenceLanguage = (filePath: string): string => {
  if (filePath.endsWith(".json") || filePath.endsWith(".jsonc")) {
    return "json";
  }
  if (filePath.endsWith(".js")) {
    return "javascript";
  }
  if (filePath.endsWith(".yml") || filePath.endsWith(".yaml")) {
    return "yaml";
  }
  if (filePath.endsWith(".md")) {
    return "markdown";
  }
  return "typescript";
};

export const generateAllFiles = (args: BootstrapArgs): GeneratedFile[] => {
  const frontendDir = `frontend`;
  const backendDir = `backend`;

  return [
    // Root files
    {content: generateRootGitignore(), path: ".gitignore"},
    {content: generateRootReadme(args), path: "README.md"},
    {content: generateRootDockerignore(), path: ".dockerignore"},
    {content: generateRootDockerfile(), path: "Dockerfile"},
    {content: generateCursorRules(args), path: ".cursorrules"},
    {content: generateMcpSettings(args), path: ".cursor/mcp.json"},
    {content: generateMcpSettings(args), path: ".mcp.json"},
    {content: generateClaudeMd(args), path: "CLAUDE.md"},

    // Backend files
    {content: generateBackendPackageJson(args), path: `${backendDir}/package.json`},
    {content: generateBackendTsConfig(), path: `${backendDir}/tsconfig.json`},
    {content: generateBackendBiomeJsonc(), path: `${backendDir}/biome.jsonc`},
    {content: generateBackendIndex(), path: `${backendDir}/src/index.ts`},
    {content: generateBackendAccess(), path: `${backendDir}/src/access.ts`},
    {content: generateBackendServer(args), path: `${backendDir}/src/server.ts`},
    {content: generateBackendDatabase(args), path: `${backendDir}/src/utils/database.ts`},
    {content: generateBackendSeed(args), path: `${backendDir}/src/scripts/seed.ts`},
    {
      content: generateBackendBetterAuthConfig(args),
      path: `${backendDir}/src/utils/betterAuthConfig.ts`,
    },
    {content: generateBackendEnv(args), path: `${backendDir}/.env`},
    {content: generateBackendEnvExample(args), path: `${backendDir}/.env.example`},
    {content: generateBackendModelPlugins(), path: `${backendDir}/src/models/modelPlugins.ts`},
    {content: generateBackendUserModel(), path: `${backendDir}/src/models/user.ts`},
    {
      content: generateBackendOrganizationSettings(),
      path: `${backendDir}/src/models/organizationSettings.ts`,
    },
    {
      content: generateBackendAppConfiguration(args),
      path: `${backendDir}/src/models/appConfiguration.ts`,
    },
    {content: generateBackendModelsIndex(), path: `${backendDir}/src/models/index.ts`},
    {content: generateBackendUserRoutes(), path: `${backendDir}/src/api/users.ts`},
    {content: generateBackendTypes(), path: `${backendDir}/src/types/index.ts`},
    {content: generateBackendTypesModels(), path: `${backendDir}/src/types/models/index.ts`},
    {content: generateBackendUserTypes(), path: `${backendDir}/src/types/models/userTypes.ts`},
    {
      content: generateBackendOrganizationSettingsTypes(),
      path: `${backendDir}/src/types/models/organizationSettingsTypes.ts`,
    },

    // Frontend files
    {content: generateFrontendPackageJson(args), path: `${frontendDir}/package.json`},
    {content: generateFrontendAppJson(args), path: `${frontendDir}/app.json`},
    {content: generateFrontendTsConfig(), path: `${frontendDir}/tsconfig.json`},
    {content: generateFrontendMetroConfig(), path: `${frontendDir}/metro.config.js`},
    {content: generateFrontendBiomeJsonc(), path: `${frontendDir}/biome.jsonc`},
    {content: generateFrontendRootLayout(args), path: `${frontendDir}/app/_layout.tsx`},
    {content: generateFrontendLogin(), path: `${frontendDir}/app/login.tsx`},
    {content: generateFrontendSignup(), path: `${frontendDir}/app/signup.tsx`},
    {content: generateFrontendNotFound(), path: `${frontendDir}/app/+not-found.tsx`},
    {content: generateFrontendTabsLayout(), path: `${frontendDir}/app/(tabs)/_layout.tsx`},
    {content: generateFrontendTabsIndex(args), path: `${frontendDir}/app/(tabs)/index.tsx`},
    {content: generateFrontendTabsProfile(), path: `${frontendDir}/app/(tabs)/profile.tsx`},
    {content: generateFrontendAdminLayout(), path: `${frontendDir}/app/(tabs)/admin/_layout.tsx`},
    {content: generateFrontendAdminIndex(), path: `${frontendDir}/app/(tabs)/admin/index.tsx`},
    {
      content: generateFrontendAdminConfiguration(),
      path: `${frontendDir}/app/(tabs)/admin/configuration.tsx`,
    },
    {content: generateFrontendApiClient(), path: `${frontendDir}/store/apiClient.ts`},
    {content: generateFrontendApiSdk(), path: `${frontendDir}/store/apiSdk.ts`},
    {content: generateFrontendBetterAuthLib(args), path: `${frontendDir}/lib/betterAuth.ts`},
    {content: generateFrontendSyncDb(args), path: `${frontendDir}/store/syncdb.ts`},
    {content: generateFrontendTheme(), path: `${frontendDir}/constants/theme.ts`},
    {content: generateFrontendUtilsIndex(), path: `${frontendDir}/utils/index.ts`},
    {content: generateFrontendEnv(), path: `${frontendDir}/.env`},
    {content: generateFrontendEnvExample(), path: `${frontendDir}/.env.example`},

    // GitHub Actions workflows
    {content: generateBackendCiWorkflow(args), path: ".github/workflows/backend-ci.yml"},
    {content: generateFrontendCiWorkflow(args), path: ".github/workflows/frontend-ci.yml"},
  ];
};
