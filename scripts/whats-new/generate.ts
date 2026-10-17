#!/usr/bin/env bun
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

import {isWhatsNewFileCurrent, writeWhatsNewFile} from "./io";
import {WHATS_NEW_OUTPUT_PATH} from "./lib";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

const main = (): void => {
  if (process.argv.includes("--check")) {
    if (!isWhatsNewFileCurrent(REPO_ROOT)) {
      console.error(
        `check-whats-new: ${WHATS_NEW_OUTPUT_PATH} does not match CHANGELOG.md. Run bun run whats-new:generate and commit the result.`
      );
      process.exit(1);
    }
    console.info(`check-whats-new: OK — ${WHATS_NEW_OUTPUT_PATH} matches CHANGELOG.md`);
    return;
  }

  const outputPath = writeWhatsNewFile(REPO_ROOT);
  console.info(`whats-new:generate: wrote ${outputPath}`);
};

main();
