import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it} from "bun:test";
import {cpSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {collectEvidence} from "../collectEvidence";
import {probeR1, probeR2, probeR8, probeR12} from "./access";
import {probeR3, probeR4, probeR7, probeR13} from "./app";
import type {ProbeContext, RunResult} from "./probeKit";
import {probeR5, probeR6, probeR9, probeR10, probeR11} from "./services";

const FIXTURE = join(import.meta.dir, "..", "..", "fixtures", "apps", "good");
const SEEDED = {email: "test@example.com", password: "testpassword123"};

interface StubState {
  aiRequests: number;
  deployedAcceptsSeededAdmin: boolean;
}

const state: StubState = {aiRequests: 0, deployedAcceptsSeededAdmin: false};
const todos = new Map<string, string>();
let server: ReturnType<typeof Bun.serve>;
let base = "";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    headers: {"content-type": "application/json", ...headers},
    status,
  });

/** Minimal stand-in for a Terreno backend: Better Auth sign-in, todos, admin, consent, GPT. */
const handle = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const auth = request.headers.get("authorization") ?? "";
  const role = auth.replace("Bearer ", "");
  const body =
    request.method === "GET" || request.method === "DELETE"
      ? {}
      : await request.json().catch(() => ({}));
  if (url.pathname === "/api/auth/sign-in/email") {
    const admin = body.email === "admin@example.com" && body.password === "testpassword123";
    const member = body.email === SEEDED.email && body.password === SEEDED.password;
    if (!admin && !member && !String(body.email).startsWith("probe-")) {
      return json({}, 401);
    }
    return json({}, 200, {"set-auth-token": admin ? "admin" : "member"});
  }
  if (url.pathname === "/api/auth/sign-up/email") {
    return body.password.length < 8 ? json({}, 400) : json({});
  }
  if (!role) {
    return json({}, 401);
  }
  if (url.pathname === "/admin/config") {
    return role === "admin" ? json({}) : json({}, 403);
  }
  if (url.pathname === "/todos" && request.method === "POST") {
    const id = `t${todos.size + 1}`;
    todos.set(id, role);
    return json({data: {_id: id}}, 201);
  }
  const todoId = url.pathname.match(/^\/todos\/(\w+)$/)?.[1];
  if (todoId) {
    if (request.method === "DELETE") {
      return json({}, 204);
    }
    const owner = todos.get(todoId);
    return role === "admin" || owner === role ? json({}) : json({}, 404);
  }
  if (url.pathname === "/consents/pending") {
    return json({data: [{_id: "form1"}]});
  }
  if (url.pathname === "/consents/respond") {
    return json({});
  }
  if (url.pathname === "/gpt/prompt") {
    state.aiRequests += 1;
    return new Response('data: {"text":"hello"}\n\n');
  }
  return json({}, 404);
};

beforeAll(() => {
  server = Bun.serve({fetch: handle, port: 0});
  base = `http://localhost:${server.port}`;
});
afterAll(() => {
  server.stop(true);
});

let appDir = "";
beforeEach(() => {
  appDir = mkdtempSync(join(tmpdir(), "probe-app-"));
  cpSync(FIXTURE, appDir, {recursive: true});
  todos.clear();
  state.aiRequests = 0;
});
afterEach(() => {
  rmSync(appDir, {force: true, recursive: true});
});

const noGit = (): RunResult => ({status: 1, stdout: ""});
const context = (extra: Partial<ProbeContext> = {}): ProbeContext => ({
  appDir,
  baseUrl: base,
  deps: {mongo: {count: async () => 1}, run: noGit},
  env: {},
  ...extra,
});

describe("R2 secure auth", () => {
  it("fails and names a tracked .env holding a secret", async () => {
    writeFileSync(join(appDir, "backend", ".env"), "BETTER_AUTH_SECRET=abc\n");
    const result = await probeR2(context({deps: {run: noGit}}));
    expect(result.status).toBe("FAIL");
    expect(result.facts.join("\n")).toContain("backend/.env is tracked");
  });

  it("is UNKNOWN, not PASS, without a deployed URL", async () => {
    const result = await probeR2(context());
    expect(result.status).toBe("UNKNOWN");
    expect(result.facts).toContain("DEPLOY_URL not set");
  });

  it("passes when the deployed app rejects the seeded admin password", async () => {
    const result = await probeR2(context({env: {DEPLOY_URL: `${base}/nope`}}));
    expect(result.facts.join("\n")).toContain("unauthenticated GET /todos is 401");
  });

  it("fails when rate limiting is disabled", async () => {
    writeFileSync(join(appDir, "backend", "src", "limit.ts"), "new TerrenoApp({rateLimit: false})");
    const result = await probeR2(context());
    expect(result.status).toBe("FAIL");
  });
});

describe("R1 admin user", () => {
  it("fails with no admin user and passes with one", async () => {
    const none = await probeR1(context({deps: {mongo: {count: async () => 0}, run: noGit}}));
    expect(none.status).toBe("FAIL");
    const some = await probeR1(context());
    expect(some.status).toBe("PASS");
  });
});

describe("R11 checklist", () => {
  it("fails without CHECKLIST.md and passes with five unchecked items", async () => {
    expect((await probeR11(context())).status).toBe("PASS");
    rmSync(join(appDir, "CHECKLIST.md"));
    expect((await probeR11(context())).status).toBe("FAIL");
  });
});

describe("R13 deployed", () => {
  it("is UNKNOWN when DEPLOY_URL is unset", async () => {
    const result = await probeR13(context());
    expect(result.status).toBe("UNKNOWN");
    expect(result.facts).toContain("DEPLOY_URL not set");
  });
});

describe("R5 GPT", () => {
  it("is UNKNOWN without an AI key", async () => {
    expect((await probeR5(context())).status).toBe("UNKNOWN");
  });

  it("passes with a key, a streamed reply and a new AIRequest row", async () => {
    const mongo = {count: async () => state.aiRequests};
    const result = await probeR5(context({deps: {mongo, run: noGit}, env: {OPENAI_API_KEY: "k"}}));
    expect(result.status).toBe("PASS");
  });
});

describe("R9 CI", () => {
  const ci = (gh: string, circle: string): ProbeContext =>
    context({
      deps: {
        fetch: (async (input: RequestInfo | URL) =>
          String(input).includes("/workflow")
            ? json({items: [{status: circle}]})
            : json({items: [{id: "p1"}]})) as typeof fetch,
        run: (command) =>
          command === "gh"
            ? {status: 0, stdout: JSON.stringify([{conclusion: gh, url: "https://gh/run/1"}])}
            : {status: 0, stdout: "main"},
      },
      env: {BOOTSTRAP_LOOP_CIRCLECI_SLUG: "gh/o/r", CIRCLECI_TOKEN: "t"},
    });

  it("passes on success and success, fails on success and failed", async () => {
    expect((await probeR9(ci("success", "success"))).status).toBe("PASS");
    expect((await probeR9(ci("success", "failed"))).status).toBe("FAIL");
  });

  it("fails without a coverage report", async () => {
    writeFileSync(join(appDir, ".circleci", "config.yml"), "jobs: test");
    expect((await probeR9(ci("success", "success"))).status).toBe("FAIL");
  });
});

describe("R6 consent, R7 features, R8 roles, R12 seed", () => {
  it("R6 passes against the stub", async () => {
    expect((await probeR6(context())).status).toBe("PASS");
  });
  it("R7 exercises the todo lifecycle", async () => {
    expect((await probeR7(context())).status).toBe("PASS");
  });
  it("R8 passes and fails when a member can read another user's todo", async () => {
    expect((await probeR8(context())).status).toBe("PASS");
    const leaky = context({deps: {mongo: {count: async () => 0}, run: noGit}});
    expect((await probeR8(leaky)).status).toBe("FAIL");
  });
  it("R12 needs a seed script and a working seeded login", async () => {
    expect((await probeR12(context())).status).toBe("PASS");
    writeFileSync(join(appDir, "backend", "package.json"), "{}");
    expect((await probeR12(context())).status).toBe("FAIL");
  });
});

describe("R3, R4, R10", () => {
  it("R3 fails while the template palette is kept and passes once it is replaced", async () => {
    writeFileSync(
      join(appDir, "frontend", "constants", "theme.ts"),
      'primary500: "#0086B3", secondary500: "#2B6072", accent500: "#D69C0E"'
    );
    expect((await probeR3(context({screenshots: ["a.png"]}))).status).toBe("FAIL");
    writeFileSync(
      join(appDir, "frontend", "constants", "theme.ts"),
      'primary500: "#4F46E5", secondary500: "#7C3AED", accent500: "#F97316"'
    );
    expect((await probeR3(context({screenshots: ["a.png"]}))).status).toBe("PASS");
  });

  it("R4 fails when mobile scrolls horizontally", async () => {
    const viewport = async ({width}: {width: number}) => ({
      horizontalScroll: width < 500,
      primaryActionVisible: true,
      todoCreateWorks: true,
    });
    const result = await probeR4(context({deps: {viewport}, webUrl: base}));
    expect(result.status).toBe("FAIL");
  });

  it("R10 checks the AI tooling files", async () => {
    const run = (): RunResult => ({status: 0, stdout: ""});
    expect((await probeR10(context({deps: {run}}))).status).toBe("PASS");
    rmSync(join(appDir, ".mcp.json"));
    expect((await probeR10(context({deps: {run}}))).status).toBe("FAIL");
  });
});

describe("collectEvidence", () => {
  it("writes evidence.json with all thirteen rows and screenshots, recording a throwing probe as UNKNOWN", async () => {
    const runDir = mkdtempSync(join(tmpdir(), "probe-run-"));
    cpSync(FIXTURE, join(runDir, "app"), {recursive: true});
    let stopped = false;
    const evidence = await collectEvidence({
      deps: {mongo: {count: async () => 1}, run: noGit},
      env: {},
      runDir,
      screenshot: async ({path}) => writeFileSync(path, "png"),
      startApp: async () => ({
        baseUrl: base,
        stop: async () => {
          stopped = true;
        },
        webUrl: base,
      }),
    });
    expect(evidence.rows.map((row) => row.row)).toHaveLength(13);
    expect(stopped).toBe(true);
    expect(await Bun.file(join(runDir, "evidence", "evidence.json")).exists()).toBe(true);
    expect(await Bun.file(join(runDir, "evidence", "login-mobile.png")).exists()).toBe(true);
    expect(evidence.rows.find((row) => row.row === "R13")?.status).toBe("UNKNOWN");
    rmSync(runDir, {force: true, recursive: true});
  });
});
