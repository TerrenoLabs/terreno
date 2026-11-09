/**
 * Real-process smoke for @terreno/blocks. Run `bun e2e/smoke.ts` after `bun run compile`.
 *
 * Finds the compiled `terreno-blocks` binary through the installed package's `bin` field, the
 * way a consumer's package manager links it, and runs `validate` on two documents written to a
 * temp dir: a valid one must exit 0 with no output, and an invalid one must exit non-zero and
 * name the failing path and error code. Exits non-zero on the first failed check.
 */
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {runBin} from "@terreno/test";

const BIN_NAME = "terreno-blocks";

const VALID_DOCUMENT = `v: 1
blocks:
  - type: text
    markdown: Signups grew 12% this month.
  - type: actions
    id: followups
    elements:
      - type: button
        id: weekly
        text: Show weekly
        action:
          kind: reply
          text: Show weekly signups
`;

// The text block has no `markdown`, so validation must report MISSING_REQUIRED at that path.
const INVALID_DOCUMENT = `v: 1
blocks:
  - type: text
`;
const EXPECTED_ERROR_PATH = "blocks[0].markdown";
const EXPECTED_ERROR_CODE = "MISSING_REQUIRED";

/** Resolves the installed package by name, then follows its `bin` field to the compiled CLI. */
const resolveBlocksBin = (): string => {
  const packageDir = dirname(dirname(require.resolve("@terreno/blocks")));
  const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
    bin?: Record<string, string>;
  };
  const relativeBin = manifest.bin?.[BIN_NAME];
  if (!relativeBin) {
    throw new Error(`@terreno/blocks package.json has no "${BIN_NAME}" bin`);
  }
  return join(packageDir, relativeBin);
};

const run = async (): Promise<void> => {
  const startedAt = performance.now();
  const bin = resolveBlocksBin();
  const workDir = mkdtempSync(join(tmpdir(), "blocks-smoke-"));

  try {
    const validPath = join(workDir, "valid.yaml");
    writeFileSync(validPath, VALID_DOCUMENT);
    const valid = await runBin({args: ["validate", validPath], bin});
    if (valid.exitCode !== 0 || valid.stdout !== "" || valid.stderr !== "") {
      throw new Error(
        `${BIN_NAME} validate (valid): expected exit 0 with no output, got exit ${valid.exitCode}\nstdout: ${valid.stdout}\nstderr: ${valid.stderr}`
      );
    }
    console.info(`✅ ${BIN_NAME} validate accepts a valid document with exit 0`);

    const invalidPath = join(workDir, "invalid.yaml");
    writeFileSync(invalidPath, INVALID_DOCUMENT);
    const invalid = await runBin({args: ["validate", invalidPath], bin});
    const isErrorReported =
      invalid.stdout.includes(EXPECTED_ERROR_PATH) && invalid.stdout.includes(EXPECTED_ERROR_CODE);
    if (invalid.exitCode === 0 || !isErrorReported) {
      throw new Error(
        `${BIN_NAME} validate (invalid): expected a non-zero exit naming ${EXPECTED_ERROR_PATH} ${EXPECTED_ERROR_CODE}, got exit ${invalid.exitCode}\nstdout: ${invalid.stdout}\nstderr: ${invalid.stderr}`
      );
    }
    console.info(
      `✅ ${BIN_NAME} validate rejects an invalid document with exit ${invalid.exitCode} and ${EXPECTED_ERROR_CODE}`
    );
  } finally {
    rmSync(workDir, {force: true, recursive: true});
  }

  console.info(`blocks smoke passed in ${Math.round(performance.now() - startedAt)} ms`);
};

run().then(
  () => {
    process.exit(0);
  },
  (error: unknown) => {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
);
