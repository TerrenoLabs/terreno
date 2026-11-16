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
 */
import {mkdirSync, writeFileSync} from "node:fs";
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
  process.exit(run.exitCode);
}
console.error(`unknown mode ${mode}`);
process.exit(5);
