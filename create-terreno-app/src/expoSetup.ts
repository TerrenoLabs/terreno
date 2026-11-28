import {spawnSync} from "node:child_process";
import {existsSync} from "node:fs";
import {join} from "node:path";

const EXPO_PLATFORMS = ["android", "ios"] as const;
const BUNDLE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)+$/;
const EAS_COMMAND = "bunx";
const EAS_PACKAGE = "eas-cli";
const CREDENTIALS_PROFILE = "production";

export type ExpoPlatform = (typeof EXPO_PLATFORMS)[number];

export interface ExpoCommand {
  args: string[];
  command: string;
  cwd: string;
  /** Hand the terminal to the command so it can prompt and print progress. */
  inheritStdio: boolean;
}

export interface ExpoCommandResult {
  exitCode: number;
  stdout: string;
}

export type ExpoCommandRunner = (command: ExpoCommand) => ExpoCommandResult;

export interface ExpoStepResult {
  /** Command to run by hand when the step was skipped or failed. */
  command?: string;
  detail: string;
  name: string;
  status: "done" | "failed" | "skipped";
}

export interface SetupExpoArgs {
  /** Expo account that owns the EAS project. Defaults to the signed-in account. */
  account?: string;
  frontendPath: string;
  /** True when `EXPO_TOKEN` authenticates eas-cli. Defaults to the environment. */
  hasToken?: boolean;
  /** True when the commands may prompt. Defaults to whether stdin and stdout are terminals. */
  isInteractive?: boolean;
  platforms?: ExpoPlatform[];
  run?: ExpoCommandRunner;
  write?: (line: string) => void;
}

export interface SetupExpoResult {
  steps: ExpoStepResult[];
  /** False when dependencies, sign-in, or the EAS project could not be set up. */
  success: boolean;
}

/**
 * A bundle id is used as both the iOS bundle identifier and the Android package, so it is
 * limited to what both stores accept: dot-separated segments of letters and digits.
 */
export const isValidBundleId = (bundleId: string): boolean => {
  return BUNDLE_ID_PATTERN.test(bundleId);
};

export const parseExpoPlatforms = (value: string): ExpoPlatform[] | undefined => {
  if (value === "all") {
    return [...EXPO_PLATFORMS];
  }
  const platform = EXPO_PLATFORMS.find((candidate) => candidate === value);
  return platform ? [platform] : undefined;
};

const runExpoCommand: ExpoCommandRunner = (command) => {
  const result = spawnSync(command.command, command.args, {
    cwd: command.cwd,
    encoding: "utf8",
    stdio: command.inheritStdio ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  return {exitCode: result.status ?? 1, stdout: result.stdout ?? ""};
};

const formatCommand = (frontendPath: string, args: string[]): string => {
  return `cd ${frontendPath} && ${[EAS_COMMAND, EAS_PACKAGE, ...args].join(" ")}`;
};

/**
 * Connects a freshly scaffolded frontend to Expo Application Services with eas-cli: installs
 * dependencies so eas-cli can read the app config, signs in, creates (or links) the EAS project
 * and writes its id into `app.json`, then sets up build credentials for each platform.
 *
 * Sign-in and credentials need a terminal. Without one, sign-in requires `EXPO_TOKEN` and the
 * credentials steps are reported as skipped with the command to run later.
 */
export const setupExpo = (args: SetupExpoArgs): SetupExpoResult => {
  const {account, frontendPath} = args;
  const run = args.run ?? runExpoCommand;
  const write = args.write ?? ((): void => {});
  const hasToken = args.hasToken ?? Boolean(process.env.EXPO_TOKEN);
  const isInteractive = args.isInteractive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const platforms = args.platforms ?? [...EXPO_PLATFORMS];
  const steps: ExpoStepResult[] = [];

  const eas = (easArgs: string[], inheritStdio: boolean): ExpoCommandResult => {
    return run({
      args: [EAS_PACKAGE, ...easArgs],
      command: EAS_COMMAND,
      cwd: frontendPath,
      inheritStdio,
    });
  };
  const fail = (step: Omit<ExpoStepResult, "status">): SetupExpoResult => {
    steps.push({...step, status: "failed"});
    return {steps, success: false};
  };

  if (existsSync(join(frontendPath, "node_modules", "expo"))) {
    steps.push({detail: "already installed", name: "dependencies", status: "skipped"});
  } else {
    write("Installing frontend dependencies...");
    const install = run({
      args: ["install"],
      command: "bun",
      cwd: frontendPath,
      inheritStdio: true,
    });
    if (install.exitCode !== 0) {
      return fail({
        command: `cd ${frontendPath} && bun install`,
        detail: "bun install failed",
        name: "dependencies",
      });
    }
    steps.push({detail: "installed", name: "dependencies", status: "done"});
  }

  if (hasToken) {
    steps.push({detail: "authenticated with EXPO_TOKEN", name: "login", status: "done"});
  } else {
    const whoami = eas(["whoami"], false);
    const username = whoami.stdout.trim().split("\n")[0];
    if (whoami.exitCode === 0) {
      steps.push({detail: `signed in as ${username}`, name: "login", status: "done"});
    } else if (!isInteractive) {
      return fail({
        command: formatCommand(frontendPath, ["login"]),
        detail: "not signed in to Expo; set EXPO_TOKEN or sign in from a terminal",
        name: "login",
      });
    } else {
      write("Signing in to Expo...");
      if (eas(["login"], true).exitCode !== 0) {
        return fail({
          command: formatCommand(frontendPath, ["login"]),
          detail: "eas login failed",
          name: "login",
        });
      }
      steps.push({detail: "signed in", name: "login", status: "done"});
    }
  }

  const initArgs = [
    "init",
    ...(account ? ["--account", account] : []),
    ...(isInteractive ? [] : ["--non-interactive", "--force"]),
  ];
  write("Creating the EAS project...");
  if (eas(initArgs, true).exitCode !== 0) {
    return fail({
      command: formatCommand(frontendPath, initArgs),
      detail: "eas init failed",
      name: "project",
    });
  }
  steps.push({detail: "EAS project linked in app.json", name: "project", status: "done"});

  for (const platform of platforms) {
    const credentialsArgs = [
      "credentials:configure-build",
      "--platform",
      platform,
      "--profile",
      CREDENTIALS_PROFILE,
    ];
    const step = {
      command: formatCommand(frontendPath, credentialsArgs),
      name: `credentials:${platform}`,
    };
    if (!isInteractive) {
      steps.push({...step, detail: "needs a terminal", status: "skipped"});
      continue;
    }
    write(`Setting up ${platform} build credentials...`);
    if (eas(credentialsArgs, true).exitCode !== 0) {
      steps.push({...step, detail: "eas credentials did not finish", status: "failed"});
      continue;
    }
    steps.push({detail: "configured", name: step.name, status: "done"});
  }

  return {steps, success: true};
};

export const formatExpoSteps = (steps: ExpoStepResult[]): string[] => {
  return steps.map((step) => {
    const line = `  ${step.name}: ${step.status} (${step.detail})`;
    if (step.status === "done" || !step.command) {
      return line;
    }
    return `${line}\n    run: ${step.command}`;
  });
};
