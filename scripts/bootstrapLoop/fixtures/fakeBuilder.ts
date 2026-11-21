#!/usr/bin/env bun
/**
 * Stand-in for the agent builder. Reads the prompt on stdin, records it and its own env,
 * then acts out one scenario chosen by BOOTSTRAP_LOOP_FAKE_MODE:
 *   local    run the checkout CLI exactly as the local bootstrap prompt asks
 *   fixture  write a tiny backend/frontend with caret Terreno deps
 *   fail3    exit 3
 *   tserror  fixture plus a TypeScript error
 *   files    write the JSON map in BOOTSTRAP_LOOP_FAKE_FILES (path -> content)
 *   noop     exit 0 and write nothing
 *   all      fixture plus every artifact the stage checks look for; edits the theme once the
 *            app is a git repo, so the theming check sees a change from the scaffold baseline
 */
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";

const mode = process.env.BOOTSTRAP_LOOP_FAKE_MODE ?? "fixture";
const prompt = await Bun.stdin.text();

if (process.env.BOOTSTRAP_LOOP_FAKE_PROMPT_FILE) {
  writeFileSync(process.env.BOOTSTRAP_LOOP_FAKE_PROMPT_FILE, prompt);
}
if (process.env.BOOTSTRAP_LOOP_FAKE_ENV_FILE) {
  writeFileSync(process.env.BOOTSTRAP_LOOP_FAKE_ENV_FILE, JSON.stringify(process.env));
}

const writeFixture = (withTypeError: boolean): void => {
  mkdirSync("backend/src/models", {recursive: true});
  writeFileSync("backend/src/models/todo.ts", 'export const todoModelName = "Todo";\n');
  mkdirSync("frontend/app", {recursive: true});
  writeFileSync("frontend/app/index.tsx", "export const todoScreen = 1;\n");
  for (const dir of ["backend", "frontend"]) {
    mkdirSync(join(dir, "src"), {recursive: true});
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        dependencies: {"@terreno/api": "^58.0.6", "@terreno/ui": "~58.0.6", luxon: "^3.7.2"},
        name: dir,
      })
    );
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({compilerOptions: {noEmit: true, strict: true}, include: ["src"]})
    );
    writeFileSync(
      join(dir, "src", "index.ts"),
      dir === "backend" && withTypeError
        ? "export const n: number = 'x';\n"
        : "export const n = 1;\n"
    );
  }
};

if (mode === "noop") {
  process.exit(0);
}
if (mode === "files") {
  const files = JSON.parse(process.env.BOOTSTRAP_LOOP_FAKE_FILES ?? "{}") as Record<string, string>;
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(path), {recursive: true});
    writeFileSync(path, content);
  }
  process.exit(0);
}
if (mode === "fail3") {
  console.error("fake builder failing");
  process.exit(3);
}
if (mode === "all") {
  const {existsSync} = await import("node:fs");
  if (!existsSync("backend/package.json")) {
    writeFixture(false);
  }
  const pkg = JSON.parse(readFileSync("backend/package.json", "utf8")) as Record<string, unknown>;
  pkg.scripts = {seed: "bun src/seed.ts"};
  writeFileSync("backend/package.json", JSON.stringify(pkg));
  writeFileSync(
    "backend/src/features.ts",
    'export const t = "AdminApp BetterAuthApp addGptRoutes dueDate seedDefaults consent";\n'
  );
  mkdirSync("frontend/constants", {recursive: true});
  const themed = existsSync(".git");
  writeFileSync(
    "frontend/constants/theme.ts",
    themed ? "export const t = 2;\n" : "export const t = 1;\n"
  );
  writeFileSync("backend/.env.example", "BETTER_AUTH_SECRET=\n");
  writeFileSync(".mcp.json", "{}");
  mkdirSync(".github/workflows", {recursive: true});
  writeFileSync(".github/workflows/ci.yml", "name: ci\n");
  mkdirSync(".circleci", {recursive: true});
  writeFileSync(".circleci/config.yml", "version: 2.1\n");
  writeFileSync("CHECKLIST.md", [1, 2, 3, 4, 5].map((n) => `- [ ] item ${n}`).join("\n"));
  writeFileSync("deploy.json", JSON.stringify({url: "https://todo.example.test"}));
  process.exit(0);
}
if (mode === "fixture" || mode === "tserror") {
  writeFixture(mode === "tserror");
  process.exit(0);
}
if (mode === "local") {
  const match = prompt.match(/bun (\S+\/cli\/dist\/bin\.js) bootstrap app .*--terreno-path (\S+)/);
  if (!match) {
    console.error("local bootstrap command not found in prompt");
    process.exit(4);
  }
  const run = Bun.spawnSync(
    [
      "bun",
      match[1],
      "bootstrap",
      "app",
      "--name",
      "todo-app",
      "--display-name",
      "Todo App",
      "--terreno-path",
      match[2],
    ],
    {stderr: "inherit", stdout: "inherit"}
  );
  if (run.exitCode === 0) {
    // The real template ships no todo feature; stand in for the builder adding one.
    mkdirSync("backend/src/models", {recursive: true});
    writeFileSync("backend/src/models/todoModel.ts", 'export const todoModelName = "Todo";\n');
    mkdirSync("frontend/app", {recursive: true});
    writeFileSync("frontend/app/todos.tsx", "export const todoScreen = 1;\n");
  }
  process.exit(run.exitCode);
}
console.error(`unknown mode ${mode}`);
process.exit(5);
