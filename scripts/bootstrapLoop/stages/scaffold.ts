import {spawnSync} from "node:child_process";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";

import {builderEnv, runBuilder, tailLines, UNATTENDED_NOTE} from "../agent";
import {CHECKOUT_ROOT, NAIVE_PROMPT, renderBootstrapPrompt} from "../bootstrapPrompt";
import {collectEnvFileValues, redact} from "../redact";
import type {StageCheck, StageContext, StageDefinition, StageOutcome} from "../types";
import {todoFeatureChecks} from "./checks";

const TAIL_LINES = 200;
const DEP_SECTIONS = ["dependencies", "devDependencies", "peerDependencies"] as const;

const exec = (command: string, args: string[], cwd: string): {ok: boolean; output: string} => {
  const result = spawnSync(command, args, {cwd, encoding: "utf8"});
  return {ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}`};
};

/** Pins every Terreno dependency in one package.json to exactly `version`. */
export const pinTerrenoDependencies = (packageJsonPath: string, version: string): string[] => {
  if (!existsSync(packageJsonPath)) {
    return [];
  }
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as Record<
    string,
    Record<string, string> | undefined
  >;
  const pinned: string[] = [];
  for (const section of DEP_SECTIONS) {
    for (const name of Object.keys(pkg[section] ?? {})) {
      if (name.startsWith("@terreno/") || name === "create-terreno-app") {
        (pkg[section] as Record<string, string>)[name] = version;
        pinned.push(name);
      }
    }
  }
  writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
  return pinned;
};

/** `local` runs against linked workspace packages, so only published versions are pinned. */
const pinCheck = (context: StageContext): StageCheck => {
  if (context.version === "local") {
    return {
      ev: "local checkout, dependencies linked by --terreno-path",
      name: "pin-deps",
      status: "PASS",
    };
  }
  const pinned = ["backend", "frontend"].flatMap((dir) =>
    pinTerrenoDependencies(join(context.appDir, dir, "package.json"), context.version)
  );
  return {
    ev: `pinned ${String(pinned.length)} dependencies to ${context.version}`,
    name: "pin-deps",
    status: pinned.length > 0 ? "PASS" : "FAIL",
  };
};

const installCheck = (context: StageContext): StageCheck => {
  if (context.env.BOOTSTRAP_LOOP_SKIP_INSTALL === "1") {
    return {ev: "skipped by BOOTSTRAP_LOOP_SKIP_INSTALL", name: "install", status: "PASS"};
  }
  const failed: string[] = [];
  for (const dir of ["backend", "frontend"]) {
    const cwd = join(context.appDir, dir);
    if (!existsSync(join(cwd, "package.json"))) {
      failed.push(`${dir}/package.json missing`);
      continue;
    }
    const install = exec("bun", ["install"], cwd);
    if (!install.ok) {
      failed.push(`${dir}: ${tailLines(install.output, 20)}`);
    }
  }
  return {
    ev: failed.length === 0 ? "bun install ok in backend and frontend" : failed.join("\n"),
    name: "install",
    status: failed.length === 0 ? "PASS" : "FAIL",
  };
};

const typecheckCheck = (context: StageContext): StageCheck => {
  const cwd = join(context.appDir, "backend");
  const appTsc = join(cwd, "node_modules", ".bin", "tsc");
  const tsc = existsSync(appTsc) ? appTsc : join(CHECKOUT_ROOT, "node_modules", ".bin", "tsc");
  const result = existsSync(tsc)
    ? exec(tsc, ["--noEmit"], cwd)
    : exec("bunx", ["tsc", "--noEmit"], cwd);
  return {
    ev: result.ok ? "tsc --noEmit ok" : tailLines(result.output, 30),
    name: "backend-typecheck",
    status: result.ok ? "PASS" : "FAIL",
  };
};

/** Commits the scaffold once so later stages diff against it. */
const baselineCommit = (context: StageContext): StageCheck => {
  const cwd = context.appDir;
  if (!existsSync(join(cwd, ".git"))) {
    exec("git", ["init", "-q"], cwd);
  }
  const ignorePath = join(cwd, ".gitignore");
  const ignored = existsSync(ignorePath) ? readFileSync(ignorePath, "utf8") : "";
  const missing = ["node_modules", ".env*", ".vercel", ".mongo"].filter(
    (entry) => !ignored.includes(entry)
  );
  if (missing.length > 0) {
    writeFileSync(
      ignorePath,
      `${ignored}${ignored.endsWith("\n") || !ignored ? "" : "\n"}${missing.join("\n")}\n`
    );
  }
  exec("git", ["add", "-A"], cwd);
  const commit = exec(
    "git",
    [
      "-c",
      "user.name=bootstrap-loop",
      "-c",
      "user.email=bootstrap-loop@localhost",
      "commit",
      "-q",
      "-m",
      "Scaffold baseline",
      "--allow-empty",
    ],
    cwd
  );
  return {
    ev: commit.ok ? "baseline commit created" : tailLines(commit.output, 10),
    name: "baseline-commit",
    status: commit.ok ? "PASS" : "FAIL",
  };
};

const run = async (context: StageContext): Promise<StageOutcome> => {
  mkdirSync(context.appDir, {recursive: true});
  const bootstrapPrompt = await renderBootstrapPrompt({version: context.version});
  const failureSection =
    context.failures.length > 0
      ? `\n\n## Fix these failures\n\n${context.failures.map((failure) => `- ${failure}`).join("\n")}`
      : "";
  const prompt = `${NAIVE_PROMPT}\n\n${bootstrapPrompt}${failureSection}\n\n${UNATTENDED_NOTE}\n`;
  const env = builderEnv("scaffold", context.env);
  const builder = await runBuilder({cwd: context.appDir, env, prompt});
  const secretValues = collectEnvFileValues(context.appDir);
  const log = tailLines(redact(builder.output, context.env, secretValues), TAIL_LINES);

  const checks: StageCheck[] = [
    {
      ev:
        builder.exitCode === 0 ? "builder exited 0" : `builder exited ${String(builder.exitCode)}`,
      name: "builder",
      status: builder.exitCode === 0 ? "PASS" : "FAIL",
    },
  ];
  if (builder.exitCode !== 0) {
    return {checks, log};
  }
  checks.push(
    pinCheck(context),
    installCheck(context),
    typecheckCheck(context),
    ...todoFeatureChecks(context.appDir)
  );
  if (checks.every((check) => check.status === "PASS")) {
    checks.push(baselineCommit(context));
  }
  return {checks, log};
};

export const scaffoldStage: StageDefinition = {id: "scaffold", kind: "agent", run};
