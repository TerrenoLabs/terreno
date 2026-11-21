import {DateTime} from "luxon";

import {api, envOr, Findings, findInSource, type Probe, readIfPresent, signIn} from "./probeKit";

/** The template's primary500, secondary500 and accent500 (create-terreno-app generate.ts). */
const TEMPLATE_ANCHORS = ["#0086B3", "#2B6072", "#D69C0E"];

const VIEWPORTS = [
  {height: 800, label: "desktop", width: 1280},
  {height: 844, label: "mobile", width: 390},
];

/** R3: the theme differs from the scaffold's; the scorer judges the screenshots. */
export const probeR3: Probe = async (context) => {
  const findings = new Findings("R3");
  const current = readIfPresent(context.appDir, "frontend/constants/theme.ts");
  if (current === undefined) {
    findings.bad("frontend/constants/theme.ts missing");
    return findings.result();
  }
  // The scaffold commit is taken after a single-prompt build, so it cannot be the reference:
  // compare with the template's own primary, secondary and accent anchor colors instead.
  const kept = TEMPLATE_ANCHORS.filter((anchor) => current.toUpperCase().includes(anchor));
  findings.check(
    kept.length <= 1,
    `theme.ts replaces the template palette (${kept.length} of ${TEMPLATE_ANCHORS.length} template anchors kept)`,
    `theme.ts keeps the template palette (${kept.join(", ")})`
  );
  const shots = context.screenshots ?? [];
  findings.check(
    shots.length > 0,
    `${shots.length} screenshots for the scorer`,
    "no screenshots captured for the scorer"
  );
  return findings.result(shots);
};

/** R4: no horizontal scroll, primary actions visible and todo create works at both sizes. */
export const probeR4: Probe = async (context) => {
  const findings = new Findings("R4");
  const viewport = context.deps?.viewport;
  if (!context.webUrl) {
    findings.missing("webUrl");
    return findings.result();
  }
  if (!viewport) {
    findings.missing("browser driver");
    return findings.result();
  }
  for (const {height, label, width} of VIEWPORTS) {
    const result = await viewport({height, url: context.webUrl, width});
    findings.check(
      !result.horizontalScroll,
      `${label}: no horizontal scroll`,
      `${label}: horizontal scroll at ${width}px`
    );
    findings.check(
      result.primaryActionVisible,
      `${label}: primary action visible`,
      `${label}: primary action hidden`
    );
    findings.check(
      result.todoCreateWorks,
      `${label}: todo create works`,
      `${label}: todo create failed`
    );
  }
  return findings.result();
};

/** R7: create, edit, complete, delete, due date and filter, owner-scoped and synced. */
export const probeR7: Probe = async (context) => {
  const findings = new Findings("R7");
  const {appDir, baseUrl, env} = context;
  const dirs = ["backend/src", "frontend"];
  findings.check(
    Boolean(findInSource(appDir, dirs, /dueDate/)),
    "due date present",
    "no dueDate in the app"
  );
  findings.check(
    Boolean(
      findInSource(
        appDir,
        ["frontend"],
        /(?=[\s\S]*\bactive\b)(?=[\s\S]*\b(done|completed)\b)(?=[\s\S]*\ball\b)/i
      )
    ),
    "all/active/done filter present",
    "no all/active/done filter in the frontend"
  );
  findings.check(
    Boolean(findInSource(appDir, ["backend/src"], /syncPlugin|sync:\s*\{/)),
    "todos are synced",
    "todos are not synced (no syncPlugin or sync config)"
  );
  findings.check(
    Boolean(findInSource(appDir, ["backend/src"], /OwnerQueryFilter|IsOwner/)),
    "todos are owner-scoped",
    "todos are not owner-scoped"
  );
  if (!baseUrl) {
    findings.missing("baseUrl");
    return findings.result();
  }
  const session = await signIn(
    context,
    baseUrl,
    envOr(env, "BOOTSTRAP_LOOP_SEED_EMAIL", "test@example.com"),
    envOr(env, "BOOTSTRAP_LOOP_SEED_PASSWORD", "testpassword123")
  );
  if (!session) {
    findings.bad("seeded member cannot log in to exercise todos");
    return findings.result();
  }
  const created = await api(context, baseUrl, "/todos", {
    body: {dueDate: "2030-01-01T00:00:00.000Z", title: "r7 probe"},
    method: "POST",
    session,
  });
  const body = created.body as {data?: {_id?: string}; _id?: string};
  const id = body?.data?._id ?? body?._id;
  findings.check(
    created.status === 201 && Boolean(id),
    "todo created with a due date",
    `create returned ${created.status}`
  );
  if (id) {
    const edited = await api(context, baseUrl, `/todos/${id}`, {
      body: {title: "r7 edited"},
      method: "PATCH",
      session,
    });
    findings.check(edited.status === 200, "todo edited", `edit returned ${edited.status}`);
    const done = await api(context, baseUrl, `/todos/${id}`, {
      body: {completed: true},
      method: "PATCH",
      session,
    });
    findings.check(done.status === 200, "todo completed", `complete returned ${done.status}`);
    const removed = await api(context, baseUrl, `/todos/${id}`, {method: "DELETE", session});
    findings.check(
      [200, 204].includes(removed.status),
      "todo deleted",
      `delete returned ${removed.status}`
    );
  }
  return findings.result();
};

/** R13: the deployed URL serves 200, a deep link survives refresh, login works against it. */
export const probeR13: Probe = async (context) => {
  const findings = new Findings("R13");
  const deployUrl = context.env.DEPLOY_URL?.replace(/\/$/, "");
  if (!deployUrl) {
    findings.missing("DEPLOY_URL");
    return findings.result();
  }
  const doFetch = context.deps?.fetch ?? fetch;
  const root = await doFetch(deployUrl);
  findings.check(
    root.status === 200,
    `GET ${deployUrl} 200 at ${DateTime.utc().toISO()}`,
    `GET ${deployUrl} returned ${root.status}`
  );
  const deep = await doFetch(`${deployUrl}/login`);
  findings.check(
    deep.status === 200,
    "deep link /login loads on refresh",
    `deep link /login returned ${deep.status}`
  );
  const apiUrl = (context.env.DEPLOY_API_URL ?? deployUrl).replace(/\/$/, "");
  const session = await signIn(
    context,
    apiUrl,
    envOr(context.env, "BOOTSTRAP_LOOP_DEPLOY_EMAIL", "test@example.com"),
    envOr(context.env, "BOOTSTRAP_LOOP_DEPLOY_PASSWORD", "testpassword123")
  );
  findings.check(
    Boolean(session),
    "login works against the deployed backend",
    "login failed against the deployed backend"
  );
  return findings.result();
};
