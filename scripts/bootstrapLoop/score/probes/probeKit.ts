import {spawnSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {existsSync, readdirSync, readFileSync, statSync} from "node:fs";
import {join} from "node:path";

type EvidenceStatus = "PASS" | "FAIL" | "UNKNOWN";

/** One rubric row's evidence, as written to `evidence.json`. */
export interface RowEvidence {
  row: string;
  status: EvidenceStatus;
  facts: string[];
  artifacts: string[];
}

interface MongoProbe {
  /** Counts documents in `collection` matching `filter`. */
  count: (collection: string, filter: Record<string, unknown>) => Promise<number>;
}

export interface RunResult {
  status: number;
  stdout: string;
}

interface ViewportResult {
  horizontalScroll: boolean;
  primaryActionVisible: boolean;
  todoCreateWorks: boolean;
}

/** Everything a probe may touch outside the app; tests replace each one. */
export interface ProbeDeps {
  mongo?: MongoProbe;
  run?: (command: string, args: string[], cwd: string) => RunResult;
  fetch?: typeof fetch;
  viewport?: (options: {url: string; width: number; height: number}) => Promise<ViewportResult>;
}

export interface ProbeContext {
  appDir: string;
  env: Record<string, string | undefined>;
  baseUrl?: string;
  webUrl?: string;
  /** Screenshot paths already captured by collectEvidence. */
  screenshots?: string[];
  deps?: ProbeDeps;
}

export type Probe = (context: ProbeContext) => Promise<RowEvidence>;

const SKIPPED_DIRS = new Set(["node_modules", ".git", ".expo", "dist", ".vercel"]);

export const defaultRun = (command: string, args: string[], cwd: string): RunResult => {
  const result = spawnSync(command, args, {cwd, encoding: "utf8"});
  return {status: result.status ?? 1, stdout: `${result.stdout ?? ""}${result.stderr ?? ""}`};
};

/** Collects verdicts: any failure fails the row, else any missing input makes it UNKNOWN. */
export class Findings {
  private readonly facts: string[] = [];
  private failed = false;
  private unknown = false;

  constructor(private readonly row: string) {}

  ok(fact: string): void {
    this.facts.push(fact);
  }

  bad(fact: string): void {
    this.failed = true;
    this.facts.push(fact);
  }

  check(condition: boolean, passFact: string, failFact: string): void {
    if (condition) {
      this.ok(passFact);
      return;
    }
    this.bad(failFact);
  }

  /** The probe lacked an input; the row can never PASS on this run. */
  missing(variable: string): void {
    this.unknown = true;
    this.facts.push(`${variable} not set`);
  }

  result(artifacts: string[] = []): RowEvidence {
    const status: EvidenceStatus = this.failed ? "FAIL" : this.unknown ? "UNKNOWN" : "PASS";
    return {artifacts, facts: this.facts, row: this.row, status};
  }
}

/** Relative paths of source-like files under `dirs`, skipping heavy directories. */
export const listFiles = (appDir: string, dirs: string[] = ["."]): string[] => {
  const files: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) {
      return;
    }
    for (const entry of readdirSync(dir)) {
      if (SKIPPED_DIRS.has(entry)) {
        continue;
      }
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else {
        files.push(path.slice(appDir.length + 1));
      }
    }
  };
  for (const dir of dirs) {
    walk(join(appDir, dir));
  }
  return files;
};

/** Files tracked by git, falling back to a directory walk when the app is not a repo. */
export const trackedFiles = (appDir: string, run = defaultRun): string[] => {
  const result = run("git", ["ls-files"], appDir);
  if (result.status !== 0) {
    return listFiles(appDir);
  }
  return result.stdout.split("\n").filter(Boolean);
};

export const readIfPresent = (appDir: string, relative: string): string | undefined => {
  const path = join(appDir, relative);
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
};

/** First file under `dirs` whose content matches `pattern`. */
export const findInSource = (appDir: string, dirs: string[], pattern: RegExp): string | undefined =>
  listFiles(appDir, dirs).find(
    (file) =>
      /\.(ts|tsx|js|json|md|ya?ml)$/.test(file) &&
      pattern.test(readFileSync(join(appDir, file), "utf8"))
  );

export interface Session {
  headers: Record<string, string>;
}

const jsonHeaders = {"content-type": "application/json"};

/** Signs in through Better Auth; returns auth headers, or undefined when the login fails. */
export const signIn = async (
  context: ProbeContext,
  base: string,
  email: string,
  password: string
): Promise<Session | undefined> => {
  const doFetch = context.deps?.fetch ?? fetch;
  const response = await doFetch(`${base}/api/auth/sign-in/email`, {
    body: JSON.stringify({email, password}),
    headers: jsonHeaders,
    method: "POST",
  });
  if (!response.ok) {
    return undefined;
  }
  const token = response.headers.get("set-auth-token");
  if (token) {
    return {headers: {authorization: `Bearer ${token}`}};
  }
  const cookie = response.headers.get("set-cookie");
  return cookie ? {headers: {cookie: cookie.split(";")[0]}} : undefined;
};

export const signUp = async (
  context: ProbeContext,
  base: string,
  email: string,
  password: string
): Promise<Response> => {
  const doFetch = context.deps?.fetch ?? fetch;
  return doFetch(`${base}/api/auth/sign-up/email`, {
    body: JSON.stringify({email, name: "Probe User", password}),
    headers: jsonHeaders,
    method: "POST",
  });
};

export const api = async (
  context: ProbeContext,
  base: string,
  path: string,
  options: {method?: string; body?: unknown; session?: Session} = {}
): Promise<{status: number; body: unknown}> => {
  const doFetch = context.deps?.fetch ?? fetch;
  const response = await doFetch(`${base}${path}`, {
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers: {...jsonHeaders, ...(options.session?.headers ?? {})},
    method: options.method ?? "GET",
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Non-JSON bodies (streams, HTML) stay as text.
  }
  return {body, status: response.status};
};

/** Rows the run owner dropped from scope (BOOTSTRAP_LOOP_DESCOPE="R5,R9,R13"). */
export const isDescoped = (env: Record<string, string | undefined>, row: string): boolean =>
  (env.BOOTSTRAP_LOOP_DESCOPE ?? "")
    .split(",")
    .map((item) => item.trim())
    .includes(row);

export const envOr = (
  env: Record<string, string | undefined>,
  name: string,
  fallback: string
): string => env[name] || fallback;

export const probeEmail = (): string => `probe-${randomUUID()}@example.com`;
