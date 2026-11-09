/**
 * Apply `.github/code-scanning/dismissals.json` to the repository's code
 * scanning alerts.
 *
 * Usage:
 *   GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/name bun scripts/ci/codeScanning/applyDismissals.ts [--dry-run] [--ledger <path>]
 *
 * Exits 1 when the ledger is invalid or an entry no longer matches its alert
 * (rule or path changed), so a stale ledger is noticed instead of silently
 * dismissing the wrong finding.
 */
import {readFileSync} from "node:fs";

import {type DismissalEntry, type LiveAlert, planDismissals, validateLedger} from "./dismissals";

const DEFAULT_LEDGER = ".github/code-scanning/dismissals.json";

interface Args {
  isDryRun: boolean;
  ledgerPath: string;
}

const parseArgs = (argv: string[]): Args => {
  const ledgerIndex = argv.indexOf("--ledger");
  return {
    isDryRun: argv.includes("--dry-run"),
    ledgerPath: ledgerIndex >= 0 && argv[ledgerIndex + 1] ? argv[ledgerIndex + 1] : DEFAULT_LEDGER,
  };
};

const githubRequest = async ({
  token,
  url,
  method = "GET",
  body,
}: {
  token: string;
  url: string;
  method?: string;
  body?: unknown;
}): Promise<unknown> => {
  const response = await fetch(url, {
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    method,
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`${method} ${url} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
};

const fetchAlerts = async ({
  token,
  repo,
  entries,
}: {
  token: string;
  repo: string;
  entries: DismissalEntry[];
}): Promise<LiveAlert[]> => {
  const alerts: LiveAlert[] = [];
  for (const entry of entries) {
    const alert = await githubRequest({
      token,
      url: `https://api.github.com/repos/${repo}/code-scanning/alerts/${entry.alert}`,
    });
    if (alert) {
      alerts.push(alert as LiveAlert);
    }
  }
  return alerts;
};

const main = async (): Promise<number> => {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const missing: string[] = [];
  if (!token) {
    missing.push("GITHUB_TOKEN");
  }
  if (!repo) {
    missing.push("GITHUB_REPOSITORY");
  }
  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    return 1;
  }

  const {errors, ledger} = validateLedger(JSON.parse(readFileSync(args.ledgerPath, "utf8")));
  if (errors.length > 0) {
    console.error(`Invalid ledger ${args.ledgerPath}:\n${errors.join("\n")}`);
    return 1;
  }

  const alerts = await fetchAlerts({
    entries: ledger.dismissals,
    repo: repo as string,
    token: token as string,
  });
  const plan = planDismissals({alerts, ledger});

  for (const entry of plan.dismiss) {
    console.info(
      `${args.isDryRun ? "Would dismiss" : "Dismissing"} #${entry.alert} ${entry.rule} ${entry.path} (${entry.reason})`
    );
    if (args.isDryRun) {
      continue;
    }
    await githubRequest({
      body: {dismissed_comment: entry.comment, dismissed_reason: entry.reason, state: "dismissed"},
      method: "PATCH",
      token: token as string,
      url: `https://api.github.com/repos/${repo}/code-scanning/alerts/${entry.alert}`,
    });
  }
  console.info(
    `${args.isDryRun ? "Would dismiss" : "Dismissed"} ${plan.dismiss.length}, already closed ${plan.alreadyClosed.length}, missing ${plan.missing.length}, mismatched ${plan.mismatched.length}`
  );
  for (const entry of plan.missing) {
    console.warn(`Alert #${entry.alert} not found; leaving it out`);
  }
  for (const {entry, actualRule, actualPath} of plan.mismatched) {
    console.error(
      `Alert #${entry.alert} is ${actualRule} at ${actualPath}, ledger says ${entry.rule} at ${entry.path}; not dismissed`
    );
  }
  return plan.mismatched.length > 0 ? 1 : 0;
};

if (import.meta.main) {
  process.exit(await main());
}
