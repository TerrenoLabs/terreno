import {
  api,
  envOr,
  Findings,
  findInSource,
  type Probe,
  type ProbeContext,
  probeEmail,
  readIfPresent,
  signIn,
  signUp,
  trackedFiles,
} from "./probeKit";

const PLACEHOLDER =
  /^(|changeme|change-me|change_me|your[-_].*|<.*>|x+|replace.*|example.*|.*placeholder.*|dev-.*|test.*)$/i;
const SECRET_LITERAL = /(SECRET|TOKEN|PASSWORD|API_KEY)\w*["']?\s*[:=]\s*["'][^"'\s$]{12,}["']/i;
const SEEDED_EMAIL = "admin@example.com";
const SEEDED_PASSWORD = "testpassword123";

const adminCredentials = (env: ProbeContext["env"]): {email: string; password: string} => ({
  email: envOr(env, "BOOTSTRAP_LOOP_ADMIN_EMAIL", SEEDED_EMAIL),
  password: envOr(env, "BOOTSTRAP_LOOP_ADMIN_PASSWORD", SEEDED_PASSWORD),
});

const memberCredentials = (env: ProbeContext["env"]): {email: string; password: string} => ({
  email: envOr(env, "BOOTSTRAP_LOOP_SEED_EMAIL", "test@example.com"),
  password: envOr(env, "BOOTSTRAP_LOOP_SEED_PASSWORD", SEEDED_PASSWORD),
});

/** R1: an admin exists, can log in, and is the only kind of user who reaches /admin/config. */
export const probeR1: Probe = async (context) => {
  const findings = new Findings("R1");
  const {mongo} = context.deps ?? {};
  if (mongo) {
    const admins = await mongo.count("users", {admin: true});
    findings.check(admins >= 1, `${admins} admin user(s)`, "no user with admin: true");
  } else {
    findings.missing("BOOTSTRAP_LOOP_MONGO_URI");
  }
  if (!context.baseUrl) {
    findings.missing("baseUrl");
    return findings.result();
  }
  const {email, password} = adminCredentials(context.env);
  const admin = await signIn(context, context.baseUrl, email, password);
  findings.check(
    Boolean(admin),
    "admin login returns a session",
    `admin login failed for ${email}`
  );
  if (admin) {
    const config = await api(context, context.baseUrl, "/admin/config", {session: admin});
    findings.check(
      config.status === 200,
      "GET /admin/config 200 for admin",
      `admin got ${config.status} from /admin/config`
    );
  }
  const member = await signIn(
    context,
    context.baseUrl,
    memberCredentials(context.env).email,
    memberCredentials(context.env).password
  );
  if (member) {
    const config = await api(context, context.baseUrl, "/admin/config", {session: member});
    findings.check(
      config.status === 403,
      "GET /admin/config 403 for a member",
      `member got ${config.status} from /admin/config`
    );
  } else {
    findings.missing("member login (seed first)");
  }
  return findings.result();
};

/** R2: Better Auth on, no committed secrets, rate limit left on, weak passwords refused. */
export const probeR2: Probe = async (context) => {
  const findings = new Findings("R2");
  const {appDir, env} = context;
  const tracked = trackedFiles(appDir, context.deps?.run);
  const trackedEnv = tracked.filter(
    (file) => /(^|\/)\.env(\.[^/]+)?$/.test(file) && !file.endsWith(".example")
  );
  for (const file of trackedEnv) {
    findings.bad(`${file} is tracked by git`);
  }
  if (trackedEnv.length === 0) {
    findings.ok("no .env file is tracked");
  }
  for (const file of tracked.filter((name) => name.endsWith(".env.example"))) {
    const unsafe = (readIfPresent(appDir, file) ?? "")
      .split("\n")
      .map((line) =>
        line
          .match(/^\s*[A-Z0-9_]+\s*=\s*(.*)$/)?.[1]
          ?.trim()
          .replace(/^["']|["']$/g, "")
      )
      .filter((value): value is string => value !== undefined && !PLACEHOLDER.test(value));
    findings.check(
      unsafe.length === 0,
      `${file} holds placeholders only`,
      `${file} holds non-placeholder values`
    );
  }
  const literal = tracked.find(
    (file) =>
      /\.(ts|tsx|js|json|ya?ml)$/.test(file) &&
      !/(\.example|test|seed|fixtures)/i.test(file) &&
      SECRET_LITERAL.test(readIfPresent(appDir, file) ?? "")
  );
  findings.check(!literal, "no secret literal in tracked source", `secret literal in ${literal}`);
  findings.check(
    Boolean(findInSource(appDir, ["backend/src"], /BetterAuthApp|betterAuth/)),
    "Better Auth configured",
    "Better Auth is not configured in backend/src"
  );
  const rateOff = findInSource(appDir, ["backend/src"], /rateLimit:\s*false/);
  findings.check(!rateOff, "rate limit left on", `rate limit disabled in ${rateOff}`);

  if (context.baseUrl) {
    const todos = await api(context, context.baseUrl, "/todos");
    findings.check(
      todos.status === 401,
      "unauthenticated GET /todos is 401",
      `unauthenticated GET /todos is ${todos.status}`
    );
    const weak = await signUp(context, context.baseUrl, probeEmail(), "short1");
    findings.check(
      !weak.ok,
      "password under 8 characters rejected",
      "7-character password accepted"
    );
  } else {
    findings.missing("baseUrl");
  }
  const deployUrl = env.DEPLOY_URL;
  if (deployUrl) {
    const seeded = await signIn(context, deployUrl, SEEDED_EMAIL, SEEDED_PASSWORD);
    findings.check(
      !seeded,
      "seeded admin login fails on the deployed app",
      "deployed app accepts the seeded admin password"
    );
  } else {
    findings.missing("DEPLOY_URL");
  }
  return findings.result();
};

/** R8: members stay out of admin routes and other users' todos; admin holds the seeded roles. */
export const probeR8: Probe = async (context) => {
  const findings = new Findings("R8");
  const {baseUrl, env} = context;
  if (!baseUrl) {
    findings.missing("baseUrl");
    return findings.result();
  }
  const adminCreds = adminCredentials(env);
  const admin = await signIn(context, baseUrl, adminCreds.email, adminCreds.password);
  const memberCreds = memberCredentials(env);
  const member = await signIn(context, baseUrl, memberCreds.email, memberCreds.password);
  if (!admin || !member) {
    findings.bad(`login failed for ${admin ? "member" : "admin"}`);
    return findings.result();
  }
  const adminRoute = await api(context, baseUrl, "/admin/config", {session: member});
  findings.check(
    adminRoute.status === 403,
    "member gets 403 on /admin/config",
    `member got ${adminRoute.status} on /admin/config`
  );
  const created = await api(context, baseUrl, "/todos", {
    body: {title: "r8 probe"},
    method: "POST",
    session: admin,
  });
  const id =
    (created.body as {data?: {_id?: string}})?.data?._id ?? (created.body as {_id?: string})?._id;
  if (id) {
    const crossRead = await api(context, baseUrl, `/todos/${id}`, {session: member});
    findings.check(
      [403, 404].includes(crossRead.status),
      `member reading another user's todo gets ${crossRead.status}`,
      `member read another user's todo (${crossRead.status})`
    );
    const adminRead = await api(context, baseUrl, `/todos/${id}`, {session: admin});
    findings.check(
      adminRead.status === 200,
      "admin reads any todo",
      `admin got ${adminRead.status} reading a todo`
    );
    await api(context, baseUrl, `/todos/${id}`, {method: "DELETE", session: admin});
  } else {
    findings.bad("admin could not create a todo to probe ownership");
  }
  const {mongo} = context.deps ?? {};
  if (mongo) {
    for (const role of ["operator", "org-admin"]) {
      const count = await mongo.count("roles", {name: role});
      findings.check(count >= 1, `role ${role} exists`, `role ${role} missing`);
    }
    const holders = await mongo.count("roleassignments", {role: "org-admin"});
    findings.check(holders >= 1, "org-admin is assigned", "no user holds org-admin");
  } else {
    findings.missing("BOOTSTRAP_LOOP_MONGO_URI");
  }
  return findings.result();
};

/** R12: a seed script exists and the seeded non-admin user can log in. */
export const probeR12: Probe = async (context) => {
  const findings = new Findings("R12");
  const pkg = readIfPresent(context.appDir, "backend/package.json");
  const hasSeed = Boolean(pkg && JSON.parse(pkg).scripts?.seed);
  findings.check(hasSeed, "backend has a seed script", "backend/package.json has no seed script");
  if (!context.baseUrl) {
    findings.missing("baseUrl");
    return findings.result();
  }
  const creds = memberCredentials(context.env);
  const session = await signIn(context, context.baseUrl, creds.email, creds.password);
  findings.check(
    Boolean(session),
    `seeded user ${creds.email} can log in`,
    `seeded user ${creds.email} cannot log in`
  );
  return findings.result();
};
