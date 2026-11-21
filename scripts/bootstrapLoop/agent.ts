import {spawn} from "node:child_process";

const DEFAULT_BUILDER_CMD = "claude -p --output-format json --permission-mode bypassPermissions";

export interface BuilderRunOptions {
  prompt: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  command?: string;
}

export interface BuilderRunResult {
  exitCode: number;
  output: string;
}

const builderCommand = (env: NodeJS.ProcessEnv = process.env): string =>
  env.BOOTSTRAP_LOOP_BUILDER_CMD?.trim() || DEFAULT_BUILDER_CMD;

/** Env every stage may see; secrets reach a stage only through its own allowlist. */
const BASE_ENV_NAMES = ["PATH", "HOME", "USER", "SHELL", "TMPDIR", "LANG", "CI", "TERM"];
const BUILDER_MODEL_ENV_NAMES = ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"];
const STAGE_ENV_NAMES: Record<string, string[]> = {
  ai: ["GOOGLE_GENERATIVE_AI_API_KEY"],
  ci: ["CIRCLECI_TOKEN", "BOOTSTRAP_LOOP_GH_TOKEN"],
  deploy: ["VERCEL_TOKEN", "BOOTSTRAP_LOOP_MONGO_URI"],
};

export const builderEnv = (stageId: string, source: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const names = [
    ...BASE_ENV_NAMES,
    ...BUILDER_MODEL_ENV_NAMES,
    ...(STAGE_ENV_NAMES[stageId] ?? []),
    ...Object.keys(source).filter(
      (name) =>
        name.startsWith("BOOTSTRAP_LOOP_") && !/(TOKEN|KEY|SECRET|PASSWORD|_URI|_URL)/.test(name)
    ),
    // The builder command itself is configuration, not a secret.
    "BOOTSTRAP_LOOP_BUILDER_CMD",
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const name of names) {
    const value = source[name];
    if (value !== undefined) {
      env[name] = value;
    }
  }
  if (stageId === "ci" && source.BOOTSTRAP_LOOP_GH_TOKEN) {
    env.GH_TOKEN = source.BOOTSTRAP_LOOP_GH_TOKEN;
  }
  return env;
};

/** Runs the builder command with the prompt on stdin and returns its combined output. */
export const runBuilder = ({
  prompt,
  cwd,
  env,
  command = builderCommand(env),
}: BuilderRunOptions): Promise<BuilderRunResult> =>
  new Promise((resolve) => {
    const child = spawn("sh", ["-c", command], {cwd, env, stdio: ["pipe", "pipe", "pipe"]});
    const chunks: string[] = [];
    child.stdout.on("data", (chunk) => chunks.push(String(chunk)));
    child.stderr.on("data", (chunk) => chunks.push(String(chunk)));
    child.on("error", (error) => {
      chunks.push(`spawn failed: ${error.message}\n`);
      resolve({exitCode: 127, output: chunks.join("")});
    });
    child.on("close", (code) => resolve({exitCode: code ?? 1, output: chunks.join("")}));
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
  });

export const tailLines = (text: string, count: number): string =>
  text.split("\n").slice(-count).join("\n");
