import {beforeAll, beforeEach, describe, expect, it, mock} from "bun:test";
import {TerrenoApp, type TerrenoAppOptions} from "@terreno/api";
import type express from "express";

import {getLangfuseClient, initLangfuseClient} from "./langfuseClient";
import {addEvaluationRoutes} from "./langfuseRoutesEvaluations";
import {addPlaygroundRoutes} from "./langfuseRoutesPlayground";
import {addPromptRoutes} from "./langfuseRoutesPrompts";
import {addTraceRoutes} from "./langfuseRoutesTraces";
import type {FakeLangfusePrompt} from "./tests/fakeLangfusePrompt";
import {
  authAsUserWithCredentials,
  ensureTestUsers,
  type StandardAiTestUserRole,
  terrenoUserModel,
} from "./tests/helpers";

const LANGFUSE_TEST_USERS = [
  {admin: true, email: "lf-admin@example.com", name: "LF Admin", password: "adminPass123"},
  {admin: false, email: "lf-user@example.com", name: "LF User", password: "userPass123"},
] as const;

const authAsUser = async (appInstance: express.Application, type: StandardAiTestUserRole) => {
  const user = LANGFUSE_TEST_USERS[type === "admin" ? 0 : 1];
  return authAsUserWithCredentials(appInstance, {email: user.email, password: user.password});
};

const scoreCreate = mock(() => {});
const promptCreate = mock(async (_params: Record<string, unknown>) => ({}));
const promptGet = mock(
  async (name: string): Promise<FakeLangfusePrompt> => ({
    config: {temperature: 0.5},
    labels: ["production"],
    name,
    prompt: "Hello {{name}}, welcome to {{place}}",
    tags: ["tag"],
    type: "text",
    version: 1,
  })
);
const promptsList = mock(async () => ({
  data: [{name: "p1", versions: [1]}],
  meta: {limit: 20, page: 1, total: 1, totalPages: 1},
}));
const traceList = mock(async () => ({
  data: [{id: "t1"}],
  meta: {limit: 20, page: 1, total: 1, totalPages: 1},
}));
const traceGet = mock(async (traceId: string) => ({id: traceId, name: "Trace"}));
const flush = mock(async () => {});

let app: express.Application;

describe("Langfuse routes", () => {
  beforeAll(async () => {
    await ensureTestUsers([...LANGFUSE_TEST_USERS]);
  });

  beforeEach(() => {
    // Init the (fake) langfuse client and wire our local mocks onto its
    // methods so the route handlers exercise customizable responses without
    // making real SDK calls.
    initLangfuseClient({publicKey: "pk-test", secretKey: "sk-test"});
    const client = getLangfuseClient() as unknown as {
      api: {
        prompts: {list: typeof promptsList};
        trace: {get: typeof traceGet; list: typeof traceList};
      };
      flush: typeof flush;
      prompt: {create: typeof promptCreate; get: typeof promptGet};
      score: {create: typeof scoreCreate};
    };
    client.api.prompts.list = promptsList;
    client.api.trace.get = traceGet;
    client.api.trace.list = traceList;
    client.flush = flush;
    client.prompt.create = promptCreate;
    client.prompt.get = promptGet;
    client.score.create = scoreCreate;

    app = new TerrenoApp({
      configureApp: (router) => {
        // The route helpers only register handlers, which a Router supports as well.
        const routes = router as unknown as express.Application;
        addPromptRoutes(routes, "/admin/langfuse");
        addTraceRoutes(routes, "/admin/langfuse");
        addPlaygroundRoutes(routes, "/admin/langfuse");
        addEvaluationRoutes(routes, "/admin/langfuse", []);
      },
      skipListen: true,
      userModel: terrenoUserModel as unknown as TerrenoAppOptions["userModel"],
    }).build();
  });

  describe("prompt routes", () => {
    it("returns 403 for non-admin users", async () => {
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.get("/admin/langfuse/prompts");
      expect(res.status).toBe(403);
    });

    it("lists prompts for admin users", async () => {
      const agent = await authAsUser(app, "admin");
      const res = await agent.get("/admin/langfuse/prompts?page=2&limit=5");
      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(promptsList).toHaveBeenCalled();
    });

    it("returns a prompt by name for admin users", async () => {
      const agent = await authAsUser(app, "admin");
      const res = await agent.get("/admin/langfuse/prompts/mine?version=2&label=staging");
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("mine");
      expect(res.body.version).toBe(1);
    });

    it("creates a text prompt", async () => {
      const agent = await authAsUser(app, "admin");
      const res = await agent
        .post("/admin/langfuse/prompts")
        .send({name: "new", prompt: "Hello", type: "text"});
      expect(res.status).toBe(201);
      expect(promptCreate).toHaveBeenCalled();
    });

    it("creates a chat prompt", async () => {
      const agent = await authAsUser(app, "admin");
      const res = await agent.post("/admin/langfuse/prompts").send({
        name: "chat",
        prompt: [{content: "hi", role: "user"}],
        tags: ["x"],
        type: "chat",
      });
      expect(res.status).toBe(201);
    });

    it("rejects prompt create when required fields are missing", async () => {
      const agent = await authAsUser(app, "admin");
      const res = await agent.post("/admin/langfuse/prompts").send({name: "x"});
      expect(res.status).toBe(400);
    });

    it("invalidates prompt cache", async () => {
      const agent = await authAsUser(app, "admin");
      const res = await agent.delete("/admin/langfuse/prompts/mine/cache");
      expect(res.status).toBe(200);
      expect(res.body.invalidated).toBe(true);
    });
  });

  describe("trace routes", () => {
    it("returns 403 for non-admin users", async () => {
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.get("/admin/langfuse/traces");
      expect(res.status).toBe(403);
    });

    it("lists traces for admin users with filters", async () => {
      const agent = await authAsUser(app, "admin");
      const res = await agent.get(
        "/admin/langfuse/traces?page=3&limit=7&userId=u1&from=2024-01-01&to=2024-12-31"
      );
      expect(res.status).toBe(200);
      expect(traceList).toHaveBeenCalled();
      expect(res.body.data).toBeDefined();
    });

    it("returns a single trace by id", async () => {
      const agent = await authAsUser(app, "admin");
      const res = await agent.get("/admin/langfuse/traces/trace-1");
      expect(res.status).toBe(200);
      expect(res.body.id).toBe("trace-1");
    });
  });

  describe("playground routes", () => {
    it("returns 403 for non-admin users", async () => {
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.post("/admin/langfuse/playground").send({promptName: "test"});
      expect(res.status).toBe(403);
    });

    it("returns 400 when promptName is missing", async () => {
      const agent = await authAsUser(app, "admin");
      const res = await agent.post("/admin/langfuse/playground").send({});
      expect(res.status).toBe(400);
    });

    it("compiles a prompt for admin users", async () => {
      const agent = await authAsUser(app, "admin");
      const res = await agent
        .post("/admin/langfuse/playground")
        .send({promptName: "welcome", variables: {name: "Sam", place: "Earth"}});
      expect(res.status).toBe(200);
      expect(res.body.compiled).toBe("Hello Sam, welcome to Earth");
      expect(res.body.variables.sort()).toEqual(["name", "place"]);
    });

    it("compiles a chat prompt and extracts variables from chat messages", async () => {
      promptGet.mockImplementationOnce(async (name: string) => ({
        config: {},
        labels: ["production"],
        name,
        prompt: [
          {content: "You are {{role}}.", role: "system"},
          {content: "Greet {{user}}.", role: "user"},
        ],
        tags: [],
        type: "chat",
        version: 2,
      }));
      const agent = await authAsUser(app, "admin");
      const res = await agent
        .post("/admin/langfuse/playground")
        .send({promptName: "chatter", variables: {role: "bot", user: "Alex"}});
      expect(res.status).toBe(200);
      expect(res.body.type).toBe("chat");
      expect(Array.isArray(res.body.compiled)).toBe(true);
      expect(res.body.variables.sort()).toEqual(["role", "user"]);
    });
  });

  describe("evaluation routes", () => {
    it("returns 403 for non-admin users on config", async () => {
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.get("/admin/langfuse/evaluations/config");
      expect(res.status).toBe(403);
    });

    it("rejects evaluation submissions missing required fields", async () => {
      const agent = await authAsUser(app, "admin");
      const res = await agent.post("/admin/langfuse/evaluations").send({name: "x"});
      expect(res.status).toBe(400);
    });

    it("creates an evaluation score", async () => {
      const agent = await authAsUser(app, "admin");
      const res = await agent
        .post("/admin/langfuse/evaluations")
        .send({dataType: "NUMERIC", name: "quality", traceId: "t1", value: 5});
      expect(res.status).toBe(201);
      expect(scoreCreate).toHaveBeenCalled();
      expect(flush).toHaveBeenCalled();
    });

    it("returns non-403 for admin users on config", async () => {
      const agent = await authAsUser(app, "admin");
      const res = await agent.get("/admin/langfuse/evaluations/config");
      expect(res.status).not.toBe(403);
    });

    it("returns 403 for non-admin users on submit", async () => {
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .post("/admin/langfuse/evaluations")
        .send({name: "score", traceId: "t1", value: 1});
      expect(res.status).toBe(403);
    });
  });
});
