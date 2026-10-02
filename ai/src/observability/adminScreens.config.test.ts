import {beforeEach, describe, expect, it} from "bun:test";
import {AdminApp} from "@terreno/admin-backend";
import {
  addAuthRoutes,
  apiErrorMiddleware,
  apiUnauthorizedMiddleware,
  createAccess,
  setupAuth,
  terrenoStatements,
  type UserModel as UserModelType,
} from "@terreno/api";
import {getBaseServer, setupDb, UserModel} from "@terreno/api/testing";
import {authAsUser as loginWithCredentials} from "@terreno/test";
import mongoose from "mongoose";

import {observabilityAdminScreens} from "./adminScreens";

const OBSERVABILITY_SCREEN_NAMES = [
  "ai-prompts",
  "ai-traces",
  "ai-evaluators",
  "ai-datasets",
  "ai-experiments",
  "ai-review",
] as const;

const buildAdminConfigApp = (
  grantsByEmail: Record<string, Record<string, string[]>>
): ReturnType<typeof getBaseServer> => {
  const app = getBaseServer();
  setupAuth(app, UserModel as unknown as UserModelType);
  addAuthRoutes(app, UserModel as unknown as UserModelType);

  const accessControl = createAccess({
    connection: mongoose.connection,
    resolvePermissions: async ({user}) => {
      const email = "email" in user && typeof user.email === "string" ? user.email : "";
      return grantsByEmail[email] ?? {};
    },
    statements: terrenoStatements,
  });

  const admin = new AdminApp({
    accessControl,
    customScreens: observabilityAdminScreens({localOn: true}),
    models: [],
  });
  admin.register(app);
  app.use(apiUnauthorizedMiddleware);
  app.use(apiErrorMiddleware);
  return app;
};

const createPasswordUser = async ({
  email,
  password,
}: {
  email: string;
  password: string;
}): Promise<void> => {
  const doc = await UserModel.create({
    admin: false,
    email,
    name: email,
  });
  await (doc as unknown as {setPassword: (value: string) => Promise<void>}).setPassword(password);
  await doc.save();
};

const loginAs = async (app: ReturnType<typeof getBaseServer>, email: string, password: string) => {
  return loginWithCredentials(app, {email, password});
};

const screenNamesFromConfig = (body: {customScreens: {name: string}[]}): string[] => {
  return body.customScreens.map((screen) => screen.name);
};

describe("observability admin config", () => {
  beforeEach(async () => {
    await setupDb();
    await UserModel.deleteMany({});
  });

  it("prompts-only omits every other observability screen", async () => {
    const password = "promptsOnlyPass123";
    const app = buildAdminConfigApp({
      "prompts-only@example.com": {
        admin: ["access"],
        aiPrompt: ["list", "read"],
      },
    });
    await createPasswordUser({email: "prompts-only@example.com", password});

    const agent = await loginAs(app, "prompts-only@example.com", password);
    const response = await agent.get("/admin/config").expect(200);
    const names = screenNamesFromConfig(response.body);

    expect(names).toEqual(["ai-prompts"]);
    for (const excluded of OBSERVABILITY_SCREEN_NAMES) {
      if (excluded === "ai-prompts") {
        continue;
      }
      expect(names).not.toContain(excluded);
    }
  });

  it("traces-only omits prompts and other observability screens", async () => {
    const password = "tracesOnlyPass123";
    const app = buildAdminConfigApp({
      "traces-only@example.com": {
        admin: ["access"],
        aiTrace: ["list", "read"],
      },
    });
    await createPasswordUser({email: "traces-only@example.com", password});

    const agent = await loginAs(app, "traces-only@example.com", password);
    const response = await agent.get("/admin/config").expect(200);
    const names = screenNamesFromConfig(response.body);

    expect(names).toEqual(["ai-traces"]);
    expect(names).not.toContain("ai-prompts");
    expect(names).not.toContain("ai-review");
  });

  it("returns no observability screens when the caller has admin shell but no ai*:list grants", async () => {
    const password = "shellOnlyPass123";
    const app = buildAdminConfigApp({
      "shell-only@example.com": {
        admin: ["access"],
      },
    });
    await createPasswordUser({email: "shell-only@example.com", password});

    const agent = await loginAs(app, "shell-only@example.com", password);
    const response = await agent.get("/admin/config").expect(200);
    const names = screenNamesFromConfig(response.body);

    for (const screenName of OBSERVABILITY_SCREEN_NAMES) {
      expect(names).not.toContain(screenName);
    }
  });
});
