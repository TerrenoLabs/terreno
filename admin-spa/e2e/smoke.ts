import type {Server} from "node:http";
import {createTestApp} from "./serveTestApp";

/**
 * Backend-free smoke check: boots the SPA serve plugin over the pre-built `dist/` export
 * (`client/` + `server/`), then asserts the server-rendered login page, the root loader path,
 * the cache headers and the gate's redirect. Run with `bun e2e/smoke.ts`
 * after `bun run build:web`. Runs every check and exits non-zero if any failed, so it can
 * gate CI without needing a browser, database, or full backend.
 */
const PORT = Number(process.env.PORT ?? 4111);
const BASE = `http://localhost:${PORT}`;

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const run = async (): Promise<void> => {
  const server: Server = await new Promise((resolve) => {
    const s = createTestApp().listen(PORT, () => resolve(s));
  });

  const checks: Check[] = [];
  try {
    const loginRes = await fetch(`${BASE}/console/login`);
    const loginHtml = await loginRes.text();
    checks.push({
      detail: `status=${loginRes.status}`,
      name: "GET /console/login is server-rendered with the brand and login form",
      ok:
        loginRes.status === 200 &&
        loginHtml.includes("Terreno Admin (e2e)") &&
        loginHtml.includes("admin-spa-login-email"),
    });
    checks.push({
      detail: `cache-control=${loginRes.headers.get("cache-control")}`,
      name: "the login page is no-store, private",
      ok: loginRes.headers.get("cache-control") === "no-store, private",
    });
    checks.push({
      detail: "looks for window.__ADMIN_SPA_BASE__",
      name: "the page carries the SPA base global",
      ok: loginHtml.includes('window.__ADMIN_SPA_BASE__="/console"'),
    });

    const entryMatch = loginHtml.match(/\/console\/_expo\/static\/js\/web\/entry-[^"]+\.js/);
    const entryUrl = entryMatch?.[0];
    const entryRes = entryUrl ? await fetch(`${BASE}${entryUrl}`) : undefined;
    checks.push({
      detail: `entry=${entryUrl ?? "MISSING"} status=${entryRes?.status ?? "n/a"}`,
      name: "JS bundle is served",
      ok: Boolean(entryRes && entryRes.status === 200),
    });

    const loaderRes = await fetch(`${BASE}/_expo/loaders/login`);
    checks.push({
      detail: `status=${loaderRes.status} cache-control=${loaderRes.headers.get("cache-control")}`,
      name: "GET /_expo/loaders/login (site root) answers no-store, private",
      ok:
        loaderRes.status === 200 && loaderRes.headers.get("cache-control") === "no-store, private",
    });

    const cfgRes = await fetch(`${BASE}/console/app-config.json`);
    const cfg = (await cfgRes.json()) as {brandName?: string; providers?: string[]};
    checks.push({
      detail: `status=${cfgRes.status} brand=${cfg.brandName}`,
      name: "app-config.json returns merged config",
      ok: cfgRes.status === 200 && cfg.brandName === "Terreno Admin (e2e)",
    });

    const protectedRes = await fetch(`${BASE}/console/User/123`, {redirect: "manual"});
    checks.push({
      detail: `status=${protectedRes.status} location=${protectedRes.headers.get("location")}`,
      name: "an anonymous protected page redirects to login",
      ok:
        protectedRes.status === 302 &&
        protectedRes.headers.get("location") === "/console/login?returnTo=%2FUser%2F123",
    });

    const outsideRes = await fetch(`${BASE}/unrelated`);
    checks.push({
      detail: `status=${outsideRes.status}`,
      name: "routes outside basePath are not handled (404)",
      ok: outsideRes.status === 404,
    });
  } finally {
    server.close();
  }

  let failed = false;
  for (const check of checks) {
    const symbol = check.ok ? "✅" : "❌";
    console.info(`${symbol} ${check.name} (${check.detail})`);
    if (!check.ok) {
      failed = true;
    }
  }

  if (failed) {
    console.error("admin-spa smoke check FAILED");
    process.exit(1);
  }
  console.info("admin-spa smoke check passed");
  process.exit(0);
};

void run();
