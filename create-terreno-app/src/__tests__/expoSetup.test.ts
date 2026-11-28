import {describe, expect, test} from "bun:test";
import {mkdirSync, mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {
  type ExpoCommand,
  type ExpoCommandRunner,
  formatExpoSteps,
  isValidBundleId,
  parseExpoPlatforms,
  setupExpo,
} from "../expoSetup.js";

interface FakeRunner {
  calls: string[];
  run: ExpoCommandRunner;
}

/** Records each command as one string and fails the commands whose text matches `failing`. */
const createRunner = (failing: string[] = []): FakeRunner => {
  const calls: string[] = [];
  const run = (command: ExpoCommand): {exitCode: number; stdout: string} => {
    const text = [command.command, ...command.args].join(" ");
    calls.push(text);
    const isFailing = failing.some((fragment) => text.includes(fragment));
    return {exitCode: isFailing ? 1 : 0, stdout: text.endsWith("whoami") ? "josh\n" : ""};
  };
  return {calls, run};
};

const withFrontend = (installed: boolean, body: (frontendPath: string) => void): void => {
  const frontendPath = mkdtempSync(join(tmpdir(), "create-terreno-app-expo-"));
  try {
    if (installed) {
      mkdirSync(join(frontendPath, "node_modules", "expo"), {recursive: true});
    }
    body(frontendPath);
  } finally {
    rmSync(frontendPath, {force: true, recursive: true});
  }
};

describe("setupExpo", () => {
  test("installs, reuses the signed-in account, creates the project, and sets up credentials", () => {
    withFrontend(false, (frontendPath) => {
      const runner = createRunner();
      const result = setupExpo({
        frontendPath,
        hasToken: false,
        isInteractive: true,
        run: runner.run,
      });

      expect(result.success).toBe(true);
      expect(runner.calls).toEqual([
        "bun install",
        "bunx eas-cli whoami",
        "bunx eas-cli init",
        "bunx eas-cli credentials:configure-build --platform android --profile production",
        "bunx eas-cli credentials:configure-build --platform ios --profile production",
      ]);
      expect(result.steps.map((step) => step.status)).toEqual([
        "done",
        "done",
        "done",
        "done",
        "done",
      ]);
      expect(result.steps[1]?.detail).toBe("signed in as josh");
    });
  });

  test("signs in from a terminal when nobody is signed in", () => {
    withFrontend(true, (frontendPath) => {
      const runner = createRunner(["whoami"]);
      const result = setupExpo({
        frontendPath,
        hasToken: false,
        isInteractive: true,
        platforms: [],
        run: runner.run,
      });

      expect(result.success).toBe(true);
      expect(runner.calls).toEqual([
        "bunx eas-cli whoami",
        "bunx eas-cli login",
        "bunx eas-cli init",
      ]);
      expect(result.steps[0]).toMatchObject({name: "dependencies", status: "skipped"});
    });
  });

  test("stops before creating a project when sign-in fails", () => {
    withFrontend(true, (frontendPath) => {
      const runner = createRunner(["whoami", "login"]);
      const result = setupExpo({
        frontendPath,
        hasToken: false,
        isInteractive: true,
        run: runner.run,
      });

      expect(result.success).toBe(false);
      expect(runner.calls).not.toContain("bunx eas-cli init");
      expect(result.steps.at(-1)).toMatchObject({name: "login", status: "failed"});
    });
  });

  test("without a terminal it needs EXPO_TOKEN and never prompts", () => {
    withFrontend(true, (frontendPath) => {
      const runner = createRunner(["whoami"]);
      const result = setupExpo({
        frontendPath,
        hasToken: false,
        isInteractive: false,
        run: runner.run,
      });

      expect(result.success).toBe(false);
      expect(runner.calls).toEqual(["bunx eas-cli whoami"]);
      expect(result.steps.at(-1)?.detail).toContain("EXPO_TOKEN");
    });
  });

  test("with EXPO_TOKEN and no terminal it creates the project and skips credentials", () => {
    withFrontend(true, (frontendPath) => {
      const runner = createRunner();
      const result = setupExpo({
        account: "acme",
        frontendPath,
        hasToken: true,
        isInteractive: false,
        platforms: ["ios"],
        run: runner.run,
      });

      expect(result.success).toBe(true);
      expect(runner.calls).toEqual(["bunx eas-cli init --account acme --non-interactive --force"]);
      expect(result.steps.at(-1)).toMatchObject({
        name: "credentials:ios",
        status: "skipped",
      });
      expect(result.steps.at(-1)?.command).toContain(
        "bunx eas-cli credentials:configure-build --platform ios --profile production"
      );
    });
  });

  test("stops when dependencies or the project cannot be set up", () => {
    withFrontend(false, (frontendPath) => {
      const runner = createRunner(["bun install"]);
      const result = setupExpo({frontendPath, hasToken: true, run: runner.run});
      expect(result.success).toBe(false);
      expect(runner.calls).toEqual(["bun install"]);
    });
    withFrontend(true, (frontendPath) => {
      const runner = createRunner(["init"]);
      const result = setupExpo({
        frontendPath,
        hasToken: true,
        isInteractive: true,
        run: runner.run,
      });
      expect(result.success).toBe(false);
      expect(result.steps.at(-1)).toMatchObject({name: "project", status: "failed"});
    });
  });

  test("a credentials failure is reported without failing the setup", () => {
    withFrontend(true, (frontendPath) => {
      const runner = createRunner(["--platform ios"]);
      const lines: string[] = [];
      const result = setupExpo({
        frontendPath,
        hasToken: true,
        isInteractive: true,
        run: runner.run,
        write: (line) => lines.push(line),
      });

      expect(result.success).toBe(true);
      expect(result.steps.at(-1)).toMatchObject({name: "credentials:ios", status: "failed"});
      expect(lines).toContain("Setting up android build credentials...");
      const summary = formatExpoSteps(result.steps).join("\n");
      expect(summary).toContain("credentials:android: done (configured)");
      expect(summary).toContain("run: cd ");
    });
  });
});

describe("isValidBundleId", () => {
  test("accepts ids valid on both iOS and Android", () => {
    expect(isValidBundleId("com.example.myApp2")).toBe(true);
    expect(isValidBundleId("myapp")).toBe(false);
    expect(isValidBundleId("com.example.my-app")).toBe(false);
    expect(isValidBundleId("com.example.my_app")).toBe(false);
    expect(isValidBundleId("com.2example.app")).toBe(false);
  });
});

describe("parseExpoPlatforms", () => {
  test("maps all, one platform, and rejects anything else", () => {
    expect(parseExpoPlatforms("all")).toEqual(["android", "ios"]);
    expect(parseExpoPlatforms("ios")).toEqual(["ios"]);
    expect(parseExpoPlatforms("windows")).toBeUndefined();
  });
});
