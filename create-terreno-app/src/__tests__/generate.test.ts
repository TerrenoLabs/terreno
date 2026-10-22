import {describe, test} from "bun:test";
import {assert} from "chai";
import rootPackageJson from "../../../package.json";
import packageJson from "../../package.json";
import {
  API_SDK_SCRIPT,
  BETTER_AUTH_VERSION,
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
  "frontend/package.json",
  "frontend/store/apiClient.ts",
  "frontend/store/apiSdk.ts",
  "frontend/store/syncdb.ts",
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

    assert.equal(frontendPackageJson.dependencies.expo, "~58.0.14");
    assert.equal(frontendPackageJson.dependencies["expo-router"], "~58.0.23");
    assert.equal(frontendPackageJson.dependencies["expo-constants"], "~58.0.12");
    assert.equal(frontendPackageJson.dependencies["expo-sqlite"], "~58.0.13");
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

describe("generated frontend Terreno 58 compatibility", () => {
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

  test("admin screens bind auth through AdminProvider with the shared auth provider", () => {
    const apiClient = read("frontend/store/apiClient.ts");
    const adminLayout = read("frontend/app/(tabs)/admin/_layout.tsx");
    const adminIndex = read("frontend/app/(tabs)/admin/index.tsx");
    const adminConfig = read("frontend/app/(tabs)/admin/configuration.tsx");

    assert.include(apiClient, "export const getAdminAuthHeaders");
    assert.include(apiClient, "await authProvider.getToken()");
    assert.include(adminLayout, "<AdminProvider");
    assert.include(adminLayout, 'import {getAdminAuthHeaders} from "@/store/apiClient"');
    assert.include(adminLayout, 'import {baseUrl} from "@terreno/syncdb/config"');
    assert.include(adminLayout, "getAuthHeaders={getAdminAuthHeaders}");
    assert.include(adminLayout, "apiOrigin={baseUrl}");
    assert.notInclude(adminIndex, "api=");
    assert.notInclude(adminConfig, "api=");
  });

  test("request client shares the syncdb auth provider and sends app headers", () => {
    const apiClient = read("frontend/store/apiClient.ts");
    const syncdb = read("frontend/store/syncdb.ts");
    const betterAuth = read("frontend/lib/betterAuth.ts");

    assert.include(apiClient, 'from "@terreno/syncdb/api"');
    assert.include(apiClient, 'import {appHeaders, baseUrl} from "@terreno/syncdb/config"');
    assert.include(apiClient, 'import {authProvider} from "@/store/syncdb"');
    assert.include(apiClient, 'credentials: "include"');
    assert.include(apiClient, "headers: appHeaders");
    assert.include(syncdb, "export const authProvider = betterAuthAdapter(");
    assert.include(syncdb, "bridgeBetterAuthReactClient(betterAuthClient)");
    assert.include(syncdb, 'import {baseUrl} from "@terreno/syncdb/config"');
    assert.include(betterAuth, 'import {createBetterAuthClient} from "@terreno/syncdb/auth"');
    assert.include(betterAuth, 'storagePrefix: "compat-app"');
  });

  test("root layout provides session and request client without Redux", () => {
    const layout = read("frontend/app/_layout.tsx");
    const login = read("frontend/app/login.tsx");
    const signup = read("frontend/app/signup.tsx");

    assert.include(layout, 'import {SessionProvider, useSession} from "@terreno/syncdb/auth"');
    assert.include(layout, "<ApiClientProvider client={apiClient}>");
    assert.include(layout, "authClient={betterAuthClient}");
    assert.include(layout, "onLogout={apiClient.reset}");
    assert.include(layout, "syncDbs={SYNC_DBS}");
    assert.include(layout, "const {userId, isLoading: isAuthLoading} = useSession();");
    assert.include(layout, "<SyncDbProvider client={syncDb}>");
    assert.notInclude(layout, "PersistGate");
    for (const screen of [login, signup]) {
      assert.include(screen, "const {refresh} = useSession();");
      assert.include(screen, "await refresh();");
      assert.notInclude(screen, "dispatch");
    }
  });

  test("profile screen uses generated /auth/me hooks and session logout", () => {
    const profile = read("frontend/app/(tabs)/profile.tsx");

    assert.include(
      profile,
      'import {useGetAuthMeQuery, usePatchAuthMeMutation} from "@/store/apiSdk"'
    );
    assert.include(profile, "const {data: user, isLoading} = useGetAuthMeQuery();");
    assert.include(profile, "const {logout} = useSession();");
    assert.include(profile, "await updateProfile({name: value}).unwrap();");
    assert.notInclude(profile, "profile?.data");
  });

  test("api-sdk script regenerates store/apiSdk.ts with the syncdb codegen", () => {
    const apiSdk = read("frontend/store/apiSdk.ts");
    const frontendPackageJson = JSON.parse(read("frontend/package.json")) as {
      scripts: Record<string, string>;
    };

    assert.equal(frontendPackageJson.scripts["api-sdk"], API_SDK_SCRIPT);
    assert.include(API_SDK_SCRIPT, "terreno-syncdb-codegen");
    assert.include(API_SDK_SCRIPT, "--api-out ./store/apiSdk.ts");
    assert.equal(frontendPackageJson.scripts.sdk, "bun run api-sdk");
    assert.include(apiSdk, "GENERATED by @terreno/syncdb (terreno-syncdb-codegen --api-out)");
    assert.include(apiSdk, "export const useGetAuthMeQuery = (");
    assert.include(apiSdk, "export const usePatchAuthMeMutation = (");
    assert.include(apiSdk, 'from "@terreno/syncdb/react"');
  });

  test("frontend has no Redux, @terreno/rtk, or RTK codegen", () => {
    const frontendPackageJson = JSON.parse(read("frontend/package.json")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const deps = {...frontendPackageJson.dependencies, ...frontendPackageJson.devDependencies};

    for (const name of [
      "@reduxjs/toolkit",
      "@rtk-query/codegen-openapi",
      "@terreno/rtk",
      "react-redux",
      "redux-persist",
    ]) {
      assert.notProperty(deps, name);
    }
    assert.equal(frontendPackageJson.dependencies["better-auth"], BETTER_AUTH_VERSION);
    assert.equal(frontendPackageJson.dependencies["@better-auth/expo"], BETTER_AUTH_VERSION);
    assert.property(frontendPackageJson.dependencies, "expo-secure-store");

    const forbidden =
      /@terreno\/rtk|@reduxjs\/toolkit|react-redux|redux-persist|openApiSdk|@rtk-query/;
    for (const file of files.filter((candidate) => candidate.path.startsWith("frontend/"))) {
      assert.notMatch(file.content, forbidden, file.path);
    }
  });

  test("tsconfigs use no TypeScript 6 deprecated options", () => {
    const tsconfigPaths = ["backend/tsconfig.json", "frontend/tsconfig.json"];

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
      compilerOptions: {paths: Record<string, string[]>; types?: string[]};
      extends: string;
    };

    assert.equal(tsconfig.extends, "expo/tsconfig.base");
    assert.deepEqual(tsconfig.compilerOptions.paths["@/*"], ["./*"]);
    assert.notProperty(tsconfig.compilerOptions.paths, "@store");
    assert.include(tsconfig.compilerOptions.types ?? [], "bun");
  });
});
