import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import type express from "express";
import type {HydratedDocument} from "mongoose";
import supertest from "supertest";
import type TestAgent from "supertest/lib/agent";
import type {UserModel as UserMongooseModel} from "./auth";
import {ConsentApp, type ConsentAppOptions} from "./consentApp";
import {ConsentForm} from "./models/consentForm";
import {ConsentResponse} from "./models/consentResponse";
import {TerrenoApp} from "./terrenoApp";
import {authAsUser, setupDb, type User, UserModel} from "./tests";
import {expectDocumentedResponse} from "./tests/openApiResponseSchema";
import type {ConsentFormDocument} from "./types/consentForm";

const buildApp = (consentAppOptions: ConsentAppOptions = {}): express.Application =>
  new TerrenoApp({
    skipListen: true,
    userModel: UserModel as unknown as UserMongooseModel,
  })
    .register(new ConsentApp(consentAppOptions))
    .build();

describe("ConsentApp", () => {
  it("contributes consent form and response admin metadata", () => {
    const contribution = new ConsentApp().adminContribution();

    expect(contribution.models).toHaveLength(2);
    expect(contribution.models?.map((item) => item.routePath)).toEqual([
      "/consent-forms",
      "/consent-responses",
    ]);
    expect(contribution.models?.[0]?.admin.fieldOverrides).toEqual({
      checkboxes: {widget: "checkbox-list"},
      content: {widget: "locale-content"},
      defaultLocale: {widget: "locale-default"},
    });
    expect(contribution.models?.[1]?.admin.adminPermissions).toEqual({
      create: [],
      delete: [],
      update: [],
    });
    expect(contribution.models?.[1]?.populatePaths).toEqual([
      {fields: ["title", "slug", "version", "type"], path: "consentFormId"},
      {fields: ["name", "email"], path: "userId"},
    ]);
  });

  let admin: HydratedDocument<User>;
  let notAdmin: HydratedDocument<User>;
  let adminAgent: TestAgent;
  let userAgent: TestAgent;

  beforeEach(async () => {
    [admin, notAdmin] = await setupDb();
    await Promise.all([ConsentForm.deleteMany({}), ConsentResponse.deleteMany({})]);
    const app = buildApp({auditTrail: true});
    adminAgent = await authAsUser(app, "admin");
    userAgent = await authAsUser(app, "notAdmin");
  });

  afterEach(async () => {
    await Promise.all([ConsentForm.deleteMany({}), ConsentResponse.deleteMany({})]);
  });

  describe("GET /consent-forms (admin CRUD)", () => {
    it("returns empty list when no forms exist", async () => {
      const res = await adminAgent.get("/consent-forms").expect(200);
      expect(res.body.data).toHaveLength(0);
      expect(res.body.requestId).toBe(res.headers["x-request-id"]);
    });

    it("lists consent forms for admins", async () => {
      await ConsentForm.create({
        active: true,
        content: new Map([["en", "# Terms\nPlease agree."]]),
        order: 1,
        slug: "terms",
        title: "Terms of Service",
        type: "terms",
        version: 1,
      });

      const res = await adminAgent.get("/consent-forms").expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].title).toBe("Terms of Service");
    });

    it("blocks non-admins from listing forms", async () => {
      await userAgent.get("/consent-forms").expect(405);
    });

    it("creates a consent form as admin", async () => {
      const res = await adminAgent
        .post("/consent-forms")
        .send({
          active: false,
          content: {en: "# Privacy\nWe protect your data."},
          order: 2,
          slug: "privacy",
          title: "Privacy Policy",
          type: "privacy",
          version: 1,
        })
        .expect(201);

      expect(res.body.data.title).toBe("Privacy Policy");
      expect(res.body.data.slug).toBe("privacy");
    });

    it("updates a consent form as admin", async () => {
      const form = await ConsentForm.create({
        active: false,
        content: new Map([["en", "# HIPAA"]]),
        order: 3,
        slug: "hipaa",
        title: "HIPAA Notice",
        type: "hipaa",
        version: 1,
      });

      const res = await adminAgent
        .patch(`/consent-forms/${form._id}`)
        .send({title: "HIPAA Authorization"})
        .expect(200);

      expect(res.body.data.title).toBe("HIPAA Authorization");
    });
  });

  describe("POST /consent-forms/:id/publish", () => {
    it("creates a new version and activates it", async () => {
      const form = await ConsentForm.create({
        active: true,
        content: new Map([["en", "# Terms v1"]]),
        order: 1,
        slug: "terms-publish",
        title: "Terms v1",
        type: "terms",
        version: 1,
      });

      const res = await adminAgent.post(`/consent-forms/${form._id}/publish`).expect(200);

      expect(res.body.data.version).toBe(2);
      expect(res.body.data.active).toBe(true);
      expect(res.body.data.slug).toBe("terms-publish");

      // Old form should be deactivated
      const oldForm = await ConsentForm.findById(form._id);
      expect(oldForm?.active).toBe(false);
    });

    it("increments version number correctly", async () => {
      const form = await ConsentForm.create({
        active: true,
        content: new Map([["en", "# Content"]]),
        order: 1,
        slug: "versioned",
        title: "Versioned Form",
        type: "agreement",
        version: 3,
      });

      const res = await adminAgent.post(`/consent-forms/${form._id}/publish`).expect(200);

      expect(res.body.data.version).toBe(4);
    });

    it("requires admin to publish", async () => {
      const form = await ConsentForm.create({
        active: true,
        content: new Map([["en", "# Terms"]]),
        order: 1,
        slug: "terms-nonadmin",
        title: "Terms",
        type: "terms",
        version: 1,
      });

      await userAgent.post(`/consent-forms/${form._id}/publish`).expect(403);
    });
  });

  describe("GET /consent-responses (admin read-only)", () => {
    it("returns empty list when no responses", async () => {
      const res = await adminAgent.get("/consent-responses").expect(200);
      expect(res.body.data).toHaveLength(0);
    });

    it("lists responses for admins", async () => {
      const form = await ConsentForm.create({
        active: true,
        content: new Map([["en", "# Terms"]]),
        order: 1,
        slug: "terms-resp",
        title: "Terms",
        type: "terms",
        version: 1,
      });

      await ConsentResponse.create({
        agreed: true,
        agreedAt: new Date(),
        consentFormId: form._id,
        formVersionSnapshot: 1,
        locale: "en",
        userId: notAdmin._id,
      });

      const res = await adminAgent.get("/consent-responses").expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].agreed).toBe(true);
    });

    it("populates consentFormId and userId on read", async () => {
      const form = await ConsentForm.create({
        active: true,
        content: new Map([["en", "# Terms"]]),
        order: 1,
        slug: "terms-populated",
        title: "Terms Populated",
        type: "terms",
        version: 1,
      });

      const response = await ConsentResponse.create({
        agreed: true,
        agreedAt: new Date(),
        consentFormId: form._id,
        formVersionSnapshot: 1,
        locale: "en",
        userId: notAdmin._id,
      });

      const res = await adminAgent.get(`/consent-responses/${response._id}`).expect(200);
      expect(res.body.data.consentFormId.title).toBe("Terms Populated");
      expect(res.body.data.userId.email).toBe(notAdmin.email);
      expect(res.body.data.userId.name).toBe(notAdmin.name);
    });

    it("blocks non-admins from listing responses", async () => {
      await userAgent.get("/consent-responses").expect(405);
    });

    it("blocks create on consent-responses", async () => {
      await adminAgent.post("/consent-responses").send({}).expect(405);
    });
  });

  describe("GET /consents/pending", () => {
    it("returns empty array when no active forms", async () => {
      const res = await userAgent.get("/consents/pending").expect(200);
      expect(res.body.data).toHaveLength(0);
    });

    it("returns active forms the user hasn't responded to", async () => {
      await ConsentForm.create({
        active: true,
        content: new Map([["en", "# Terms"]]),
        order: 1,
        slug: "pending-terms",
        title: "Terms",
        type: "terms",
        version: 1,
      });

      const res = await userAgent.get("/consents/pending").expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].title).toBe("Terms");
    });

    it("excludes forms the user has already responded to at the current version", async () => {
      const form = await ConsentForm.create({
        active: true,
        content: new Map([["en", "# Terms"]]),
        order: 1,
        slug: "responded-terms",
        title: "Terms",
        type: "terms",
        version: 1,
      });

      await ConsentResponse.create({
        agreed: true,
        agreedAt: new Date(),
        consentFormId: form._id,
        formVersionSnapshot: 1,
        locale: "en",
        userId: notAdmin._id,
      });

      const res = await userAgent.get("/consents/pending").expect(200);
      expect(res.body.data).toHaveLength(0);
    });

    it("includes forms when the user responded to an older version", async () => {
      const form = await ConsentForm.create({
        active: true,
        content: new Map([["en", "# Terms v2"]]),
        order: 1,
        slug: "updated-terms",
        title: "Terms",
        type: "terms",
        version: 2,
      });

      // User responded to version 1
      await ConsentResponse.create({
        agreed: true,
        agreedAt: new Date(),
        consentFormId: form._id,
        formVersionSnapshot: 1,
        locale: "en",
        userId: notAdmin._id,
      });

      const res = await userAgent.get("/consents/pending").expect(200);
      expect(res.body.data).toHaveLength(1);
    });

    it("returns forms sorted by order field", async () => {
      await Promise.all([
        ConsentForm.create({
          active: true,
          content: new Map([["en", "# Second"]]),
          order: 2,
          slug: "second-form",
          title: "Second Form",
          type: "privacy",
          version: 1,
        }),
        ConsentForm.create({
          active: true,
          content: new Map([["en", "# First"]]),
          order: 1,
          slug: "first-form",
          title: "First Form",
          type: "terms",
          version: 1,
        }),
      ]);

      const res = await userAgent.get("/consents/pending").expect(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].title).toBe("First Form");
      expect(res.body.data[1].title).toBe("Second Form");
    });

    it("applies resolveConsentForms callback to filter forms", async () => {
      await Promise.all([
        ConsentForm.create({
          active: true,
          content: new Map([["en", "# Privacy"]]),
          order: 1,
          slug: "resolver-privacy",
          title: "Privacy",
          type: "privacy",
          version: 1,
        }),
        ConsentForm.create({
          active: true,
          content: new Map([["en", "# Terms"]]),
          order: 2,
          slug: "resolver-terms",
          title: "Terms",
          type: "terms",
          version: 1,
        }),
      ]);

      // Build app with resolver that only returns privacy forms
      const filteredApp = buildApp({
        resolveConsentForms: (_user, forms) => forms.filter((f) => f.type === "privacy"),
      });
      const filteredAgent = await authAsUser(filteredApp, "notAdmin");

      const res = await filteredAgent.get("/consents/pending").expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].type).toBe("privacy");
    });

    it("resolveConsentForms can filter by user admin status", async () => {
      await ConsentForm.create({
        active: true,
        content: new Map([["en", "# Terms"]]),
        order: 1,
        slug: "admin-filter-terms",
        title: "Terms",
        type: "terms",
        version: 1,
      });

      // Build app with resolver that skips admin users
      const filteredApp = buildApp({
        resolveConsentForms: (user, forms) => (user.admin ? [] : forms),
      });
      const filteredAdmin = await authAsUser(filteredApp, "admin");
      const filteredUser = await authAsUser(filteredApp, "notAdmin");

      // Admin sees no forms
      const adminRes = await filteredAdmin.get("/consents/pending").expect(200);
      expect(adminRes.body.data).toHaveLength(0);

      // Regular user sees forms
      const userRes = await filteredUser.get("/consents/pending").expect(200);
      expect(userRes.body.data).toHaveLength(1);
    });

    it("requires authentication", async () => {
      const app = buildApp();
      await supertest(app).get("/consents/pending").expect(401);
    });
  });

  describe("POST /consents/respond", () => {
    let form: ConsentFormDocument;

    beforeEach(async () => {
      form = await ConsentForm.create({
        active: true,
        content: new Map([["en", "# Terms"]]),
        order: 1,
        slug: "respond-terms",
        title: "Terms",
        type: "terms",
        version: 1,
      });
    });

    it("creates a consent response", async () => {
      const res = await userAgent
        .post("/consents/respond")
        .send({
          agreed: true,
          consentFormId: form._id,
          locale: "en",
        })
        .expect(200);

      expect(res.body.data.agreed).toBe(true);
      expect(res.body.data.locale).toBe("en");
    });

    it("returns 400 when consentFormId is missing", async () => {
      await userAgent.post("/consents/respond").send({agreed: true, locale: "en"}).expect(400);
    });

    it("returns 400 when agreed field is missing", async () => {
      await userAgent
        .post("/consents/respond")
        .send({consentFormId: form._id, locale: "en"})
        .expect(400);
    });

    it("returns 400 when locale is missing", async () => {
      await userAgent
        .post("/consents/respond")
        .send({agreed: true, consentFormId: form._id})
        .expect(400);
    });

    it("returns 400 when form is not active", async () => {
      const inactiveForm = await ConsentForm.create({
        active: false,
        content: new Map([["en", "# Inactive"]]),
        order: 5,
        slug: "inactive-form",
        title: "Inactive Form",
        type: "custom",
        version: 1,
      });

      await userAgent
        .post("/consents/respond")
        .send({agreed: true, consentFormId: inactiveForm._id, locale: "en"})
        .expect(400);
    });

    it("validates required checkboxes when agreed is true", async () => {
      const formWithRequired = await ConsentForm.create({
        active: true,
        checkboxes: [{label: "I confirm", required: true}],
        content: new Map([["en", "# Required Checkbox Form"]]),
        order: 6,
        slug: "required-checkbox-form",
        title: "Required Checkbox Form",
        type: "agreement",
        version: 1,
      });

      // Agree without checking the required checkbox
      await userAgent
        .post("/consents/respond")
        .send({
          agreed: true,
          checkboxValues: {"0": false},
          consentFormId: formWithRequired._id,
          locale: "en",
        })
        .expect(400);

      // Agree with the required checkbox checked
      const res = await userAgent
        .post("/consents/respond")
        .send({
          agreed: true,
          checkboxValues: {"0": true},
          consentFormId: formWithRequired._id,
          locale: "en",
        })
        .expect(200);

      expect(res.body.data.agreed).toBe(true);
    });

    it("requires signature when captureSignature is true and agreed is true", async () => {
      const sigForm = await ConsentForm.create({
        active: true,
        captureSignature: true,
        content: new Map([["en", "# Signature Required"]]),
        order: 7,
        slug: "sig-form",
        title: "Signature Form",
        type: "agreement",
        version: 1,
      });

      await userAgent
        .post("/consents/respond")
        .send({agreed: true, consentFormId: sigForm._id, locale: "en"})
        .expect(400);

      const res = await userAgent
        .post("/consents/respond")
        .send({
          agreed: true,
          consentFormId: sigForm._id,
          locale: "en",
          signature: "data:image/png;base64,abc123",
        })
        .expect(200);

      expect(res.body.data.signature).toBe("data:image/png;base64,abc123");
    });

    it("stores formVersionSnapshot always", async () => {
      const res = await userAgent
        .post("/consents/respond")
        .send({agreed: true, consentFormId: form._id, locale: "en"})
        .expect(200);

      expect(res.body.data.formVersionSnapshot).toBe(1);
    });

    it("stores audit trail fields when auditTrail is enabled", async () => {
      const res = await userAgent
        .post("/consents/respond")
        .send({agreed: true, consentFormId: form._id, locale: "en"})
        .expect(200);

      expect(res.body.data.contentSnapshot).toBeDefined();
      expect(res.body.data.contentSnapshot).toContain("Terms");
    });

    it("requires authentication", async () => {
      const app = buildApp();
      await supertest(app)
        .post("/consents/respond")
        .send({agreed: true, consentFormId: form._id, locale: "en"})
        .expect(401);
    });
  });

  describe("GET /consents/my", () => {
    it("returns empty array when user has no consents", async () => {
      const res = await userAgent.get("/consents/my").expect(200);
      expect(res.body.data).toHaveLength(0);
    });

    it("returns user consent history with populated form data", async () => {
      const form = await ConsentForm.create({
        active: true,
        checkboxes: [{label: "I agree to the terms", required: true}],
        content: new Map([["en", "# Terms"]]),
        order: 1,
        slug: "my-terms",
        title: "Terms of Service",
        type: "terms",
        version: 2,
      });

      await ConsentResponse.create({
        agreed: true,
        agreedAt: new Date(),
        checkboxValues: new Map([["0", true]]),
        consentFormId: form._id,
        formVersionSnapshot: 2,
        locale: "en",
        userId: notAdmin._id,
      });

      const res = await userAgent.get("/consents/my").expect(200);
      expect(res.body.data).toHaveLength(1);

      const item = res.body.data[0];
      expect(item.agreed).toBe(true);
      expect(item.locale).toBe("en");
      expect(item.formVersionSnapshot).toBe(2);
      expect(item.form).toBeDefined();
      expect(item.form.title).toBe("Terms of Service");
      expect(item.form.slug).toBe("my-terms");
      expect(item.form.type).toBe("terms");
      expect(item.form.version).toBe(2);
      expect(item.form.checkboxes).toHaveLength(1);
      expect(item.form.checkboxes[0].label).toBe("I agree to the terms");
    });

    it("returns responses sorted by agreedAt descending", async () => {
      const form = await ConsentForm.create({
        active: true,
        content: new Map([["en", "# Terms"]]),
        order: 1,
        slug: "sorted-terms",
        title: "Terms",
        type: "terms",
        version: 1,
      });

      const olderDate = new Date("2025-01-01T00:00:00Z");
      const newerDate = new Date("2025-06-01T00:00:00Z");

      await ConsentResponse.create({
        agreed: true,
        agreedAt: olderDate,
        consentFormId: form._id,
        formVersionSnapshot: 1,
        locale: "en",
        userId: notAdmin._id,
      });

      await ConsentResponse.create({
        agreed: false,
        agreedAt: newerDate,
        consentFormId: form._id,
        formVersionSnapshot: 1,
        locale: "en",
        userId: notAdmin._id,
      });

      const res = await userAgent.get("/consents/my").expect(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].agreed).toBe(false); // newer first
      expect(res.body.data[1].agreed).toBe(true); // older second
    });

    it("includes audit trail fields when present", async () => {
      const form = await ConsentForm.create({
        active: true,
        content: new Map([["en", "# Audit Terms"]]),
        order: 1,
        slug: "audit-my-terms",
        title: "Audit Terms",
        type: "terms",
        version: 1,
      });

      await ConsentResponse.create({
        agreed: true,
        agreedAt: new Date(),
        consentFormId: form._id,
        contentSnapshot: "# Audit Terms",
        formVersionSnapshot: 1,
        ipAddress: "192.168.1.1",
        locale: "en",
        userAgent: "Mozilla/5.0 Test Agent",
        userId: notAdmin._id,
      });

      const res = await userAgent.get("/consents/my").expect(200);
      expect(res.body.data).toHaveLength(1);

      const item = res.body.data[0];
      expect(item.ipAddress).toBe("192.168.1.1");
      expect(item.userAgent).toBe("Mozilla/5.0 Test Agent");
      expect(item.contentSnapshot).toBe("# Audit Terms");
    });

    it("includes signature when present", async () => {
      const form = await ConsentForm.create({
        active: true,
        captureSignature: true,
        content: new Map([["en", "# Signature Terms"]]),
        order: 1,
        slug: "sig-my-terms",
        title: "Signature Terms",
        type: "agreement",
        version: 1,
      });

      const signedAt = new Date();
      await ConsentResponse.create({
        agreed: true,
        agreedAt: new Date(),
        consentFormId: form._id,
        formVersionSnapshot: 1,
        locale: "en",
        signature: "data:image/png;base64,sig123",
        signedAt,
        userId: notAdmin._id,
      });

      const res = await userAgent.get("/consents/my").expect(200);
      expect(res.body.data).toHaveLength(1);

      const item = res.body.data[0];
      expect(item.signature).toBe("data:image/png;base64,sig123");
      expect(item.signedAt).toBeDefined();
    });

    it("does not return other users' consents", async () => {
      const form = await ConsentForm.create({
        active: true,
        content: new Map([["en", "# Isolation Terms"]]),
        order: 1,
        slug: "isolation-terms",
        title: "Isolation Terms",
        type: "terms",
        version: 1,
      });

      await ConsentResponse.create({
        agreed: true,
        agreedAt: new Date(),
        consentFormId: form._id,
        formVersionSnapshot: 1,
        locale: "en",
        userId: admin._id,
      });

      await ConsentResponse.create({
        agreed: true,
        agreedAt: new Date(),
        consentFormId: form._id,
        formVersionSnapshot: 1,
        locale: "en",
        userId: notAdmin._id,
      });

      const adminRes = await adminAgent.get("/consents/my").expect(200);
      expect(adminRes.body.data).toHaveLength(1);
      expect(adminRes.body.data[0].form.title).toBe("Isolation Terms");

      const userRes = await userAgent.get("/consents/my").expect(200);
      expect(userRes.body.data).toHaveLength(1);
      expect(userRes.body.data[0].form.title).toBe("Isolation Terms");
    });

    it("requires authentication", async () => {
      const app = buildApp();
      await supertest(app).get("/consents/my").expect(401);
    });
  });

  describe("POST /consent-forms/generate (aiConfig)", () => {
    const aiConfig = {
      generateContent: async ({
        type,
        description,
        locale,
      }: {
        type: string;
        description: string;
        locale: string;
      }) => `Generated ${type} content (${locale}) for: ${description}`,
      translateContent: async ({
        content,
        fromLocale,
        toLocale,
      }: {
        content: string;
        fromLocale: string;
        toLocale: string;
      }) => `[${fromLocale}->${toLocale}] ${content}`,
    };

    it("generates consent form content for admins", async () => {
      const aiApp = buildApp({aiConfig});
      const aiAdmin = await authAsUser(aiApp, "admin");

      const res = await aiAdmin
        .post("/consent-forms/generate")
        .send({description: "Privacy policy for a health app", locale: "es", type: "privacy"})
        .expect(200);

      expect(res.body.data.content).toBe(
        "Generated privacy content (es) for: Privacy policy for a health app"
      );
    });

    it("defaults locale to en when not provided", async () => {
      const aiApp = buildApp({aiConfig});
      const aiAdmin = await authAsUser(aiApp, "admin");

      const res = await aiAdmin
        .post("/consent-forms/generate")
        .send({description: "Terms", type: "terms"})
        .expect(200);

      expect(res.body.data.content).toContain("(en)");
    });

    it("returns 403 for non-admin users", async () => {
      const aiApp = buildApp({aiConfig});
      const aiUser = await authAsUser(aiApp, "notAdmin");

      await aiUser
        .post("/consent-forms/generate")
        .send({description: "Privacy", type: "privacy"})
        .expect(403);
    });

    it("returns 400 when type is missing", async () => {
      const aiApp = buildApp({aiConfig});
      const aiAdmin = await authAsUser(aiApp, "admin");

      await aiAdmin.post("/consent-forms/generate").send({description: "Privacy"}).expect(400);
    });

    it("returns 400 when description is missing", async () => {
      const aiApp = buildApp({aiConfig});
      const aiAdmin = await authAsUser(aiApp, "admin");

      await aiAdmin.post("/consent-forms/generate").send({type: "privacy"}).expect(400);
    });

    it("returns 404 when aiConfig is not provided", async () => {
      await adminAgent
        .post("/consent-forms/generate")
        .send({description: "Privacy", type: "privacy"})
        .expect(404);
    });
  });

  describe("POST /consent-forms/translate (aiConfig)", () => {
    const aiConfig = {
      generateContent: async ({
        type,
        description,
        locale,
      }: {
        type: string;
        description: string;
        locale: string;
      }) => `Generated ${type} content (${locale}) for: ${description}`,
      translateContent: async ({
        content,
        fromLocale,
        toLocale,
      }: {
        content: string;
        fromLocale: string;
        toLocale: string;
      }) => `[${fromLocale}->${toLocale}] ${content}`,
    };

    it("translates consent form content for admins", async () => {
      const aiApp = buildApp({aiConfig});
      const aiAdmin = await authAsUser(aiApp, "admin");

      const res = await aiAdmin
        .post("/consent-forms/translate")
        .send({content: "Hello world", fromLocale: "en", toLocale: "es"})
        .expect(200);

      expect(res.body.data.content).toBe("[en->es] Hello world");
    });

    it("returns 403 for non-admin users", async () => {
      const aiApp = buildApp({aiConfig});
      const aiUser = await authAsUser(aiApp, "notAdmin");

      await aiUser
        .post("/consent-forms/translate")
        .send({content: "Hello", fromLocale: "en", toLocale: "es"})
        .expect(403);
    });

    it("returns 400 when content is missing", async () => {
      const aiApp = buildApp({aiConfig});
      const aiAdmin = await authAsUser(aiApp, "admin");

      await aiAdmin
        .post("/consent-forms/translate")
        .send({fromLocale: "en", toLocale: "es"})
        .expect(400);
    });

    it("returns 400 when fromLocale is missing", async () => {
      const aiApp = buildApp({aiConfig});
      const aiAdmin = await authAsUser(aiApp, "admin");

      await aiAdmin
        .post("/consent-forms/translate")
        .send({content: "Hello", toLocale: "es"})
        .expect(400);
    });

    it("returns 400 when toLocale is missing", async () => {
      const aiApp = buildApp({aiConfig});
      const aiAdmin = await authAsUser(aiApp, "admin");

      await aiAdmin
        .post("/consent-forms/translate")
        .send({content: "Hello", fromLocale: "en"})
        .expect(400);
    });

    it("returns 404 when aiConfig is not provided", async () => {
      await adminAgent
        .post("/consent-forms/translate")
        .send({content: "Hello", fromLocale: "en", toLocale: "es"})
        .expect(404);
    });
  });

  describe("GET /consents/audit/:userId", () => {
    it("returns audit history for a user when auditTrail is enabled", async () => {
      const form = await ConsentForm.create({
        active: true,
        content: new Map([["en", "# Audit Terms"]]),
        order: 1,
        slug: "audit-terms",
        title: "Audit Terms",
        type: "terms",
        version: 1,
      });

      await ConsentResponse.create({
        agreed: true,
        agreedAt: new Date(),
        consentFormId: form._id,
        contentSnapshot: "# Audit Terms",
        formVersionSnapshot: 1,
        locale: "en",
        userId: notAdmin._id,
      });

      const res = await adminAgent.get(`/consents/audit/${notAdmin._id}`).expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].agreed).toBe(true);
      expect(res.body.data[0].form.title).toBe("Audit Terms");
    });

    it("returns 403 for non-admin users", async () => {
      await userAgent.get(`/consents/audit/${notAdmin._id}`).expect(403);
    });

    it("returns 404 when auditTrail is disabled", async () => {
      const noAuditApp = buildApp({auditTrail: false});
      const noAuditAdmin = await authAsUser(noAuditApp, "admin");
      await noAuditAdmin.get(`/consents/audit/${notAdmin._id}`).expect(404);
    });
  });

  describe("OpenAPI", () => {
    interface SchemaNode {
      items?: SchemaNode;
      properties?: Record<string, SchemaNode>;
      required?: string[];
      type?: string;
    }

    const responseSchema = (
      paths: Record<string, Record<string, {responses: Record<string, unknown>}>>,
      path: string,
      method: string
    ): SchemaNode | undefined => {
      const response = paths[path]?.[method]?.responses["200"] as
        | {content?: Record<string, {schema: SchemaNode}>}
        | undefined;
      return response?.content?.["application/json"]?.schema;
    };

    it("documents GET /consents/pending and POST /consents/respond", async () => {
      const res = await supertest(buildApp()).get("/openapi.json").expect(200);
      const paths = res.body.paths;

      const pending = responseSchema(paths, "/consents/pending", "get");
      expect(pending?.required).toEqual(["data"]);
      expect(pending?.properties?.data?.type).toBe("array");
      const formItem = pending?.properties?.data?.items;
      expect(formItem?.properties?.slug?.type).toBe("string");
      expect(formItem?.properties?.version?.type).toBe("number");
      expect(formItem?.properties?.id?.type).toBe("string");

      const respond = paths["/consents/respond"]?.post;
      const body = respond?.requestBody?.content?.["application/json"]?.schema;
      expect(body?.required).toEqual(["agreed", "consentFormId", "locale"]);
      expect(body?.properties?.agreed?.type).toBe("boolean");
      expect(body?.properties?.checkboxValues?.additionalProperties).toEqual({type: "boolean"});
      expect(body?.properties?.signature?.type).toBe("string");
      const respondData = responseSchema(paths, "/consents/respond", "post")?.properties?.data;
      expect(respondData?.properties?.agreed?.type).toBe("boolean");
      expect(respondData?.properties?.consentFormId).toBeDefined();
    });

    it("documents every field the consent routes return", async () => {
      const app = buildApp({auditTrail: true});
      const docRes = await supertest(app).get("/openapi.json").expect(200);
      const paths = docRes.body.paths;
      const form = await ConsentForm.create({
        active: true,
        captureSignature: true,
        content: new Map([["en", "# Terms"]]),
        order: 1,
        slug: "openapi-terms",
        title: "Terms",
        type: "terms",
        version: 1,
      });
      const agent = await authAsUser(app, "notAdmin");

      const pendingRes = await agent.get("/consents/pending").expect(200);
      expectDocumentedResponse({
        method: "get",
        path: "/consents/pending",
        response: pendingRes,
        spec: docRes.body,
      });
      const pendingDocumented = Object.keys(
        responseSchema(paths, "/consents/pending", "get")?.properties?.data?.items?.properties ?? {}
      );
      expect(pendingDocumented).toEqual(
        expect.arrayContaining(Object.keys(pendingRes.body.data[0]).filter((key) => key !== "__v"))
      );

      const respondRes = await agent
        .post("/consents/respond")
        .send({
          agreed: true,
          consentFormId: form._id,
          locale: "en",
          signature: "data:image/png;base64,AA",
        })
        .expect(200);
      expectDocumentedResponse({
        method: "post",
        path: "/consents/respond",
        response: respondRes,
        spec: docRes.body,
      });
      const respondDocumented = Object.keys(
        responseSchema(paths, "/consents/respond", "post")?.properties?.data?.properties ?? {}
      );
      expect(respondDocumented).toEqual(
        expect.arrayContaining(Object.keys(respondRes.body.data).filter((key) => key !== "__v"))
      );
    });
  });
});
