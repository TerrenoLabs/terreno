import {mkdir} from "node:fs/promises";
import {join} from "node:path";
import AxeBuilder from "@axe-core/playwright";
import {chromium, type Page} from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const ARTIFACT_DIRECTORY = "/opt/cursor/artifacts/accessibility";

interface AccessibilityPageReport {
  incomplete: number;
  passes: number;
  screenshot: string;
  url: string;
  violations: Array<{
    help: string;
    helpUrl: string;
    id: string;
    impact: string | null;
    nodes: number;
  }>;
}

const getArtifactName = (url: string): string => {
  const parsedUrl = new URL(url);
  const path = `${parsedUrl.pathname}-${parsedUrl.searchParams.get("theme") ?? "default"}`;
  return path.replaceAll(/[^a-zA-Z0-9]+/g, "-").replaceAll(/^-|-$/g, "") || "page";
};

const scanPage = async ({
  page,
  url,
}: {
  page: Page;
  url: string;
}): Promise<AccessibilityPageReport> => {
  await page.goto(url, {waitUntil: "domcontentloaded"});
  await page.locator("body").waitFor({state: "visible"});
  await page.waitForTimeout(500);

  const results = await new AxeBuilder({page}).withTags(WCAG_TAGS).analyze();
  const artifactName = getArtifactName(url);
  const screenshot = join(ARTIFACT_DIRECTORY, `${artifactName}.png`);
  await page.screenshot({fullPage: true, path: screenshot});

  return {
    incomplete: results.incomplete.length,
    passes: results.passes.length,
    screenshot,
    url,
    violations: results.violations.map((violation) => ({
      help: violation.help,
      helpUrl: violation.helpUrl,
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.length,
    })),
  };
};

const main = async (): Promise<void> => {
  const urls = Bun.argv.slice(2);
  if (urls.length === 0) {
    throw new Error("Usage: bun scripts/accessibility/scan.ts <url> [url...]");
  }

  await mkdir(ARTIFACT_DIRECTORY, {recursive: true});
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {height: 900, width: 1440}});
  const reports: AccessibilityPageReport[] = [];

  try {
    for (const url of urls) {
      reports.push(await scanPage({page, url}));
    }
  } finally {
    await browser.close();
  }

  const reportPath = join(ARTIFACT_DIRECTORY, "wcag-report.json");
  await Bun.write(reportPath, `${JSON.stringify({reports, tags: WCAG_TAGS}, null, 2)}\n`);

  const violationCount = reports.reduce((total, report) => total + report.violations.length, 0);
  console.info(
    `WCAG scan: ${violationCount} violation types across ${reports.length} page(s). Report: ${reportPath}`
  );
  if (violationCount > 0) {
    process.exitCode = 1;
  }
};

await main();
