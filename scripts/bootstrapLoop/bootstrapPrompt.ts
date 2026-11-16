import {spawnSync} from "node:child_process";
import {existsSync, mkdirSync, mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";

export const NAIVE_PROMPT = "make me a todo app";
export const MIN_VERSION = "58.0.0";
export const LOCAL_VERSION = "local";
export const DEFAULT_APP_NAME = "todo-app";
export const DEFAULT_APP_DISPLAY_NAME = "Todo App";

export const CHECKOUT_ROOT = resolve(import.meta.dir, "..", "..");

interface BootstrapModule {
  handleBootstrapPromptRequest: (
    name: string,
    args: Record<string, string>
  ) => {messages: Array<{content: {text: string}}>};
}

export interface RenderBootstrapPromptOptions {
  version: string;
  appName?: string;
  appDisplayName?: string;
  /** Checkout used for `local`; defaults to this repository. */
  checkout?: string;
}

const parseVersion = (version: string): number[] | undefined => {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
};

export const assertSupportedVersion = (version: string): void => {
  if (version === LOCAL_VERSION) {
    return;
  }
  const parsed = parseVersion(version);
  const floor = parseVersion(MIN_VERSION) as number[];
  if (!parsed) {
    throw new Error(`version ${version} is not a stable x.y.z release or "local"`);
  }
  const isBelow =
    parsed[0] < floor[0] ||
    (parsed[0] === floor[0] &&
      (parsed[1] < floor[1] || (parsed[1] === floor[1] && parsed[2] < floor[2])));
  if (isBelow) {
    throw new Error(`version below ${MIN_VERSION} not supported`);
  }
};

/** Installs `@terreno/mcp@<version>` into a temp dir and returns its bootstrap module path. */
const installPublishedBootstrap = (version: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `bootstrap-loop-mcp-${version}-`));
  mkdirSync(dir, {recursive: true});
  writeFileSync(join(dir, "package.json"), JSON.stringify({name: "prompt-render", private: true}));
  const install = spawnSync("bun", ["add", "--no-save", `@terreno/mcp@${version}`], {
    cwd: dir,
    encoding: "utf8",
    timeout: 60_000,
  });
  if (install.status !== 0) {
    throw new Error(
      `could not install @terreno/mcp@${version}: ${install.stderr || install.stdout}`
    );
  }
  return join(dir, "node_modules", "@terreno", "mcp", "dist", "bootstrap.js");
};

const loadBootstrapModule = async (modulePath: string): Promise<BootstrapModule> => {
  if (!existsSync(modulePath)) {
    throw new Error(`bootstrap module not found at ${modulePath}`);
  }
  return (await import(pathToFileURL(modulePath).href)) as BootstrapModule;
};

const scaffoldLine = (appName: string, appDisplayName: string): RegExp =>
  new RegExp(
    `bunx create-terreno-app ${appName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} --display-name "${appDisplayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`
  );

/**
 * Renders the `terreno_bootstrap` prompt of one version. For `local` the scaffold command is
 * rewritten to this checkout's CLI so the builder scaffolds HEAD, not the published template.
 */
export const renderBootstrapPrompt = async ({
  version,
  appName = DEFAULT_APP_NAME,
  appDisplayName = DEFAULT_APP_DISPLAY_NAME,
  checkout = CHECKOUT_ROOT,
}: RenderBootstrapPromptOptions): Promise<string> => {
  assertSupportedVersion(version);
  const isLocal = version === LOCAL_VERSION;
  const modulePath = isLocal
    ? join(checkout, "mcp-server", "dist", "bootstrap.js")
    : installPublishedBootstrap(version);
  const bootstrap = await loadBootstrapModule(modulePath);
  const text = bootstrap.handleBootstrapPromptRequest("terreno_bootstrap", {
    appDisplayName,
    appName,
  }).messages[0].content.text;
  const line = scaffoldLine(appName, appDisplayName);

  if (isLocal) {
    const cli = join(checkout, "cli", "dist", "bin.js");
    const command = `bun ${cli} bootstrap app --name ${appName} --display-name "${appDisplayName}" --terreno-path ${checkout}`;
    return `${text.replace(line, command)}\n\nRun this in the current directory: \`backend/\` and \`frontend/\` belong directly in it.`;
  }
  const pinned = `bunx create-terreno-app@${version} ${appName} --display-name "${appDisplayName}"`;
  return `${text.replace(line, pinned)}\n\nThe CLI creates \`./${appName}/\`. After it finishes, move its contents (including dotfiles) up into the current directory so \`backend/\` and \`frontend/\` sit directly in it, then delete the empty \`./${appName}/\`.`;
};
