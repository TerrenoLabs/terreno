import {spawnSync} from "node:child_process";
import {existsSync, readdirSync, readFileSync, statSync} from "node:fs";
import {join} from "node:path";

import {tailLines} from "../agent";
import type {StageCheck} from "../types";

const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx|json|md|yml|yaml)$/;
const SKIPPED_DIRS = new Set(["node_modules", ".git", ".expo", "dist", ".vercel"]);

const pass = (name: string, ev: string): StageCheck => ({ev, name, status: "PASS"});
const fail = (name: string, ev: string): StageCheck => ({ev, name, status: "FAIL"});
const verdict = (name: string, ok: boolean, passEv: string, failEv: string): StageCheck =>
  ok ? pass(name, passEv) : fail(name, failEv);

const walk = (dir: string, files: string[] = []): string[] => {
  if (!existsSync(dir)) {
    return files;
  }
  for (const entry of readdirSync(dir)) {
    if (SKIPPED_DIRS.has(entry)) {
      continue;
    }
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path, files);
    } else if (SOURCE_EXTENSIONS.test(entry)) {
      files.push(path);
    }
  }
  return files;
};

/** True when any source file under `dirs` (relative to the app) matches `pattern`. */
const sourceMatches = (appDir: string, dirs: string[], pattern: RegExp): string | undefined =>
  dirs
    .flatMap((dir) => walk(join(appDir, dir)))
    .find((file) => pattern.test(readFileSync(file, "utf8")));

const grepCheck = (name: string, appDir: string, dirs: string[], pattern: RegExp): StageCheck => {
  const found = sourceMatches(appDir, dirs, pattern);
  return verdict(
    name,
    Boolean(found),
    `${pattern.source} found in ${found?.slice(appDir.length + 1)}`,
    `no source under ${dirs.join(", ")} matches ${pattern.source}`
  );
};

const fileCheck = (name: string, appDir: string, relative: string): StageCheck =>
  verdict(name, existsSync(join(appDir, relative)), `${relative} present`, `${relative} missing`);

const typecheck = (appDir: string, dir: "backend" | "frontend"): StageCheck => {
  const name = `${dir}-typecheck`;
  const cwd = join(appDir, dir);
  if (!existsSync(join(cwd, "tsconfig.json"))) {
    return fail(name, `${dir}/tsconfig.json missing`);
  }
  const appTsc = join(cwd, "node_modules", ".bin", "tsc");
  const result = spawnSync(
    existsSync(appTsc) ? appTsc : "bunx",
    existsSync(appTsc) ? ["--noEmit"] : ["tsc", "--noEmit"],
    {
      cwd,
      encoding: "utf8",
    }
  );
  return verdict(
    name,
    result.status === 0,
    "tsc --noEmit ok",
    tailLines(`${result.stdout ?? ""}${result.stderr ?? ""}`, 30)
  );
};

/** First commit of the app repo: the scaffold baseline later stages diff against. */
const baselineSha = (appDir: string): string | undefined => {
  const result = spawnSync("git", ["rev-list", "--max-parents=0", "HEAD"], {
    cwd: appDir,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim().split("\n")[0] : undefined;
};

const changedSinceBaseline = (appDir: string, relative: string): StageCheck => {
  const name = "theme-changed";
  const sha = baselineSha(appDir);
  if (!sha) {
    return fail(name, "no scaffold baseline commit in the app repo");
  }
  const diff = spawnSync("git", ["diff", "--quiet", sha, "--", relative], {cwd: appDir});
  const changed = diff.status === 1 || (diff.status === 0 && !existsSync(join(appDir, relative)));
  return verdict(
    name,
    diff.status === 1,
    `${relative} differs from the scaffold`,
    changed ? `${relative} was removed` : `${relative} is unchanged from the scaffold`
  );
};

const scriptCheck = (appDir: string, script: string): StageCheck => {
  const path = join(appDir, "backend", "package.json");
  const scripts = existsSync(path)
    ? ((JSON.parse(readFileSync(path, "utf8")) as {scripts?: Record<string, string>}).scripts ?? {})
    : {};
  return verdict(
    `${script}-script`,
    Boolean(scripts[script]),
    `backend package.json has a ${script} script`,
    `backend package.json has no ${script} script`
  );
};

const checklistChecks = (appDir: string): StageCheck[] => {
  const path = join(appDir, "CHECKLIST.md");
  if (!existsSync(path)) {
    return [fail("checklist-file", "CHECKLIST.md missing")];
  }
  const items = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => /^\s*[-*] \[ \] \S/.test(line)).length;
  return [
    verdict(
      "checklist-file",
      items >= 5,
      `CHECKLIST.md has ${String(items)} unchecked items`,
      `CHECKLIST.md has ${String(items)} unchecked items, need at least 5`
    ),
  ];
};

const deployChecks = (appDir: string): StageCheck[] => {
  const path = join(appDir, "deploy.json");
  if (!existsSync(path)) {
    return [fail("deploy-url", "deploy.json missing")];
  }
  let url = "";
  try {
    url = String((JSON.parse(readFileSync(path, "utf8")) as {url?: string}).url ?? "");
  } catch {
    return [fail("deploy-url", "deploy.json is not valid JSON")];
  }
  return [
    verdict(
      "deploy-url",
      /^https?:\/\/\S+$/.test(url),
      `deployed at ${url}`,
      `deploy.json url is "${url}"`
    ),
  ];
};

const typechecks = (appDir: string): StageCheck[] => [
  typecheck(appDir, "backend"),
  typecheck(appDir, "frontend"),
];

const BACKEND = ["backend/src"];
const APP = ["backend/src", "frontend"];

/** Deterministic checks per stage; rubric probes run at scoring, not here. */
export const stageChecks: Record<string, (appDir: string) => StageCheck[]> = {
  admin: (appDir) => [
    grepCheck("admin-app", appDir, BACKEND, /AdminApp/),
    scriptCheck(appDir, "seed"),
    ...typechecks(appDir),
  ],
  ai: (appDir) => [
    grepCheck("gpt-routes", appDir, BACKEND, /addGptRoutes|AiApp/),
    fileCheck(".mcp.json", appDir, ".mcp.json"),
    ...typechecks(appDir),
  ],
  auth: (appDir) => [
    grepCheck("better-auth", appDir, BACKEND, /BetterAuthApp|betterAuth/),
    fileCheck("env-example", appDir, "backend/.env.example"),
    ...typechecks(appDir),
  ],
  checklist: checklistChecks,
  ci: (appDir) => [
    verdict(
      "github-workflow",
      existsSync(join(appDir, ".github", "workflows")) &&
        readdirSync(join(appDir, ".github", "workflows")).some((file) => /\.ya?ml$/.test(file)),
      ".github/workflows has a workflow",
      ".github/workflows has no workflow file"
    ),
    fileCheck("circleci-config", appDir, ".circleci/config.yml"),
  ],
  consent: (appDir) => [grepCheck("consent-form", appDir, APP, /consent/i), ...typechecks(appDir)],
  deploy: deployChecks,
  features: (appDir) => [grepCheck("due-date", appDir, BACKEND, /dueDate/), ...typechecks(appDir)],
  roles: (appDir) => [
    grepCheck("rbac-seed", appDir, BACKEND, /seedDefaults|org-admin/),
    ...typechecks(appDir),
  ],
  theming: (appDir) => [
    changedSinceBaseline(appDir, "frontend/constants/theme.ts"),
    typecheck(appDir, "frontend"),
  ],
};
