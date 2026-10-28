/**
 * Real-process smoke for @terreno/cli. Run `bun e2e/smoke.ts` after `bun run compile`.
 *
 * Runs the compiled `terreno` binary (the `bin` entry in package.json) as a child process from a
 * temp directory: `--version` prints the package version, `--version --json` prints the name and
 * version as JSON, and the offline `generate model` subcommand writes a Mongoose model file that
 * parses as TypeScript and exports the model. Exits non-zero on the first failed check.
 *
 * The CLI imports `@terreno/mcp`, which reads its bundled markdown when first loaded. Only the
 * mcp-server `build` script copies that markdown into `dist/docs`; `bun run compile` does not.
 * When `dist/docs` is missing, the smoke points `TERRENO_MCP_DOCS_DIR` at the source copy.
 */
import {existsSync, readFileSync} from "node:fs";
import {mkdtemp, readFile, realpath, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {type RunBinResult, runBin} from "@terreno/test";

const PACKAGE_DIR = join(import.meta.dir, "..");
const MCP_DIR = join(PACKAGE_DIR, "..", "mcp-server");
const MODEL_NAME = "SmokeWidget";

interface CliPackageJson {
  bin: {terreno: string};
  name: string;
  version: string;
}

interface VersionJson {
  name?: string;
  version?: string;
}

interface WriteJson {
  ok?: boolean;
  path?: string;
}

const pkg = JSON.parse(readFileSync(join(PACKAGE_DIR, "package.json"), "utf8")) as CliPackageJson;
const BIN = join(PACKAGE_DIR, pkg.bin.terreno);

const mcpDocsEnv = (): Record<string, string> => {
  if (existsSync(join(MCP_DIR, "dist", "docs"))) {
    return {};
  }
  return {TERRENO_MCP_DOCS_DIR: join(MCP_DIR, "src", "docs")};
};

const terreno = async ({args, cwd}: {args: string[]; cwd: string}): Promise<RunBinResult> => {
  const result = await runBin({args, bin: BIN, cwd, env: mcpDocsEnv()});
  if (result.exitCode !== 0) {
    throw new Error(
      `terreno ${args.join(" ")} exited ${result.exitCode}\n${result.stdout}${result.stderr}`
    );
  }
  return result;
};

const checkVersion = async (cwd: string): Promise<void> => {
  // runBin runs scripts through Bun, so the shebang an installed `terreno` relies on is checked here.
  const shebang = readFileSync(BIN, "utf8").split("\n", 1)[0];
  if (shebang !== "#!/usr/bin/env bun") {
    throw new Error(`${pkg.bin.terreno} starts with "${shebang}", expected a Bun shebang`);
  }

  const plain = await terreno({args: ["--version"], cwd});
  if (plain.stdout.trim() !== pkg.version) {
    throw new Error(`terreno --version printed "${plain.stdout.trim()}", expected ${pkg.version}`);
  }
  console.info(`✅ terreno --version prints ${pkg.version}`);

  const json = JSON.parse(
    (await terreno({args: ["--version", "--json"], cwd})).stdout
  ) as VersionJson;
  if (json.name !== pkg.name || json.version !== pkg.version) {
    throw new Error(`terreno --version --json printed ${JSON.stringify(json)}`);
  }
  console.info(`✅ terreno --version --json prints ${pkg.name} ${pkg.version}`);
};

const checkGenerateModel = async (cwd: string): Promise<void> => {
  const outPath = join(cwd, "models", "smokeWidget.ts");
  const result = await terreno({
    args: [
      "generate",
      "model",
      "--name",
      MODEL_NAME,
      "--field",
      "title:String:required",
      "--out",
      "models/smokeWidget.ts",
      "--json",
    ],
    cwd,
  });
  const written = JSON.parse(result.stdout) as WriteJson;
  if (written.ok !== true || written.path !== outPath) {
    throw new Error(`generate model printed ${result.stdout.trim()}, expected path ${outPath}`);
  }

  const source = await readFile(outPath, "utf8");
  const {exports} = new Bun.Transpiler({loader: "ts"}).scan(source);
  if (!exports.includes(MODEL_NAME)) {
    throw new Error(`generated model exports [${exports.join(", ")}], expected ${MODEL_NAME}`);
  }
  if (!/title:\s*\{\s*type:\s*String,\s*required:\s*true/.test(source)) {
    throw new Error(`generated model has no required String title field:\n${source}`);
  }
  console.info(`✅ terreno generate model writes ${MODEL_NAME} with a required title field`);
};

const run = async (): Promise<void> => {
  const startedAt = performance.now();
  // The CLI reports paths from its resolved cwd; macOS tmpdir() goes through a symlink.
  const cwd = await realpath(await mkdtemp(join(tmpdir(), "terreno-cli-smoke-")));
  try {
    await checkVersion(cwd);
    await checkGenerateModel(cwd);
  } finally {
    await rm(cwd, {force: true, recursive: true});
  }
  console.info(`cli smoke passed in ${Math.round(performance.now() - startedAt)} ms`);
};

run().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
);
