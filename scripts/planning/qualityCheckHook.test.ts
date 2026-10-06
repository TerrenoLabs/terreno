import {describe, it} from "bun:test";
import {spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {assert} from "chai";

interface HookResult {
  status: number | null;
  stderr: string;
  stdout: string;
}

const repositoryRoot = join(import.meta.dir, "../..");
const qualityCheckScript = join(repositoryRoot, ".rulesync/hooks/quality-check.sh");
const hookHosts = [
  "antigravity-cli",
  "claudecode",
  "codexcli",
  "copilot",
  "copilotcli",
  "cursor",
  "devin",
] as const;

const writeMarker = (path: string): void => {
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, "{}\n");
};

const runHook = ({
  analysisStatus = 0,
  depsRoot,
  hookHost,
  hookInput = "{}",
  installStatus = 0,
  lintStatus,
  typecheckStatus,
}: {
  analysisStatus?: number;
  depsRoot?: string;
  hookHost: (typeof hookHosts)[number];
  hookInput?: string;
  installStatus?: number;
  lintStatus: number;
  typecheckStatus: number;
}): HookResult => {
  const command = `
bun() {
  if [[ "$*" == "install --frozen-lockfile" ]]; then
    echo "install output" >&2
    return "$INSTALL_STATUS"
  fi
  if [[ "$*" == "run lint" ]]; then
    echo "lint output" >&2
    return "$LINT_STATUS"
  fi
  if [[ "$*" == "run compile" ]]; then
    echo "typecheck output" >&2
    return "$TYPECHECK_STATUS"
  fi
  if [[ "$*" == "run analyze:full" ]]; then
    echo "analysis output" >&2
    return "$ANALYSIS_STATUS"
  fi
  return 99
}
export -f bun
exec "$QUALITY_CHECK_SCRIPT" "$HOOK_HOST"
`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ANALYSIS_STATUS: String(analysisStatus),
    HOOK_HOST: hookHost,
    INSTALL_STATUS: String(installStatus),
    LINT_STATUS: String(lintStatus),
    QUALITY_CHECK_SCRIPT: qualityCheckScript,
    TYPECHECK_STATUS: String(typecheckStatus),
  };
  if (depsRoot) {
    env.QUALITY_CHECK_DEPS_ROOT = depsRoot;
  } else {
    delete env.QUALITY_CHECK_DEPS_ROOT;
  }
  const result = spawnSync("bash", ["-c", command], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env,
    input: hookInput,
  });

  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
};

describe("quality-check hook", (): void => {
  it("returns valid allow JSON after both checks pass", (): void => {
    for (const hookHost of hookHosts) {
      const result = runHook({hookHost, lintStatus: 0, typecheckStatus: 0});

      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), {});
      assert.include(result.stderr, "lint output");
      assert.include(result.stderr, "typecheck output");
      assert.include(result.stderr, "analysis output");
      assert.notInclude(result.stderr, "installing workspace dependencies");
    }
  });

  it("installs when TypeScript is present but a workspace package is not linked", (): void => {
    const depsRoot = mkdtempSync(join(tmpdir(), "quality-check-deps-"));
    try {
      writeMarker(join(depsRoot, "node_modules/typescript/package.json"));
      const result = runHook({
        depsRoot,
        hookHost: "cursor",
        lintStatus: 0,
        typecheckStatus: 0,
      });

      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), {});
      assert.include(result.stderr, "installing workspace dependencies");
      assert.include(result.stderr, "install output");
      assert.include(result.stderr, "typecheck output");
    } finally {
      rmSync(depsRoot, {recursive: true});
    }
  });

  it("installs when TypeScript is missing", (): void => {
    const depsRoot = mkdtempSync(join(tmpdir(), "quality-check-deps-"));
    try {
      const result = runHook({
        depsRoot,
        hookHost: "cursor",
        lintStatus: 0,
        typecheckStatus: 0,
      });

      assert.equal(result.status, 0, result.stderr);
      assert.include(result.stderr, "installing workspace dependencies");
      assert.include(result.stderr, "install output");
    } finally {
      rmSync(depsRoot, {recursive: true});
    }
  });

  it("blocks when install fails because a workspace package is not linked", (): void => {
    const depsRoot = mkdtempSync(join(tmpdir(), "quality-check-deps-"));
    try {
      writeMarker(join(depsRoot, "node_modules/typescript/package.json"));
      const result = runHook({
        depsRoot,
        hookHost: "cursor",
        installStatus: 1,
        lintStatus: 0,
        typecheckStatus: 0,
      });

      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), {
        followup_message:
          "Quality checks failed because workspace dependencies are not installed. Run bun install --frozen-lockfile from the repo root, then retry.",
      });
      assert.notInclude(result.stderr, "typecheck output");
    } finally {
      rmSync(depsRoot, {recursive: true});
    }
  });

  it("returns a Cursor follow-up when either check fails", (): void => {
    const result = runHook({
      analysisStatus: 11,
      hookHost: "cursor",
      lintStatus: 7,
      typecheckStatus: 9,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      followup_message:
        "Quality checks failed (lint=7, typecheck=9, analysis=11). Fix the reported errors before stopping.",
    });
    assert.include(result.stderr, "Quality checks failed: lint=7 typecheck=9 analysis=11");
  });

  it("returns a blocking decision for structured non-Cursor hosts", (): void => {
    for (const hookHost of hookHosts.filter((host) => host !== "cursor")) {
      const result = runHook({
        analysisStatus: 11,
        hookHost,
        lintStatus: 7,
        typecheckStatus: 9,
      });

      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), {
        decision: "block",
        reason:
          "Quality checks failed (lint=7, typecheck=9, analysis=11). Fix the reported errors before stopping.",
      });
    }
  });

  it("allows a structured-host retry to stop without rerunning checks", (): void => {
    const result = runHook({
      hookHost: "claudecode",
      hookInput: '{"stop_hook_active": true}',
      lintStatus: 99,
      typecheckStatus: 99,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {});
    assert.equal(result.stderr, "");
  });
});
