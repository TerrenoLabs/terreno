import {describe, test} from "bun:test";
import {assert} from "chai";
import rootPackageJson from "../../../package.json";
import packageJson from "../../package.json";
import {
  BSON_VERSION,
  generateAllFiles,
  MONGODB_VERSION,
  MONGOOSE_VERSION,
  PLAYWRIGHT_MCP_PACKAGE_VERSION,
} from "../generate.js";

const EXPECTED_PATHS = [
  ".cursor/mcp.json",
  ".cursorrules",
  ".dockerignore",
  ".github/workflows/backend-ci.yml",
  ".github/workflows/frontend-ci.yml",
  ".gitignore",
  "CLAUDE.md",
  "Dockerfile",
  "README.md",
  "backend/.env",
  "backend/.env.example",
  "backend/biome.jsonc",
  "backend/package.json",
  "backend/src/access.ts",
  "backend/src/api/users.ts",
  "backend/src/index.ts",
  "backend/src/models/appConfiguration.ts",
  "backend/src/models/index.ts",
  "backend/src/models/modelPlugins.ts",
  "backend/src/models/organizationSettings.ts",
  "backend/src/models/user.ts",
  "backend/src/scripts/seed.ts",
  "backend/src/server.ts",
  "backend/src/types/index.ts",
  "backend/src/types/models/index.ts",
  "backend/src/types/models/organizationSettingsTypes.ts",
  "backend/src/types/models/userTypes.ts",
  "backend/src/utils/betterAuthConfig.ts",
  "backend/src/utils/database.ts",
  "backend/tsconfig.json",
  "frontend/.env",
  "frontend/.env.example",
  "frontend/app.json",
  "frontend/app/(tabs)/_layout.tsx",
  "frontend/app/(tabs)/admin/_layout.tsx",
  "frontend/app/(tabs)/admin/configuration.tsx",
  "frontend/app/(tabs)/admin/index.tsx",
  "frontend/app/(tabs)/index.tsx",
  "frontend/app/(tabs)/profile.tsx",
  "frontend/app/+not-found.tsx",
  "frontend/app/_layout.tsx",
  "frontend/app/login.tsx",
  "frontend/app/signup.tsx",
  "frontend/biome.jsonc",
  "frontend/constants/theme.ts",
  "frontend/lib/betterAuth.ts",
  "frontend/metro.config.js",
  "frontend/openapi-config.ts",
  "frontend/package.json",
  "frontend/scripts/generate-sdk.ts",
  "frontend/store/appState.ts",
  "frontend/store/betterAuthApi.ts",
  "frontend/store/errors.ts",
  "frontend/store/index.ts",
  "frontend/store/openApiSdk.ts",
  "frontend/store/sdk.ts",
  "frontend/store/syncdb.ts",
  "frontend/tsconfig.codegen.json",
  "frontend/tsconfig.json",
  "frontend/utils/index.ts",
];
const TERRENO_RANGE = `^${packageJson.version}`;

describe("generateAllFiles", () => {
  test("returns backend, frontend, CI, MCP, and seed files", () => {
    const files = generateAllFiles({
      appDisplayName: "My App",
      appName: "my-app",
    });
    const paths = files.map((file) => file.path);

    assert.deepEqual(paths.toSorted(), EXPECTED_PATHS);
  });

  test("pins every generated @terreno/* dependency to ^PACKAGE_VERSION", () => {
    const files = generateAllFiles({
      appDisplayName: "Pin App",
      appName: "pin-app",
    });

    const backendPackageJson = JSON.parse(
      files.find((file) => file.path === "backend/package.json")?.content ?? "{}"
    ) as {dependencies: Record<string, string>};
    const frontendPackageJson = JSON.parse(
      files.find((file) => file.path === "frontend/package.json")?.content ?? "{}"
    ) as {dependencies: Record<string, string>};

    assert.deepInclude(backendPackageJson.dependencies, {
      "@terreno/admin-backend": TERRENO_RANGE,
      "@terreno/api": TERRENO_RANGE,
    });
    assert.deepInclude(frontendPackageJson.dependencies, {
      "@terreno/admin-frontend": TERRENO_RANGE,
      "@terreno/rtk": TERRENO_RANGE,
      "@terreno/syncdb": TERRENO_RANGE,
      "@terreno/ui": TERRENO_RANGE,
    });
  });

  test("pins Expo native modules to SDK 57 majors", () => {
    const files = generateAllFiles({
      appDisplayName: "Expo App",
      appName: "expo-app",
    });
    const frontendPackageJson = JSON.parse(
      files.find((file) => file.path === "frontend/package.json")?.content ?? "{}"
    ) as {dependencies: Record<string, string>};

    assert.equal(frontendPackageJson.dependencies.expo, "~57.0.14");
    assert.equal(frontendPackageJson.dependencies["expo-router"], "~57.0.14");
    assert.equal(frontendPackageJson.dependencies["expo-constants"], "~57.0.12");
    assert.equal(frontendPackageJson.dependencies["expo-sqlite"], "~57.0.1");
  });

  test("generates the default MCP server configuration", () => {
    const files = generateAllFiles({
      appDisplayName: "Default MCP",
      appName: "default-mcp",
    });
    const mcpJson = JSON.parse(
      files.find((file) => file.path === ".cursor/mcp.json")?.content ?? "{}"
    ) as {
      mcpServers: Record<string, {args?: string[]; command?: string; type?: string; url?: string}>;
    };

    assert.equal(mcpJson.mcpServers.terreno.url, "https://mcp.terreno.app/mcp");
    assert.deepEqual(mcpJson.mcpServers.expo, {
      type: "http",
      url: "https://mcp.expo.dev/mcp",
    });
    assert.deepEqual(mcpJson.mcpServers.playwright.args, [
      "-y",
      `@playwright/mcp@${PLAYWRIGHT_MCP_PACKAGE_VERSION}`,
    ]);
    assert.equal(mcpJson.mcpServers["terreno-local"].command, "bunx");
    assert.deepEqual(mcpJson.mcpServers["terreno-local"].args, ["terreno-mcp-local"]);
  });

  test("uses a custom MCP server URL", () => {
    const files = generateAllFiles({
      appDisplayName: "Custom MCP",
      appName: "custom-mcp",
      mcpServerUrl: "https://custom.mcp.example.com",
    });
    const mcpJson = JSON.parse(
      files.find((file) => file.path === ".cursor/mcp.json")?.content ?? "{}"
    ) as {mcpServers: {terreno: {url: string}}};

    assert.equal(mcpJson.mcpServers.terreno.url, "https://custom.mcp.example.com/mcp");
  });

  test("includes a consumer backend Dockerfile with PORT and /health", () => {
    const files = generateAllFiles({
      appDisplayName: "Deploy App",
      appName: "deploy-app",
    });
    const dockerfile = files.find((file) => file.path === "Dockerfile")?.content ?? "";
    const dockerignore = files.find((file) => file.path === ".dockerignore")?.content ?? "";
    const backendPackageJson = JSON.parse(
      files.find((file) => file.path === "backend/package.json")?.content ?? "{}"
    ) as {scripts: Record<string, string>};

    assert.include(dockerfile, "FROM oven/bun:1-slim");
    assert.include(dockerfile, "ENV PORT=8080");
    assert.include(dockerfile, "EXPOSE 8080");
    assert.include(dockerfile, `CMD curl -fsS "http://127.0.0.1:\${PORT}/health"`);
    assert.include(dockerfile, 'CMD ["bun", "run", "start"]');
    assert.equal(backendPackageJson.scripts.start, "bun run src/index.ts");
    assert.notInclude(dockerfile, "example-backend");
    assert.notInclude(dockerfile, "COPY . .");
    assert.notInclude(dockerfile, "@terreno/api compile");
    assert.include(dockerignore, "backend/.env");
    assert.include(dockerignore, "frontend/.env");
  });

  test("writes env examples alongside local .env defaults", () => {
    const files = generateAllFiles({
      appDisplayName: "Env App",
      appName: "env-app",
    });
    const backendEnv = files.find((file) => file.path === "backend/.env")?.content ?? "";
    const backendEnvExample =
      files.find((file) => file.path === "backend/.env.example")?.content ?? "";
    const frontendEnv = files.find((file) => file.path === "frontend/.env")?.content ?? "";
    const frontendEnvExample =
      files.find((file) => file.path === "frontend/.env.example")?.content ?? "";

    assert.include(backendEnv, "MONGO_URI=mongodb://127.0.0.1:27017/env_app?replicaSet=rs0");
    assert.include(backendEnv, "PORT=4000");
    assert.include(backendEnvExample, "MONGO_URI=");
    assert.include(backendEnvExample, "BETTER_AUTH_SECRET=");
    assert.include(backendEnvExample, "PORT=8080");
    assert.include(backendEnvExample, "NODE_ENV=production");

    assert.include(frontendEnv, "EXPO_PUBLIC_API_URL=http://localhost:4000");
    assert.include(frontendEnvExample, "EXPO_PUBLIC_API_URL=");
  });

  test("README documents local run, deploy, and Terreno how-to links", () => {
    const files = generateAllFiles({
      appDisplayName: "Readme App",
      appName: "readme-app",
    });
    const readme = files.find((file) => file.path === "README.md")?.content ?? "";

    assert.include(readme, "Readme App");
    assert.include(readme, "bun run dev");
    assert.include(readme, "bun run seed");
    assert.include(readme, "bun run web");
    assert.include(readme, "docker build");
    assert.include(
      readme,
      "https://github.com/TerrenoLabs/terreno/blob/master/docs/explanation/deployment-baseline.md"
    );
    assert.include(
      readme,
      "https://github.com/TerrenoLabs/terreno/blob/master/docs/how-to/deploy-backend-to-cloud-run.md"
    );
    assert.include(
      readme,
      "https://github.com/TerrenoLabs/terreno/blob/master/docs/how-to/build-for-web.md"
    );
  });

  test("declares mongodb as a direct backend dependency for Better Auth ESM resolution", () => {
    const files = generateAllFiles({
      appDisplayName: "Mongo App",
      appName: "mongo-app",
    });
    const backendPackageJson = JSON.parse(
      files.find((file) => file.path === "backend/package.json")?.content ?? "{}"
    ) as {dependencies: Record<string, string>};

    assert.equal(backendPackageJson.dependencies.mongodb, MONGODB_VERSION);
    assert.notInclude(backendPackageJson.dependencies.mongodb, "^");
    assert.notProperty(backendPackageJson.dependencies, "bson");
  });

  test("pins backend Mongo stack for Bun (exact mongoose + mongodb/bson overrides)", () => {
    const files = generateAllFiles({
      appDisplayName: "Mongo App",
      appName: "mongo-app",
    });
    const backendPackageJson = JSON.parse(
      files.find((file) => file.path === "backend/package.json")?.content ?? "{}"
    ) as {
      dependencies: Record<string, string>;
      overrides?: Record<string, string>;
    };

    assert.equal(MONGOOSE_VERSION, "9.7.4");
    assert.equal(MONGODB_VERSION, "7.2.0");
    assert.equal(BSON_VERSION, "7.2.0");
    assert.equal(MONGOOSE_VERSION, rootPackageJson.catalog.mongoose);
    assert.equal(MONGODB_VERSION, rootPackageJson.overrides.mongodb);
    assert.equal(BSON_VERSION, rootPackageJson.overrides.bson);
    assert.equal(backendPackageJson.dependencies.mongoose, "9.7.4");
    assert.notInclude(backendPackageJson.dependencies.mongoose, "^");
    assert.deepEqual(backendPackageJson.overrides, {
      bson: "7.2.0",
      mongodb: "7.2.0",
    });
  });

  test("generated CI installs before a lockfile exists", () => {
    const files = generateAllFiles({
      appDisplayName: "CI App",
      appName: "ci-app",
    });

    for (const path of [".github/workflows/backend-ci.yml", ".github/workflows/frontend-ci.yml"]) {
      const workflow = files.find((file) => file.path === path)?.content ?? "";
      assert.include(workflow, "run: bun install");
      assert.notInclude(workflow, "--frozen-lockfile");
    }
    assert.notInclude(
      files.map((file) => file.path),
      "bun.lock",
      "generator does not emit an install-resolved lockfile"
    );
  });

  test("generated backend registers /health via @terreno/api-health", () => {
    const files = generateAllFiles({
      appDisplayName: "Health App",
      appName: "health-app",
    });
    const backendPackageJson = JSON.parse(
      files.find((file) => file.path === "backend/package.json")?.content ?? "{}"
    ) as {dependencies: Record<string, string>};
    const server = files.find((file) => file.path === "backend/src/server.ts")?.content ?? "";

    assert.deepInclude(backendPackageJson.dependencies, {
      "@terreno/api-health": TERRENO_RANGE,
    });
    assert.include(server, "HealthApp");
    assert.include(server, "@terreno/api-health");
    assert.include(server, "mongoose.connection.readyState");
    assert.include(server, "healthy: mongoConnected");
    assert.include(server, "process.env.PORT");
  });

  test("generated backend enables organizations with typed settings", () => {
    const files = generateAllFiles({
      appDisplayName: "Org App",
      appName: "org-app",
    });
    const access = files.find((file) => file.path === "backend/src/access.ts")?.content ?? "";
    const server = files.find((file) => file.path === "backend/src/server.ts")?.content ?? "";
    const settings =
      files.find((file) => file.path === "backend/src/models/organizationSettings.ts")?.content ??
      "";

    assert.include(access, "organizations: true");
    assert.include(server, "settingsSchema: organizationSettingsSchema");
    assert.include(server, "Membership.findActiveForUser");
    assert.include(settings, "createOrganizationSettingsSchema");
  });

  test("generated backend server returns express.Application from TerrenoApp.start()", () => {
    const server = generateAllFiles({
      appDisplayName: "Start App",
      appName: "start-app",
    }).find((file) => file.path === "backend/src/server.ts")?.content;

    assert.include(server, "const terraApp = new TerrenoApp");
    assert.include(server, "return terraApp");
    assert.include(server, ".start();");
    assert.notInclude(server, "return app;");
  });

  test("generated users router casts User for modelRouter compatibility", () => {
    const users = generateAllFiles({
      appDisplayName: "Users App",
      appName: "users-app",
    }).find((file) => file.path === "backend/src/api/users.ts")?.content;

    assert.include(users, "User as unknown as Model<UserDocument>");
    assert.include(users, "list: [Permissions.IsAdmin]");
    assert.include(users, "read: [Permissions.IsAdmin]");
    assert.notInclude(users, "list: [Permissions.IsAuthenticated]");
    assert.notInclude(users, "read: [Permissions.IsAuthenticated]");
  });

  test("generated Better Auth config requires BETTER_AUTH_SECRET", () => {
    const config = generateAllFiles({
      appDisplayName: "Secret App",
      appName: "secret-app",
    }).find((file) => file.path === "backend/src/utils/betterAuthConfig.ts")?.content;

    assert.include(config, "BETTER_AUTH_SECRET is required");
    assert.notInclude(config, "DEFAULT_BETTER_AUTH_SECRET");
    assert.notInclude(config, "secret-app-better-auth-secret-dev-only-32chars");
  });

  test("generated userTypes import passport-local-mongoose model types", () => {
    const userTypes = generateAllFiles({
      appDisplayName: "Types App",
      appName: "types-app",
    }).find((file) => file.path === "backend/src/types/models/userTypes.ts")?.content;

    assert.include(userTypes, 'from "passport-local-mongoose"');
    assert.include(userTypes, "PassportLocalMongooseModel<UserDocument>");
    assert.include(userTypes, "PassportLocalMongooseDocument");
    assert.notInclude(userTypes, "mongoose.PassportLocalModel");
    assert.notInclude(userTypes, "mongoose.PassportLocalDocument");
  });
});

describe("generated frontend Terreno 57 compatibility", () => {
  const files = generateAllFiles({
    appDisplayName: "Compat App",
    appName: "compat-app",
  });

  const read = (path: string): string => files.find((file) => file.path === path)?.content ?? "";

  test("tabs layout uses ColorValue and theme tokens for tab bar tint", () => {
    const layout = read("frontend/app/(tabs)/_layout.tsx");
    assert.include(layout, 'import type {ColorValue} from "react-native"');
    assert.include(layout, "color: ColorValue");
    assert.include(layout, "useTheme");
    assert.include(layout, "tabBarActiveTintColor: theme.surface.primary");
    assert.notInclude(layout, "@/constants/theme");
  });

  test("home and not-found screens use current @terreno/ui props", () => {
    const home = read("frontend/app/(tabs)/index.tsx");
    const notFound = read("frontend/app/+not-found.tsx");

    assert.include(home, 'color="secondaryDark"');
    assert.notInclude(home, 'color="secondary"');

    assert.include(notFound, 'flex="grow"');
    assert.include(notFound, "<Heading");
    assert.notInclude(notFound, "weight=");
    assert.notInclude(notFound, "flex={1}");
  });

  test("admin screens pass a type-erased AdminApi instance", () => {
    const sdk = read("frontend/store/sdk.ts");
    const adminIndex = read("frontend/app/(tabs)/admin/index.tsx");
    const adminConfig = read("frontend/app/(tabs)/admin/configuration.tsx");

    assert.include(sdk, "adminTerrenoApi");
    assert.include(sdk, 'as unknown as AdminScreenProps["api"]');
    assert.include(adminIndex, "adminTerrenoApi");
    assert.include(adminConfig, "adminTerrenoApi");
    assert.notInclude(adminIndex, "api={terrenoApi}");
  });

  test("store wires Better Auth, dev store, and app-local RootState", () => {
    const storeIndex = read("frontend/store/index.ts");
    const appState = read("frontend/store/appState.ts");
    const syncdb = read("frontend/store/syncdb.ts");

    assert.include(storeIndex, "as unknown as BetterAuthClientInterface");
    assert.include(
      storeIndex,
      "registerTerrenoDevStore(store as unknown as Store<Record<string, unknown>>)"
    );
    assert.include(appState, 'import type {RootState} from "./index"');
    assert.notInclude(appState, "@terreno/rtk");
    assert.include(syncdb, "syncAuthClient");
    assert.include(syncdb, "sessionAtom");
    assert.include(syncdb, "getSession: () => betterAuthClient.getSession()");
    assert.notInclude(syncdb, "betterAuthClient as unknown as BetterAuthClientLike");
  });

  test("OpenAPI SDK uses Better Auth base API, not JWT emptySplitApi", () => {
    const openapiConfig = read("frontend/openapi-config.ts");
    const openApiSdk = read("frontend/store/openApiSdk.ts");
    const betterAuthApi = read("frontend/store/betterAuthApi.ts");

    assert.include(openapiConfig, 'apiFile: "./store/betterAuthApi.ts"');
    assert.include(openApiSdk, 'from "./betterAuthApi"');
    assert.notInclude(openApiSdk, 'from "@terreno/rtk"');
    assert.include(betterAuthApi, "readSessionToken");
    assert.include(betterAuthApi, 'headers.set("authorization"');
    assert.include(betterAuthApi, 'credentials: "include"');
    assert.include(betterAuthApi, "betterAuthClient.getSession()");
  });

  test("profile screen reads unwrapped profile fields from Better Auth base query", () => {
    const profile = read("frontend/app/(tabs)/profile.tsx");
    const sdk = read("frontend/store/sdk.ts");

    assert.include(profile, "const user = profile;");
    assert.notInclude(profile, "profile?.data");
    assert.include(sdk, "profile fields are top-level on the response");
    assert.notInclude(sdk, "data: {");
  });

  test("tsconfigs use no TypeScript 6 deprecated options", () => {
    const tsconfigPaths = [
      "backend/tsconfig.json",
      "frontend/tsconfig.codegen.json",
      "frontend/tsconfig.json",
    ];

    for (const tsconfigPath of tsconfigPaths) {
      const {compilerOptions} = JSON.parse(read(tsconfigPath)) as {
        compilerOptions: Record<string, unknown>;
      };
      const moduleResolution = String(compilerOptions.moduleResolution ?? "").toLowerCase();
      const target = String(compilerOptions.target ?? "").toLowerCase();

      assert.notProperty(compilerOptions, "baseUrl", tsconfigPath);
      assert.notProperty(compilerOptions, "downlevelIteration", tsconfigPath);
      assert.notProperty(compilerOptions, "ignoreDeprecations", tsconfigPath);
      assert.notInclude(["node", "node10", "classic"], moduleResolution, tsconfigPath);
      assert.notEqual(target, "es5", tsconfigPath);
    }
  });

  test("frontend tsconfig resolves path aliases from its own directory", () => {
    const tsconfig = JSON.parse(read("frontend/tsconfig.json")) as {
      compilerOptions: {paths: Record<string, string[]>};
      extends: string;
    };

    assert.equal(tsconfig.extends, "expo/tsconfig.base");
    assert.deepEqual(tsconfig.compilerOptions.paths["@/*"], ["./*"]);
  });

  test("SDK stub declares profile tags and generate-sdk script typechecks", () => {
    const openApiSdk = read("frontend/store/openApiSdk.ts");
    const sdk = read("frontend/store/sdk.ts");
    const generateSdk = read("frontend/scripts/generate-sdk.ts");
    const tsconfig = JSON.parse(read("frontend/tsconfig.json")) as {
      compilerOptions: {types?: string[]};
    };
    const frontendPackageJson = JSON.parse(read("frontend/package.json")) as {
      devDependencies: Record<string, string>;
    };

    assert.include(openApiSdk, '"profile"');
    assert.include(sdk, 'addTagTypes: ["profile"]');
    assert.include(sdk, 'providesTags: ["profile"]');
    assert.isTrue(sdk.indexOf('addTagTypes: ["profile"]') < sdk.indexOf("injectEndpoints"));
    assert.include(generateSdk, "execFile");
    assert.include(tsconfig.compilerOptions.types ?? [], "bun");
    assert.property(frontendPackageJson.devDependencies, "@types/bun");
    assert.property(frontendPackageJson.devDependencies, "ts-node");
  });
});
