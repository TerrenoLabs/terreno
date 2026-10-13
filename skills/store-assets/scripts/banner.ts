#!/usr/bin/env bun
//
// Render the Google Play feature graphic (1024x500, no alpha) for an app: brand surface, logo,
// headline, body, capsules, decorations, and two of the app's Android store screenshots.
//
// Usage:
//   bun run store:banner <app>
//
// Needs `brand` and the app's `banner` in storeAssets.config.json, plus
// <appDir>/storeScreenshots/android/ from `bun run screenshots`.
// Output: <appDir>/storeScreenshots/playFeatureGraphic.png

import {existsSync, rmSync} from "node:fs";
import {join, relative, resolve} from "node:path";
import {chromium} from "@playwright/test";
import {
  fail as failTagged,
  getApp,
  loadConfig,
  REPO_ROOT,
  runOrFail,
  say as sayTagged,
} from "./config";

const TAG = "store:banner";
const WIDTH = 1024;
const HEIGHT = 500;
const MIME_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
};

const say = (message: string): void => sayTagged({message, tag: TAG});
const fail = (message: string): never => failTagged({message, tag: TAG});

// Resolves a config path and keeps it inside the repo.
const resolveRepoPath = ({path}: {path: string}): string => {
  const absolute = resolve(REPO_ROOT, path);
  if (relative(REPO_ROOT, absolute).startsWith("..")) {
    return fail(`${path} is outside the repo`);
  }
  if (!existsSync(absolute)) {
    return fail(`Missing ${absolute}`);
  }
  return absolute;
};

const dataUri = async ({path}: {path: string}): Promise<string> => {
  const absolute = resolveRepoPath({path});
  const mime = MIME_TYPES[absolute.split(".").pop() ?? ""] ?? "application/octet-stream";
  const bytes = await Bun.file(absolute).arrayBuffer();
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
};

const recolorSvg = ({svg, recolor}: {svg: string; recolor?: Record<string, string>}): string =>
  Object.entries(recolor ?? {}).reduce(
    (result, [from, to]) => result.replaceAll(`"${from}"`, `"${to}"`),
    svg
  );

const escapeHtml = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const main = async (): Promise<void> => {
  const config = await loadConfig({tag: TAG});
  const appKey = process.argv[2];
  const app = getApp({appKey, config, tag: TAG});
  const brand = config.brand;
  if (!brand) {
    fail("storeAssets.config.json has no `brand` section");
    return;
  }
  const banner = app.banner;
  if (!banner) {
    fail(`App "${appKey}" has no \`banner\` section`);
    return;
  }
  const [frontName, backName] = banner.screenshots;
  if (!frontName || !backName) {
    fail(`apps.${appKey}.banner.screenshots needs two names from storeScreenshots/android`);
    return;
  }

  const shotDir = join(app.appDir, "storeScreenshots", "android");
  const front = await dataUri({path: join(shotDir, frontName)});
  const back = await dataUri({path: join(shotDir, backName)});
  // Recolor the vector logo onto the surface; raster lockups rarely match the token exactly.
  const logoSvg = recolorSvg({
    recolor: brand.logoRecolor,
    svg: await Bun.file(resolveRepoPath({path: brand.logoSvg})).text(),
  });
  const logo = `data:image/svg+xml;base64,${Buffer.from(logoSvg).toString("base64")}`;
  const decorations = await Promise.all(
    (brand.bannerDecorations ?? []).map(
      async ({src, style}) =>
        `<img style="position:absolute;${escapeHtml(style)}" src="${await dataUri({path: src})}" alt="">`
    )
  );
  const capsules = (banner.capsules ?? [])
    .map((label) => `<span class="capsule">${escapeHtml(label)}</span>`)
    .join("");
  const fontsLink = brand.googleFontsQuery
    ? `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${escapeHtml(brand.googleFontsQuery)}&display=swap">`
    : "";

  const html = `<!doctype html>
<html><head><meta charset="utf-8">${fontsLink}
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; background: ${brand.surface}; position: relative; }
  .copy { position: absolute; left: 64px; top: 60px; width: 470px; }
  .logo { height: ${brand.logoHeight ?? 30}px; display: block; }
  h1 { font-family: "${brand.headingFont}", serif; font-weight: 900; font-size: 40px; line-height: 1.2; color: ${brand.onSurface}; margin-top: 36px; }
  p { font-family: "${brand.bodyFont}", sans-serif; font-size: 20px; line-height: 1.5; color: ${brand.onSurface}; margin-top: 16px; }
  .capsules { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 24px; }
  .capsule { font-family: "${brand.bodyFont}", sans-serif; font-weight: 700; font-size: 14px; color: ${brand.capsuleText}; background: ${brand.capsuleBackground}; border-radius: 360px; padding: 6px 16px; }
  .shot { position: absolute; width: 230px; border-radius: 16px; box-shadow: 0 8px 24px rgba(31, 34, 40, .24); border: 1px solid ${brand.border}; }
  .shot.back { left: 760px; top: 96px; }
  .shot.front { left: 580px; top: 48px; }
</style></head>
<body>
  <div class="copy">
    <img class="logo" src="${logo}" alt="">
    <h1>${escapeHtml(banner.headline)}</h1>
    <p>${escapeHtml(banner.body)}</p>
    <div class="capsules">${capsules}</div>
  </div>
  <img class="shot back" src="${back}" alt="">
  <img class="shot front" src="${front}" alt="">
  ${decorations.join("\n  ")}
</body></html>`;

  const outPath = join(REPO_ROOT, app.appDir, "storeScreenshots", "playFeatureGraphic.png");
  const jpegPath = `${outPath}.jpg`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      deviceScaleFactor: 1,
      viewport: {height: HEIGHT, width: WIDTH},
    });
    await page.setContent(html, {waitUntil: "networkidle"});
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    // Render to JPEG first so the PNG we keep has no alpha channel, which Play rejects.
    await Bun.write(jpegPath, await page.screenshot({quality: 100, type: "jpeg"}));
  } finally {
    await browser.close();
  }
  // The temporary JPEG goes away even if the conversion fails.
  process.on("exit", () => rmSync(jpegPath, {force: true}));
  await runOrFail({
    cmd: ["sips", "-s", "format", "png", jpegPath, "--out", outPath],
    isQuiet: true,
    tag: TAG,
  });
  say(`Saved ${outPath} (${WIDTH}x${HEIGHT})`);
};

await main();
