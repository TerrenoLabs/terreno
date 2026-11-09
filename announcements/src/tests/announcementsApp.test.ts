import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {
  APIError,
  addAuthRoutes,
  apiErrorMiddleware,
  apiUnauthorizedMiddleware,
  setupAuth,
  type UserModel as UserModelType,
} from "@terreno/api";
import {authAsUser, getBaseServer, setupDb, UserModel} from "@terreno/api/testing";
import {assert} from "chai";
import type express from "express";
import {DateTime} from "luxon";
import supertest from "supertest";
import type TestAgent from "supertest/lib/agent";
import {AnnouncementsApp} from "../announcementsApp";
import {Announcement} from "../models/announcement";
import {AnnouncementAcknowledgement} from "../models/announcementAcknowledgement";
import {AnnouncementClickEvent} from "../models/announcementClickEvent";
import {AnnouncementImpression} from "../models/announcementImpression";
import {importAnnouncementRelease} from "../releaseImport";

const buildApp = (options?: {
  basePath?: string;
  defaultAcknowledgementPolicy?: "required" | "dismiss-only";
  isStaff?: (user: unknown) => boolean;
  matchAudience?: (user: unknown, announcement: unknown) => boolean;
  uploadToken?: string;
}): express.Application => {
  const app = getBaseServer();
  setupAuth(app, UserModel as unknown as UserModelType);
  addAuthRoutes(app, UserModel as unknown as UserModelType);

  const plugin = new AnnouncementsApp(options);
  plugin.register(app);

  app.use(apiUnauthorizedMiddleware);
  app.use(apiErrorMiddleware);
  return app;
};

describe("AnnouncementsApp", () => {
  let app: express.Application;
  let adminAgent: TestAgent;
  let userAgent: TestAgent;

  beforeEach(async () => {
    await setupDb();
    await Announcement.deleteMany({});
    await AnnouncementAcknowledgement.deleteMany({});
    await AnnouncementImpression.deleteMany({});
    await AnnouncementClickEvent.deleteMany({});
    app = buildApp();
    adminAgent = await authAsUser(app, "admin");
    userAgent = await authAsUser(app, "notAdmin");
  });

  afterEach(async () => {
    await Announcement.deleteMany({});
    await AnnouncementAcknowledgement.deleteMany({});
    await AnnouncementImpression.deleteMany({});
    await AnnouncementClickEvent.deleteMany({});
  });

  it("contributes announcement admin models and grouped overview screen", () => {
    const contribution = new AnnouncementsApp().adminContribution();
    expect(contribution.models?.length).toBe(4);
    expect(contribution.models?.[0]?.routePath).toBe("/announcements");
    expect(contribution.models?.[0]?.admin.displayName).toBe("All announcements");
    expect(contribution.models?.every((entry) => entry.admin.group === "Announcements")).toBe(true);
    for (const eventModel of contribution.models?.slice(1) ?? []) {
      assert.deepEqual(eventModel.admin.adminPermissions?.create, []);
      assert.deepEqual(eventModel.admin.adminPermissions?.delete, []);
      assert.deepEqual(eventModel.admin.adminPermissions?.update, []);
    }
    expect(contribution.customScreens).toEqual([
      {
        displayName: "Overview",
        group: "Announcements",
        icon: "bullhorn",
        name: "announcements",
      },
    ]);
  });

  it("publishes draft announcements and returns them as pending", async () => {
    const createRes = await adminAgent
      .post("/announcements")
      .send({
        acknowledgementPolicy: "required",
        body: "## Welcome\n\nCheck out the new feature.",
        title: "New feature",
      })
      .expect(201);

    const announcementId = createRes.body.data._id as string;
    await adminAgent.post(`/announcements/${announcementId}/publish`).expect(200);

    const pendingRes = await userAgent.get("/announcements/pending?platform=web").expect(200);
    expect(pendingRes.body.data.current?.id).toBe(announcementId);
    expect(pendingRes.body.data.current?.requiresAcknowledgement).toBe(true);
    expect(pendingRes.body.data.remainingCount).toBe(0);
  });

  it("imports multiple release announcements as idempotent drafts with a bearer token", async () => {
    const uploadApp = buildApp({uploadToken: "release-upload-secret"});
    const request = supertest(uploadApp);
    const pack = {
      announcements: [
        {
          acknowledgementPolicy: "required",
          body: "Staff release details",
          displayMode: "modal",
          slug: "staff-release",
          title: "Staff: version 1.14.0",
        },
        {
          body: "Patient release details",
          slug: "patient-release",
          title: "New in version 1.14.0",
        },
      ],
      defaults: {
        audienceType: "patient",
        platforms: ["ios", "android"],
      },
      release: {
        buildNumber: 1842,
        channel: "production",
        product: "example",
        version: "1.14.0",
      },
    };

    const firstResponse = await request
      .post("/announcements/import-release")
      .set("Authorization", "Bearer release-upload-secret")
      .send(pack)
      .expect(200);
    assert.equal(firstResponse.body.data.created, 2);
    assert.equal(firstResponse.body.data.published, 0);

    const imported = await Announcement.find({}).sort({releaseSlug: 1});
    assert.lengthOf(imported, 2);
    assert.equal(imported[0]?.status, "draft");
    assert.equal(imported[0]?.minBuildNumber, 1842);
    assert.deepEqual(imported[0]?.platforms, ["ios", "android"]);
    assert.equal(imported[0]?.release?.version, "1.14.0");

    const secondResponse = await request
      .post("/announcements/import-release")
      .set("Authorization", "Bearer release-upload-secret")
      .send(pack)
      .expect(200);
    assert.equal(secondResponse.body.data.created, 0);
    assert.equal(secondResponse.body.data.unchanged, 2);
    assert.equal(secondResponse.body.data.updated, 0);
    assert.equal(await Announcement.countDocuments({}), 2);
  });

  it("publishes a release pack only when publish is explicitly true", async () => {
    const uploadApp = buildApp({uploadToken: "release-upload-secret"});
    const response = await supertest(uploadApp)
      .post("/announcements/import-release")
      .set("Authorization", "Bearer release-upload-secret")
      .send({
        announcements: [
          {
            body: "Public release details",
            displayMode: "feed",
            slug: "changelog",
            title: "Version 1.14.0",
          },
        ],
        publish: true,
        release: {
          product: "example",
          version: "1.14.0",
        },
      })
      .expect(200);

    assert.equal(response.body.data.published, 1);
    const announcement = await Announcement.findExactlyOne({releaseSlug: "changelog"});
    assert.equal(announcement.status, "published");
    assert.exists(announcement.publishedAt);
    assert.equal(announcement.release?.channel, "production");
  });

  it("restores a soft-deleted announcement when its release pack is re-imported", async () => {
    const uploadApp = buildApp({uploadToken: "release-upload-secret"});
    const pack = {
      announcements: [{body: "Updated details", slug: "changelog", title: "Version 1.14.0"}],
      release: {product: "example", version: "1.14.0"},
    };
    await supertest(uploadApp)
      .post("/announcements/import-release")
      .set("Authorization", "Bearer release-upload-secret")
      .send(pack)
      .expect(200);
    const original = await Announcement.findExactlyOne({releaseSlug: "changelog"});
    original.deleted = true;
    await original.save();

    const response = await supertest(uploadApp)
      .post("/announcements/import-release")
      .set("Authorization", "Bearer release-upload-secret")
      .send(pack)
      .expect(200);

    assert.equal(response.body.data.updated, 1);
    const restored = await Announcement.findExactlyOne({releaseSlug: "changelog"});
    assert.equal(restored.deleted, false);
    assert.equal(await Announcement.countDocuments({}), 1);
  });

  it("bumps the content version when a restored published import changes its body", async () => {
    const uploadApp = buildApp({uploadToken: "release-upload-secret"});
    const buildPack = (body: string): Record<string, unknown> => ({
      announcements: [{body, slug: "changelog", title: "Version 1.14.0"}],
      publish: true,
      release: {product: "example", version: "1.14.0"},
    });
    await supertest(uploadApp)
      .post("/announcements/import-release")
      .set("Authorization", "Bearer release-upload-secret")
      .send(buildPack("Original published details"))
      .expect(200);
    const original = await Announcement.findExactlyOne({releaseSlug: "changelog"});
    original.deleted = true;
    await original.save();

    await supertest(uploadApp)
      .post("/announcements/import-release")
      .set("Authorization", "Bearer release-upload-secret")
      .send(buildPack("Revised published details"))
      .expect(200);

    const restored = await Announcement.findExactlyOne({releaseSlug: "changelog"});
    assert.equal(restored.version, 2);
    assert.equal(restored.body, "Revised published details");
  });

  it("rejects release imports with an invalid upload token", async () => {
    const uploadApp = buildApp({uploadToken: "release-upload-secret"});
    await supertest(uploadApp)
      .post("/announcements/import-release")
      .set("Authorization", "Bearer wrong-secret")
      .send({
        announcements: [{body: "Details", slug: "changelog", title: "Version 1.14.0"}],
        release: {product: "example", version: "1.14.0"},
      })
      .expect(401);
    assert.equal(await Announcement.countDocuments({}), 0);
  });

  it("rejects duplicate slugs within one release pack", async () => {
    const uploadApp = buildApp({uploadToken: "release-upload-secret"});
    const response = await supertest(uploadApp)
      .post("/announcements/import-release")
      .set("Authorization", "Bearer release-upload-secret")
      .send({
        announcements: [
          {body: "First", slug: "changelog", title: "First"},
          {body: "Second", slug: "changelog", title: "Second"},
        ],
        release: {product: "example", version: "1.14.0"},
      })
      .expect(400);

    assert.equal(response.body.title, "Validation failed");
    assert.equal(
      response.body.meta.fields.announcements,
      "Release announcement slugs must be unique"
    );
    assert.equal(await Announcement.countDocuments({}), 0);
  });

  it("rejects release packs with unknown fields or malformed items", async () => {
    const uploadApp = buildApp({uploadToken: "release-upload-secret"});
    const invalidBodies = [
      {
        announcements: [{body: "Body", slug: "changelog", title: "Title"}],
        release: {product: "example", version: "1.14.0"},
        unexpected: true,
      },
      {
        announcements: [{body: "Body", slug: "Not A Slug", title: "Title"}],
        release: {product: "example", version: "1.14.0"},
      },
      {
        announcements: [{body: "", slug: "changelog", title: "Title"}],
        release: {product: "example", version: "1.14.0"},
      },
      {
        announcements: [{body: "Body", displayMode: "popup", slug: "changelog", title: "Title"}],
        release: {product: "example", version: "1.14.0"},
      },
      {
        announcements: [{body: "Body", slug: "changelog", title: "Title"}],
        release: {version: "1.14.0"},
      },
    ];

    for (const invalidBody of invalidBodies) {
      const response = await supertest(uploadApp)
        .post("/announcements/import-release")
        .set("Authorization", "Bearer release-upload-secret")
        .send(invalidBody)
        .expect(400);
      assert.equal(response.body.title, "Validation failed");
    }
    assert.equal(await Announcement.countDocuments({}), 0);
  });

  it("validates release packs passed directly to importAnnouncementRelease", async () => {
    let caught: unknown;
    try {
      await importAnnouncementRelease({
        input: {
          announcements: [
            {body: "First", slug: "changelog", title: "First"},
            {body: "Second", slug: "changelog", title: "Second"},
          ],
          release: {product: "example", version: "1.14.0"},
        },
      });
    } catch (error) {
      caught = error;
    }

    assert.instanceOf(caught, APIError);
    assert.equal((caught as APIError).status, 400);
    assert.equal(await Announcement.countDocuments({}), 0);
  });

  it("resolves requiresAcknowledgement on GET pending for each policy case", async () => {
    const requiredApp = buildApp();
    const requiredUser = await authAsUser(requiredApp, "notAdmin");

    const requiredAnnouncement = await Announcement.create({
      acknowledgementPolicy: "required",
      body: "Required body",
      publishedAt: DateTime.utc().toJSDate(),
      status: "published",
      title: "Required ack",
      version: 1,
    });

    const requiredRes = await requiredUser.get("/announcements/pending?platform=web").expect(200);
    expect(requiredRes.body.data.current?.id).toBe(requiredAnnouncement._id.toString());
    expect(requiredRes.body.data.current?.requiresAcknowledgement).toBe(true);

    await Announcement.deleteMany({});

    const dismissAnnouncement = await Announcement.create({
      acknowledgementPolicy: "dismiss-only",
      body: "Dismiss body",
      publishedAt: DateTime.utc().toJSDate(),
      status: "published",
      title: "Dismiss only",
      version: 1,
    });

    const dismissRes = await requiredUser.get("/announcements/pending?platform=web").expect(200);
    expect(dismissRes.body.data.current?.id).toBe(dismissAnnouncement._id.toString());
    expect(dismissRes.body.data.current?.requiresAcknowledgement).toBe(false);

    await Announcement.deleteMany({});

    const defaultApp = buildApp({defaultAcknowledgementPolicy: "required"});
    const defaultUser = await authAsUser(defaultApp, "notAdmin");
    const omittedAnnouncement = await Announcement.create({
      body: "Default policy body",
      publishedAt: DateTime.utc().toJSDate(),
      status: "published",
      title: "Omitted policy",
      version: 1,
    });

    const defaultRes = await defaultUser.get("/announcements/pending?platform=web").expect(200);
    expect(defaultRes.body.data.current?.id).toBe(omittedAnnouncement._id.toString());
    expect(defaultRes.body.data.current?.requiresAcknowledgement).toBe(true);

    await Announcement.deleteMany({});

    const legacyAnnouncement = await Announcement.collection.insertOne({
      body: "Legacy body",
      created: DateTime.utc().toJSDate(),
      platforms: ["web"],
      priority: 0,
      publishedAt: DateTime.utc().toJSDate(),
      requiresAcknowledgement: true,
      status: "published",
      title: "Legacy boolean",
      updated: DateTime.utc().toJSDate(),
      version: 1,
    });

    const legacyRes = await requiredUser.get("/announcements/pending?platform=web").expect(200);
    expect(legacyRes.body.data.current?.id).toBe(legacyAnnouncement.insertedId.toString());
    expect(legacyRes.body.data.current?.requiresAcknowledgement).toBe(true);
  });

  it("clears pending after acknowledgement", async () => {
    const announcement = await Announcement.create({
      acknowledgementPolicy: "required",
      body: "Body",
      publishedAt: DateTime.utc().toJSDate(),
      status: "published",
      title: "Shipped",
      version: 1,
    });

    await userAgent.get("/announcements/pending?platform=web").expect(200);
    await userAgent.post(`/announcements/${announcement._id.toString()}/acknowledge`).expect(200);

    const pendingRes = await userAgent.get("/announcements/pending?platform=web").expect(200);
    expect(pendingRes.body.data.current).toBeNull();
  });

  it("bumps version when published title/body changes", async () => {
    const announcement = await Announcement.create({
      acknowledgementPolicy: "required",
      body: "Body v1",
      publishedAt: DateTime.utc().toJSDate(),
      status: "published",
      title: "Title v1",
      version: 1,
    });

    await userAgent.post(`/announcements/${announcement._id.toString()}/acknowledge`).expect(200);

    announcement.body = "Body v2";
    await announcement.save();

    const pendingRes = await userAgent.get("/announcements/pending?platform=web").expect(200);
    expect(pendingRes.body.data.current?.version).toBe(2);
  });

  it("rejects non-admins from admin CRUD", async () => {
    await userAgent.get("/announcements").expect(405);
  });

  it("rejects invalid publish and archive transitions", async () => {
    const published = await Announcement.create({
      body: "Body",
      publishedAt: DateTime.utc().toJSDate(),
      status: "published",
      title: "Already published",
      version: 1,
    });

    await adminAgent.post(`/announcements/${published._id.toString()}/publish`).expect(400);

    const draft = await Announcement.create({
      body: "Draft body",
      status: "draft",
      title: "Draft",
      version: 1,
    });

    await adminAgent.post(`/announcements/${draft._id.toString()}/archive`).expect(400);
  });

  it("records impressions and keeps duplicate acknowledgements idempotent", async () => {
    const announcement = await Announcement.create({
      acknowledgementPolicy: "required",
      body: "Body",
      publishedAt: DateTime.utc().toJSDate(),
      status: "published",
      title: "Track views",
      version: 1,
    });

    const announcementId = announcement._id.toString();
    await userAgent
      .post(`/announcements/${announcementId}/impression`)
      .send({platform: "web"})
      .expect(200);

    const impressions = await AnnouncementImpression.find({announcementId: announcement._id});
    expect(impressions.length).toBe(1);
    expect(impressions[0]?.platform).toBe("web");

    await userAgent.post(`/announcements/${announcementId}/acknowledge`).expect(200);
    await userAgent.post(`/announcements/${announcementId}/acknowledge`).expect(200);

    const acknowledgements = await AnnouncementAcknowledgement.find({
      announcementId: announcement._id,
    });
    expect(acknowledgements.length).toBe(1);
  });

  it("POST acknowledge and impression return 404 when the announcement is not visible", async () => {
    await Announcement.deleteMany({});
    await AnnouncementAcknowledgement.deleteMany({});
    await AnnouncementImpression.deleteMany({});

    const visibilityApp = buildApp({
      isStaff: (user) => (user as {admin?: boolean}).admin === true,
      matchAudience: (_user, announcement) => {
        const audience = announcement as {audience?: {include?: boolean}};
        return audience.audience?.include !== false;
      },
    });
    const staffAgent = await authAsUser(visibilityApp, "admin");
    const patientAgent = await authAsUser(visibilityApp, "notAdmin");

    const staffOnly = await Announcement.create({
      audienceType: "staff",
      body: "Staff",
      publishedAt: DateTime.utc().toJSDate(),
      status: "published",
      title: "Staff only",
      version: 1,
    });
    await patientAgent.post(`/announcements/${staffOnly._id.toString()}/acknowledge`).expect(404);
    await patientAgent
      .post(`/announcements/${staffOnly._id.toString()}/impression`)
      .send({platform: "web"})
      .expect(404);

    const excluded = await Announcement.create({
      audience: {include: false},
      audienceType: "all",
      body: "Hidden",
      publishedAt: DateTime.utc().toJSDate(),
      status: "published",
      title: "Custom excluded",
      version: 1,
    });
    await staffAgent
      .post(`/announcements/${excluded._id.toString()}/acknowledge?platform=web`)
      .expect(404);
    await staffAgent
      .post(`/announcements/${excluded._id.toString()}/impression?platform=web`)
      .send({platform: "web"})
      .expect(404);

    const expired = await Announcement.create({
      body: "Expired",
      expiresAt: DateTime.utc().minus({days: 1}).toJSDate(),
      publishedAt: DateTime.utc().minus({days: 2}).toJSDate(),
      status: "published",
      title: "Expired",
      version: 1,
    });
    await patientAgent.post(`/announcements/${expired._id.toString()}/acknowledge`).expect(404);
    await patientAgent
      .post(`/announcements/${expired._id.toString()}/impression`)
      .send({platform: "web"})
      .expect(404);

    const gated = await Announcement.create({
      body: "Gated",
      minBuildNumber: 10,
      publishedAt: DateTime.utc().toJSDate(),
      status: "published",
      title: "Min build",
      version: 1,
    });
    await patientAgent
      .post(`/announcements/${gated._id.toString()}/acknowledge?platform=web&version=9`)
      .expect(404);
    await patientAgent
      .post(`/announcements/${gated._id.toString()}/impression?platform=web&version=9`)
      .send({platform: "web"})
      .expect(404);

    assert.lengthOf(await AnnouncementAcknowledgement.find({}), 0);
    assert.lengthOf(await AnnouncementImpression.find({}), 0);
  });

  it("filters pending announcements with matchAudience", async () => {
    await Announcement.deleteMany({});
    await AnnouncementImpression.deleteMany({});
    await AnnouncementAcknowledgement.deleteMany({});

    const targetedApp = buildApp({
      matchAudience: (_user, announcement) => {
        const audience = announcement as {audience?: {include?: boolean}};
        return audience.audience?.include !== false;
      },
    });
    const targetedUserAgent = await authAsUser(targetedApp, "notAdmin");

    await Announcement.create({
      acknowledgementPolicy: "required",
      audience: {include: true},
      body: "Visible",
      publishedAt: DateTime.utc().toJSDate(),
      status: "published",
      title: "Included",
      version: 1,
    });
    await Announcement.create({
      acknowledgementPolicy: "required",
      audience: {include: false},
      body: "Hidden",
      publishedAt: DateTime.utc().toJSDate(),
      status: "published",
      title: "Excluded",
      version: 1,
    });

    const pendingRes = await targetedUserAgent
      .get("/announcements/pending?platform=web")
      .expect(200);

    expect(pendingRes.body.data.current?.title).toBe("Included");
    expect(pendingRes.body.data.remainingCount).toBe(0);
  });

  it("returns a paginated announcement feed", async () => {
    await Announcement.create({
      body: "Feed body",
      publishedAt: DateTime.utc().toJSDate(),
      status: "published",
      title: "Feed item",
      version: 1,
    });

    const feedRes = await userAgent
      .get("/announcements/feed?page=1&limit=10&platform=web")
      .expect(200);
    expect(feedRes.body.data.length).toBeGreaterThanOrEqual(1);
    expect(feedRes.body.total).toBeGreaterThanOrEqual(1);
    expect(feedRes.body.page).toBe(1);
  });

  it("GET pending omits feed displayMode and GET feed includes feed-only items", async () => {
    await Announcement.deleteMany({});

    const modal = await Announcement.create({
      acknowledgementPolicy: "required",
      body: "Modal body",
      displayMode: "modal",
      publishedAt: DateTime.utc().toJSDate(),
      status: "published",
      title: "Modal item",
      version: 1,
    });
    await Announcement.create({
      acknowledgementPolicy: "required",
      body: "Feed body",
      displayMode: "feed",
      publishedAt: DateTime.utc().toJSDate(),
      status: "published",
      title: "Feed only",
      version: 1,
    });

    const pendingRes = await userAgent.get("/announcements/pending?platform=web").expect(200);
    assert.strictEqual(pendingRes.body.data.current?.id, modal._id.toString());
    assert.strictEqual(pendingRes.body.data.current?.displayMode, "modal");

    const feedRes = await userAgent
      .get("/announcements/feed?page=1&limit=10&platform=web")
      .expect(200);
    const feedTitles = feedRes.body.data.map((item: {title: string}) => item.title);
    assert.include(feedTitles, "Modal item");
    assert.include(feedTitles, "Feed only");
  });

  it("GET pending and feed honor minBuildNumber when version query is present", async () => {
    await Announcement.deleteMany({});

    const visible = await Announcement.create({
      acknowledgementPolicy: "required",
      body: "Visible body",
      minBuildNumber: 10,
      publishedAt: DateTime.utc().toJSDate(),
      status: "published",
      title: "Visible at 10",
      version: 1,
    });
    await Announcement.create({
      acknowledgementPolicy: "required",
      body: "Hidden body",
      minBuildNumber: 20,
      publishedAt: DateTime.utc().toJSDate(),
      status: "published",
      title: "Hidden below 20",
      version: 1,
    });

    const pendingHidden = await userAgent
      .get("/announcements/pending?platform=web&version=9")
      .expect(200);
    assert.isNull(pendingHidden.body.data.current);

    const pendingVisible = await userAgent
      .get("/announcements/pending?platform=web&version=10")
      .expect(200);
    assert.strictEqual(pendingVisible.body.data.current?.id, visible._id.toString());

    const feedHidden = await userAgent
      .get("/announcements/feed?platform=web&version=9")
      .expect(200);
    assert.lengthOf(feedHidden.body.data, 0);

    const feedOmitted = await userAgent.get("/announcements/feed?platform=web").expect(200);
    assert.isAtLeast(feedOmitted.body.data.length, 2);
  });

  it("filters pending by audienceType composed with matchAudience", async () => {
    await Announcement.deleteMany({});

    const audienceApp = buildApp({
      isStaff: (user) => (user as {admin?: boolean}).admin === true,
      matchAudience: (_user, announcement) => {
        const audience = announcement as {audience?: {include?: boolean}};
        return audience.audience?.include !== false;
      },
    });
    const staffAgent = await authAsUser(audienceApp, "admin");
    const patientAgent = await authAsUser(audienceApp, "notAdmin");

    await Announcement.create({
      acknowledgementPolicy: "required",
      audience: {include: true},
      audienceType: "staff",
      body: "Staff only",
      publishedAt: DateTime.utc().toJSDate(),
      status: "published",
      title: "Staff modal",
      version: 1,
    });
    await Announcement.create({
      acknowledgementPolicy: "required",
      audience: {include: true},
      audienceType: "patient",
      body: "Patient only",
      publishedAt: DateTime.utc().toJSDate(),
      status: "published",
      title: "Patient modal",
      version: 1,
    });

    const staffPending = await staffAgent.get("/announcements/pending?platform=web").expect(200);
    assert.strictEqual(staffPending.body.data.current?.title, "Staff modal");

    const patientPending = await patientAgent
      .get("/announcements/pending?platform=web")
      .expect(200);
    assert.strictEqual(patientPending.body.data.current?.title, "Patient modal");
  });

  it("POST click records primaryAction with version and optional platform", async () => {
    const announcement = await Announcement.create({
      body: "Body",
      platforms: ["web"],
      primaryAction: {label: "Learn more", url: "https://example.com"},
      publishedAt: DateTime.utc().toJSDate(),
      status: "published",
      title: "Clickable",
      version: 3,
    });

    const announcementId = announcement._id.toString();
    await userAgent
      .post(`/announcements/${announcementId}/click`)
      .send({action: "primaryAction", platform: "web"})
      .expect(200);

    const clicks = await AnnouncementClickEvent.find({announcementId: announcement._id});
    assert.lengthOf(clicks, 1);
    assert.strictEqual(clicks[0]?.action, "primaryAction");
    assert.strictEqual(clicks[0]?.version, 3);
    assert.strictEqual(clicks[0]?.platform, "web");
    assert.isOk(clicks[0]?.clickedAt);
  });

  it("POST click inserts a new row on each repeat click", async () => {
    const announcement = await Announcement.create({
      body: "Body",
      primaryAction: {label: "Go", url: "https://example.com/go"},
      publishedAt: DateTime.utc().toJSDate(),
      status: "published",
      title: "Repeat clicks",
      version: 1,
    });

    const announcementId = announcement._id.toString();
    await userAgent
      .post(`/announcements/${announcementId}/click`)
      .send({action: "primaryAction"})
      .expect(200);
    await userAgent
      .post(`/announcements/${announcementId}/click`)
      .send({action: "primaryAction"})
      .expect(200);

    const clicks = await AnnouncementClickEvent.find({announcementId: announcement._id});
    assert.lengthOf(clicks, 2);
  });

  it("POST click returns 400 when primaryAction is missing or action is unknown", async () => {
    await Announcement.deleteMany({});
    await AnnouncementClickEvent.deleteMany({});

    const withoutPrimary = await Announcement.create({
      body: "Body",
      publishedAt: DateTime.utc().toJSDate(),
      status: "published",
      title: "No CTA",
      version: 1,
    });

    await userAgent
      .post(`/announcements/${withoutPrimary._id.toString()}/click`)
      .send({action: "primaryAction"})
      .expect(400);

    const withPrimary = await Announcement.create({
      body: "Body",
      primaryAction: {label: "Go", url: "https://example.com"},
      publishedAt: DateTime.utc().toJSDate(),
      status: "published",
      title: "Has CTA",
      version: 1,
    });

    await userAgent
      .post(`/announcements/${withPrimary._id.toString()}/click`)
      .send({action: "secondaryAction"})
      .expect(400);
  });

  it("POST click and impression reject bodies that fail the Zod schema", async () => {
    await Announcement.deleteMany({});
    await AnnouncementClickEvent.deleteMany({});
    await AnnouncementImpression.deleteMany({});

    const announcement = await Announcement.create({
      body: "Body",
      primaryAction: {label: "Go", url: "https://example.com"},
      publishedAt: DateTime.utc().toJSDate(),
      status: "published",
      title: "Strict bodies",
      version: 1,
    });
    const announcementId = announcement._id.toString();

    const missingAction = await userAgent
      .post(`/announcements/${announcementId}/click`)
      .send({platform: "web"})
      .expect(400);
    assert.equal(missingAction.body.title, "Validation failed");
    assert.isString(missingAction.body.meta.fields.action);

    await userAgent
      .post(`/announcements/${announcementId}/click`)
      .send({action: "primaryAction", extra: true})
      .expect(400);

    const badImpressionPlatform = await userAgent
      .post(`/announcements/${announcementId}/impression`)
      .send({platform: "desktop"})
      .expect(400);
    assert.isString(badImpressionPlatform.body.meta.fields.platform);

    await userAgent
      .post(`/announcements/${announcementId}/impression`)
      .send({unexpected: "value"})
      .expect(400);

    await userAgent.post(`/announcements/${announcementId}/impression?platform=ios`).expect(200);

    assert.lengthOf(await AnnouncementClickEvent.find({announcementId: announcement._id}), 0);
    const impressions = await AnnouncementImpression.find({announcementId: announcement._id});
    assert.lengthOf(impressions, 1);
    assert.strictEqual(impressions[0]?.platform, "ios");
  });

  it("POST click returns 404 for non-visible announcements before validating action or CTA", async () => {
    await Announcement.deleteMany({});
    await AnnouncementClickEvent.deleteMany({});

    const visibilityApp = buildApp({
      isStaff: (user) => (user as {admin?: boolean}).admin === true,
    });
    const patientAgent = await authAsUser(visibilityApp, "notAdmin");

    const staffOnly = await Announcement.create({
      audienceType: "staff",
      body: "Staff",
      primaryAction: {label: "Go", url: "https://example.com"},
      publishedAt: DateTime.utc().toJSDate(),
      status: "published",
      title: "Staff only",
      version: 1,
    });

    const invalidActionRes = await patientAgent
      .post(`/announcements/${staffOnly._id.toString()}/click?platform=web`)
      .send({action: "secondaryAction"});
    assert.strictEqual(invalidActionRes.status, 404);

    const staffOnlyNoCta = await Announcement.create({
      audienceType: "staff",
      body: "Staff no CTA",
      publishedAt: DateTime.utc().toJSDate(),
      status: "published",
      title: "Staff no CTA",
      version: 1,
    });

    const missingCtaRes = await patientAgent
      .post(`/announcements/${staffOnlyNoCta._id.toString()}/click?platform=web`)
      .send({action: "primaryAction"});
    assert.strictEqual(missingCtaRes.status, 404);
  });

  it("POST click returns 400 when platform is supplied but invalid", async () => {
    await Announcement.deleteMany({});
    await AnnouncementClickEvent.deleteMany({});

    const announcement = await Announcement.create({
      body: "Body",
      primaryAction: {label: "Go", url: "https://example.com"},
      publishedAt: DateTime.utc().toJSDate(),
      status: "published",
      title: "Visible",
      version: 1,
    });

    await userAgent
      .post(`/announcements/${announcement._id.toString()}/click`)
      .send({action: "primaryAction", platform: "desktop"})
      .expect(400);

    const clicks = await AnnouncementClickEvent.find({announcementId: announcement._id});
    assert.lengthOf(clicks, 0);
  });

  it("POST click requires authentication", async () => {
    const announcement = await Announcement.create({
      body: "Body",
      primaryAction: {label: "Go", url: "https://example.com"},
      publishedAt: DateTime.utc().toJSDate(),
      status: "published",
      title: "Auth required",
      version: 1,
    });

    await supertest(app)
      .post(`/announcements/${announcement._id.toString()}/click`)
      .send({action: "primaryAction"})
      .expect(401);
  });

  it("POST click returns 404 when announcement is not visible to the user", async () => {
    await Announcement.deleteMany({});
    await AnnouncementClickEvent.deleteMany({});

    const visibilityApp = buildApp({
      isStaff: (user) => (user as {admin?: boolean}).admin === true,
      matchAudience: (_user, announcement) => {
        const audience = announcement as {audience?: {include?: boolean}};
        return audience.audience?.include !== false;
      },
    });
    const staffAgent = await authAsUser(visibilityApp, "admin");
    const patientAgent = await authAsUser(visibilityApp, "notAdmin");

    const draft = await Announcement.create({
      body: "Draft",
      primaryAction: {label: "Go", url: "https://example.com"},
      status: "draft",
      title: "Draft",
      version: 1,
    });
    await patientAgent
      .post(`/announcements/${draft._id.toString()}/click`)
      .send({action: "primaryAction"})
      .expect(404);

    const expired = await Announcement.create({
      body: "Expired",
      expiresAt: DateTime.utc().minus({days: 1}).toJSDate(),
      primaryAction: {label: "Go", url: "https://example.com"},
      publishedAt: DateTime.utc().minus({days: 2}).toJSDate(),
      status: "published",
      title: "Expired",
      version: 1,
    });
    await patientAgent
      .post(`/announcements/${expired._id.toString()}/click`)
      .send({action: "primaryAction"})
      .expect(404);

    const scheduled = await Announcement.create({
      body: "Future",
      primaryAction: {label: "Go", url: "https://example.com"},
      publishAt: DateTime.utc().plus({days: 1}).toJSDate(),
      publishedAt: DateTime.utc().toJSDate(),
      status: "published",
      title: "Scheduled",
      version: 1,
    });
    await patientAgent
      .post(`/announcements/${scheduled._id.toString()}/click`)
      .send({action: "primaryAction"})
      .expect(404);

    const iosOnly = await Announcement.create({
      body: "iOS",
      platforms: ["ios"],
      primaryAction: {label: "Go", url: "https://example.com"},
      publishedAt: DateTime.utc().toJSDate(),
      status: "published",
      title: "iOS only",
      version: 1,
    });
    await patientAgent
      .post(`/announcements/${iosOnly._id.toString()}/click?platform=web`)
      .send({action: "primaryAction"})
      .expect(404);

    const gated = await Announcement.create({
      body: "Gated",
      minBuildNumber: 10,
      primaryAction: {label: "Go", url: "https://example.com"},
      publishedAt: DateTime.utc().toJSDate(),
      status: "published",
      title: "Min build",
      version: 1,
    });
    await patientAgent
      .post(`/announcements/${gated._id.toString()}/click?platform=web&version=9`)
      .send({action: "primaryAction"})
      .expect(404);

    const staffOnly = await Announcement.create({
      audience: {include: true},
      audienceType: "staff",
      body: "Staff",
      primaryAction: {label: "Go", url: "https://example.com"},
      publishedAt: DateTime.utc().toJSDate(),
      status: "published",
      title: "Staff only",
      version: 1,
    });
    await patientAgent
      .post(`/announcements/${staffOnly._id.toString()}/click?platform=web`)
      .send({action: "primaryAction"})
      .expect(404);

    const excluded = await Announcement.create({
      audience: {include: false},
      audienceType: "all",
      body: "Hidden",
      primaryAction: {label: "Go", url: "https://example.com"},
      publishedAt: DateTime.utc().toJSDate(),
      status: "published",
      title: "Custom excluded",
      version: 1,
    });
    await staffAgent
      .post(`/announcements/${excluded._id.toString()}/click?platform=web`)
      .send({action: "primaryAction"})
      .expect(404);
  });

  it("GET /config returns defaultAcknowledgementPolicy for admins", async () => {
    const defaultApp = buildApp();
    const defaultAdmin = await authAsUser(defaultApp, "admin");
    const defaultRes = await defaultAdmin.get("/announcements/config").expect(200);
    assert.strictEqual(defaultRes.body.data.defaultAcknowledgementPolicy, "dismiss-only");

    const requiredApp = buildApp({defaultAcknowledgementPolicy: "required"});
    const requiredAdmin = await authAsUser(requiredApp, "admin");
    const requiredRes = await requiredAdmin.get("/announcements/config").expect(200);
    assert.strictEqual(requiredRes.body.data.defaultAcknowledgementPolicy, "required");

    const dismissApp = buildApp({defaultAcknowledgementPolicy: "dismiss-only"});
    const dismissAdmin = await authAsUser(dismissApp, "admin");
    const dismissRes = await dismissAdmin.get("/announcements/config").expect(200);
    assert.strictEqual(dismissRes.body.data.defaultAcknowledgementPolicy, "dismiss-only");
  });

  it("GET /config returns 403 for non-admins", async () => {
    const res = await userAgent.get("/announcements/config").expect(403);
    assert.strictEqual(res.body.title, "Admin access required");
  });

  it("GET /config requires authentication", async () => {
    await supertest(app).get("/announcements/config").expect(401);
  });

  it("admin can list announcement click events and non-admins cannot", async () => {
    await Announcement.deleteMany({});
    await AnnouncementClickEvent.deleteMany({});

    const announcement = await Announcement.create({
      body: "Body",
      primaryAction: {label: "Go", url: "https://example.com"},
      publishedAt: DateTime.utc().toJSDate(),
      status: "published",
      title: "Tracked click",
      version: 2,
    });

    await userAgent
      .post(`/announcements/${announcement._id.toString()}/click`)
      .send({action: "primaryAction", platform: "web"})
      .expect(200);

    const listRes = await adminAgent.get("/announcement-click-events").expect(200);
    assert.isAtLeast(listRes.body.data.length, 1);
    const listed = listRes.body.data.find((row: {announcementId: string | {_id: string}}) => {
      const announcementRef = row.announcementId;
      const id =
        typeof announcementRef === "string" ? announcementRef : announcementRef?._id?.toString();
      return id === announcement._id.toString();
    });
    assert.isOk(listed);
    assert.strictEqual(listed.action, "primaryAction");
    assert.strictEqual(listed.version, 2);

    await userAgent.get("/announcement-click-events").expect(405);
  });
});
