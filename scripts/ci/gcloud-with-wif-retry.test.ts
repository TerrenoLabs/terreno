import {afterEach, describe, it} from "bun:test";
import {chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {assert} from "chai";

const retryScript = join(import.meta.dir, "gcloud-with-wif-retry.sh");
const temporaryDirectories: string[] = [];

interface RetryResult {
  exitCode: number;
  invocationCount: number;
  stderr: string;
  stdout: string;
}

const runRetry = async ({
  mode,
}: {
  mode: "recover" | "permission" | "exhaust" | "noisy";
}): Promise<RetryResult> => {
  const directory = mkdtempSync(join(tmpdir(), "gcloud-wif-retry-"));
  temporaryDirectories.push(directory);
  const countFile = join(directory, "count");
  const fakeGcloud = join(directory, "gcloud");
  writeFileSync(
    fakeGcloud,
    `#!/usr/bin/env bash
set -euo pipefail
count=0
if [ -f "$GCLOUD_FAKE_COUNT_FILE" ]; then
  count="$(cat "$GCLOUD_FAKE_COUNT_FILE")"
fi
count=$((count + 1))
echo "$count" >"$GCLOUD_FAKE_COUNT_FILE"

case "$GCLOUD_FAKE_MODE" in
  recover)
    if [ "$count" -lt 3 ]; then
      echo "Unable to retrieve Identity Pool subject token: upstream request timeout" >&2
      exit 1
    fi
    echo "deployed"
    ;;
  permission)
    echo "PERMISSION_DENIED" >&2
    exit 42
    ;;
  exhaust)
    echo "Unable to retrieve Identity Pool subject token: upstream request timeout" >&2
    exit 7
    ;;
  noisy)
    if [ "$count" -lt 2 ]; then
      for index in $(seq 1 4000); do
        echo "Deploying revision progress line $index" >&2
      done
      echo "Unable to retrieve Identity Pool subject token: upstream request timeout" >&2
      exit 1
    fi
    echo '{"status":{"url":"https://example.run.app"}}'
    ;;
esac
`
  );
  chmodSync(fakeGcloud, 0o755);

  const process = Bun.spawn(["bash", retryScript, "run", "deploy", "example-service"], {
    env: {
      ...Bun.env,
      GCLOUD_FAKE_COUNT_FILE: countFile,
      GCLOUD_FAKE_MODE: mode,
      GCLOUD_WIF_RETRY_ATTEMPTS: "3",
      GCLOUD_WIF_RETRY_BASE_SECONDS: "0",
      GCLOUD_WIF_RETRY_REAL: fakeGcloud,
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);

  return {
    exitCode,
    invocationCount: Number(readFileSync(countFile, "utf8")),
    stderr,
    stdout,
  };
};

afterEach((): void => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, {force: true, recursive: true});
  }
});

describe("gcloud WIF retry", (): void => {
  it("retries transient identity-token timeouts until deployment succeeds", async (): Promise<void> => {
    const result = await runRetry({mode: "recover"});

    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.invocationCount, 3);
    assert.equal(result.stdout, "deployed\n");
    assert.include(result.stderr, "Unable to retrieve Identity Pool subject token");
    assert.include(result.stderr, "attempt 2/3");
  });

  it("does not retry deterministic deployment failures", async (): Promise<void> => {
    const result = await runRetry({mode: "permission"});

    assert.equal(result.exitCode, 42);
    assert.equal(result.invocationCount, 1);
    assert.include(result.stderr, "PERMISSION_DENIED");
    assert.notInclude(result.stdout, "PERMISSION_DENIED");
  });

  it("detects a transient timeout buried in high-volume deploy progress output", async (): Promise<void> => {
    const result = await runRetry({mode: "noisy"});

    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.invocationCount, 2);
    assert.equal(result.stdout, '{"status":{"url":"https://example.run.app"}}\n');
    assert.include(result.stderr, "Deploying revision progress line 4000");
  });

  it("fails after the bounded number of transient retries", async (): Promise<void> => {
    const result = await runRetry({mode: "exhaust"});

    assert.equal(result.exitCode, 7);
    assert.equal(result.invocationCount, 3);
    assert.include(result.stderr, "::error::gcloud run deploy exhausted 3 attempts");
  });
});
