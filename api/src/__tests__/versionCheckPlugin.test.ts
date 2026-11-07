import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {assert} from "chai";
import supertest from "supertest";
import type {UserModel as UserModelType} from "../auth";
import {VersionConfig} from "../models/versionConfig";
import {configureOpenApiValidator, resetOpenApiValidatorConfig} from "../openApiValidator";
import {TerrenoApp} from "../terrenoApp";
import {setupDb, UserModel} from "../tests";
import {expectDocumentedResponse} from "../tests/openApiResponseSchema";
import {VersionCheckPlugin} from "../versionCheckPlugin";

const typedUserModel = UserModel as unknown as UserModelType;

describe("VersionCheckPlugin", () => {
  let app: ReturnType<typeof supertest>;

  beforeEach(async () => {
    await setupDb();
    await VersionConfig.deleteMany({});

    const expressApp = new TerrenoApp({
      skipListen: true,
      userModel: typedUserModel,
    })
      .register(new VersionCheckPlugin())
      .build();

    app = supertest(expressApp);
  });

  afterEach(async () => {
    await VersionConfig.deleteMany({});
  });

  it("returns ok when no VersionConfig exists", async () => {
    const res = await app.get("/version-check").query({platform: "web", version: 100});
    expect(res.status).toBe(200);
    expect(res.body.requestId).toBe(res.headers["x-request-id"]);
    expect(res.body).toEqual(
      expect.objectContaining({
        pollingIntervalMs: 86400000,
        status: "ok",
      })
    );
  });

  it("returns ok when version param is missing", async () => {
    const res = await app.get("/version-check");
    expect(res.status).toBe(200);
    expect(res.body.requestId).toBe(res.headers["x-request-id"]);
    expect(res.body).toEqual(expect.objectContaining({status: "ok"}));
  });

  it("returns ok when version param is invalid", async () => {
    const res = await app.get("/version-check").query({platform: "web", version: "invalid"});
    expect(res.status).toBe(200);
    expect(res.body.requestId).toBe(res.headers["x-request-id"]);
    expect(res.body).toEqual(expect.objectContaining({status: "ok"}));
  });

  it("returns ok when version is provided more than once", async () => {
    const res = await app.get("/version-check?platform=mobile&version=1&version=2");

    assert.equal(res.status, 200);
    assert.equal(res.body.status, "ok");
    assert.notProperty(res.body, "pollingIntervalMs");
  });

  it("returns ok when client version >= warning and required (web)", async () => {
    await VersionConfig.create({
      webRequiredVersion: 50,
      webWarningVersion: 100,
    });

    const res = await app.get("/version-check").query({platform: "web", version: 150});
    expect(res.status).toBe(200);
    expect(res.body.requestId).toBe(res.headers["x-request-id"]);
    expect(res.body).toEqual(
      expect.objectContaining({
        pollingIntervalMs: 86400000,
        requiredVersion: 50,
        status: "ok",
        warningVersion: 100,
      })
    );
  });

  it("returns warning when client version < warning (web)", async () => {
    await VersionConfig.create({
      warningMessage: "Please update!",
      webRequiredVersion: 50,
      webWarningVersion: 100,
    });

    const res = await app.get("/version-check").query({platform: "web", version: 80});
    expect(res.status).toBe(200);
    expect(res.body.requestId).toBe(res.headers["x-request-id"]);
    expect(res.body.status).toBe("warning");
    expect(res.body.message).toBe("Please update!");
  });

  it("returns required when client version < required (web)", async () => {
    await VersionConfig.create({
      requiredMessage: "Update required",
      updateUrl: "https://example.com/update",
      webRequiredVersion: 100,
      webWarningVersion: 150,
    });

    const res = await app.get("/version-check").query({platform: "web", version: 50});
    expect(res.status).toBe(200);
    expect(res.body.requestId).toBe(res.headers["x-request-id"]);
    expect(res.body.status).toBe("required");
    expect(res.body.message).toBe("Update required");
    expect(res.body.updateUrl).toBe("https://example.com/update");
  });

  it("uses mobile thresholds when platform is mobile", async () => {
    await VersionConfig.create({
      mobileRequiredVersion: 200,
      mobileWarningVersion: 250,
      webRequiredVersion: 50,
      webWarningVersion: 80,
    });

    const webRes = await app.get("/version-check").query({platform: "web", version: 100});
    expect(webRes.body.requestId).toBe(webRes.headers["x-request-id"]);
    expect(webRes.body.status).toBe("ok");

    const mobileRes = await app.get("/version-check").query({platform: "mobile", version: 100});
    expect(mobileRes.body.requestId).toBe(mobileRes.headers["x-request-id"]);
    expect(mobileRes.body.status).toBe("required");
  });

  it("returns warning when a mobile version is below the mobile warning threshold", async () => {
    await VersionConfig.create({
      mobileRequiredVersion: 100,
      mobileWarningVersion: 200,
      warningMessage: "Update the mobile app",
    });

    const res = await app.get("/version-check").query({platform: "mobile", version: 150});
    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        message: "Update the mobile app",
        requiredVersion: 100,
        status: "warning",
        warningVersion: 200,
      })
    );
  });

  it("omits mobile thresholds when they are not configured", async () => {
    await VersionConfig.create({});

    const res = await app.get("/version-check").query({platform: "mobile", version: 1});
    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        status: "ok",
      })
    );
    expect(res.body.requiredVersion).toBeUndefined();
    expect(res.body.warningVersion).toBeUndefined();
  });

  it("defaults to web when platform is invalid", async () => {
    await VersionConfig.create({
      webRequiredVersion: 100,
      webWarningVersion: 150,
    });

    const res = await app.get("/version-check").query({platform: "invalid", version: 50});
    expect(res.body.requestId).toBe(res.headers["x-request-id"]);
    expect(res.body.status).toBe("required");
  });

  it("version equal to threshold returns ok (not warning)", async () => {
    await VersionConfig.create({
      webRequiredVersion: 50,
      webWarningVersion: 100,
    });

    const res = await app.get("/version-check").query({platform: "web", version: 100});
    expect(res.status).toBe(200);
    expect(res.body.requestId).toBe(res.headers["x-request-id"]);
    expect(res.body).toEqual(
      expect.objectContaining({
        pollingIntervalMs: 86400000,
        requiredVersion: 50,
        status: "ok",
        warningVersion: 100,
      })
    );
  });

  it("returns pollingIntervalMs from config pollingIntervalMinutes", async () => {
    await VersionConfig.create({
      pollingIntervalMinutes: 60,
      webRequiredVersion: 0,
      webWarningVersion: 0,
    });

    const res = await app.get("/version-check").query({platform: "web", version: 100});
    expect(res.status).toBe(200);
    expect(res.body.requestId).toBe(res.headers["x-request-id"]);
    expect(res.body.pollingIntervalMs).toBe(3600000);
  });

  it("returns default pollingIntervalMs (86400000) when pollingIntervalMinutes not set", async () => {
    await VersionConfig.create({
      webRequiredVersion: 0,
      webWarningVersion: 0,
    });

    const res = await app.get("/version-check").query({platform: "web", version: 100});
    expect(res.status).toBe(200);
    expect(res.body.requestId).toBe(res.headers["x-request-id"]);
    expect(res.body.pollingIntervalMs).toBe(86400000);
  });

  it("handles numeric version parameter directly", async () => {
    await VersionConfig.create({
      webRequiredVersion: 100,
      webWarningVersion: 150,
    });

    const res = await app.get("/version-check?version=50&platform=web");
    expect(res.status).toBe(200);
    expect(res.body.requestId).toBe(res.headers["x-request-id"]);
    expect(res.body.status).toBe("required");
  });

  it("returns default warning message when warningMessage not set", async () => {
    await VersionConfig.create({
      webRequiredVersion: 0,
      webWarningVersion: 100,
    });

    const res = await app.get("/version-check").query({platform: "web", version: 50});
    expect(res.status).toBe(200);
    expect(res.body.requestId).toBe(res.headers["x-request-id"]);
    expect(res.body.status).toBe("warning");
    expect(res.body.message).toBe(
      "A new version is available. Please update for the best experience."
    );
  });

  it("returns default required message when requiredMessage not set", async () => {
    await VersionConfig.create({
      webRequiredVersion: 100,
      webWarningVersion: 150,
    });

    const res = await app.get("/version-check").query({platform: "web", version: 50});
    expect(res.status).toBe(200);
    expect(res.body.requestId).toBe(res.headers["x-request-id"]);
    expect(res.body.status).toBe("required");
    expect(res.body.message).toBe(
      "This version is no longer supported. Please update to continue."
    );
  });

  it("version equal to required returns warning not required", async () => {
    await VersionConfig.create({
      webRequiredVersion: 100,
      webWarningVersion: 150,
    });

    const res = await app.get("/version-check").query({platform: "web", version: 100});
    expect(res.status).toBe(200);
    expect(res.body.requestId).toBe(res.headers["x-request-id"]);
    expect(res.body.status).toBe("warning");
  });

  it("uses default messages when warningMessage/requiredMessage are not set", async () => {
    await VersionConfig.create({
      webRequiredVersion: 100,
      webWarningVersion: 200,
    });

    const warningRes = await app.get("/version-check").query({platform: "web", version: 150});
    expect(warningRes.body.requestId).toBe(warningRes.headers["x-request-id"]);
    expect(warningRes.body.status).toBe("warning");
    expect(warningRes.body.message).toBe(
      "A new version is available. Please update for the best experience."
    );

    const requiredRes = await app.get("/version-check").query({platform: "web", version: 50});
    expect(requiredRes.body.requestId).toBe(requiredRes.headers["x-request-id"]);
    expect(requiredRes.body.status).toBe("required");
    expect(requiredRes.body.message).toBe(
      "This version is no longer supported. Please update to continue."
    );
  });

  it("handles numeric version parameter", async () => {
    const res = await app.get("/version-check?version=50&platform=web");
    expect(res.status).toBe(200);
    expect(res.body.requestId).toBe(res.headers["x-request-id"]);
  });
});

describe("VersionCheckPlugin direct usage", () => {
  it("can be instantiated and register called directly on an express app", async () => {
    const express = require("express");
    const plugin = new VersionCheckPlugin();
    expect(plugin).toBeDefined();
    expect(plugin).toBeInstanceOf(VersionCheckPlugin);
    expect(typeof plugin.register).toBe("function");

    const expressApp = express();
    plugin.register(expressApp);

    const testApp = supertest(expressApp);
    const res = await testApp.get("/version-check");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("handles a numeric version query parameter", async () => {
    await setupDb();
    await VersionConfig.deleteMany({});

    const express = require("express");
    const expressApp = express();

    // Use a custom query parser that coerces numeric strings to numbers so we
    // exercise the `typeof versionParam === "number"` branch.
    expressApp.set("query parser", (qs: string) => {
      const params: Record<string, string | number> = {};
      for (const pair of qs.split("&")) {
        const [key, val] = pair.split("=");
        if (val !== undefined && /^\d+$/.test(val)) {
          params[decodeURIComponent(key)] = Number(val);
        } else {
          params[decodeURIComponent(key)] = decodeURIComponent(val ?? "");
        }
      }
      return params;
    });

    const plugin = new VersionCheckPlugin();
    plugin.register(expressApp);

    await VersionConfig.create({
      webRequiredVersion: 100,
      webWarningVersion: 150,
    });

    const testApp = supertest(expressApp);
    const res = await testApp.get("/version-check?version=50&platform=web");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("required");
  });
});

describe("VersionCheckPlugin OpenAPI", () => {
  const buildApp = (): ReturnType<TerrenoApp["build"]> =>
    new TerrenoApp({skipListen: true, userModel: typedUserModel})
      .register(new VersionCheckPlugin())
      .build();

  beforeEach(async () => {
    await setupDb();
    await VersionConfig.deleteMany({});
  });

  it("documents GET /version-check in /openapi.json", async () => {
    const res = await supertest(buildApp()).get("/openapi.json").expect(200);
    const operation = res.body.paths["/version-check"]?.get;
    expect(operation).toBeDefined();
    const parameters = operation.parameters as {in: string; name: string; schema: unknown}[];
    expect(parameters.map((parameter) => `${parameter.in}:${parameter.name}`)).toEqual([
      "query:platform",
      "query:version",
    ]);
    expect(parameters[0]?.schema).toEqual({enum: ["web", "mobile"], type: "string"});
    const schema = operation.responses["200"].content["application/json"].schema;
    expect(schema.required).toEqual(["status"]);
    expect(schema.properties.status.enum).toEqual(["ok", "warning", "required"]);
    expect(Object.keys(schema.properties).sort()).toEqual([
      "message",
      "pollingIntervalMs",
      "requiredVersion",
      "status",
      "updateUrl",
      "warningVersion",
    ]);
  });

  it("returns ok, warning, and required bodies that match the documented schema", async () => {
    const agent = supertest(buildApp());
    const spec = (await agent.get("/openapi.json").expect(200)).body;
    await VersionConfig.create({
      requiredMessage: "Update required",
      updateUrl: "https://example.com/update",
      warningMessage: "Please update",
      webRequiredVersion: 50,
      webWarningVersion: 100,
    });

    for (const [version, status] of [
      [150, "ok"],
      [80, "warning"],
      [10, "required"],
    ] as const) {
      const res = await agent.get("/version-check").query({platform: "web", version}).expect(200);
      expect(res.body.status).toBe(status);
      expectDocumentedResponse({method: "get", path: "/version-check", response: res, spec});
    }
  });

  it("does not validate documented query params: a non-numeric version is still ok", async () => {
    configureOpenApiValidator({logValidationErrors: false});
    try {
      const res = await supertest(buildApp())
        .get("/version-check")
        .query({platform: "tv", version: "abc"});
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
    } finally {
      resetOpenApiValidatorConfig();
    }
  });
});
