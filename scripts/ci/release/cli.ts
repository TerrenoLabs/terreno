#!/usr/bin/env bun
/**
 * Release automation entry points shared by CircleCI and GitHub Actions.
 *
 * Usage:
 *   bun run scripts/ci/release/cli.ts plan-merge <head-ref> <files-file> <changelog-file>
 *   bun run scripts/ci/release/cli.ts check-tag <version> <on-master: true|false>
 *   bun run scripts/ci/release/cli.ts notes <version> [previous-version]
 *
 * Policy: docs/how-to/release-automation.md
 */
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

import {loadUnreleasedFragments} from "../../changelog/io";
import {checkReleaseTag, planBotMerge, renderReleaseNotes} from "./lib";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const readChangelog = (): string => readFileSync(join(REPO_ROOT, "CHANGELOG.md"), "utf8");

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const main = (): void => {
  const [command, ...args] = process.argv.slice(2);

  if (command === "plan-merge") {
    // The pull request's own CHANGELOG.md is passed in: bot-merge runs this script
    // from master so a pull request cannot rewrite its own eligibility check.
    const [headRef, filesFile, changelogFile] = args;
    if (!headRef || !filesFile || !changelogFile) {
      fail("plan-merge: provide <head-ref> <files-file> <changelog-file>");
    }
    const files = readFileSync(filesFile, "utf8").split("\n").filter(Boolean);
    const plan = planBotMerge({
      changelog: readFileSync(changelogFile, "utf8"),
      files,
      headRef,
    });
    // GitHub Actions reads this JSON from stdout; the reason goes to the job log.
    console.info(JSON.stringify(plan));
    return;
  }

  if (command === "check-tag") {
    const [version, onMaster] = args;
    if (!version || !onMaster) {
      fail("check-tag: provide <version> <on-master>");
    }
    const result = checkReleaseTag({
      changelog: readChangelog(),
      isOnMaster: onMaster === "true",
      unreleasedFragmentCount: loadUnreleasedFragments(REPO_ROOT).fragments.length,
      version,
    });
    if (!result.isValid) {
      fail(`check-tag: release ${version} is not ready:\n  ${result.failures.join("\n  ")}`);
    }
    console.info(`check-tag: OK — ${version} is on master with its release notes`);
    return;
  }

  if (command === "notes") {
    const [version, previousVersion] = args;
    if (!version) {
      fail("notes: provide <version>");
    }
    process.stdout.write(
      renderReleaseNotes({
        changelog: readChangelog(),
        previousVersion,
        repository: process.env.GITHUB_REPOSITORY ?? "TerrenoLabs/terreno",
        version,
      })
    );
    return;
  }

  fail(`Unknown command: ${command ?? "(none)"}`);
};

main();
