#!/usr/bin/env bun
/**
 * Captures the ListDetailLayout demo inbox at phone and tablet sizes and fails when an expected
 * pane or row is missing. Run against a demo web server (`cd demo && bun run web`).
 *
 *   bun run ui:list-detail:capture [--base-url=http://127.0.0.1:8085] [--out=/opt/cursor/artifacts]
 */
import {mkdirSync} from "node:fs";
import {join} from "node:path";
import {chromium, type Page} from "@playwright/test";

interface Capture {
  name: string;
  path: string;
  viewport: {height: number; width: number};
  visible: string[];
  hidden: string[];
  current?: string;
}

const PHONE = {height: 844, width: 390};
const TABLET = {height: 768, width: 1024};

export const CAPTURES: Capture[] = [
  {
    hidden: ["list-detail-list-pane"],
    name: "phone-inbox",
    path: "/demo/list-detail",
    viewport: PHONE,
    visible: ["mail-list", "mail-row-1-clickable"],
  },
  {
    hidden: ["list-detail-list-pane", "mail-list"],
    name: "phone-message",
    path: "/demo/list-detail/3",
    viewport: PHONE,
    visible: ["mail-message-3"],
  },
  {
    current: "mail-row-3",
    hidden: [],
    name: "tablet-message",
    path: "/demo/list-detail/3",
    viewport: TABLET,
    visible: ["list-detail-list-pane", "mail-list", "mail-message-3"],
  },
  {
    current: "mail-row-3",
    hidden: [],
    name: "sidebar-message",
    path: "/demo/sidebar-navigation/mail/3",
    viewport: {height: 800, width: 1280},
    visible: ["list-detail-list-pane", "mail-list", "mail-message-3"],
  },
];

const readArg = (name: string, fallback: string): string => {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
};

const checkCapture = async (page: Page, capture: Capture): Promise<string[]> => {
  const problems: string[] = [];
  for (const testId of capture.visible) {
    if (!(await page.getByTestId(testId).first().isVisible())) {
      problems.push(`${testId} is not visible`);
    }
  }
  for (const testId of capture.hidden) {
    if (await page.getByTestId(testId).first().isVisible()) {
      problems.push(`${testId} should not be visible`);
    }
  }
  if (capture.current) {
    // A clickable Box row renders its pressable as `${testID}-clickable`.
    const row = page.getByTestId(`${capture.current}-clickable`);
    if ((await row.getAttribute("aria-current")) !== "true") {
      problems.push(`${capture.current} is not marked aria-current="true"`);
    }
  }
  return problems;
};

const main = async (): Promise<void> => {
  const baseUrl = readArg("base-url", "http://127.0.0.1:8085");
  const outDir = readArg("out", "/opt/cursor/artifacts");
  mkdirSync(outDir, {recursive: true});

  const browser = await chromium.launch();
  const failures: string[] = [];
  try {
    for (const capture of CAPTURES) {
      const page = await browser.newPage({viewport: capture.viewport});
      await page.goto(`${baseUrl}${capture.path}`, {timeout: 120_000, waitUntil: "networkidle"});
      await page
        .getByTestId(capture.visible[0] ?? "list-detail-layout")
        .first()
        .waitFor({
          timeout: 60_000,
        });
      const file = join(outDir, `list-detail-demo-${capture.name}.png`);
      await page.screenshot({path: file});
      const problems = await checkCapture(page, capture);
      for (const problem of problems) {
        failures.push(`${capture.name}: ${problem}`);
      }
      console.info(`${problems.length === 0 ? "ok  " : "FAIL"} ${capture.name} -> ${file}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }

  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
};

if (import.meta.main) {
  await main();
}
