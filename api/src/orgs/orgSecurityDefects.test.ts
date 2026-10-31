import {beforeEach, describe, it} from "bun:test";
import {authAsUser as loginWithPassword} from "@terreno/test";
import {assert} from "chai";
import type {Application} from "express";
import mongoose, {model, Schema} from "mongoose";
import type {PassportLocalMongooseDocument} from "passport-local-mongoose";

import {modelRouter} from "../api";
import {
  type UserModel as AuthUserModel,
  addAuthRoutes,
  authenticateMiddleware,
  setupAuth,
} from "../auth";
import {apiErrorMiddleware, apiUnauthorizedMiddleware} from "../errors";
import {Permissions} from "../permissions";
import {createAccess} from "../rbac/access";
import {terrenoStatements} from "../rbac/statements";
import {getBaseServer} from "../tests";
import {type User, UserModel} from "../tests/models";
import type {OrganizationDocument} from "../types/organization";
import {Membership, Organization} from "./organizationModel";
import {ORGANIZATION_DISABLED_TITLE, orgContextMiddleware, resolveOrgContext} from "./orgContext";
import {isOrgMemberPermission, OrgQueryFilter} from "./orgPermissions";
import {ORGANIZATION_ID_IMMUTABLE_TITLE, orgScopedPlugin} from "./orgPlugin";
import {OrgsApp} from "./orgsApp";

interface OrgProject {
  organizationId: mongoose.Types.ObjectId;
  title: string;
}

const projectSchema = new Schema<OrgProject>(
  {title: {description: "Project title", required: true, type: String}},
  {strict: "throw"}
);
projectSchema.plugin(orgScopedPlugin);

const OrgProjectModel =
  (mongoose.models.OrgSecurityProject as mongoose.Model<OrgProject> | undefined) ??
  model<OrgProject>("OrgSecurityProject", projectSchema);

const PASSWORD = "testpassword123";

const setPassword = async (user: User, password: string): Promise<void> => {
  await (user as unknown as PassportLocalMongooseDocument).setPassword(password);
  await (user as unknown as {save: () => Promise<void>}).save();
};

const createUser = async (args: {email: string; roles?: string[]}): Promise<User> => {
  const user = await UserModel.create({
    email: args.email,
    name: args.email,
    roles: args.roles ?? [],
  });
  await setPassword(user, PASSWORD);
  return user;
};

describe("org security regressions", () => {
  let app: Application;

  beforeEach(async () => {
    await Promise.all([
      Membership.deleteMany({}),
      Organization.deleteMany({}),
      OrgProjectModel.deleteMany({}),
      UserModel.deleteMany({}),
    ]);
    await OrgProjectModel.syncIndexes();

    const access = createAccess({
      connection: mongoose.connection,
      organizations: true,
      statements: terrenoStatements,
      userModel: UserModel as unknown as AuthUserModel,
    });
    await access.roles.seedDefaults();

    app = getBaseServer();
    setupAuth(app, UserModel as unknown as AuthUserModel);
    addAuthRoutes(app, UserModel as unknown as AuthUserModel);
    app.use(apiUnauthorizedMiddleware);
    new OrgsApp({access, userModel: UserModel as unknown as AuthUserModel}).register(app);

    const tenant = authenticateMiddleware();
    app.use(
      "/projects",
      tenant,
      orgContextMiddleware({required: true}),
      modelRouter(OrgProjectModel, {
        permissions: {
          create: [Permissions.IsAuthenticated, isOrgMemberPermission],
          delete: [],
          list: [Permissions.IsAuthenticated],
          read: [Permissions.IsAuthenticated, isOrgMemberPermission],
          update: [Permissions.IsAuthenticated, isOrgMemberPermission],
        },
        preCreate: async (body, req) => {
          // orgContextMiddleware sets req.organization; the Express typing leaves it unknown.
          const organizationId = (req.organization as OrganizationDocument | undefined)?._id;
          if (!organizationId) {
            throw new Error("organization context required");
          }
          return {...body, organizationId} as OrgProject;
        },
        queryFields: ["title", "organizationId"],
        queryFilter: OrgQueryFilter,
      })
    );
    app.use(apiErrorMiddleware);
  });

  describe("disabled organizations", () => {
    it("rejects disabled organizations in resolveOrgContext for explicit header context", async () => {
      const operator = await createUser({email: "operator@example.com", roles: ["operator"]});
      const org = await Organization.create({
        disabled: true,
        name: "Disabled Co",
        ownerId: operator._id,
      });

      let error: unknown;
      try {
        await resolveOrgContext({
          organizationId: String(org._id),
          required: true,
          user: operator as unknown as import("../auth").User,
        });
      } catch (caught) {
        error = caught;
      }

      assert.isDefined(error);
      assert.equal((error as {status?: number}).status, 403);
      assert.equal((error as {title?: string}).title, ORGANIZATION_DISABLED_TITLE);
    });

    it("rejects a disabled organization inferred from one active org-admin membership", async () => {
      const admin = await createUser({email: "orgadmin@example.com"});
      const org = await Organization.create({
        disabled: true,
        name: "Disabled Co",
        ownerId: admin._id,
      });
      await Membership.create({
        organizationId: org._id,
        roleName: "org-admin",
        status: "active",
        userId: admin._id,
      });

      let error: unknown;
      try {
        await resolveOrgContext({
          required: true,
          user: admin as unknown as import("../auth").User,
        });
      } catch (caught) {
        error = caught;
      }

      assert.isDefined(error);
      assert.equal((error as {status?: number}).status, 403);
      assert.equal((error as {title?: string}).title, ORGANIZATION_DISABLED_TITLE);
    });

    it("excludes disabled organizations from GET /orgs/mine", async () => {
      const operator = await createUser({email: "operator@example.com", roles: ["operator"]});
      await Organization.create({disabled: true, name: "Disabled Co", ownerId: operator._id});
      await Organization.create({name: "Active Co", ownerId: operator._id});

      const operatorAgent = await loginWithPassword(app, {
        email: "operator@example.com",
        password: PASSWORD,
      });
      const mine = await operatorAgent.get("/orgs/mine");
      assert.equal(mine.status, 200);
      assert.equal(mine.body.data.length, 1);
      assert.equal(mine.body.data[0].name, "Active Co");
    });

    it("rejects tenant routes when X-Organization-Id selects a disabled org", async () => {
      const operator = await createUser({email: "operator@example.com", roles: ["operator"]});
      const org = await Organization.create({
        disabled: true,
        name: "Disabled Co",
        ownerId: operator._id,
      });
      await OrgProjectModel.create({organizationId: org._id, title: "Secret project"});

      const operatorAgent = await loginWithPassword(app, {
        email: "operator@example.com",
        password: PASSWORD,
      });
      const res = await operatorAgent.get("/projects").set("X-Organization-Id", String(org._id));
      assert.equal(res.status, 403);
      assert.equal(res.body.title, ORGANIZATION_DISABLED_TITLE);
    });

    it("rejects attaching a member to a disabled organization", async () => {
      const operator = await createUser({email: "operator@example.com", roles: ["operator"]});
      await createUser({email: "newmember@example.com"});
      const org = await Organization.create({
        disabled: true,
        name: "Disabled Co",
        ownerId: operator._id,
      });

      const operatorAgent = await loginWithPassword(app, {
        email: "operator@example.com",
        password: PASSWORD,
      });
      const attached = await operatorAgent
        .post(`/orgs/${org._id}/members`)
        .send({email: "newmember@example.com", roleName: "member"});
      assert.equal(attached.status, 403);
      assert.equal(attached.body.title, ORGANIZATION_DISABLED_TITLE);
    });

    it("rejects reactivating a suspended member while the organization stays disabled", async () => {
      const operator = await createUser({email: "operator@example.com", roles: ["operator"]});
      const member = await createUser({email: "suspended@example.com"});
      const org = await Organization.create({
        disabled: true,
        name: "Disabled Co",
        ownerId: operator._id,
      });
      const membership = await Membership.create({
        organizationId: org._id,
        roleName: "member",
        status: "suspended",
        userId: member._id,
      });

      const operatorAgent = await loginWithPassword(app, {
        email: "operator@example.com",
        password: PASSWORD,
      });
      const reactivated = await operatorAgent
        .patch(`/orgs/${org._id}/members/${membership._id}`)
        .send({status: "active"});
      assert.equal(reactivated.status, 403);
      assert.equal(reactivated.body.title, ORGANIZATION_DISABLED_TITLE);

      const reloaded = await Membership.findById(membership._id);
      assert.equal(reloaded?.status, "suspended");
      assert.isTrue((await Organization.findById(org._id))?.disabled);
    });

    it("still lets operators read and re-enable a disabled organization via /orgs/:id", async () => {
      const operator = await createUser({email: "operator@example.com", roles: ["operator"]});
      const org = await Organization.create({
        disabled: true,
        name: "Disabled Co",
        ownerId: operator._id,
      });

      const operatorAgent = await loginWithPassword(app, {
        email: "operator@example.com",
        password: PASSWORD,
      });
      const read = await operatorAgent.get(`/orgs/${org._id}`);
      assert.equal(read.status, 200);
      assert.isTrue(read.body.data.disabled);

      const reenabled = await operatorAgent.patch(`/orgs/${org._id}`).send({disabled: false});
      assert.equal(reenabled.status, 200);
      assert.isFalse(reenabled.body.data.disabled);
    });

    it("still lists disabled organizations on GET /orgs for operators", async () => {
      const operator = await createUser({email: "operator@example.com", roles: ["operator"]});
      await Organization.create({disabled: true, name: "Disabled Co", ownerId: operator._id});

      const operatorAgent = await loginWithPassword(app, {
        email: "operator@example.com",
        password: PASSWORD,
      });
      const listed = await operatorAgent.get("/orgs");
      assert.equal(listed.status, 200);
      assert.equal(listed.body.data.length, 1);
      assert.isTrue(listed.body.data[0].disabled);
    });

    it("rejects deleted organizations in resolveOrgContext with 404", async () => {
      const operator = await createUser({email: "operator@example.com", roles: ["operator"]});
      const org = await Organization.create({name: "Deleted Co", ownerId: operator._id});
      org.deleted = true;
      await org.save();

      let error: unknown;
      try {
        await resolveOrgContext({
          organizationId: String(org._id),
          required: true,
          user: operator as unknown as import("../auth").User,
        });
      } catch (caught) {
        error = caught;
      }

      assert.isDefined(error);
      assert.equal((error as {status?: number}).status, 404);
    });
  });

  describe("cross-tenant object access", () => {
    it("rejects GET for an org-B project when scoped to org A", async () => {
      const user = await createUser({email: "dualmember@example.com"});
      const orgA = await Organization.create({name: "Org A", ownerId: user._id});
      const orgB = await Organization.create({name: "Org B", ownerId: user._id});
      await Membership.create({organizationId: orgA._id, roleName: "member", userId: user._id});
      await Membership.create({organizationId: orgB._id, roleName: "member", userId: user._id});
      const projectB = await OrgProjectModel.create({
        organizationId: orgB._id,
        title: "Secret in B",
      });

      const agent = await loginWithPassword(app, {
        email: "dualmember@example.com",
        password: PASSWORD,
      });
      const read = await agent
        .get(`/projects/${projectB._id}`)
        .set("X-Organization-Id", String(orgA._id));

      assert.equal(read.status, 403);
    });

    it("rejects PATCH for an org-B project when scoped to org A", async () => {
      const user = await createUser({email: "dualpatch@example.com"});
      const orgA = await Organization.create({name: "Org Alpha P", ownerId: user._id});
      const orgB = await Organization.create({name: "Org Beta P", ownerId: user._id});
      await Membership.create({organizationId: orgA._id, roleName: "member", userId: user._id});
      await Membership.create({organizationId: orgB._id, roleName: "member", userId: user._id});
      const projectB = await OrgProjectModel.create({organizationId: orgB._id, title: "Before"});

      const agent = await loginWithPassword(app, {
        email: "dualpatch@example.com",
        password: PASSWORD,
      });
      const patched = await agent
        .patch(`/projects/${projectB._id}`)
        .set("X-Organization-Id", String(orgA._id))
        .send({title: "After"});

      assert.equal(patched.status, 403);

      const reloaded = await OrgProjectModel.findById(projectB._id);
      assert.equal(reloaded?.title, "Before");
    });

    it("allows GET for a same-org project when scoped to that org", async () => {
      const user = await createUser({email: "samemember@example.com"});
      const orgA = await Organization.create({name: "Org Same", ownerId: user._id});
      await Membership.create({organizationId: orgA._id, roleName: "member", userId: user._id});
      const project = await OrgProjectModel.create({organizationId: orgA._id, title: "Visible"});

      const agent = await loginWithPassword(app, {
        email: "samemember@example.com",
        password: PASSWORD,
      });
      const read = await agent
        .get(`/projects/${project._id}`)
        .set("X-Organization-Id", String(orgA._id));

      assert.equal(read.status, 200);
      assert.equal(read.body.data.title, "Visible");
    });
  });

  describe("organizationId immutability", () => {
    it("rejects REST PATCH attempts to retarget organizationId", async () => {
      const user = await createUser({email: "dualmember@example.com"});
      const orgA = await Organization.create({name: "Org A", ownerId: user._id});
      const orgB = await Organization.create({name: "Org B", ownerId: user._id});
      await Membership.create({organizationId: orgA._id, roleName: "member", userId: user._id});
      await Membership.create({organizationId: orgB._id, roleName: "member", userId: user._id});
      const project = await OrgProjectModel.create({organizationId: orgA._id, title: "Move me"});

      const agent = await loginWithPassword(app, {
        email: "dualmember@example.com",
        password: PASSWORD,
      });
      const patched = await agent
        .patch(`/projects/${project._id}`)
        .set("X-Organization-Id", String(orgA._id))
        .send({organizationId: String(orgB._id), title: "Moved"});

      assert.equal(patched.status, 400);
      assert.equal(patched.body.title, ORGANIZATION_ID_IMMUTABLE_TITLE);

      const reloaded = await OrgProjectModel.findById(project._id);
      assert.equal(String(reloaded?.organizationId), String(orgA._id));
      assert.equal(reloaded?.title, "Move me");
    });

    it("rejects direct document saves that change organizationId", async () => {
      const orgA = new mongoose.Types.ObjectId();
      const orgB = new mongoose.Types.ObjectId();
      const project = await OrgProjectModel.create({organizationId: orgA, title: "Pinned"});

      project.organizationId = orgB;
      let error: unknown;
      try {
        await project.save();
      } catch (caught) {
        error = caught;
      }

      assert.isDefined(error);
      assert.equal((error as {status?: number}).status, 400);
      assert.equal((error as {title?: string}).title, ORGANIZATION_ID_IMMUTABLE_TITLE);
    });
  });
});
