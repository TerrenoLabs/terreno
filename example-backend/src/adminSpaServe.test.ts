import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import supertest from "supertest";

import {start} from "./server";

const BAKED_BASE_URL = "/console";

// Minimal stand-in for an `expo export` (web.output: "server"): client/ plus the server/
// files expo-server's node environment loads. render.js reads the config that the serve plugin
// publishes on the process global, like the real bundle does.
const writeFixtureExport = (root: string): void => {
  const clientJs = path.join(root, "client", "_expo", "static", "js", "web");
  fs.mkdirSync(clientJs, {recursive: true});
  fs.writeFileSync(path.join(clientJs, "entry.abc.js"), "console-dist-dir-fixture-asset");
  const serverExpo = path.join(root, "server", "_expo");
  fs.mkdirSync(path.join(serverExpo, "server"), {recursive: true});
  fs.writeFileSync(
    path.join(serverExpo, "routes.json"),
    JSON.stringify({
      apiRoutes: [],
      assets: {css: [], js: [`${BAKED_BASE_URL}/_expo/static/js/web/entry.abc.js`]},
      htmlRoutes: [{file: "login.js", namedRegex: "^/login(?:/)?$", page: "/login", routeKeys: {}}],
      notFoundRoutes: [],
      redirects: [],
      rendering: {file: "_expo/server/render.js", mode: "ssr"},
      rewrites: [],
    })
  );
  fs.writeFileSync(
    path.join(serverExpo, "server", "render.js"),
    `exports.getStaticContent = async () => {
  const published = globalThis[Symbol.for("terreno.adminSpa.server")];
  return "<html><body>console-dist-dir-fixture " + published.appConfig.brandName + "</body></html>";
};\n`
  );
};

/**
 * Covers the ADMIN_SPA_DIST_DIR override used by compiled deploys (Cloud Run), where
 * the serve plugin's __dirname-relative bundle resolution cannot work. The server must
 * serve the export (client/ + server/) from the configured directory at /console.
 */
describe("admin SPA serving with ADMIN_SPA_DIST_DIR", () => {
  let fixtureDistDir: string;

  beforeAll(() => {
    fixtureDistDir = fs.mkdtempSync(path.join(os.tmpdir(), "admin-spa-dist-"));
    writeFixtureExport(fixtureDistDir);
  });

  afterAll(() => {
    fs.rmSync(fixtureDistDir, {force: true, recursive: true});
  });

  it("serves the SPA from the configured dist directory", async () => {
    process.env.ADMIN_SPA_ENABLED = "true";
    process.env.ADMIN_SPA_DIST_DIR = fixtureDistDir;

    const app = await start(true);
    const server = supertest(app);

    // The page is rendered on the server from <distDir>/server, with the plugin's brand name.
    const loginRes = await server.get("/console/login").expect(200);
    expect(loginRes.headers["content-type"]).toContain("text/html");
    expect(loginRes.text).toContain("console-dist-dir-fixture Terreno Example");

    // Static client files come from <distDir>/client under the mount path.
    const assetRes = await server.get("/console/_expo/static/js/web/entry.abc.js").expect(200);
    expect(assetRes.text).toBe("console-dist-dir-fixture-asset");

    const configRes = await server.get("/console/app-config.json").expect(200);
    expect(configRes.body.brandName).toBe("Terreno Example");
  });

  it("does not mount /console when the flag is disabled", async () => {
    process.env.ADMIN_SPA_ENABLED = "false";

    const app = await start(true);
    const server = supertest(app);

    await server.get("/console").expect(404);
  });
});
