import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {assert} from "chai";
import express from "express";
import supertest from "supertest";
import {addTerrenoDevBrowserLogsRoute} from "../browserLogsRoute";

describe("Terreno dev browser logs route", () => {
  let dir: string;
  let prevBrowserLogs: string | undefined;
  let prevEnv: NodeJS.ProcessEnv["NODE_ENV"] | undefined;
  let prevCwd: string;

  beforeEach(() => {
    prevCwd = process.cwd();
    prevEnv = process.env.NODE_ENV;
    prevBrowserLogs = process.env.TERRENO_BROWSER_LOGS;
    dir = mkdtempSync(join(tmpdir(), "terreno-browser-logs-"));
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    process.env.NODE_ENV = prevEnv ?? "test";
    if (prevBrowserLogs === undefined) {
      Reflect.deleteProperty(process.env, "TERRENO_BROWSER_LOGS");
    } else {
      process.env.TERRENO_BROWSER_LOGS = prevBrowserLogs;
    }
    rmSync(dir, {force: true, recursive: true});
  });

  it("accepts POST batches in development and appends JSONL", async () => {
    process.env.NODE_ENV = "development";

    const app = express();
    addTerrenoDevBrowserLogsRoute(app);

    const res = await supertest(app)
      .post("/__terreno/browser-logs")
      .send({entries: [{level: "error", message: "from client"}]});

    expect(res.status).toBe(204);
    const p = join(dir, ".terreno", "logs", "browser.log");
    const txt = readFileSync(p, "utf-8");
    expect(txt).toContain("from client");
  });

  it("rejects batches over the entry cap", async () => {
    process.env.NODE_ENV = "development";

    const app = express();
    addTerrenoDevBrowserLogsRoute(app);

    const res = await supertest(app)
      .post("/__terreno/browser-logs")
      .send({entries: Array.from({length: 101}, () => ({level: "error", message: "x"}))});

    expect(res.status).toBe(413);
  });

  it("enforces the body cap after TerrenoApp's global JSON parser", async () => {
    process.env.NODE_ENV = "development";

    const app = express();
    app.use(express.json({limit: "1mb"}));
    addTerrenoDevBrowserLogsRoute(app);

    const response = await supertest(app)
      .post("/__terreno/browser-logs")
      .send({entries: [{level: "error", message: "x".repeat(300 * 1024)}]});

    assert.equal(response.status, 413);
    assert.include(response.body.error, "256 kB");
  });

  it("rejects an empty request body", async () => {
    process.env.NODE_ENV = "development";
    const app = express();
    addTerrenoDevBrowserLogsRoute(app);

    const response = await supertest(app).post("/__terreno/browser-logs");
    expect(response.status).toBe(400);
  });

  it("rejects unauthenticated remote clients and accepts authenticated ones", async () => {
    process.env.NODE_ENV = "development";
    const remoteAddressMiddleware: express.RequestHandler = (req, _res, next) => {
      Object.defineProperty(req.socket, "remoteAddress", {
        configurable: true,
        value: "10.0.0.5",
      });
      next();
    };
    const remoteApp = express();
    remoteApp.use(remoteAddressMiddleware);
    addTerrenoDevBrowserLogsRoute(remoteApp);

    const rejected = await supertest(remoteApp)
      .post("/__terreno/browser-logs")
      .send({entries: [{level: "error", message: "remote"}]});
    assert.equal(rejected.status, 403);

    const authenticatedApp = express();
    authenticatedApp.use(remoteAddressMiddleware);
    authenticatedApp.use((req, _res, next) => {
      Object.assign(req, {user: {_id: "dev-user"}});
      next();
    });
    addTerrenoDevBrowserLogsRoute(authenticatedApp);
    const accepted = await supertest(authenticatedApp)
      .post("/__terreno/browser-logs")
      .send({entries: [{level: "error", message: "authenticated"}]});
    assert.equal(accepted.status, 204);
  });

  it("restarts the dev log before it exceeds the size cap", async () => {
    process.env.NODE_ENV = "development";
    const logDir = join(dir, ".terreno", "logs");
    const logPath = join(logDir, "browser.log");
    const app = express();
    addTerrenoDevBrowserLogsRoute(app);
    await supertest(app)
      .post("/__terreno/browser-logs")
      .send({entries: [{level: "info", message: "create directory"}]});
    writeFileSync(logPath, Buffer.alloc(5 * 1024 * 1024));

    const response = await supertest(app)
      .post("/__terreno/browser-logs")
      .send({entries: [{level: "error", message: "after rollover"}]});

    assert.equal(response.status, 204);
    assert.isBelow(statSync(logPath).size, 1024);
    assert.include(readFileSync(logPath, "utf8"), "after rollover");
  });

  it("is not mounted outside development unless explicitly enabled", async () => {
    process.env.NODE_ENV = "test";

    const disabledApp = express();
    addTerrenoDevBrowserLogsRoute(disabledApp);
    const disabledResponse = await supertest(disabledApp)
      .post("/__terreno/browser-logs")
      .send({entries: [{level: "error", message: "x"}]});
    expect(disabledResponse.status).toBe(404);

    process.env.TERRENO_BROWSER_LOGS = "true";
    const enabledApp = express();
    addTerrenoDevBrowserLogsRoute(enabledApp);
    const enabledResponse = await supertest(enabledApp)
      .post("/__terreno/browser-logs")
      .send({entries: [{level: "error", message: "x"}]});
    expect(enabledResponse.status).toBe(204);

    process.env.NODE_ENV = "production";
    const productionApp = express();
    addTerrenoDevBrowserLogsRoute(productionApp);
    const productionResponse = await supertest(productionApp)
      .post("/__terreno/browser-logs")
      .send({entries: [{level: "error", message: "x"}]});
    expect(productionResponse.status).toBe(404);
  });
});
