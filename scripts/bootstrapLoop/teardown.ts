import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";

export interface DeployRecord {
  branch?: string;
  database?: string;
  deployId?: string;
  keep?: boolean;
  repo?: string;
  url?: string;
}

export interface TeardownRunOptions {
  runDir: string;
  /** Shell command run once per resource with the resource name as `$1`. */
  command?: string;
  env?: Record<string, string | undefined>;
}

/** Real teardown: delete the Vercel deploy, drop the database, delete the CI branch. */
const DEFAULT_COMMAND = [
  'case "$1" in',
  '  deploy) vercel remove "$BOOTSTRAP_LOOP_DEPLOY_ID" --yes --token "$VERCEL_TOKEN" ;;',
  '  database) mongosh "$BOOTSTRAP_LOOP_MONGO_URI" --quiet --eval "db.getSiblingDB(process.env.BOOTSTRAP_LOOP_DATABASE).dropDatabase()" ;;',
  '  branch) GH_TOKEN="$BOOTSTRAP_LOOP_GH_TOKEN" gh api -X DELETE "repos/$BOOTSTRAP_LOOP_REPO/git/refs/heads/$BOOTSTRAP_LOOP_BRANCH" ;;',
  "esac",
].join("\n");

/** The deploy stage records `deploy.json` in the app dir; the run dir is also accepted. */
export const readDeployRecord = (runDir: string): DeployRecord => {
  for (const path of [join(runDir, "app", "deploy.json"), join(runDir, "deploy.json")]) {
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf8")) as DeployRecord;
    }
  }
  throw new Error(`no deploy.json in ${runDir} or ${join(runDir, "app")}`);
};

/** Deletes the run's deploy, database and CI branch; returns what it removed as `kind:name`. */
export const teardownRun = async ({
  runDir,
  command,
  env = process.env,
}: TeardownRunOptions): Promise<{removed: string[]}> => {
  const record = readDeployRecord(runDir);
  const resources: [string, string | undefined][] = [
    ["deploy", record.deployId],
    ["database", record.database],
    ["branch", record.branch],
  ];
  const childEnv = {
    ...env,
    BOOTSTRAP_LOOP_BRANCH: record.branch ?? "",
    BOOTSTRAP_LOOP_DATABASE: record.database ?? "",
    BOOTSTRAP_LOOP_DEPLOY_ID: record.deployId ?? "",
    BOOTSTRAP_LOOP_REPO: record.repo ?? env.BOOTSTRAP_LOOP_REPO ?? "",
  };
  const removed: string[] = [];
  for (const [kind, name] of resources) {
    if (!name) {
      continue;
    }
    const script = command ? `${command} "$1"` : DEFAULT_COMMAND;
    const proc = Bun.spawn(["sh", "-c", script, "teardown", kind], {
      env: childEnv as Record<string, string>,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    if (code !== 0) {
      throw new Error(`teardown of ${kind} ${name} failed (${code}): ${stderr.trim()}`);
    }
    removed.push(`${kind}:${name}`);
  }
  return {removed};
};
