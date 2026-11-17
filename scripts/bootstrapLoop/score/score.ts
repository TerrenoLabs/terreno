import {spawn} from "node:child_process";
import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {DateTime} from "luxon";

import type {BuildResult} from "../build";
import {collectEvidence as defaultCollect, type EvidenceFile} from "./collectEvidence";
import {compareTimes, type TimeReport} from "./timeRegression";

export const DEFAULT_SCORER_CMD = "claude -p --output-format json --allowedTools Read,Glob,Grep";
export const MIN_VISUAL_SCORE = 4;

export interface RowScore {
  row: string;
  status: "PASS" | "FAIL";
  reason: string;
}

export interface EvidenceRefs {
  ci: string[];
  deploy: string[];
  screenshots: string[];
}

export interface ScoreResult {
  version: string;
  rows: RowScore[];
  pass: boolean;
  visualScore: number;
  times: TimeReport;
  evidenceRefs: EvidenceRefs;
}

export interface ScoreBuildOptions {
  runDir: string;
  previousDir?: string;
  env?: NodeJS.ProcessEnv;
  /** Replaced in tests; defaults to T5's collector. */
  collect?: (options: {runDir: string; env?: NodeJS.ProcessEnv}) => Promise<EvidenceFile>;
}

interface ScorerOutput {
  rows: RowScore[];
  visualScore: number;
}

const SCORER_ENV_NAMES = ["PATH", "HOME", "USER", "SHELL", "TMPDIR", "LANG", "TERM"];
const MODEL_ENV_NAMES = ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"];

/** The scorer sees PATH, HOME, its model key and non-secret loop settings, nothing else. */
const scorerEnv = (source: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};
  const names = [
    ...SCORER_ENV_NAMES,
    ...MODEL_ENV_NAMES,
    ...Object.keys(source).filter(
      (name) =>
        name.startsWith("BOOTSTRAP_LOOP_") && !/(TOKEN|KEY|SECRET|PASSWORD|_URI|_URL)/.test(name)
    ),
  ];
  for (const name of names) {
    if (source[name] !== undefined) {
      env[name] = source[name];
    }
  }
  return env;
};

const runScorer = (
  command: string,
  prompt: string,
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<{exitCode: number; output: string}> =>
  new Promise((resolve) => {
    const child = spawn("sh", ["-c", command], {cwd, env, stdio: ["pipe", "pipe", "pipe"]});
    const out: string[] = [];
    child.stdout.on("data", (chunk) => out.push(String(chunk)));
    child.on("error", () => resolve({exitCode: 127, output: ""}));
    child.on("close", (code) => resolve({exitCode: code ?? 1, output: out.join("")}));
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
  });

const isRowScore = (value: unknown): value is RowScore => {
  const item = value as RowScore;
  return (
    typeof item?.row === "string" &&
    (item.status === "PASS" || item.status === "FAIL") &&
    typeof item.reason === "string"
  );
};

const tryParse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** Accepts bare JSON, fenced JSON, and the `{result: "<json>"}` envelope of `claude -p`. */
export const parseScorerOutput = (stdout: string): ScorerOutput | undefined => {
  const unfence = (text: string): string =>
    text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
  let parsed = tryParse(unfence(stdout)) as {result?: unknown} | undefined;
  if (typeof parsed?.result === "string") {
    parsed = tryParse(unfence(parsed.result)) as typeof parsed;
  }
  const candidate = parsed as Partial<ScorerOutput> | undefined;
  if (
    !candidate ||
    !Array.isArray(candidate.rows) ||
    !candidate.rows.every(isRowScore) ||
    typeof candidate.visualScore !== "number"
  ) {
    return undefined;
  }
  return {rows: candidate.rows, visualScore: candidate.visualScore};
};

const buildEvidenceRefs = (evidence: EvidenceFile): EvidenceRefs => {
  const facts = (row: string): string[] =>
    evidence.rows.find((item) => item.row === row)?.facts ?? [];
  const screenshots = evidence.rows.flatMap((item) =>
    item.artifacts.filter((path) => path.endsWith(".png"))
  );
  return {
    ci: facts("R9").filter((fact) => /https?:\/\/|run/i.test(fact)),
    deploy: facts("R13").filter((fact) => /https?:\/\//.test(fact)),
    screenshots: [...new Set(screenshots)],
  };
};

/** Combines the probe and the scorer: a row passes only when both say PASS. */
const mergeRows = (
  evidence: EvidenceFile,
  scorer: ScorerOutput | undefined,
  rowIds: string[]
): RowScore[] =>
  rowIds.map((row) => {
    if (!scorer) {
      return {reason: "scorer output unparsable", row, status: "FAIL"};
    }
    const probe = evidence.rows.find((item) => item.row === row);
    if (!probe || probe.status !== "PASS") {
      const why = probe ? probe.facts.join("; ") : "no probe evidence";
      return {
        reason: `probe ${probe?.status ?? "UNKNOWN"}${why ? `: ${why}` : ""}`,
        row,
        status: "FAIL",
      };
    }
    const judged = scorer.rows.find((item) => item.row === row);
    if (!judged) {
      return {reason: "scorer did not score this row", row, status: "FAIL"};
    }
    if (row === "R3" && scorer.visualScore < MIN_VISUAL_SCORE) {
      return {
        reason: `visual score ${String(scorer.visualScore)} is below ${String(MIN_VISUAL_SCORE)}. ${judged.reason}`,
        row,
        status: "FAIL",
      };
    }
    return judged;
  });

const readBuild = (dir: string): BuildResult | undefined => {
  const path = join(dir, "build.json");
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as BuildResult) : undefined;
};

const renderMarkdown = (result: ScoreResult): string => {
  const lines = [
    `# Score for ${result.version}: ${result.pass ? "PASS" : "FAIL"}`,
    "",
    `Visual score: ${String(result.visualScore)}/5`,
    "",
    "| Row | Status | Reason |",
    "| --- | --- | --- |",
    ...result.rows.map(
      (row) => `| ${row.row} | ${row.status} | ${row.reason.replace(/\|/g, "/")} |`
    ),
    "",
    "## Time",
    "",
    "| Stage | Minutes | Previous | Regressed |",
    "| --- | --- | --- | --- |",
    ...result.times.stages.map(
      (stage) =>
        `| ${stage.id} | ${String(stage.totalMinutes)} | ${stage.previous === undefined ? "n/a" : String(stage.previous)} | ${stage.regressed ? "YES" : "no"} |`
    ),
    "",
    `Total with scoring: ${String(result.times.totalMinutes)} min (scoring ${String(result.times.scoreMinutes)} min). Previous build total: ${result.times.previousTotal === undefined ? "n/a" : String(result.times.previousTotal)}. Total regressed: ${result.times.totalRegressed ? "YES" : "no"}.`,
  ];
  return `${lines.join("\n")}\n`;
};

/**
 * Collects evidence, asks a separate scorer process (new session, evidence directory only)
 * to judge it, and writes `score.json` and `SCORE.md` into the run directory.
 */
export const scoreBuild = async ({
  runDir,
  previousDir,
  env = process.env,
  collect = defaultCollect,
}: ScoreBuildOptions): Promise<ScoreResult> => {
  const started = DateTime.now();
  const build = readBuild(runDir);
  if (!build) {
    throw new Error(`no build.json in ${runDir}; run the build first`);
  }
  const evidence = await collect({env, runDir});
  const rubric = readFileSync(
    join(import.meta.dir, "../../../.rulesync/skills/bootstrap-todo-loop/references/rubric.md"),
    "utf8"
  );
  const prompt = [
    readFileSync(join(import.meta.dir, "scorerPrompt.md"), "utf8"),
    "## Rubric",
    rubric,
    "## Evidence",
    JSON.stringify(evidence, null, 2),
  ].join("\n\n");
  const command = env.BOOTSTRAP_LOOP_SCORER_CMD?.trim() || DEFAULT_SCORER_CMD;
  const {output} = await runScorer(command, prompt, join(runDir, "evidence"), scorerEnv(env));
  const scorer = parseScorerOutput(output);
  const scoreMinutes = DateTime.now().diff(started, "minutes").minutes;

  const rows = mergeRows(
    evidence,
    scorer,
    evidence.rows.map((item) => item.row)
  );
  const previous = previousDir ? readBuild(previousDir) : undefined;
  const result: ScoreResult = {
    evidenceRefs: buildEvidenceRefs(evidence),
    pass: rows.every((row) => row.status === "PASS"),
    rows,
    times: compareTimes({build, previous, scoreMinutes}),
    version: build.version,
    visualScore: scorer?.visualScore ?? 0,
  };
  writeFileSync(join(runDir, "score.json"), `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(join(runDir, "SCORE.md"), renderMarkdown(result));
  return result;
};
