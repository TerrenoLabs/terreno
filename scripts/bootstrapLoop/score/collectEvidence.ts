import {type ChildProcess, spawn} from "node:child_process";
import {mkdirSync, writeFileSync} from "node:fs";
import {join} from "node:path";

import {probeR1, probeR2, probeR8, probeR12} from "./probes/access";
import {probeR3, probeR4, probeR7, probeR13} from "./probes/app";
import type {Probe, ProbeContext, ProbeDeps, RowEvidence} from "./probes/probeKit";
import {probeR5, probeR6, probeR9, probeR10, probeR11} from "./probes/services";

const PROBES: Record<string, Probe> = {
  R1: probeR1,
  R2: probeR2,
  R3: probeR3,
  R4: probeR4,
  R5: probeR5,
  R6: probeR6,
  R7: probeR7,
  R8: probeR8,
  R9: probeR9,
  R10: probeR10,
  R11: probeR11,
  R12: probeR12,
  R13: probeR13,
};

export const ROW_IDS = Object.keys(PROBES).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));

const VIEWPORTS = [
  {height: 800, label: "desktop", width: 1280},
  {height: 844, label: "mobile", width: 390},
];
const SCREENS = [
  {name: "login", path: "/login"},
  {name: "todos", path: "/"},
  {name: "admin", path: "/admin"},
];

interface RunningApp {
  baseUrl: string;
  webUrl: string;
  stop: () => Promise<void>;
}

export interface CollectEvidenceOptions {
  runDir: string;
  env?: NodeJS.ProcessEnv;
  /** Replaced in tests: starts the backend and web against a replica-set Mongo. */
  startApp?: (appDir: string, env: NodeJS.ProcessEnv) => Promise<RunningApp>;
  /** Replaced in tests: writes one PNG and returns its path. */
  screenshot?: (options: {
    url: string;
    width: number;
    height: number;
    path: string;
  }) => Promise<void>;
  deps?: ProbeDeps;
}

export interface EvidenceFile {
  rows: RowEvidence[];
}

const waitFor = async (url: string, attempts = 60): Promise<void> => {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      if ((await fetch(url)).status < 500) {
        return;
      }
    } catch {
      // Server is not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${url} did not come up`);
};

/** Starts the app's backend (4000) and web export server (8082) as child processes. */
const startAppProcesses = async (appDir: string, env: NodeJS.ProcessEnv): Promise<RunningApp> => {
  const children: ChildProcess[] = [];
  const launch = (cwd: string, args: string[], extra: NodeJS.ProcessEnv): void => {
    children.push(spawn("bun", args, {cwd, env: {...env, ...extra}, stdio: "ignore"}));
  };
  launch(join(appDir, "backend"), ["run", "dev"], {PORT: "4000"});
  launch(join(appDir, "frontend"), ["run", "web"], {
    EXPO_PUBLIC_API_URL: "http://localhost:4000",
    PORT: "8082",
  });
  await waitFor("http://localhost:4000/health");
  await waitFor("http://localhost:8082");
  return {
    baseUrl: "http://localhost:4000",
    stop: async () => {
      for (const child of children) {
        child.kill();
      }
    },
    webUrl: "http://localhost:8082",
  };
};

/** Playwright is the app's own dependency, so it loads lazily and only when screenshots run. */
const playwrightScreenshot: NonNullable<CollectEvidenceOptions["screenshot"]> = async ({
  height,
  path,
  url,
  width,
}) => {
  const moduleName = "playwright";
  const {chromium} = await import(moduleName);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({viewport: {height, width}});
    await page.goto(url, {waitUntil: "networkidle"});
    await page.screenshot({fullPage: true, path});
  } finally {
    await browser.close();
  }
};

/**
 * Runs the probe for every rubric row against the running app and writes
 * `<runDir>/evidence/evidence.json` plus the screenshots. A probe that throws is recorded
 * as `UNKNOWN`, never as a pass.
 */
export const collectEvidence = async (options: CollectEvidenceOptions): Promise<EvidenceFile> => {
  const env = options.env ?? process.env;
  const appDir = join(options.runDir, "app");
  const evidenceDir = join(options.runDir, "evidence");
  mkdirSync(evidenceDir, {recursive: true});

  const app = await (options.startApp ?? startAppProcesses)(appDir, env);
  const screenshots: string[] = [];
  try {
    const shoot = options.screenshot ?? playwrightScreenshot;
    for (const viewport of VIEWPORTS) {
      for (const screen of SCREENS) {
        const path = join(evidenceDir, `${screen.name}-${viewport.label}.png`);
        try {
          await shoot({
            height: viewport.height,
            path,
            url: `${app.webUrl}${screen.path}`,
            width: viewport.width,
          });
          screenshots.push(path);
        } catch (error) {
          console.warn(`screenshot ${screen.name}-${viewport.label} failed`, error);
        }
      }
    }
    const context: ProbeContext = {
      appDir,
      baseUrl: app.baseUrl,
      deps: options.deps,
      env: env as Record<string, string | undefined>,
      screenshots,
      webUrl: app.webUrl,
    };
    const rows: RowEvidence[] = [];
    for (const id of ROW_IDS) {
      try {
        rows.push(await PROBES[id](context));
      } catch (error) {
        rows.push({
          artifacts: [],
          facts: [`probe threw: ${String(error)}`],
          row: id,
          status: "UNKNOWN",
        });
      }
    }
    const evidence: EvidenceFile = {rows};
    writeFileSync(join(evidenceDir, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    return evidence;
  } finally {
    await app.stop();
  }
};
