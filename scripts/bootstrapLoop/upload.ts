import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {dirname, join, relative} from "node:path";

import {collectEnvFileValues, redact} from "./redact";

export interface UploadRunOptions {
  runDir: string;
  dest: string;
  env?: Record<string, string | undefined>;
}

const TEXT_EXTENSIONS = new Set([".json", ".md", ".txt", ".log", ".yml", ".yaml"]);
const REQUIRED_REPORTS = ["score.json", "SCORE.md", "ITERATIONS.md", "build.json"];
const OPTIONAL_REPORTS = ["REGRESSIONS.md"];
const TAR_EXCLUDES = ["node_modules", ".env", ".env.*", ".vercel", ".git"];

const isText = (path: string): boolean => {
  const dot = path.lastIndexOf(".");
  return dot >= 0 && TEXT_EXTENSIONS.has(path.slice(dot));
};

const listFiles = (dir: string): string[] => {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
};

/** Copies one file, redacting it when it is text so no secret value reaches the artifact. */
const copyRedacted = (
  from: string,
  to: string,
  env: Record<string, string | undefined>,
  secrets: string[]
): void => {
  mkdirSync(dirname(to), {recursive: true});
  if (isText(from)) {
    writeFileSync(to, redact(readFileSync(from, "utf8"), env, secrets));
    return;
  }
  copyFileSync(from, to);
};

const tarApp = async (appDir: string, output: string): Promise<void> => {
  const args = ["tar", "-czf", output];
  for (const pattern of TAR_EXCLUDES) {
    args.push(`--exclude=${pattern}`);
  }
  args.push("-C", dirname(appDir), "app");
  const proc = Bun.spawn(args, {stderr: "pipe", stdout: "pipe"});
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) {
    throw new Error(`tar failed (${code}): ${stderr.trim()}`);
  }
};

/**
 * Copies a run's app tarball, screenshots, evidence, stage JSONs and reports to `dest`,
 * running every text file through the redactor. Returns the uploaded paths relative to `dest`.
 */
export const uploadRun = async ({
  runDir,
  dest,
  env = process.env,
}: UploadRunOptions): Promise<{files: string[]}> => {
  const missing = REQUIRED_REPORTS.filter((name) => !existsSync(join(runDir, name)));
  if (missing.length > 0) {
    throw new Error(`run dir ${runDir} is missing ${missing.join(", ")}`);
  }
  const appDir = join(runDir, "app");
  const secrets = existsSync(appDir) ? collectEnvFileValues(appDir) : [];
  mkdirSync(dest, {recursive: true});
  const files: string[] = [];
  if (existsSync(appDir)) {
    await tarApp(appDir, join(dest, "app.tar.gz"));
    files.push("app.tar.gz");
  }
  const evidenceDir = join(runDir, "evidence");
  for (const path of listFiles(evidenceDir)) {
    const name = relative(evidenceDir, path);
    const target = name.endsWith(".png") ? join("screenshots", name) : name;
    copyRedacted(path, join(dest, target), env, secrets);
    files.push(target);
  }
  for (const name of [...REQUIRED_REPORTS, ...OPTIONAL_REPORTS]) {
    const from = join(runDir, name);
    if (existsSync(from)) {
      copyRedacted(from, join(dest, name), env, secrets);
      files.push(name);
    }
  }
  const stagesDir = join(runDir, "stages");
  for (const path of listFiles(stagesDir)) {
    const target = join("stages", relative(stagesDir, path));
    copyRedacted(path, join(dest, target), env, secrets);
    files.push(target);
  }
  return {files};
};
