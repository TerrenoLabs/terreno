/** Verifies `/openapi.json` documents the user-facing announcement routes. */
import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {TerrenoApp, type UserModel as UserModelType} from "@terreno/api";
import {
  authAsUser,
  expectDocumentedResponse,
  type OpenApiResponseSpec,
  setupDb,
  UserModel,
} from "@terreno/api/testing";
import type express from "express";
import {DateTime} from "luxon";
import supertest from "supertest";
import {AnnouncementsApp} from "../announcementsApp";
import {Announcement} from "../models/announcement";
import {AnnouncementAcknowledgement} from "../models/announcementAcknowledgement";
import {AnnouncementClickEvent} from "../models/announcementClickEvent";
import {AnnouncementImpression} from "../models/announcementImpression";

interface SchemaNode {
  enum?: string[];
  items?: SchemaNode;
  nullable?: boolean;
  properties?: Record<string, SchemaNode>;
  required?: string[];
  type?: string;
}

interface Operation {
  parameters?: {in: string; name: string; schema: SchemaNode}[];
  requestBody?: {content: Record<string, {schema: SchemaNode}>; required?: boolean};
  responses: Record<string, {content?: Record<string, {schema: SchemaNode}>}>;
  tags?: string[];
}

const buildApp = (): express.Application =>
  new TerrenoApp({
    rateLimit: false,
    skipListen: true,
    userModel: UserModel as unknown as UserModelType,
  })
    .register(new AnnouncementsApp())
    .build();

const response200 = (operation: Operation | undefined): SchemaNode | undefined =>
  operation?.responses["200"]?.content?.["application/json"]?.schema;

const parameterNames = (operation: Operation | undefined): string[] =>
  (operation?.parameters ?? []).map((parameter) => `${parameter.in}:${parameter.name}`).sort();

const clearAnnouncements = async (): Promise<void> => {
  await Announcement.deleteMany({});
  await AnnouncementAcknowledgement.deleteMany({});
  await AnnouncementImpression.deleteMany({});
  await AnnouncementClickEvent.deleteMany({});
};

describe("AnnouncementsApp OpenAPI", () => {
  let app: express.Application;
  let paths: Record<string, Record<string, Operation>>;

  beforeEach(async () => {
    await setupDb();
    await clearAnnouncements();
    app = buildApp();
    const res = await supertest(app).get("/openapi.json").expect(200);
    paths = res.body.paths;
  });

  afterEach(async () => {
    await clearAnnouncements();
  });

  it("documents GET /announcements/pending", () => {
    const operation = paths["/announcements/pending"]?.get;
    expect(operation?.tags).toEqual(["announcements"]);
    expect(parameterNames(operation)).toEqual(["query:platform", "query:version"]);
    const body = response200(operation);
    expect(body?.required).toEqual(["data"]);
    const current = body?.properties?.data?.properties?.current;
    expect(current?.nullable).toBe(true);
    expect(current?.properties?.displayMode?.enum).toEqual(["modal", "banner", "feed"]);
    expect(body?.properties?.data?.properties?.remainingCount?.type).toBe("number");
  });

  it("documents GET /announcements/feed with its pagination fields", () => {
    const operation = paths["/announcements/feed"]?.get;
    expect(parameterNames(operation)).toEqual([
      "query:limit",
      "query:page",
      "query:platform",
      "query:version",
    ]);
    const body = response200(operation);
    expect(body?.required).toEqual(["data", "more", "page", "total"]);
    expect(body?.properties?.more?.type).toBe("boolean");
    expect(body?.properties?.data?.type).toBe("array");
    expect(body?.properties?.data?.items?.properties?.id?.type).toBe("string");
    expect(body?.properties?.data?.items?.nullable).toBeUndefined();
  });

  it("documents the acknowledge, impression, and click actions", () => {
    const acknowledge = paths["/announcements/{id}/acknowledge"]?.post;
    expect(parameterNames(acknowledge)).toEqual(["path:id", "query:platform", "query:version"]);
    expect(acknowledge?.requestBody).toBeUndefined();
    expect(response200(acknowledge)?.properties?.data?.properties?.acknowledged?.type).toBe(
      "boolean"
    );

    const impression = paths["/announcements/{id}/impression"]?.post;
    expect(parameterNames(impression)).toEqual(["path:id", "query:platform", "query:version"]);
    expect(impression?.requestBody?.required).toBe(false);
    expect(
      impression?.requestBody?.content["application/json"]?.schema.properties?.platform?.enum
    ).toEqual(["ios", "android", "web"]);
    expect(response200(impression)?.properties?.data?.properties?.recorded?.type).toBe("boolean");

    const click = paths["/announcements/{id}/click"]?.post;
    const clickBody = click?.requestBody?.content["application/json"]?.schema;
    expect(click?.requestBody?.required).toBe(true);
    expect(clickBody?.required).toEqual(["action"]);
    expect(clickBody?.properties?.action?.enum).toEqual(["primaryAction"]);
    expect(response200(click)?.properties?.data?.required).toEqual(["recorded"]);
  });

  it("documents every field pending and feed return", async () => {
    await Announcement.create({
      body: "Body",
      primaryAction: {label: "Open", url: "https://example.com"},
      publishedAt: DateTime.utc().minus({minutes: 1}).toJSDate(),
      status: "published",
      title: "Documented",
    });
    const agent = await authAsUser(app, "notAdmin");
    const announcementProperties = Object.keys(
      response200(paths["/announcements/feed"]?.get)?.properties?.data?.items?.properties ?? {}
    );

    const pending = await agent.get("/announcements/pending?platform=web").expect(200);
    expect(announcementProperties).toEqual(
      expect.arrayContaining(Object.keys(pending.body.data.current))
    );
    const pendingDataFields = Object.keys(
      response200(paths["/announcements/pending"]?.get)?.properties?.data?.properties ?? {}
    );
    expect(pendingDataFields).toEqual(expect.arrayContaining(Object.keys(pending.body.data)));

    const feed = await agent.get("/announcements/feed?platform=web").expect(200);
    expect(announcementProperties).toEqual(expect.arrayContaining(Object.keys(feed.body.data[0])));
    const feedFields = Object.keys(
      response200(paths["/announcements/feed"]?.get)?.properties ?? {}
    );
    expect([...feedFields, "requestId"]).toEqual(expect.arrayContaining(Object.keys(feed.body)));
  });

  it("returns bodies that match the documented schemas for every user route", async () => {
    const spec = (await supertest(app).get("/openapi.json").expect(200))
      .body as OpenApiResponseSpec;
    const agent = await authAsUser(app, "notAdmin");
    const empty = await agent.get("/announcements/pending?platform=web").expect(200);
    expect(empty.body.data.current).toBeNull();
    expectDocumentedResponse({
      method: "get",
      path: "/announcements/pending",
      response: empty,
      spec,
    });

    const publishedAt = DateTime.utc().minus({minutes: 1}).toJSDate();
    const withAction = await Announcement.create({
      acknowledgementPolicy: "required",
      body: "Body",
      primaryAction: {label: "Open", url: "https://example.com"},
      publishedAt,
      status: "published",
      title: "With action",
    });
    await Announcement.create({body: "Body", publishedAt, status: "published", title: "Plain"});
    const id = withAction._id.toString();

    const pending = await agent.get("/announcements/pending?platform=web").expect(200);
    expectDocumentedResponse({
      method: "get",
      path: "/announcements/pending",
      response: pending,
      spec,
    });

    const impression = await agent
      .post(`/announcements/${id}/impression`)
      .send({platform: "web"})
      .expect(200);
    expectDocumentedResponse({
      method: "post",
      path: "/announcements/{id}/impression",
      response: impression,
      spec,
    });

    const click = await agent
      .post(`/announcements/${id}/click?platform=web`)
      .send({action: "primaryAction"})
      .expect(200);
    expectDocumentedResponse({
      method: "post",
      path: "/announcements/{id}/click",
      response: click,
      spec,
    });

    const acknowledge = await agent
      .post(`/announcements/${id}/acknowledge?platform=web`)
      .expect(200);
    expectDocumentedResponse({
      method: "post",
      path: "/announcements/{id}/acknowledge",
      response: acknowledge,
      spec,
    });

    for (const page of [1, 2]) {
      const feed = await agent
        .get(`/announcements/feed?platform=web&limit=1&page=${page}`)
        .expect(200);
      expectDocumentedResponse({method: "get", path: "/announcements/feed", response: feed, spec});
    }
  });

  it("reports more on every feed page but the last so clients keep the list envelope", async () => {
    const publishedAt = DateTime.utc().minus({minutes: 1}).toJSDate();
    for (const title of ["One", "Two", "Three"]) {
      await Announcement.create({body: "Body", publishedAt, status: "published", title});
    }
    const agent = await authAsUser(app, "notAdmin");

    const pages = [];
    for (const page of [1, 2, 3]) {
      const res = await agent.get(`/announcements/feed?platform=web&limit=2&page=${page}`);
      pages.push({count: res.body.data.length, more: res.body.more, total: res.body.total});
    }

    expect(pages).toEqual([
      {count: 2, more: true, total: 3},
      {count: 1, more: false, total: 3},
      {count: 0, more: false, total: 3},
    ]);
  });
});
