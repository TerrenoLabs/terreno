import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";

import {stageChecks} from "./checks";

let appDir = "";

const write = (relative: string, content: string): void => {
  mkdirSync(dirname(join(appDir, relative)), {recursive: true});
  writeFileSync(join(appDir, relative), content);
};

/** Results of a stage's checks, minus the slow tsc runs which agentStages.test.ts covers. */
const fileChecks = (stage: string): Record<string, string> =>
  Object.fromEntries(
    stageChecks[stage](appDir)
      .filter((check) => !check.name.endsWith("-typecheck"))
      .map((check) => [check.name, check.status])
  );

beforeEach(() => {
  appDir = mkdtempSync(join(tmpdir(), "bootstrap-checks-"));
});

afterEach(() => {
  rmSync(appDir, {force: true, recursive: true});
});

describe("stageChecks", () => {
  it("fails every source check on an empty app and passes once the files exist", () => {
    for (const stage of ["auth", "admin", "features", "roles", "consent", "ai", "ci"]) {
      expect(Object.values(fileChecks(stage))).toContain("FAIL");
    }
    write("backend/src/app.ts", "BetterAuthApp AdminApp dueDate seedDefaults addGptRoutes");
    write("backend/.env.example", "BETTER_AUTH_SECRET=changeme\n");
    write("backend/package.json", JSON.stringify({scripts: {seed: "bun run seed.ts"}}));
    write("frontend/app/consent.tsx", "export const ConsentScreen = 1;");
    write(".mcp.json", "{}");
    for (const stage of ["auth", "admin", "features", "roles", "consent", "ai"]) {
      expect(Object.values(fileChecks(stage))).not.toContain("FAIL");
    }
  });

  it("requires both CI hosts", () => {
    write(".github/workflows/ci.yml", "name: ci\n");
    expect(fileChecks("ci")).toEqual({"circleci-config": "FAIL", "github-workflow": "PASS"});
    write(".circleci/config.yml", "version: 2.1\n");
    expect(fileChecks("ci")).toEqual({"circleci-config": "PASS", "github-workflow": "PASS"});
  });

  it("needs a seed script, not just an AdminApp", () => {
    write("backend/src/app.ts", "new AdminApp()");
    expect(fileChecks("admin")).toEqual({"admin-app": "PASS", "seed-script": "FAIL"});
  });

  it("counts only unchecked items in CHECKLIST.md", () => {
    write("CHECKLIST.md", "- [x] a\n- [ ] b\n- [ ] c\n- [ ] d\n- [ ] e\n");
    expect(stageChecks.checklist(appDir)[0].status).toBe("FAIL");
    write("CHECKLIST.md", "- [ ] a\n- [ ] b\n* [ ] c\n- [ ] d\n- [ ] e\n");
    expect(stageChecks.checklist(appDir)[0].status).toBe("PASS");
  });

  it("validates the deploy URL", () => {
    expect(stageChecks.deploy(appDir)[0].ev).toBe("deploy.json missing");
    write("deploy.json", "{not json");
    expect(stageChecks.deploy(appDir)[0].ev).toBe("deploy.json is not valid JSON");
    write("deploy.json", JSON.stringify({url: "todo"}));
    expect(stageChecks.deploy(appDir)[0].status).toBe("FAIL");
    write("deploy.json", JSON.stringify({url: "https://todo.example.app"}));
    expect(stageChecks.deploy(appDir)[0].status).toBe("PASS");
  });

  it("detects a theme file that changed since the scaffold baseline", () => {
    const git = (...args: string[]): void => {
      Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], {cwd: appDir});
    };
    write("frontend/constants/theme.ts", "export const theme = 1;\n");
    git("init", "-q");
    git("add", "-A");
    git("commit", "-q", "-m", "baseline");
    const themeCheck = (): string | undefined =>
      stageChecks.theming(appDir).find((check) => check.name === "theme-changed")?.status;
    expect(themeCheck()).toBe("FAIL");
    write("frontend/constants/theme.ts", "export const theme = 2;\n");
    expect(themeCheck()).toBe("PASS");
  });
});
