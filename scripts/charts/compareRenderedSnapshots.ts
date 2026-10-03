#!/usr/bin/env bun
import {spawn} from "node:child_process";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {chromium, type Locator, type Page} from "@playwright/test";
import {DateTime} from "luxon";

import {
  CHART_VISUAL_FIXTURES,
  CHART_VISUAL_GALLERY_TEST_ID,
  type ChartVisualFixtureId,
  chartVisualFixtureTestId,
} from "../../demo/chartVisual/fixtureCatalog.ts";
import {diffPngBuffers, isChartVisualMatch} from "./compareChartImages.ts";

const REPO_ROOT = resolve(import.meta.dir, "../..");
const SNAPSHOT_DIR = join(REPO_ROOT, "demo/rendered-snapshots");
const OUTPUT_DIR = join(REPO_ROOT, "demo/chart-visual-output");
const DEFAULT_PORT = 8085;
const DEFAULT_BASE_URL = `http://127.0.0.1:${DEFAULT_PORT}`;
const GALLERY_PATH = "/demo/chart-visual-gallery?embed=1";
const VIEWPORT = {height: 900, width: 1280};

interface FixtureReport {
  diffCount?: number;
  id: string;
  status: "match" | "mismatch" | "missing" | "error";
  message?: string;
}

interface StartedDemo {
  pid: number;
}

export const getSnapshotAction = ({
  exists,
  update,
}: {
  exists: boolean;
  update: boolean;
}): "compare" | "missing" | "write" => {
  if (update) {
    return "write";
  }
  if (!exists) {
    return "missing";
  }
  return "compare";
};

const parseArgs = (argv: string[]): {only?: ChartVisualFixtureId; update: boolean} => {
  let update = false;
  let only: ChartVisualFixtureId | undefined;
  for (const arg of argv) {
    if (arg === "--update") {
      update = true;
      continue;
    }
    if (arg.startsWith("--only=")) {
      const id = arg.slice("--only=".length) as ChartVisualFixtureId;
      only = id;
    }
  }
  return {only, update};
};

const isServerUp = async (baseUrl: string): Promise<boolean> => {
  try {
    const response = await fetch(baseUrl, {method: "GET"});
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
};

const waitForServer = async (baseUrl: string, timeoutMs: number): Promise<void> => {
  const deadline = DateTime.utc().plus({milliseconds: timeoutMs});
  while (DateTime.utc().toMillis() < deadline.toMillis()) {
    if (await isServerUp(baseUrl)) {
      return;
    }
    await Bun.sleep(1000);
  }
  throw new Error(`Demo web did not become ready at ${baseUrl} within ${timeoutMs}ms`);
};

const stopDemo = ({pid}: StartedDemo): void => {
  try {
    process.kill(-pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }
};

const startDemoIfNeeded = async (baseUrl: string): Promise<StartedDemo | undefined> => {
  if (await isServerUp(baseUrl)) {
    return undefined;
  }
  const child = spawn("bun", ["run", "demo:web"], {
    cwd: REPO_ROOT,
    detached: true,
    env: {...process.env, RCT_METRO_PORT: String(DEFAULT_PORT)},
    stdio: "inherit",
  });
  if (child.pid === undefined) {
    throw new Error("Failed to start bun run demo:web");
  }
  const startedDemo = {pid: child.pid};
  try {
    await waitForServer(baseUrl, 180_000);
    return startedDemo;
  } catch (error) {
    stopDemo(startedDemo);
    throw error;
  }
};

const waitForFixtureChartsReady = async (locator: Locator): Promise<void> => {
  await locator.scrollIntoViewIfNeeded();
  await Promise.race([
    locator.locator("svg").first().waitFor({state: "visible", timeout: 30_000}),
    locator.getByText("No signups yet").waitFor({state: "visible", timeout: 30_000}),
  ]);
  const svgLocator = locator.locator("svg");
  const svgCount = await svgLocator.count();
  for (let index = 0; index < svgCount; index += 1) {
    await svgLocator.nth(index).waitFor({state: "visible", timeout: 30_000});
  }
  await Bun.sleep(300);
};

const hideFixedAndStickyElements = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const nodes = document.querySelectorAll("body *");
    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) {
        continue;
      }
      const style = window.getComputedStyle(node);
      if (style.position !== "fixed" && style.position !== "sticky") {
        continue;
      }
      node.style.setProperty("display", "none", "important");
    }
  });
};

const selectedFixtures = (only?: ChartVisualFixtureId) => {
  if (!only) {
    return [...CHART_VISUAL_FIXTURES];
  }
  const fixture = CHART_VISUAL_FIXTURES.find((entry) => entry.id === only);
  if (!fixture) {
    throw new Error(`Unknown fixture id: ${only}`);
  }
  return [fixture];
};

export const compareChartRenderedSnapshots = async ({
  argv = process.argv.slice(2),
}: {
  argv?: string[];
} = {}): Promise<{failed: number; reports: FixtureReport[]}> => {
  const {only, update} = parseArgs(argv);
  const baseUrl = process.env.CHART_VISUAL_BASE_URL ?? DEFAULT_BASE_URL;
  mkdirSync(SNAPSHOT_DIR, {recursive: true});
  mkdirSync(join(OUTPUT_DIR, "actual"), {recursive: true});
  mkdirSync(join(OUTPUT_DIR, "diff"), {recursive: true});

  let started: StartedDemo | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const reports: FixtureReport[] = [];

  try {
    started = await startDemoIfNeeded(baseUrl);
    browser = await chromium.launch({args: ["--disable-animations"]});
    const page = await browser.newPage({
      deviceScaleFactor: 1,
      viewport: VIEWPORT,
    });
    await page.goto(`${baseUrl}${GALLERY_PATH}`, {timeout: 120_000, waitUntil: "networkidle"});
    await page.getByTestId(CHART_VISUAL_GALLERY_TEST_ID).waitFor({timeout: 60_000});
    await page.evaluate(async (): Promise<void> => {
      await document.fonts.ready;
    });
    await hideFixedAndStickyElements(page);
    await Bun.sleep(250);

    for (const fixture of selectedFixtures(only)) {
      const locator = page.getByTestId(chartVisualFixtureTestId(fixture.id));
      await waitForFixtureChartsReady(locator);
      // Expo dev overlays can mount after lazy chart modules resolve, so suppress fixed UI again.
      await hideFixedAndStickyElements(page);
      const actual = await locator.screenshot({animations: "disabled", type: "png"});
      const snapshotPath = join(SNAPSHOT_DIR, `${fixture.id}.png`);
      const actualPath = join(OUTPUT_DIR, "actual", `${fixture.id}.png`);
      writeFileSync(actualPath, actual);

      const snapshotAction = getSnapshotAction({
        exists: existsSync(snapshotPath),
        update,
      });
      if (snapshotAction === "write") {
        writeFileSync(snapshotPath, actual);
        reports.push({
          id: fixture.id,
          message: "updated rendered-snapshot",
          status: "match",
        });
        continue;
      }
      if (snapshotAction === "missing") {
        reports.push({
          id: fixture.id,
          message: "rendered-snapshot is missing; run ui:charts:update-snapshots to create it",
          status: "missing",
        });
        continue;
      }

      try {
        const expected = readFileSync(snapshotPath);
        const {diffPng, result} = diffPngBuffers({actual, expected});
        const pixelCount = result.width * result.height;
        if (isChartVisualMatch({diffCount: result.diffCount, pixelCount})) {
          reports.push({diffCount: result.diffCount, id: fixture.id, status: "match"});
          continue;
        }
        writeFileSync(join(OUTPUT_DIR, "diff", `${fixture.id}.png`), diffPng);
        reports.push({
          diffCount: result.diffCount,
          id: fixture.id,
          message: `${result.diffCount} pixels differ (${result.width}x${result.height})`,
          status: "mismatch",
        });
      } catch (error) {
        reports.push({
          id: fixture.id,
          message: error instanceof Error ? error.message : String(error),
          status: "error",
        });
      }
    }
  } finally {
    await browser?.close();
    if (started) {
      stopDemo(started);
    }
  }

  const failed = reports.filter((report) => report.status !== "match").length;
  writeFileSync(join(OUTPUT_DIR, "report.json"), `${JSON.stringify({failed, reports}, null, 2)}\n`);
  return {failed, reports};
};

if (import.meta.main) {
  const {failed, reports} = await compareChartRenderedSnapshots();
  for (const report of reports) {
    const prefix = report.status === "match" ? "ok" : report.status;
    console.info(`${prefix} ${report.id}${report.message ? ` — ${report.message}` : ""}`);
  }
  if (failed > 0) {
    console.error(
      `${failed} fixture(s) differed. Inspect demo/chart-visual-output and run the review-chart-visuals skill.`
    );
    process.exit(1);
  }
  console.info("Chart rendered-snapshots match.");
}
