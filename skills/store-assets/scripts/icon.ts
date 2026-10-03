#!/usr/bin/env bun
//
// Render the Google Play high-res store icon (512x512, full-bleed square): the brand mark in
// `onSurface` on the brand `surface`. Play applies its own corner mask and shadow, so the image
// has square corners and no shadow.
//
// Usage:
//   bun run store:icon <app>
//
// Needs `brand.iconSvg` in storeAssets.config.json.
// Output: <appDir>/storeScreenshots/playIcon.png

import {existsSync, mkdirSync} from "node:fs";
import {join, resolve} from "node:path";
import {chromium} from "@playwright/test";
import {fail as failTagged, getApp, loadConfig, REPO_ROOT, say as sayTagged} from "./config";

const TAG = "store:icon";
const SIZE = 512;
// Keeps the mark inside Play's masked safe area.
const MARK_SIZE = 320;
const DEFAULT_MARK_VIEWBOX = "0 0 64 64";

const say = (message: string): void => sayTagged({message, tag: TAG});
const fail = (message: string): never => failTagged({message, tag: TAG});

const main = async (): Promise<void> => {
  const config = await loadConfig({tag: TAG});
  const app = getApp({appKey: process.argv[2], config, tag: TAG});
  const brand = config.brand;
  if (!brand) {
    fail("storeAssets.config.json has no `brand` section");
    return;
  }
  const svgPath = resolve(REPO_ROOT, brand.iconSvg);
  if (!existsSync(svgPath)) {
    fail(`Missing ${svgPath}`);
    return;
  }

  let svg = await Bun.file(svgPath).text();
  // A logo SVG can supply the mark: its first N <path>s, re-wrapped in the mark's viewBox.
  // Root fill="none" matters because stroke-only paths would otherwise fill black.
  if (brand.iconPathCount) {
    const paths = (svg.match(/<path[^>]*\/>/g) ?? []).slice(0, brand.iconPathCount);
    if (paths.length !== brand.iconPathCount) {
      fail(`Expected ${brand.iconPathCount} <path> elements in ${brand.iconSvg}`);
    }
    const viewBox = brand.iconViewBox ?? DEFAULT_MARK_VIEWBOX;
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="none">${paths.join("")}</svg>`;
  }
  for (const color of brand.iconRecolor ?? []) {
    svg = svg.replaceAll(`"${color}"`, `"${brand.onSurface}"`);
  }
  const mark = Buffer.from(svg).toString("base64");

  const outDir = join(REPO_ROOT, app.appDir, "storeScreenshots");
  mkdirSync(outDir, {recursive: true});
  const outPath = join(outDir, "playIcon.png");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      deviceScaleFactor: 1,
      viewport: {height: SIZE, width: SIZE},
    });
    await page.setContent(`<!doctype html>
<body style="margin:0;width:${SIZE}px;height:${SIZE}px;background:${brand.surface};display:flex;align-items:center;justify-content:center">
  <img style="width:${MARK_SIZE}px;height:${MARK_SIZE}px" src="data:image/svg+xml;base64,${mark}" alt="">
</body>`);
    await page.screenshot({path: outPath});
  } finally {
    await browser.close();
  }
  say(`Saved ${outPath} (${SIZE}x${SIZE})`);
};

await main();
