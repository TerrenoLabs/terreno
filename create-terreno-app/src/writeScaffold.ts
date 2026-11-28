import {existsSync, mkdirSync, readdirSync, statSync, writeFileSync} from "node:fs";
import {dirname, relative, resolve} from "node:path";

import {type ExpoPlatform, isValidBundleId, parseExpoPlatforms} from "./expoSetup.js";
import {type BootstrapArgs, generateAllFiles} from "./generate.js";

const ALLOWED_EXISTING_ENTRIES = new Set([".git", ".gitignore"]);
const APP_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

export interface WriteScaffoldArgs extends BootstrapArgs {
  /** Directory that will contain `<appName>/`. Defaults to `process.cwd()`. */
  parentDir?: string;
}

export interface WriteScaffoldResult {
  exitCode: number;
  nextSteps: string[];
  success: boolean;
  targetPath: string;
  error?: string;
}

export interface ParsedCliArgs {
  appName?: string;
  bundleId?: string;
  description?: string;
  displayName?: string;
  errors: string[];
  /** Run the Expo setup (sign in, EAS project, build credentials) after writing files. */
  expo: boolean;
  expoAccount?: string;
  expoPlatforms?: ExpoPlatform[];
  mcpServerUrl?: string;
  yes: boolean;
}

export const deriveDisplayName = (appName: string): string => {
  return appName
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
};

export const isValidAppName = (appName: string): boolean => {
  return APP_NAME_PATTERN.test(appName);
};

export const isTargetEmptyEnough = (targetPath: string): boolean => {
  if (!existsSync(targetPath)) {
    return true;
  }

  const stats = statSync(targetPath);
  if (!stats.isDirectory()) {
    return false;
  }

  const entries = readdirSync(targetPath);
  return entries.every((entry: string) => ALLOWED_EXISTING_ENTRIES.has(entry));
};

export const quoteShellArgument = (value: string): string => {
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
};

export const resolveScaffoldTarget = (args: {
  appName: string;
  parentDir?: string;
}): {error?: string; parentDir: string; targetPath: string} => {
  const parentDir = resolve(args.parentDir ?? process.cwd());
  const targetPath = resolve(parentDir, args.appName);
  const relativeTarget = relative(parentDir, targetPath);

  if (!isValidAppName(args.appName)) {
    return {
      error: "appName must be kebab-case (lowercase letters, numbers, and hyphens)",
      parentDir,
      targetPath,
    };
  }

  if (relativeTarget.startsWith("..") || relativeTarget === "..") {
    return {
      error: "appName must not escape the target directory",
      parentDir,
      targetPath,
    };
  }

  return {parentDir, targetPath};
};

export const formatNextSteps = (targetPath: string): string[] => {
  const quotedTargetPath = quoteShellArgument(targetPath);
  return [
    `cd ${quotedTargetPath}/backend && bun install`,
    `cd ${quotedTargetPath}/frontend && bun install`,
    "# Start MongoDB as a replica set (required for sync/realtime)",
    `cd ${quotedTargetPath}/backend && bun run seed`,
    `cd ${quotedTargetPath}/backend && bun run dev`,
    "# In another terminal, with the backend still running:",
    `cd ${quotedTargetPath}/frontend && bun run sdk`,
    `cd ${quotedTargetPath}/frontend && bun run web`,
    "# Open http://localhost:8082 and sign in as test@example.com / testpassword123",
  ];
};

const VALUE_FLAGS = [
  "--bundle-id",
  "--description",
  "--display-name",
  "--expo-account",
  "--expo-platform",
  "--mcp-server-url",
];

export const parseCliArgs = (argv: string[]): ParsedCliArgs => {
  const errors: string[] = [];
  const values = new Map<string, string>();
  let appName: string | undefined;
  let expo = false;
  let yes = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--yes") {
      yes = true;
      continue;
    }

    if (token === "--expo") {
      expo = true;
      continue;
    }

    if (VALUE_FLAGS.includes(token)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        errors.push(`${token} requires a value`);
        continue;
      }
      values.set(token, value);
      index += 1;
      continue;
    }

    if (token.startsWith("-")) {
      errors.push(`Unknown option: ${token}`);
      continue;
    }

    if (appName) {
      errors.push(`Unexpected argument: ${token}`);
      continue;
    }

    appName = token;
  }

  let displayName = values.get("--display-name");
  const bundleId = values.get("--bundle-id");
  const expoAccount = values.get("--expo-account");
  const expoPlatform = values.get("--expo-platform");
  const expoPlatforms = expoPlatform ? parseExpoPlatforms(expoPlatform) : undefined;

  if (!appName) {
    errors.push("Missing required appName argument");
  }

  if (!displayName && yes && appName) {
    displayName = deriveDisplayName(appName);
  }

  if (!displayName) {
    errors.push("Missing required --display-name (or pass --yes to derive it from appName)");
  }

  if (bundleId && !isValidBundleId(bundleId)) {
    errors.push(
      "--bundle-id must be dot-separated letters and digits, each part starting with a letter (com.example.myapp)"
    );
  }

  if (expoPlatform && !expoPlatforms) {
    errors.push("--expo-platform must be ios, android, or all");
  }

  if (!expo && (expoAccount || expoPlatform)) {
    errors.push("--expo-account and --expo-platform require --expo");
  }

  return {
    appName,
    bundleId,
    description: values.get("--description"),
    displayName,
    errors,
    expo,
    expoAccount,
    expoPlatforms,
    mcpServerUrl: values.get("--mcp-server-url"),
    yes,
  };
};

export const writeScaffold = (args: WriteScaffoldArgs): WriteScaffoldResult => {
  const {error: pathError, targetPath} = resolveScaffoldTarget({
    appName: args.appName,
    parentDir: args.parentDir,
  });

  if (pathError) {
    return {
      error: pathError,
      exitCode: 1,
      nextSteps: [],
      success: false,
      targetPath,
    };
  }

  if (!isTargetEmptyEnough(targetPath)) {
    return {
      error: `Target directory is not empty: ${targetPath}`,
      exitCode: 1,
      nextSteps: [],
      success: false,
      targetPath,
    };
  }

  const files = generateAllFiles({
    appDisplayName: args.appDisplayName,
    appName: args.appName,
    bundleId: args.bundleId,
    description: args.description,
    mcpServerUrl: args.mcpServerUrl,
  });

  for (const file of files) {
    const filePath = resolve(targetPath, file.path);
    mkdirSync(dirname(filePath), {recursive: true});
    writeFileSync(filePath, file.content, "utf8");
  }

  return {
    exitCode: 0,
    nextSteps: formatNextSteps(targetPath),
    success: true,
    targetPath,
  };
};
