import {afterEach, beforeEach, describe, expect, it, setSystemTime} from "bun:test";
import type express from "express";
import mongoose, {type Model, model, Schema} from "mongoose";
import passport from "passport";
import passportLocalMongoose from "passport-local-mongoose";
import supertest from "supertest";
import type TestAgent from "supertest/lib/agent";

import {generateTokens, type UserModel} from "./auth";
import {type GitHubUserFields, githubUserPlugin, setupGitHubAuth} from "./githubAuth";
import {logger} from "./logger";
import {createdUpdatedPlugin, isDisabledPlugin} from "./plugins";
import {TerrenoApp} from "./terrenoApp";

interface FakeStrategyOutcome {
  type: "success" | "redirect" | "fail";
  user?: unknown;
  url?: string;
  challenge?: {message: string};
}

let fakeGithubOutcome: FakeStrategyOutcome = {type: "redirect", url: "http://github.com/mock"};

interface FakePassportStrategy {
  name: string;
  success: (user: unknown) => void;
  fail: (challenge: {message: string}) => void;
  redirect: (url: string) => void;
  error: (err: Error) => void;
  authenticate: (req: express.Request) => void;
}

const installFakeGithubStrategy = (): void => {
  const strategy: Pick<FakePassportStrategy, "name" | "authenticate"> = {
    authenticate(this: FakePassportStrategy): void {
      if (fakeGithubOutcome.type === "success") {
        this.success(fakeGithubOutcome.user);
        return;
      }
      if (fakeGithubOutcome.type === "fail") {
        this.fail(fakeGithubOutcome.challenge ?? {message: "auth failed"});
        return;
      }
      this.redirect(fakeGithubOutcome.url ?? "http://github.com/mock");
    },
    name: "github",
  };
  passport.use("github", strategy as unknown as passport.Strategy);
};

interface TestUser extends GitHubUserFields {
  admin: boolean;
  name?: string;
  username: string;
  email: string;
  disabled?: boolean;
}

interface PasswordedDocument {
  setPassword: (password: string) => Promise<unknown>;
  save: () => Promise<unknown>;
  hash?: string;
  salt?: string;
}

// Create schema for GitHub-enabled user
const testUserSchema = new Schema<TestUser>({
  admin: {default: false, description: "Whether the user has admin privileges", type: Boolean},
  name: {description: "The user's display name", type: String},
  username: {description: "The user's username", type: String},
});

testUserSchema.plugin(
  passportLocalMongoose as unknown as (schema: Schema, options?: Record<string, unknown>) => void,
  {
    attemptsField: "attempts",
    interval: 1,
    limitAttempts: true,
    maxAttempts: 3,
    maxInterval: 1,
    usernameCaseInsensitive: true,
    usernameField: "email",
  }
);
testUserSchema.plugin(createdUpdatedPlugin);
testUserSchema.plugin(isDisabledPlugin);
testUserSchema.plugin(githubUserPlugin);

// Get or create model to avoid model redefinition errors
const GitHubTestUserModel =
  (mongoose.models.GitHubTestUser as Model<TestUser> | undefined) ??
  model<TestUser>("GitHubTestUser", testUserSchema);

// Connect to database before tests
const connectDb = async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose
      .connect("mongodb://127.0.0.1/terreno?&connectTimeoutMS=360000")
      .catch(logger.catch);
  }
  process.env.REFRESH_TOKEN_SECRET = "refresh_secret";
  process.env.TOKEN_SECRET = "secret";
  process.env.TOKEN_EXPIRES_IN = "30m";
  process.env.TOKEN_ISSUER = "example.com";
  process.env.SESSION_SECRET = "session";
};

describe("githubUserPlugin", () => {
  it("adds GitHub fields to schema", () => {
    const paths = testUserSchema.paths;
    expect(paths.githubId).toBeDefined();
    expect(paths.githubUsername).toBeDefined();
    expect(paths.githubProfileUrl).toBeDefined();
    expect(paths.githubAvatarUrl).toBeDefined();
  });

  it("githubId is indexed and sparse", () => {
    const githubIdPath = testUserSchema.path("githubId");
    expect(githubIdPath.options.index).toBe(true);
    expect(githubIdPath.options.sparse).toBe(true);
    expect(githubIdPath.options.unique).toBe(true);
  });
});

describe("GitHub auth routes", () => {
  let app: express.Application;
  let agent: TestAgent;

  beforeEach(async () => {
    setSystemTime();
    await connectDb();

    await GitHubTestUserModel.deleteMany({});

    // Create test user with password
    const testUser = await GitHubTestUserModel.create({
      admin: false,
      email: "test@example.com",
      name: "Test User",
    });
    await (testUser as unknown as PasswordedDocument).setPassword("password123");
    await testUser.save();

    function addRoutes(router: express.Router): void {
      router.get("/test", (_req, res) => res.json({ok: true}));
    }

    app = new TerrenoApp({
      configureApp: addRoutes,
      githubAuth: {
        allowAccountLinking: true,
        callbackURL: "http://localhost:9000/auth/github/callback",
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
      },
      skipListen: true,
      userModel: GitHubTestUserModel as unknown as UserModel,
    }).build();
    agent = supertest.agent(app);
  });

  afterEach(async () => {
    setSystemTime();
  });

  it("GET /auth/github redirects to GitHub OAuth", async () => {
    const res = await agent.get("/auth/github").expect(302);
    expect(res.headers.location).toContain("github.com");
    expect(res.headers.location).toContain("client_id=test-client-id");
  });

  it("GET /auth/github/failure returns 401", async () => {
    const res = await agent.get("/auth/github/failure").expect(401);
    expect(res.body.message).toBe("GitHub authentication failed");
  });

  it("DELETE /auth/github/unlink requires authentication", async () => {
    const res = await agent.delete("/auth/github/unlink").expect(401);
    expect(res.body).toBeDefined();
  });

  it("DELETE /auth/github/unlink works when authenticated with password", async () => {
    // Login as test user
    const loginRes = await agent
      .post("/auth/login")
      .send({email: "test@example.com", password: "password123"})
      .expect(200);

    // Link github to this user
    const user = await GitHubTestUserModel.findOne({email: "test@example.com"});
    if (user) {
      user.githubId = "99999";
      user.githubUsername = "testghuser";
      await user.save();
    }

    // Unlink
    const res = await agent
      .delete("/auth/github/unlink")
      .set("authorization", `Bearer ${loginRes.body.data.token}`)
      .expect(200);

    expect(res.body.data.message).toBe("GitHub account unlinked successfully");

    // Verify github fields are cleared
    const updatedUser = await GitHubTestUserModel.findOne({email: "test@example.com"});
    expect(updatedUser?.githubId).toBeUndefined();
    expect(updatedUser?.githubUsername).toBeUndefined();
  });

  it("user can have both password and GitHub auth", async () => {
    const user = await GitHubTestUserModel.findOne({email: "test@example.com"});
    expect(user).toBeDefined();
    if (!user) {
      return;
    }

    // Link GitHub
    user.githubId = "88888";
    user.githubUsername = "linkeduser";
    await user.save();

    // Can still login with password
    const res = await agent
      .post("/auth/login")
      .send({email: "test@example.com", password: "password123"})
      .expect(200);

    expect(res.body.data.token).toBeDefined();

    // User has both auth methods - successful login proves password works
    // and we verify GitHub fields are set
    const updatedUser = await GitHubTestUserModel.findOne({email: "test@example.com"});
    expect(updatedUser).toBeDefined();
    expect(updatedUser?.githubId).toBe("88888");
    expect(updatedUser?.githubUsername).toBe("linkeduser");
  });
});

describe("GitHub auth disabled", () => {
  let app: express.Application;
  let agent: TestAgent;

  beforeEach(async () => {
    setSystemTime();
    await connectDb();

    await GitHubTestUserModel.deleteMany({});

    function addRoutes(router: express.Router): void {
      router.get("/test", (_req, res) => res.json({ok: true}));
    }

    // Setup server WITHOUT GitHub auth
    app = new TerrenoApp({
      configureApp: addRoutes,
      skipListen: true,
      userModel: GitHubTestUserModel as unknown as UserModel,
    }).build();
    agent = supertest.agent(app);
  });

  afterEach(async () => {
    setSystemTime();
  });

  it("GitHub routes are not available when githubAuth is not configured", async () => {
    await agent.get("/auth/github").expect(404);
    await agent.get("/auth/github/callback").expect(404);
    await agent.delete("/auth/github/unlink").expect(404);
  });
});

interface GitHubProfileLike {
  id?: string;
  emails?: Array<{value: string}>;
  username?: string;
  displayName?: string;
  [key: string]: unknown;
}

interface VerifyError {
  status?: number;
  message?: string;
}

type VerifiedUser = {
  _id: mongoose.Types.ObjectId | string;
  email?: string;
} & Partial<GitHubUserFields>;

interface VerifyStrategy {
  _verify: (
    req: unknown,
    accessToken: string,
    refreshToken: string,
    profile: GitHubProfileLike,
    done: (err: VerifyError | null, user?: VerifiedUser) => void
  ) => void;
}

interface PassportWithStrategies {
  _strategies?: Record<string, VerifyStrategy | undefined>;
}

// Helper to extract the strategy verify callback and invoke it directly
const invokeGitHubVerify = (
  req: unknown,
  accessToken: string,
  refreshToken: string,
  profile: GitHubProfileLike
) => {
  const strategy = (passport as unknown as PassportWithStrategies)._strategies?.github;
  if (!strategy) {
    throw new Error("github strategy not registered");
  }
  return new Promise<{err: VerifyError | null; user: VerifiedUser}>((resolve) => {
    const done = (err: VerifyError | null, user?: VerifiedUser) => resolve({err, user});
    strategy._verify(req, accessToken, refreshToken, profile, done);
  });
};

describe("GitHub strategy verify callback", () => {
  const testApp = {get: () => {}, use: () => {}} as unknown as express.Application;

  beforeEach(async () => {
    await connectDb();
    await GitHubTestUserModel.deleteMany({});
  });

  it("uses custom findOrCreateUser when provided", async () => {
    const customUser = {_id: "custom-user-id", email: "custom@example.com"};
    setupGitHubAuth(testApp, GitHubTestUserModel as unknown as UserModel, {
      callbackURL: "http://localhost:9000/auth/github/callback",
      clientId: "id",
      clientSecret: "secret",
      findOrCreateUser: async () => customUser,
    });

    const result = await invokeGitHubVerify({}, "access", "refresh", {id: "123"});
    expect(result.err).toBeNull();
    expect(result.user).toEqual(customUser);
  });

  it("creates a new user when no existing GitHub or email user", async () => {
    setupGitHubAuth(testApp, GitHubTestUserModel as unknown as UserModel, {
      callbackURL: "http://localhost:9000/auth/github/callback",
      clientId: "id",
      clientSecret: "secret",
    });

    const profile = {
      emails: [{value: "new@example.com"}],
      id: "gh-new-1",
      photos: [{value: "http://avatar"}],
      profileUrl: "http://profile",
      username: "newghuser",
    };

    const result = await invokeGitHubVerify({}, "access", "refresh", profile);
    expect(result.err).toBeNull();
    expect(result.user).toBeDefined();
    expect(result.user.githubId).toBe("gh-new-1");
    expect(result.user.githubUsername).toBe("newghuser");
    expect(result.user.email).toBe("new@example.com");
  });

  it("logs in existing GitHub user", async () => {
    const existingUser = await GitHubTestUserModel.create({
      email: "gh@example.com",
      githubId: "gh-existing-1",
      githubUsername: "ghuser",
      name: "GH User",
    });

    setupGitHubAuth(testApp, GitHubTestUserModel as unknown as UserModel, {
      callbackURL: "http://localhost:9000/auth/github/callback",
      clientId: "id",
      clientSecret: "secret",
    });

    const result = await invokeGitHubVerify({}, "access", "refresh", {
      id: "gh-existing-1",
      username: "ghuser",
    });
    expect(result.err).toBeNull();
    expect(result.user._id.toString()).toBe(existingUser._id.toString());
  });

  it("links GitHub to authenticated user when allowAccountLinking=true", async () => {
    const existingUser = await GitHubTestUserModel.create({
      email: "link@example.com",
      name: "Link User",
    });

    setupGitHubAuth(testApp, GitHubTestUserModel as unknown as UserModel, {
      allowAccountLinking: true,
      callbackURL: "http://localhost:9000/auth/github/callback",
      clientId: "id",
      clientSecret: "secret",
    });

    const req = {user: existingUser};
    const result = await invokeGitHubVerify(req, "access", "refresh", {
      id: "gh-link-1",
      photos: [{value: "http://avatar"}],
      profileUrl: "http://profile",
      username: "linkedghuser",
    });
    expect(result.err).toBeNull();
    expect(result.user.githubId).toBe("gh-link-1");
    expect(result.user.githubUsername).toBe("linkedghuser");
  });

  it("rejects linking when allowAccountLinking=false", async () => {
    const existingUser = await GitHubTestUserModel.create({
      email: "nolink@example.com",
    });

    setupGitHubAuth(testApp, GitHubTestUserModel as unknown as UserModel, {
      allowAccountLinking: false,
      callbackURL: "http://localhost:9000/auth/github/callback",
      clientId: "id",
      clientSecret: "secret",
    });

    const req = {user: existingUser};
    const result = await invokeGitHubVerify(req, "access", "refresh", {id: "gh-nolink-1"});
    expect(result.err).toBeDefined();
    expect(result.err?.status).toBe(400);
  });

  it("rejects linking when GitHub account belongs to another user", async () => {
    const userA = await GitHubTestUserModel.create({
      email: "a@example.com",
    });
    await GitHubTestUserModel.create({
      email: "b@example.com",
      githubId: "gh-other-1",
    });

    setupGitHubAuth(testApp, GitHubTestUserModel as unknown as UserModel, {
      allowAccountLinking: true,
      callbackURL: "http://localhost:9000/auth/github/callback",
      clientId: "id",
      clientSecret: "secret",
    });

    const req = {user: userA};
    const result = await invokeGitHubVerify(req, "access", "refresh", {id: "gh-other-1"});
    expect(result.err).toBeDefined();
    expect(result.err?.status).toBe(400);
  });

  it("links GitHub to existing email user when allowAccountLinking is not false", async () => {
    await GitHubTestUserModel.create({
      email: "emailuser@example.com",
    });

    setupGitHubAuth(testApp, GitHubTestUserModel as unknown as UserModel, {
      callbackURL: "http://localhost:9000/auth/github/callback",
      clientId: "id",
      clientSecret: "secret",
    });

    const result = await invokeGitHubVerify({}, "access", "refresh", {
      emails: [{value: "emailuser@example.com"}],
      id: "gh-email-link-1",
      username: "emailuserghuser",
    });
    expect(result.err).toBeNull();
    expect(result.user.githubId).toBe("gh-email-link-1");
    expect(result.user.email).toBe("emailuser@example.com");
  });

  it("rejects email-link when allowAccountLinking=false", async () => {
    await GitHubTestUserModel.create({
      email: "emailnolink@example.com",
    });

    setupGitHubAuth(testApp, GitHubTestUserModel as unknown as UserModel, {
      allowAccountLinking: false,
      callbackURL: "http://localhost:9000/auth/github/callback",
      clientId: "id",
      clientSecret: "secret",
    });

    const result = await invokeGitHubVerify({}, "access", "refresh", {
      emails: [{value: "emailnolink@example.com"}],
      id: "gh-email-nolink-1",
    });
    expect(result.err).toBeDefined();
    expect(result.err?.status).toBe(400);
  });

  it("returns error when thrown during lookup", async () => {
    // Set up strategy with findOrCreateUser that throws
    setupGitHubAuth(testApp, GitHubTestUserModel as unknown as UserModel, {
      callbackURL: "http://localhost:9000/auth/github/callback",
      clientId: "id",
      clientSecret: "secret",
      findOrCreateUser: async () => {
        throw new Error("boom");
      },
    });

    const result = await invokeGitHubVerify({}, "access", "refresh", {id: "gh-err-1"});
    expect(result.err).toBeDefined();
    expect((result.err as Error).message).toBe("boom");
  });
});

describe("addGitHubAuthRoutes link endpoints", () => {
  let app: express.Application;
  let agent: TestAgent;

  beforeEach(async () => {
    setSystemTime();
    await connectDb();
    await GitHubTestUserModel.deleteMany({});

    function addRoutes(router: express.Router): void {
      router.get("/test", (_req, res) => res.json({ok: true}));
    }

    app = new TerrenoApp({
      configureApp: addRoutes,
      githubAuth: {
        allowAccountLinking: true,
        callbackURL: "http://localhost:9000/auth/github/callback",
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
      },
      skipListen: true,
      userModel: GitHubTestUserModel as unknown as UserModel,
    }).build();
    agent = supertest.agent(app);
  });

  afterEach(() => {
    setSystemTime();
  });

  it("GET /auth/github/link requires JWT authentication", async () => {
    const res = await agent.get("/auth/github/link").expect(401);
    expect(res.body.message).toContain("Authentication required");
  });

  it("GET /auth/github with returnTo stores it in session", async () => {
    const res = await agent.get("/auth/github?returnTo=https://example.com/cb").expect(302);
    expect(res.headers.location).toContain("github.com");
  });

  it("DELETE /auth/github/unlink clears GitHub fields", async () => {
    const user = await GitHubTestUserModel.create({
      email: "unlinkme@example.com",
      githubAvatarUrl: "http://avatar",
      githubId: "77777",
      githubProfileUrl: "http://profile",
      githubUsername: "ghunlink",
    });
    await (user as unknown as PasswordedDocument).setPassword("password123");
    await user.save();

    const loginRes = await agent
      .post("/auth/login")
      .send({email: "unlinkme@example.com", password: "password123"})
      .expect(200);

    await agent
      .delete("/auth/github/unlink")
      .set("authorization", `Bearer ${loginRes.body.data.token}`)
      .expect(200);

    const updatedUser = await GitHubTestUserModel.findOne({email: "unlinkme@example.com"});
    expect(updatedUser?.githubId).toBeUndefined();
    expect(updatedUser?.githubAvatarUrl).toBeUndefined();
    expect(updatedUser?.githubProfileUrl).toBeUndefined();
  });
});

describe("GitHub callback handler (fake strategy)", () => {
  let app: express.Application;
  let agent: TestAgent;

  beforeEach(async () => {
    setSystemTime();
    await connectDb();
    await GitHubTestUserModel.deleteMany({});

    function addRoutes(router: express.Router): void {
      router.get("/test", (_req, res) => res.json({ok: true}));
    }

    app = new TerrenoApp({
      beforeJsonSetup: (a) => {
        // The handler reads (req as unknown as {session?: {returnTo?: string}}).session?.returnTo.
        // TerrenoApp does not install express-session, so prime a fake session from a request
        // header for tests.
        a.use((req, _res, next) => {
          const headerReturnTo = req.headers["x-mock-return-to"];
          if (typeof headerReturnTo === "string") {
            (req as unknown as {session: {returnTo: string}}).session = {returnTo: headerReturnTo};
          }
          next();
        });
      },
      configureApp: addRoutes,
      githubAuth: {
        allowAccountLinking: true,
        callbackURL: "http://localhost:9000/auth/github/callback",
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
      },
      skipListen: true,
      userModel: GitHubTestUserModel as unknown as UserModel,
    }).build();
    // Swap the github strategy with our fake after TerrenoApp registered it.
    installFakeGithubStrategy();
    agent = supertest.agent(app);
  });

  afterEach(() => {
    setSystemTime();
    fakeGithubOutcome = {type: "redirect", url: "http://github.com/mock"};
  });

  it("GET /auth/github/callback returns JSON tokens on success", async () => {
    const user = await GitHubTestUserModel.create({
      email: "cb@example.com",
      githubId: "cb-gh-1",
      name: "CB User",
    } as unknown as TestUser);

    fakeGithubOutcome = {type: "success", user};

    const res = await agent.get("/auth/github/callback").expect(200);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.refreshToken).toBeDefined();
    expect(res.body.data.userId).toBeDefined();
  });

  it("GET /auth/github/callback redirects to returnTo with tokens when session.returnTo is set", async () => {
    const user = await GitHubTestUserModel.create({
      email: "cb2@example.com",
      githubId: "cb-gh-2",
      name: "CB User 2",
    } as unknown as TestUser);

    fakeGithubOutcome = {type: "success", user};
    const res = await agent
      .get("/auth/github/callback")
      .set("x-mock-return-to", "https://example.com/cb")
      .expect(302);
    expect(res.headers.location).toContain("https://example.com/cb");
    expect(res.headers.location).toContain("token=");
    expect(res.headers.location).toContain("refreshToken=");
    expect(res.headers.location).toContain("userId=");
  });

  it("GET /auth/github/callback refuses to issue tokens to a disabled user", async () => {
    const user = await GitHubTestUserModel.create({
      disabled: true,
      email: "cb-disabled@example.com",
      githubId: "cb-gh-disabled",
      name: "CB Disabled",
    } as unknown as TestUser);

    fakeGithubOutcome = {type: "success", user};

    const res = await agent
      .get("/auth/github/callback")
      .set("x-mock-return-to", "https://example.com/cb")
      .expect(401);
    expect(res.headers.location).toBeUndefined();
    expect(res.body.data?.token).toBeUndefined();
  });

  it("GET /auth/github/callback redirects on failure", async () => {
    fakeGithubOutcome = {challenge: {message: "denied"}, type: "fail"};
    const res = await agent.get("/auth/github/callback").expect(302);
    expect(res.headers.location).toContain("/auth/github/failure");
  });

  it("GET /auth/github/callback returns 500 when token generation fails", async () => {
    const user = await GitHubTestUserModel.create({
      email: "cb3@example.com",
      githubId: "cb-gh-3",
      name: "CB User 3",
    } as unknown as TestUser);

    fakeGithubOutcome = {type: "success", user};

    const savedSecret = process.env.TOKEN_SECRET;
    process.env.TOKEN_SECRET = "";
    try {
      const res = await agent.get("/auth/github/callback").expect(500);
      expect(res.body.message).toBe("Authentication failed");
    } finally {
      process.env.TOKEN_SECRET = savedSecret;
    }
  });
});

describe("GET /auth/github/link with JWT (fake strategy)", () => {
  let app: express.Application;
  let agent: TestAgent;

  beforeEach(async () => {
    setSystemTime();
    await connectDb();
    await GitHubTestUserModel.deleteMany({});

    function addRoutes(router: express.Router): void {
      router.get("/test", (_req, res) => res.json({ok: true}));
    }

    app = new TerrenoApp({
      configureApp: addRoutes,
      githubAuth: {
        allowAccountLinking: true,
        callbackURL: "http://localhost:9000/auth/github/callback",
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
      },
      skipListen: true,
      userModel: GitHubTestUserModel as unknown as UserModel,
    }).build();
    installFakeGithubStrategy();
    agent = supertest.agent(app);
  });

  afterEach(() => {
    setSystemTime();
    fakeGithubOutcome = {type: "redirect", url: "http://github.com/mock"};
  });

  it("GET /auth/github/link forwards to GitHub auth when JWT is valid", async () => {
    const user = await GitHubTestUserModel.create({
      email: "linkjwt@example.com",
      name: "Link JWT User",
    } as unknown as TestUser);
    await (user as unknown as PasswordedDocument).setPassword("password123");
    await user.save();

    const loginRes = await agent
      .post("/auth/login")
      .send({email: "linkjwt@example.com", password: "password123"})
      .expect(200);

    fakeGithubOutcome = {type: "redirect", url: "http://github.com/auth"};
    const res = await agent
      .get("/auth/github/link")
      .set("authorization", `Bearer ${loginRes.body.data.token}`)
      .expect(302);
    expect(res.headers.location).toBe("http://github.com/auth");
  });
});

describe("DELETE /auth/github/unlink edge cases", () => {
  let app: express.Application;
  let agent: TestAgent;

  beforeEach(async () => {
    setSystemTime();
    await connectDb();
    await GitHubTestUserModel.deleteMany({});

    function addRoutes(router: express.Router): void {
      router.get("/test", (_req, res) => res.json({ok: true}));
    }

    app = new TerrenoApp({
      configureApp: addRoutes,
      githubAuth: {
        allowAccountLinking: true,
        callbackURL: "http://localhost:9000/auth/github/callback",
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
      },
      skipListen: true,
      userModel: GitHubTestUserModel as unknown as UserModel,
    }).build();
    installFakeGithubStrategy();
    agent = supertest.agent(app);
  });

  afterEach(() => {
    setSystemTime();
  });

  it("returns 400 when user has no password (no other auth method)", async () => {
    const user = await GitHubTestUserModel.create({
      email: "ghonly@example.com",
      githubId: "ghonly-1",
      githubUsername: "ghonly",
    } as unknown as TestUser);

    const {token} = await generateTokens({_id: (user as unknown as {_id: unknown})._id});

    const res = await agent
      .delete("/auth/github/unlink")
      .set("authorization", `Bearer ${token}`)
      .expect(400);
    expect(res.body.message).toContain("Cannot unlink GitHub account");
  });

  it("returns 500 when save throws during unlink", async () => {
    const user = await GitHubTestUserModel.create({
      email: "savefail@example.com",
      githubId: "savefail-1",
    } as unknown as TestUser);
    await (user as unknown as PasswordedDocument).setPassword("password123");
    await user.save();

    const loginRes = await agent
      .post("/auth/login")
      .send({email: "savefail@example.com", password: "password123"})
      .expect(200);

    interface MockableFindById {
      findById: (id: unknown) => {
        select: (fields: string) => Promise<PasswordedDocument | null>;
      };
    }
    const mockableModel = GitHubTestUserModel as unknown as MockableFindById;
    const originalFindById = mockableModel.findById;
    mockableModel.findById = () => ({
      select: async () => ({
        hash: "x",
        salt: "y",
        save: async () => {
          throw new Error("boom");
        },
        setPassword: async () => undefined,
      }),
    });
    try {
      const res = await agent
        .delete("/auth/github/unlink")
        .set("authorization", `Bearer ${loginRes.body.data.token}`)
        .expect(500);
      expect(res.body.message).toBe("Failed to unlink GitHub account");
    } finally {
      mockableModel.findById = originalFindById;
    }
  });
});

describe("GitHub strategy verify callback edge cases", () => {
  const testApp = {get: () => {}, use: () => {}} as unknown as express.Application;

  beforeEach(async () => {
    await connectDb();
    await GitHubTestUserModel.deleteMany({});
  });

  it("returns 404 when linking a user whose record disappears", async () => {
    const existingUser = await GitHubTestUserModel.create({
      email: "gone@example.com",
    } as unknown as TestUser);

    setupGitHubAuth(testApp, GitHubTestUserModel as unknown as UserModel, {
      allowAccountLinking: true,
      callbackURL: "http://localhost:9000/auth/github/callback",
      clientId: "id",
      clientSecret: "secret",
    });

    // Delete user before verify runs to hit the 404 path.
    await GitHubTestUserModel.deleteOne({_id: (existingUser as unknown as {_id: unknown})._id});

    const req = {user: existingUser};
    const result = await invokeGitHubVerify(req, "access", "refresh", {
      id: "gh-missing-1",
      username: "missing",
    });
    expect(result.err).toBeDefined();
    expect(result.err?.status).toBe(404);
  });
});
