import {
  api,
  defaultRun,
  Findings,
  findInSource,
  listFiles,
  type Probe,
  type ProbeContext,
  probeEmail,
  readIfPresent,
  signIn,
  signUp,
} from "./probeKit";

const AI_KEY_NAMES = ["GOOGLE_GENERATIVE_AI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"];

/** Signs up a fresh user so consent and chat probes see a first-time account. */
const freshSession = async (context: ProbeContext, base: string) => {
  const email = probeEmail();
  const password = "probe-password-123";
  await signUp(context, base, email, password);
  return signIn(context, base, email, password);
};

/** R5: `/gpt/prompt` streams a non-empty reply and an AIRequest row is written. */
export const probeR5: Probe = async (context) => {
  const findings = new Findings("R5");
  const keyName = AI_KEY_NAMES.find((name) => context.env[name]);
  if (!keyName) {
    findings.missing(AI_KEY_NAMES.join(" or "));
    return findings.result();
  }
  if (!context.baseUrl) {
    findings.missing("baseUrl");
    return findings.result();
  }
  const session = await freshSession(context, context.baseUrl);
  if (!session) {
    findings.bad("could not sign in to call /gpt/prompt");
    return findings.result();
  }
  const before = (await context.deps?.mongo?.count("airequests", {})) ?? 0;
  const reply = await api(context, context.baseUrl, "/gpt/prompt", {
    body: {prompt: "Say hello in one short sentence."},
    method: "POST",
    session,
  });
  const text = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
  findings.check(
    reply.status === 200 && text.trim().length > 0,
    `reply streamed with ${keyName}`,
    `POST /gpt/prompt returned ${reply.status} with ${text.length} bytes`
  );
  const mongo = context.deps?.mongo;
  if (mongo) {
    const after = await mongo.count("airequests", {});
    findings.check(after > before, "an AIRequest row was written", "no AIRequest row was written");
  } else {
    findings.missing("BOOTSTRAP_LOOP_MONGO_URI");
  }
  return findings.result();
};

/** R6: a consent form exists, a fresh user is asked before the todo screen, and can accept. */
export const probeR6: Probe = async (context) => {
  const findings = new Findings("R6");
  const {appDir, baseUrl} = context;
  findings.check(
    Boolean(findInSource(appDir, ["backend/src"], /consent/i)),
    "consent configured in the backend",
    "no consent configuration in backend/src"
  );
  findings.check(
    Boolean(findInSource(appDir, ["frontend"], /consent/i)),
    "consent shown in the frontend",
    "no consent UI in the frontend"
  );
  if (!baseUrl) {
    findings.missing("baseUrl");
    return findings.result();
  }
  const session = await freshSession(context, baseUrl);
  if (!session) {
    findings.bad("could not create a fresh user");
    return findings.result();
  }
  const pending = await api(context, baseUrl, "/consents/pending", {session});
  const forms =
    (pending.body as {data?: {_id?: string}[]})?.data ??
    (Array.isArray(pending.body) ? (pending.body as {_id?: string}[]) : []);
  findings.check(
    pending.status === 200 && forms.length > 0,
    `${forms.length} consent form(s) pending for a fresh user`,
    `fresh user has no pending consent (status ${pending.status})`
  );
  if (forms[0]?._id) {
    const accepted = await api(context, baseUrl, "/consents/respond", {
      body: {agreed: true, consentFormId: forms[0]._id, locale: "en"},
      method: "POST",
      session,
    });
    findings.check(
      accepted.status >= 200 && accepted.status < 300,
      "accepting records a response",
      `accept returned ${accepted.status}`
    );
  }
  return findings.result();
};

interface CiRun {
  conclusion?: string;
  url?: string;
}

/** R9: latest run is green on GitHub Actions and CircleCI, and both report coverage. */
export const probeR9: Probe = async (context) => {
  const findings = new Findings("R9");
  const {appDir, env} = context;
  const run = context.deps?.run ?? defaultRun;
  const workflows = listFiles(appDir, [".github/workflows"])
    .map((file) => readIfPresent(appDir, file) ?? "")
    .join("\n");
  const circle = readIfPresent(appDir, ".circleci/config.yml") ?? "";
  findings.check(
    /coverage/i.test(workflows),
    "GitHub workflow reports coverage",
    "GitHub workflow has no coverage step"
  );
  findings.check(
    /coverage/i.test(circle),
    "CircleCI config reports coverage",
    "CircleCI config has no coverage step"
  );

  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], appDir).stdout.trim() || "HEAD";
  const gh = run(
    "gh",
    ["run", "list", "--branch", branch, "--limit", "1", "--json", "conclusion,url"],
    appDir
  );
  if (gh.status !== 0) {
    findings.missing("GitHub remote or gh login");
  } else {
    const latest = (JSON.parse(gh.stdout || "[]") as CiRun[])[0];
    findings.check(
      latest?.conclusion === "success",
      `GitHub Actions success ${latest?.url ?? ""}`,
      `GitHub Actions latest is ${latest?.conclusion ?? "absent"}`
    );
  }
  const token = env.CIRCLECI_TOKEN;
  const slug = env.BOOTSTRAP_LOOP_CIRCLECI_SLUG;
  if (!token || !slug) {
    findings.missing(token ? "BOOTSTRAP_LOOP_CIRCLECI_SLUG" : "CIRCLECI_TOKEN");
    return findings.result();
  }
  const doFetch = context.deps?.fetch ?? fetch;
  const pipelines = await doFetch(
    `https://circleci.com/api/v2/project/${slug}/pipeline?branch=${branch}`,
    {
      headers: {"Circle-Token": token},
    }
  );
  const first = ((await pipelines.json()) as {items?: {id: string}[]}).items?.[0];
  if (!first) {
    findings.bad("no CircleCI pipeline on the branch");
    return findings.result();
  }
  const workflowsRes = await doFetch(`https://circleci.com/api/v2/pipeline/${first.id}/workflow`, {
    headers: {"Circle-Token": token},
  });
  const statuses =
    ((await workflowsRes.json()) as {items?: {status: string}[]}).items?.map(
      (item) => item.status
    ) ?? [];
  findings.check(
    statuses.length > 0 && statuses.every((status) => status === "success"),
    `CircleCI workflows ${statuses.join(",")}`,
    `CircleCI workflows ${statuses.join(",") || "absent"}`
  );
  return findings.result();
};

/** R10: rulesync sources, generated agent docs, `.mcp.json` naming terreno-local. */
export const probeR10: Probe = async (context) => {
  const findings = new Findings("R10");
  const {appDir} = context;
  findings.check(
    listFiles(appDir, [".rulesync"]).length > 0,
    ".rulesync sources present",
    ".rulesync/ missing or empty"
  );
  for (const file of ["CLAUDE.md", "AGENTS.md"]) {
    findings.check(
      readIfPresent(appDir, file) !== undefined,
      `${file} generated`,
      `${file} missing`
    );
  }
  const mcp = readIfPresent(appDir, ".mcp.json");
  findings.check(
    Boolean(mcp?.includes("terreno-local")),
    ".mcp.json names terreno-local",
    ".mcp.json missing or lacks terreno-local"
  );
  const run = context.deps?.run ?? defaultRun;
  const info = run("bunx", ["terreno", "info"], appDir);
  findings.check(info.status === 0, "terreno info runs", `terreno info exited ${info.status}`);
  return findings.result();
};

const CHECKLIST_TOPICS: [string, RegExp][] = [
  ["secrets", /secret/i],
  ["deploy", /deploy/i],
  ["admin password change", /password/i],
  ["consent text review", /consent/i],
];

/** R11: `CHECKLIST.md` with unchecked items covering the handover topics. */
export const probeR11: Probe = async (context) => {
  const findings = new Findings("R11");
  const checklist = readIfPresent(context.appDir, "CHECKLIST.md");
  if (checklist === undefined) {
    findings.bad("CHECKLIST.md missing");
    return findings.result();
  }
  const unchecked = (checklist.match(/^\s*[-*] \[ \]/gm) ?? []).length;
  findings.check(
    unchecked >= 4,
    `${unchecked} unchecked items`,
    `only ${unchecked} unchecked items`
  );
  for (const [topic, pattern] of CHECKLIST_TOPICS) {
    findings.check(pattern.test(checklist), `covers ${topic}`, `does not cover ${topic}`);
  }
  return findings.result();
};
