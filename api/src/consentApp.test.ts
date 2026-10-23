import {afterEach, beforeEach, describe, expect, it, spyOn} from "bun:test";
import type express from "express";
import mongoose, {type HydratedDocument} from "mongoose";
import supertest from "supertest";
import type TestAgent from "supertest/lib/agent";
import {AuditApp} from "./audit/auditApp";
import {flushAuditRecorderForTests, resetAuditRecorderForTests} from "./audit/record";
import type {UserModel as UserMongooseModel} from "./auth";
import {ConsentApp, type ConsentAppOptions} from "./consentApp";
import {logger} from "./logger";
import {ConsentForm} from "./models/consentForm";
import {ConsentResponse} from "./models/consentResponse";
import {createAccess} from "./rbac/access";
import {terrenoStatements} from "./rbac/statements";
import {TerrenoApp} from "./terrenoApp";
import {authAsUser, setupDb, type User, UserModel} from "./tests";
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
      {fields: ["name", "email"], path: "provisionalSignedBy"},
    ]);
    expect(contribution.models?.[1]?.admin.listFields).toEqual([
      "userId",
      "agreed",
      "provisional",
      "locale",
      "agreedAt",
    ]);
    expect(contribution.models?.[1]?.admin.filters).toContainEqual({
      field: "provisional",
      kind: "boolean",
      label: "Provisional",
    });
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
  describe("POST /consent-responses/provisional", () => {
    const createActiveForm = async (
      overrides: Partial<Record<string, unknown>> = {}
    ): Promise<ConsentFormDocument> =>
      ConsentForm.create({
        active: true,
        content: new Map([
          ["en", "# Intake consent"],
          ["es", "# Consentimiento"],
        ]),
        order: 1,
        slug: "intake",
        title: "Intake consent",
        type: "agreement",
        version: 3,
        ...overrides,
      });

    const buildRbacApp = async (): Promise<express.Application> => {
      const access = createAccess({
        connection: mongoose.connection,
        defaultRoles: [
          {
            displayName: "Intake staff",
            name: "intake-staff",
            permissions: {consentResponse: ["signOnBehalf"]},
          },
        ],
        statements: terrenoStatements,
      });
      await access.roles.seedDefaults();
      return buildApp({accessControl: access, auditTrail: true});
    };

    it("lets an admin sign provisionally without accessControl", async () => {
      const form = await createActiveForm();
      const before = Date.now();

      const res = await adminAgent
        .post("/consent-responses/provisional")
        .set("User-Agent", "intake-tablet")
        .send({
          consentFormId: form._id.toString(),
          note: "  Verbal consent from guardian at intake  ",
          userId: notAdmin._id.toString(),
        })
        .expect(200);

      expect(res.body.data.provisional).toBe(true);
      expect(res.body.data.provisionalSignedBy.name).toBe("Admin");
      expect(res.body.data.provisionalSignedBy.email).toBe("admin@example.com");

      const stored = await ConsentResponse.findExactlyOne({_id: res.body.data._id});
      expect(stored.provisional).toBe(true);
      expect(stored.agreed).toBe(true);
      expect(stored.userId.toString()).toBe(notAdmin._id.toString());
      expect(stored.provisionalSignedBy?.toString()).toBe(admin._id.toString());
      expect(stored.provisionalNote).toBe("Verbal consent from guardian at intake");
      expect(stored.agreedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(stored.agreedAt.getTime()).toBeLessThanOrEqual(Date.now());
      expect(stored.formVersionSnapshot).toBe(3);
      expect(stored.locale).toBe("en");
      expect(stored.contentSnapshot).toBe("# Intake consent");
      expect(stored.ipAddress).toBeUndefined();
      expect(stored.userAgent).toBeUndefined();
      expect(stored.signature).toBeUndefined();
      expect(stored.signedAt).toBeUndefined();
      expect(stored.provisionalSignerIp).toBeTruthy();
      expect(stored.provisionalSignerUserAgent).toBe("intake-tablet");
    });

    it("stores the requested locale's content snapshot", async () => {
      const form = await createActiveForm();
      const res = await adminAgent
        .post("/consent-responses/provisional")
        .send({
          consentFormId: form._id.toString(),
          locale: "es",
          note: "Phone consent",
          userId: notAdmin._id.toString(),
        })
        .expect(200);
      const stored = await ConsentResponse.findExactlyOne({_id: res.body.data._id});
      expect(stored.locale).toBe("es");
      expect(stored.contentSnapshot).toBe("# Consentimiento");
    });

    it("does not store signer request metadata without auditTrail", async () => {
      const app = buildApp({auditTrail: false});
      const agent = await authAsUser(app, "admin");
      const form = await createActiveForm();
      const res = await agent
        .post("/consent-responses/provisional")
        .send({consentFormId: form._id.toString(), note: "Verbal", userId: notAdmin._id.toString()})
        .expect(200);
      const stored = await ConsentResponse.findExactlyOne({_id: res.body.data._id});
      expect(stored.provisionalSignerIp).toBeUndefined();
      expect(stored.provisionalSignerUserAgent).toBeUndefined();
      expect(stored.contentSnapshot).toBeUndefined();
      expect(stored.formVersionSnapshot).toBe(3);
    });

    it("rejects a non-admin without accessControl", async () => {
      const form = await createActiveForm();
      const res = await userAgent
        .post("/consent-responses/provisional")
        .send({consentFormId: form._id.toString(), note: "Verbal", userId: admin._id.toString()});
      expect(res.status).toBe(405);
      expect(await ConsentResponse.countDocuments({})).toBe(0);
    });

    it("warns at register when accessControl is not set", () => {
      const warn = spyOn(logger, "warn");
      try {
        buildApp();
        expect(
          warn.mock.calls.some((call) => String(call[0]).includes("without accessControl"))
        ).toBe(true);
      } finally {
        warn.mockRestore();
      }
    });

    it("lets a non-admin with consentResponse:signOnBehalf sign when accessControl is set", async () => {
      const app = await buildRbacApp();
      await UserModel.updateOne({_id: notAdmin._id}, {$set: {roles: ["intake-staff"]}});
      const agent = await authAsUser(app, "notAdmin");
      const form = await createActiveForm();

      const res = await agent
        .post("/consent-responses/provisional")
        .send({consentFormId: form._id.toString(), note: "Verbal", userId: admin._id.toString()})
        .expect(200);
      expect(res.body.data.provisionalSignedBy.name).toBe("Not Admin");
    });

    it("rejects a non-admin without the role when accessControl is set", async () => {
      const app = await buildRbacApp();
      const agent = await authAsUser(app, "notAdmin");
      const form = await createActiveForm();

      const res = await agent
        .post("/consent-responses/provisional")
        .send({consentFormId: form._id.toString(), note: "Verbal", userId: admin._id.toString()});
      expect(res.status).toBe(405);
    });

    it("rejects an admin without the role when accessControl is set", async () => {
      const app = await buildRbacApp();
      const agent = await authAsUser(app, "admin");
      const form = await createActiveForm();

      const res = await agent.post("/consent-responses/provisional").send({
        consentFormId: form._id.toString(),
        note: "Verbal",
        userId: notAdmin._id.toString(),
      });
      expect(res.status).toBe(405);
    });

    it("rejects a blank note", async () => {
      const form = await createActiveForm();
      await adminAgent
        .post("/consent-responses/provisional")
        .send({consentFormId: form._id.toString(), note: "   ", userId: notAdmin._id.toString()})
        .expect(400);
    });

    it("rejects a note over 2000 characters", async () => {
      const form = await createActiveForm();
      await adminAgent
        .post("/consent-responses/provisional")
        .send({
          consentFormId: form._id.toString(),
          note: "x".repeat(2001),
          userId: notAdmin._id.toString(),
        })
        .expect(400);
    });

    it("rejects missing ids", async () => {
      await adminAgent.post("/consent-responses/provisional").send({note: "Verbal"}).expect(400);
    });

    it("rejects malformed ids", async () => {
      const form = await createActiveForm();
      const badUser = await adminAgent
        .post("/consent-responses/provisional")
        .send({consentFormId: form._id.toString(), note: "Verbal", userId: "abc"})
        .expect(400);
      expect(badUser.body.title).toBe("userId is invalid");
      const badForm = await adminAgent
        .post("/consent-responses/provisional")
        .send({consentFormId: "abc", note: "Verbal", userId: notAdmin._id.toString()})
        .expect(400);
      expect(badForm.body.title).toBe("consentFormId is invalid");
    });

    it("rejects signing on your own behalf", async () => {
      const form = await createActiveForm();
      const res = await adminAgent
        .post("/consent-responses/provisional")
        .send({consentFormId: form._id.toString(), note: "Verbal", userId: admin._id.toString()})
        .expect(400);
      expect(res.body.title).toBe("Cannot sign provisionally for yourself");
    });

    it("rejects an inactive form", async () => {
      const form = await createActiveForm({active: false});
      const res = await adminAgent
        .post("/consent-responses/provisional")
        .send({consentFormId: form._id.toString(), note: "Verbal", userId: notAdmin._id.toString()})
        .expect(400);
      expect(res.body.title).toBe("Consent form is not active");
    });

    it("rejects a form that resolveConsentForms filters out for the target user", async () => {
      const app = buildApp({
        resolveConsentForms: (user, forms) =>
          String(user.id) === notAdmin._id.toString()
            ? forms.filter((form) => form.slug !== "intake")
            : forms,
      });
      const agent = await authAsUser(app, "admin");
      const form = await createActiveForm();
      const res = await agent
        .post("/consent-responses/provisional")
        .send({consentFormId: form._id.toString(), note: "Verbal", userId: notAdmin._id.toString()})
        .expect(400);
      expect(res.body.title).toBe("Consent form does not apply to this user");
    });

    it("returns 404 for an unknown user", async () => {
      const form = await createActiveForm();
      await adminAgent
        .post("/consent-responses/provisional")
        .send({
          consentFormId: form._id.toString(),
          note: "Verbal",
          userId: new mongoose.Types.ObjectId().toString(),
        })
        .expect(404);
    });

    it("returns 404 for an unknown form", async () => {
      await adminAgent
        .post("/consent-responses/provisional")
        .send({
          consentFormId: new mongoose.Types.ObjectId().toString(),
          note: "Verbal",
          userId: notAdmin._id.toString(),
        })
        .expect(404);
    });

    it("keeps the form pending for the user until they respond themselves", async () => {
      const form = await createActiveForm({captureSignature: false});
      await adminAgent
        .post("/consent-responses/provisional")
        .send({consentFormId: form._id.toString(), note: "Verbal", userId: notAdmin._id.toString()})
        .expect(200);

      const pending = await userAgent.get("/consents/pending").expect(200);
      expect(pending.body.data.map((item: {_id: string}) => item._id)).toEqual([
        form._id.toString(),
      ]);

      await userAgent
        .post("/consents/respond")
        .send({agreed: true, consentFormId: form._id.toString(), locale: "en"})
        .expect(200);

      const after = await userAgent.get("/consents/pending").expect(200);
      expect(after.body.data).toHaveLength(0);
    });

    describe("with AuditApp registered", () => {
      beforeEach(() => {
        resetAuditRecorderForTests();
      });

      afterEach(() => {
        resetAuditRecorderForTests();
      });

      it("writes one AuditEvent naming the actor, target user, and form", async () => {
        const app = new TerrenoApp({
          skipListen: true,
          userModel: UserModel as unknown as UserMongooseModel,
        })
          .register(new AuditApp())
          .register(new ConsentApp())
          .build();
        const agent = await authAsUser(app, "admin");
        await mongoose.connection.collection("auditevents").deleteMany({});
        const form = await createActiveForm();

        const res = await agent
          .post("/consent-responses/provisional")
          .send({
            consentFormId: form._id.toString(),
            note: "Verbal",
            userId: notAdmin._id.toString(),
          })
          .expect(200);
        await flushAuditRecorderForTests();

        const events = await mongoose.connection
          .collection("auditevents")
          .find({modelName: "ConsentResponse"})
          .toArray();
        expect(events).toHaveLength(1);
        expect(events[0].actorId.toString()).toBe(admin._id.toString());
        expect(events[0].recordId).toBe(res.body.data._id);
        expect(events[0].after.action).toBe("signOnBehalf");
        expect(events[0].after.userId).toBe(notAdmin._id.toString());
        expect(events[0].after.consentFormId).toBe(form._id.toString());
      });
    });
  });
  describe("provisional signatures on user-facing payloads", () => {
    let form: ConsentFormDocument;

    const signProvisionally = async (targetForm: ConsentFormDocument): Promise<string> => {
      const res = await adminAgent
        .post("/consent-responses/provisional")
        .set("User-Agent", "intake-desk")
        .send({
          consentFormId: targetForm._id.toString(),
          note: "Guardian agreed by phone",
          userId: notAdmin._id.toString(),
        })
        .expect(200);
      return res.body.data._id;
    };

    beforeEach(async () => {
      form = await ConsentForm.create({
        active: true,
        content: new Map([["en", "# Telehealth consent"]]),
        order: 1,
        slug: "telehealth",
        title: "Telehealth consent",
        type: "agreement",
        version: 1,
      });
    });

    it("adds the signer name and time to the pending form, without the note", async () => {
      const responseId = await signProvisionally(form);
      const stored = await ConsentResponse.findExactlyOne({_id: responseId});

      const res = await userAgent.get("/consents/pending").expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].title).toBe("Telehealth consent");
      expect(res.body.data[0].content).toEqual({en: "# Telehealth consent"});
      expect(res.body.data[0].provisionalSignature).toEqual({
        signedAt: stored.agreedAt.toISOString(),
        signedByName: "Admin",
      });
      expect(JSON.stringify(res.body.data[0])).not.toContain("Guardian agreed by phone");
    });

    it("omits provisionalSignature on forms nobody signed provisionally", async () => {
      await ConsentForm.create({
        active: true,
        content: new Map([["en", "# Privacy"]]),
        order: 2,
        slug: "privacy-notice",
        title: "Privacy",
        type: "privacy",
        version: 1,
      });
      await signProvisionally(form);

      const res = await userAgent.get("/consents/pending").expect(200);
      const privacy = res.body.data.find((item: {slug: string}) => item.slug === "privacy-notice");
      expect(privacy).toBeDefined();
      expect("provisionalSignature" in privacy).toBe(false);
    });

    it("uses the latest provisional signature for the form's current version", async () => {
      await ConsentResponse.create({
        agreed: true,
        agreedAt: new Date("2026-01-01T00:00:00.000Z"),
        consentFormId: form._id,
        formVersionSnapshot: 1,
        locale: "en",
        provisional: true,
        provisionalNote: "Older",
        provisionalSignedBy: notAdmin._id,
        userId: notAdmin._id,
      });
      await ConsentResponse.create({
        agreed: true,
        agreedAt: new Date("2026-03-01T00:00:00.000Z"),
        consentFormId: form._id,
        formVersionSnapshot: 1,
        locale: "en",
        provisional: true,
        provisionalNote: "Newer",
        provisionalSignedBy: admin._id,
        userId: notAdmin._id,
      });

      const res = await userAgent.get("/consents/pending").expect(200);
      expect(res.body.data[0].provisionalSignature).toEqual({
        signedAt: "2026-03-01T00:00:00.000Z",
        signedByName: "Admin",
      });
    });

    it("ignores provisional signatures for an older form version", async () => {
      await ConsentResponse.create({
        agreed: true,
        agreedAt: new Date("2026-01-01T00:00:00.000Z"),
        consentFormId: form._id,
        formVersionSnapshot: 0,
        locale: "en",
        provisional: true,
        provisionalNote: "Old version",
        provisionalSignedBy: admin._id,
        userId: notAdmin._id,
      });

      const res = await userAgent.get("/consents/pending").expect(200);
      expect(res.body.data).toHaveLength(1);
      expect("provisionalSignature" in res.body.data[0]).toBe(false);
    });

    it("lists provisional entries in /consents/my with the signer name only", async () => {
      await signProvisionally(form);

      const res = await userAgent.get("/consents/my").expect(200);
      expect(res.body.data).toHaveLength(1);
      const entry = res.body.data[0];
      expect(entry.provisional).toBe(true);
      expect(entry.provisionalSignedBy).toEqual({name: "Admin"});
      expect(entry).not.toHaveProperty("provisionalNote");
      expect(entry).not.toHaveProperty("provisionalSignerIp");
      expect(entry).not.toHaveProperty("provisionalSignerUserAgent");
      expect(JSON.stringify(entry)).not.toContain("Guardian agreed by phone");
    });

    it("marks the user's own entries in /consents/my as not provisional", async () => {
      await userAgent
        .post("/consents/respond")
        .send({agreed: true, consentFormId: form._id.toString(), locale: "en"})
        .expect(200);

      const res = await userAgent.get("/consents/my").expect(200);
      expect(res.body.data[0].provisional).toBe(false);
      expect(res.body.data[0].provisionalSignedBy).toBeNull();
    });

    it("includes every provisional field in the admin audit history", async () => {
      const responseId = await signProvisionally(form);
      const stored = await ConsentResponse.findExactlyOne({_id: responseId});

      const res = await adminAgent.get(`/consents/audit/${notAdmin._id}`).expect(200);
      expect(res.body.data).toHaveLength(1);
      const entry = res.body.data[0];
      expect(entry.provisional).toBe(true);
      expect(entry.provisionalSignedBy).toEqual({
        _id: admin._id.toString(),
        email: "admin@example.com",
        name: "Admin",
      });
      expect(entry.provisionalNote).toBe("Guardian agreed by phone");
      expect(entry.provisionalSignerIp).toBe(stored.provisionalSignerIp);
      expect(entry.provisionalSignerIp).toBeTruthy();
      expect(entry.provisionalSignerUserAgent).toBe("intake-desk");
    });
  });
  describe("GET /consent-responses/status", () => {
    let form: ConsentFormDocument;

    beforeEach(async () => {
      form = await ConsentForm.create({
        active: true,
        content: new Map([["en", "# Release of information"]]),
        order: 1,
        slug: "release",
        title: "Release of information",
        type: "hipaa",
        version: 1,
      });
    });

    const buildStatusRbacApp = async (): Promise<express.Application> => {
      const access = createAccess({
        connection: mongoose.connection,
        defaultRoles: [
          {
            displayName: "Intake staff",
            name: "intake-staff",
            permissions: {consentResponse: ["signOnBehalf"]},
          },
        ],
        statements: terrenoStatements,
      });
      await access.roles.seedDefaults();
      return buildApp({accessControl: access});
    };

    it("returns pending, then provisional after a provisional sign", async () => {
      const before = await adminAgent
        .get(`/consent-responses/status?userId=${notAdmin._id}`)
        .expect(200);
      expect(before.body.data).toHaveLength(1);
      expect(before.body.data[0].form.title).toBe("Release of information");
      expect(before.body.data[0].status).toBe("pending");
      expect(before.body.data[0].isConsented).toBe(false);

      await adminAgent
        .post("/consent-responses/provisional")
        .send({consentFormId: form._id.toString(), note: "Phone", userId: notAdmin._id.toString()})
        .expect(200);

      const after = await adminAgent
        .get(`/consent-responses/status?userId=${notAdmin._id}`)
        .expect(200);
      expect(after.body.data[0].status).toBe("provisional");
      expect(after.body.data[0].isConsented).toBe(true);
      expect(after.body.data[0].provisional.note).toBe("Phone");
      expect(after.body.data[0].provisional.signedBy).toEqual({
        email: "admin@example.com",
        id: admin._id.toString(),
        name: "Admin",
      });
    });

    it("returns signed after the user agrees themselves", async () => {
      await adminAgent
        .post("/consent-responses/provisional")
        .send({consentFormId: form._id.toString(), note: "Phone", userId: notAdmin._id.toString()})
        .expect(200);
      await userAgent
        .post("/consents/respond")
        .send({agreed: true, consentFormId: form._id.toString(), locale: "en"})
        .expect(200);

      const res = await adminAgent
        .get(`/consent-responses/status?userId=${notAdmin._id}`)
        .expect(200);
      expect(res.body.data[0].status).toBe("signed");
    });

    it("applies resolveConsentForms for the target user", async () => {
      const app = buildApp({
        resolveConsentForms: (user, forms) =>
          String(user.id) === notAdmin._id.toString() ? [] : forms,
      });
      const agent = await authAsUser(app, "admin");
      const res = await agent.get(`/consent-responses/status?userId=${notAdmin._id}`).expect(200);
      expect(res.body.data).toEqual([]);
    });

    it("rejects a missing userId", async () => {
      await adminAgent.get("/consent-responses/status").expect(400);
    });

    it("documents the provisional and status actions in OpenAPI", async () => {
      const app = buildApp();
      const res = await supertest(app).get("/openapi.json").expect(200);
      expect(res.body.paths["/consent-responses/status"].get).toBeDefined();
      expect(res.body.paths["/consent-responses/provisional"].post).toBeDefined();
    });

    it("returns 404 for an unknown user", async () => {
      await adminAgent
        .get(`/consent-responses/status?userId=${new mongoose.Types.ObjectId()}`)
        .expect(404);
    });

    it("returns 400 for a malformed userId", async () => {
      const res = await adminAgent.get("/consent-responses/status?userId=abc").expect(400);
      expect(res.body.title).toBe("userId is invalid");
    });

    it("rejects a non-admin without accessControl", async () => {
      await userAgent.get(`/consent-responses/status?userId=${admin._id}`).expect(405);
    });

    it("lets a non-admin with consentResponse:signOnBehalf read statuses", async () => {
      const app = await buildStatusRbacApp();
      await UserModel.updateOne({_id: notAdmin._id}, {$set: {roles: ["intake-staff"]}});
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.get(`/consent-responses/status?userId=${admin._id}`).expect(200);
      expect(res.body.data[0].status).toBe("pending");
    });

    it("rejects a non-admin without the role when accessControl is set", async () => {
      const app = await buildStatusRbacApp();
      const agent = await authAsUser(app, "notAdmin");
      await agent.get(`/consent-responses/status?userId=${admin._id}`).expect(405);
    });

    describe("with AuditApp registered", () => {
      beforeEach(() => {
        resetAuditRecorderForTests();
      });

      afterEach(() => {
        resetAuditRecorderForTests();
      });

      it("writes an AuditEvent for each status read", async () => {
        const app = new TerrenoApp({
          skipListen: true,
          userModel: UserModel as unknown as UserMongooseModel,
        })
          .register(new AuditApp())
          .register(new ConsentApp())
          .build();
        const agent = await authAsUser(app, "admin");
        await mongoose.connection.collection("auditevents").deleteMany({});

        await agent.get(`/consent-responses/status?userId=${notAdmin._id}`).expect(200);
        await agent.get(`/consent-responses/status?userId=${notAdmin._id}`).expect(200);
        await flushAuditRecorderForTests();

        const events = await mongoose.connection
          .collection("auditevents")
          .find({modelName: "ConsentResponse"})
          .toArray();
        expect(events).toHaveLength(2);
        expect(events[0].actorId.toString()).toBe(admin._id.toString());
        expect(events[0].operation).toBe("read");
        expect(events[0].verb).toBe("viewed");
        expect(events[0].after).toEqual({action: "viewStatus", userId: notAdmin._id.toString()});
      });
    });
  });
});
