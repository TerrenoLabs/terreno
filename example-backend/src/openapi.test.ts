/** Verifies generated `/openapi.json` includes registered example-backend routes. */
import {describe, expect, it} from "bun:test";
import {getObservabilityApp} from "@terreno/ai";
import {assert} from "chai";
import type express from "express";
import supertest from "supertest";

import {start} from "./server";

describe("OpenAPI spec generation", () => {
  let app: express.Application;

  it("generates a valid openapi.json", async () => {
    app = await start(true);
    const server = supertest(app);
    const res = await server.get("/openapi.json").expect(200);

    expect(res.body.openapi).toBe("3.0.0");
    expect(res.body.info).toBeDefined();
    expect(res.body.paths).toBeDefined();
  });

  it("includes admin todo routes", async () => {
    const server = supertest(app);
    const res = await server.get("/openapi.json").expect(200);

    expect(res.body.paths["/admin/todos/"]).toBeDefined();
    expect(res.body.paths["/admin/todos/{id}"]).toBeDefined();
    expect(res.body.paths["/admin/todos/"].get).toBeDefined();
    expect(res.body.paths["/admin/todos/"].post).toBeDefined();
    expect(res.body.paths["/admin/todos/{id}"].get).toBeDefined();
    expect(res.body.paths["/admin/todos/{id}"].patch).toBeDefined();
    expect(res.body.paths["/admin/todos/{id}"].delete).toBeDefined();
  });

  it("omits admin AuditEvent create, update, and delete", async () => {
    const server = supertest(app);
    const res = await server.get("/openapi.json").expect(200);

    expect(res.body.paths["/admin/audit-events/"].get).toBeDefined();
    expect(res.body.paths["/admin/audit-events/"].post).toBeUndefined();
    expect(res.body.paths["/admin/audit-events/{id}"].get).toBeDefined();
    expect(res.body.paths["/admin/audit-events/{id}"].patch).toBeUndefined();
    expect(res.body.paths["/admin/audit-events/{id}"].delete).toBeUndefined();
  });

  it("includes admin user routes", async () => {
    const server = supertest(app);
    const res = await server.get("/openapi.json").expect(200);

    expect(res.body.paths["/admin/users/"]).toBeDefined();
    expect(res.body.paths["/admin/users/{id}"]).toBeDefined();
  });

  it("includes feature flag routes", async () => {
    const server = supertest(app);
    const res = await server.get("/openapi.json").expect(200);

    expect(res.body.paths["/feature-flags/flags/"]).toBeDefined();
    expect(res.body.paths["/feature-flags/flags/{id}"]).toBeDefined();
    expect(res.body.paths["/feature-flags/flags/"].get).toBeDefined();
    expect(res.body.paths["/feature-flags/flags/"].post).toBeDefined();
  });

  it("includes communications routes", async (): Promise<void> => {
    const server = supertest(app);
    const res = await server.get("/openapi.json").expect(200);

    assert.property(res.body.paths, "/comms/pushTokens");
    assert.property(res.body.paths["/comms/pushTokens"], "post");
    assert.property(res.body.paths["/comms/pushTokens"], "get");
    assert.property(res.body.paths, "/comms/dev/testPush");
    assert.property(res.body.paths["/comms/dev/testPush"], "post");

    const tokenCollection = res.body.paths["/comms/pushTokens"];
    const messages = res.body.paths["/comms/messages"].get;
    assert.isDefined(tokenCollection.post.requestBody);
    assert.property(tokenCollection.post.responses, "401");
    assert.includeMembers(tokenCollection.post.tags, ["comms"]);
    assert.includeMembers(
      tokenCollection.get.parameters.map((parameter: {name: string}) => parameter.name),
      ["active", "limit", "page", "platform"]
    );
    assert.property(tokenCollection.get.responses, "401");
    assert.includeMembers(
      messages.parameters.map((parameter: {name: string}) => parameter.name),
      ["channel", "endDate", "limit", "page", "startDate", "status", "userId"]
    );
    assert.property(messages.responses, "401");
    assert.property(messages.responses, "403");
    assert.includeMembers(messages.tags, ["admin", "comms"]);
  });

  it("includes GPT routes", async () => {
    const server = supertest(app);
    const res = await server.get("/openapi.json").expect(200);

    expect(res.body.paths["/gpt/prompt"]).toBeDefined();
    expect(res.body.paths["/gpt/prompt"].post).toBeDefined();
    expect(res.body.paths["/gpt/remix"]).toBeDefined();
    expect(res.body.paths["/gpt/remix"].post).toBeDefined();
    expect(res.body.paths["/gpt/histories/"]).toBeDefined();
    expect(res.body.paths["/gpt/histories/"].get).toBeDefined();
    expect(res.body.paths["/gpt/histories/{id}"]).toBeDefined();
    expect(res.body.paths["/gpt/histories/pendingAsks"].get.operationId).toBe(
      "gpthistories_pendingAsks"
    );
    expect(res.body.paths["/gpt/histories/{id}/turn"].post.operationId).toBe("gpthistories_turn");
    expect(res.body.paths["/gpt/histories/{id}/stream"].get).toBeDefined();
  });

  it("boots local observability and documents the seeded summarize route", async () => {
    const observability = getObservabilityApp();
    expect(observability?.plugins.map((plugin) => plugin.id)).toEqual(["local"]);
    expect(observability?.control).toEqual({
      datasets: "local",
      experiments: "local",
      prompts: "local",
      reviewQueue: "local",
    });

    const server = supertest(app);
    const res = await server.get("/openapi.json").expect(200);
    expect(res.body.paths["/ai/example-summarize"]?.post).toBeDefined();
    expect(res.body.paths["/ai/observability/status"]?.get).toBeDefined();
    expect(res.body.paths["/ai/observability/prompts"]?.get).toBeDefined();
    expect(res.body.paths["/ai/observability/traces"]?.get).toBeDefined();
    expect(res.body.paths["/ai/observability/traces/test-multi-stage"]?.post).toBeDefined();
    expect(res.body.paths["/ai/observability/review"]?.get).toBeDefined();
  });

  it("includes settings routes", async () => {
    const server = supertest(app);
    const res = await server.get("/openapi.json").expect(200);

    expect(res.body.paths["/settings/gcs"]).toBeDefined();
    expect(res.body.paths["/settings/configureGcs"]).toBeDefined();
    expect(res.body.paths["/settings/clearGcs"]).toBeDefined();
    expect(res.body.paths["/todos/loadtestGenerate"]).toBeDefined();
    expect(res.body.paths["/users/{id}/password"]).toBeDefined();
  });

  it("includes jobs admin routes", async (): Promise<void> => {
    const server = supertest(app);
    const res = await server.get("/openapi.json").expect(200);

    assert.property(res.body.paths, "/jobs");
    assert.property(res.body.paths, "/jobs/{id}");
    assert.property(res.body.paths, "/jobs/stats");
    assert.property(res.body.paths, "/jobs/schedules");
    assert.property(res.body.paths["/jobs/{id}/retry"], "post");
    assert.property(res.body.paths["/jobs/{id}/requeue"], "post");
    assert.property(res.body.paths["/jobs/{id}/cancel"], "post");
  });

  it("has list/create/read/patch operations on admin todo routes", async () => {
    const server = supertest(app);
    const res = await server.get("/openapi.json").expect(200);
    const todoList = res.body.paths["/admin/todos/"];
    const todoDetail = res.body.paths["/admin/todos/{id}"];

    // List should have pagination parameters
    const listParams = todoList.get.parameters;
    const paramNames = listParams.map((p: {name: string}) => p.name);
    expect(paramNames).toContain("limit");
    expect(paramNames).toContain("page");

    // Create should have a request body
    expect(todoList.post.requestBody).toBeDefined();

    // Detail endpoints should have id path parameter
    expect(todoDetail.get).toBeDefined();
    expect(todoDetail.patch).toBeDefined();
    expect(todoDetail.delete).toBeDefined();
  });

  it("has ETag caching on openapi.json", async () => {
    const server = supertest(app);
    const res = await server.get("/openapi.json").expect(200);
    expect(res.headers.etag).toBeDefined();

    // Second request with matching ETag returns 304
    const secondRes = await server
      .get("/openapi.json")
      .set("If-None-Match", res.headers.etag)
      .expect(304);
    expect(secondRes.body).toEqual({});
  });

  it("includes APIError schema in components", async () => {
    const server = supertest(app);
    const res = await server.get("/openapi.json").expect(200);

    expect(res.body.components?.schemas?.APIError).toBeDefined();
  });

  it("matches snapshot", async () => {
    const server = supertest(app);
    const res = await server.get("/openapi.json").expect(200);

    expect(res.body).toMatchSnapshot();
  });
});
