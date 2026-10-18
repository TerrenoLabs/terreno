#!/usr/bin/env bun
import {readFileSync, unlinkSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

import {DateTime} from "luxon";

import {writeWhatsNewFile} from "../whats-new/io";
import {loadUnreleasedFragments, UNRELEASED_DIR_NAME} from "./io";
import {assembleChangelog} from "./lib";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

const getVersion = (): string => {
  const versionArgument = process.argv[2];

  if (!versionArgument) {
    console.error(
      "changelog:assemble: provide a version, for example bun run changelog:assemble 57.1.0"
    );
    process.exit(1);
  }

  return versionArgument;
};

const main = (): void => {
  const version = getVersion();
  const changelogPath = join(REPO_ROOT, "CHANGELOG.md");
  const {failures, fragments} = loadUnreleasedFragments(REPO_ROOT);

  if (failures.length > 0) {
    console.error(`changelog:assemble: found ${failures.length} invalid fragment(s):\n`);
    for (const failure of failures) {
      console.error(`  ${failure.fileName}: ${failure.message}`);
    }
    process.exit(1);
  }

  const date = DateTime.now().toISODate();
  if (!date) {
    console.error("changelog:assemble: Luxon could not produce today's ISO date");
    process.exit(1);
  }

  const assembled = assembleChangelog({
    changelog: readFileSync(changelogPath, "utf8"),
    date,
    fragments,
    version,
  });

  writeFileSync(changelogPath, assembled);
  const whatsNewPath = writeWhatsNewFile(REPO_ROOT);

  for (const fragment of fragments) {
    unlinkSync(join(REPO_ROOT, UNRELEASED_DIR_NAME, fragment.fileName));
  }

  console.info(
    `changelog:assemble: wrote ${version} (${fragments.length} fragment(s)) and removed the assembled files`
  );
  console.info(`changelog:assemble: refreshed what's new data at ${whatsNewPath}`);
};

main();
