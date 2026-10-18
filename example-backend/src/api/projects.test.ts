// noExplicitAny: test mock/socket shapes are dynamic
// biome-ignore-all lint/suspicious/noExplicitAny: test mock/socket shapes are dynamic
import {beforeEach, describe, expect, it} from "bun:test";
import {
  applySyncMutation,
  findSyncEntryByCollectionTag,
  generateTokens,
  installSyncSocketHandlers,
  Membership,
  Organization,
  registerSync,
  type SyncSocketLike,
  TerrenoApp,
  type User,
} from "@terreno/api";
import {DateTime} from "luxon";
import mongoose from "mongoose";
import supertest from "supertest";
import {Project} from "../models/project";
import {User as UserModel} from "../models/user";
import {projectOrgContextPlugin, projectRouter} from "./projects";

/**
 * D3 regression: `preCreate` must force/validate `organizationId` against the
 * caller's active Membership rows rather than trusting a client-supplied value. Covers both transports
 * the sync protocol supports — REST (`POST /projects`) and `sync:mutate` (socket and
 * the in-process handler `applySyncMutation`, which the HTTP `/sync/mutate` route
 * also delegates to).
 */
describe("projects tenant create-escape (D3)", () => {
  let orgA: string;
  let orgB: string;
  const getUserScopes = async (user: User): Promise<string[]> => {
    const memberships = await Membership.findActiveForUser(user.id);
    return memberships.map((membership) => String(membership.organizationId));
  };

  const buildApp = () => {
    process.env.TOKEN_SECRET = "test-secret";
    process.env.TOKEN_ISSUER = "example-backend-test";
    return new TerrenoApp({
      authOptions: {
        generateJWTPayload: (user: unknown) => ({
          admin: (user as {admin?: boolean}).admin === true,
        }),
      },
      skipListen: true,
      userModel: UserModel as any,
    })
      .register(projectOrgContextPlugin)
      .register(projectRouter)
      .build();
  };

  const createUser = async (email: string) => {
    return UserModel.register({email, name: email} as any, "password12345") as unknown as Promise<{
      _id: mongoose.Types.ObjectId;
      admin: boolean;
    }>;
  };

  const addMembership = async (
    user: {_id: mongoose.Types.ObjectId},
    organizationId: string
  ): Promise<void> => {
    await Membership.create({organizationId, userId: user._id});
  };

  beforeEach(async () => {
    // Project is sync-enabled (syncPlugin forbids multi-document writes like
    // deleteMany, including through Model.deleteMany) — clear via the raw
    // collection instead, matching the convention in api/src/sync/integration.test.ts.
    await Project.collection.deleteMany({});
    await UserModel.deleteMany({});
    await Membership.deleteMany({});
    await Organization.deleteMany({});
    const ownerId = new mongoose.Types.ObjectId();
    const organizations = await Organization.create([
      {name: "Org A", ownerId},
      {name: "Org B", ownerId},
    ]);
    orgA = String(organizations[0]._id);
    orgB = String(organizations[1]._id);
  });

  describe("over REST", () => {
    it("ignores a caller-supplied organizationId outside the caller's organizations and uses the caller's own org", async () => {
      const app = buildApp();
      const user = await createUser("resta@example.com");
      await addMembership(user, orgA);
      const {token} = await generateTokens(user);

      const res = await supertest(app)
        .post("/projects")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Organization-Id", orgB)
        .send({organizationId: orgB, title: "escape attempt"});

      // Server ignores/validates the mismatched organizationId — it must not create
      // a document scoped to an org the caller does not belong to.
      expect(res.status).toBe(403);
      expect(await Project.countDocuments({organizationId: orgB})).toBe(0);
    });

    it("creates the project scoped to the selected organization when body id is omitted", async () => {
      const app = buildApp();
      const user = await createUser("restb@example.com");
      await addMembership(user, orgA);
      const {token} = await generateTokens(user);

      const res = await supertest(app)
        .post("/projects")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Organization-Id", orgA)
        .send({title: "default org"});

      expect(res.status).toBe(201);
      expect(res.body.data.organizationId).toBe(orgA);
    });

    it("accepts an explicit organizationId that IS one of the caller's organizations", async () => {
      const app = buildApp();
      const user = await createUser("restc@example.com");
      await addMembership(user, orgA);
      await addMembership(user, orgB);
      const {token} = await generateTokens(user);

      const res = await supertest(app)
        .post("/projects")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Organization-Id", orgB)
        .send({organizationId: orgB, title: "second org"});

      expect(res.status).toBe(201);
      expect(res.body.data.organizationId).toBe(orgB);
    });

    it("rejects a caller with no organizations at all", async () => {
      const app = buildApp();
      const user = await createUser("restd@example.com");
      const {token} = await generateTokens(user);

      const res = await supertest(app)
        .post("/projects")
        .set("Authorization", `Bearer ${token}`)
        .send({title: "no org"});

      expect(res.status).toBe(403);
    });
  });

  describe("over sync:mutate (applySyncMutation, shared by HTTP /sync/mutate and the socket handler)", () => {
    // Catalog clear helpers wipe the shared collection registry; re-register projects sync
    // before each case.
    beforeEach(() => {
      if (findSyncEntryByCollectionTag("projects")) {
        return;
      }
      const syncConfig = projectRouter.options.sync;
      if (!syncConfig) {
        throw new Error("Project sync config is required");
      }
      registerSync({
        config: syncConfig,
        model: projectRouter.model,
        options: projectRouter.options,
        routePath: projectRouter.path,
      });
    });

    const asFullUser = (user: {_id: mongoose.Types.ObjectId}): User =>
      ({
        _id: String(user._id),
        admin: false,
        id: String(user._id),
      }) as User;

    it("nacks unauthorized when the mutation's organizationId escapes the caller's tenants", async () => {
      const user = await createUser("synca@example.com");
      await addMembership(user, orgA);

      const outcome = await applySyncMutation({
        mutation: {
          collection: "projects",
          data: {organizationId: orgB, title: "sync escape attempt"},
          mutationId: `d3-sync-${DateTime.utc().toMillis()}-1`,
          operation: "create",
        },
        scopeResolver: getUserScopes,
        user: asFullUser(user),
      });

      expect(outcome.type).toBe("nack");
      if (outcome.type === "nack") {
        expect(outcome.nack.code).toBe("unauthorized");
      }
      expect(await Project.countDocuments({organizationId: orgB})).toBe(0);
    });

    it("acks and scopes to the caller's own organization when organizationId is omitted", async () => {
      const user = await createUser("syncb@example.com");
      await addMembership(user, orgA);

      const outcome = await applySyncMutation({
        mutation: {
          collection: "projects",
          data: {title: "sync default org"},
          mutationId: `d3-sync-${DateTime.utc().toMillis()}-2`,
          operation: "create",
        },
        scopeResolver: getUserScopes,
        user: asFullUser(user),
      });

      expect(outcome.type).toBe("ack");
      const doc = await Project.findOne({title: "sync default org"});
      expect(doc?.organizationId).toBe(orgA);
    });

    it("denies via the installed socket handler for a subscribed collection", async () => {
      const user = await createUser("syncc@example.com");
      await addMembership(user, orgA);
      const emitted: {event: string; payload: unknown}[] = [];
      const handlers = new Map<string, (...args: any[]) => any>();
      const socket: SyncSocketLike = {
        decodedToken: {admin: false, id: String(user._id), isAnonymous: false},
        emit: (event, payload) => {
          emitted.push({event, payload});
        },
        id: "socket-1",
        join: async () => {},
        leave: async () => {},
        on: (event, handler) => {
          handlers.set(event, handler);
        },
      };

      installSyncSocketHandlers(null, socket, {
        getUserScopes,
      });

      const mutateHandler = handlers.get("sync:mutate");
      expect(mutateHandler).toBeDefined();

      let ackOrNack: {ack?: unknown; nack?: {code: string}} | undefined;
      await mutateHandler?.(
        {
          collection: "projects",
          data: {organizationId: orgB, title: "socket escape attempt"},
          mutationId: `d3-socket-${DateTime.utc().toMillis()}`,
          operation: "create",
        },
        (response: {ack?: unknown; nack?: {code: string}}) => {
          ackOrNack = response;
        }
      );

      expect(ackOrNack?.nack?.code).toBe("unauthorized");
      expect(await Project.countDocuments({organizationId: orgB})).toBe(0);
    });
  });
});
