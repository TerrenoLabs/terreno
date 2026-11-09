/**
 * Classifies a changed file for the e2e affected gate.
 *
 * `inert` files can never change what the Playwright suite exercises.
 * `source` files are decided by the import graph. `manifest` files are decided
 * by lockfile resolution. Everything else is `global`: the gate runs every
 * shard, because guessing wrong would hide a real failure.
 */
export type ChangeScope = "global" | "inert" | "manifest" | "source";

const SOURCE_EXTENSION = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

/** Paths that are never part of the running app, backend, or test suite. */
const INERT_PATTERNS: RegExp[] = [
  /^docs\//,
  /^website\//,
  /^demo\//,
  /^skills\//,
  /^plugins\//,
  /^changelog\//,
  /^terraform\//,
  /^infra\//,
  /^create-terreno-app\//,
  /^\.maestro\//,
  /^\.github\//,
  /^\.(agents|claude|codex|cursor|cursor-plugin|claude-plugin|devin|rulesync|vscode|idea)\//,
  /^\.(gitignore|gitattributes|editorconfig|npmrc|nvmrc|prettierrc.*)$/,
  /^(AGENTS|CLAUDE|CLAUDE-consumer|CLAUDE\.local|README|ROADMAP|CHANGELOG|CONTRIBUTING|SECURITY|CODE_OF_CONDUCT|LICENSE|NOTICE)(\.md)?$/,
  /\.(md|mdc|mdx)$/,
  /(^|\/)LICENSE$/,
  /(^|\/)biome\.jsonc?$/,
  /^biome\//,
  /^knip\.jsonc$/,
  /^codecov\.yml$/,
  /^\.dependency-cruiser/,
  /^rulesync\.jsonc$/,
  /^skills(-lock|\.sh)\.json$/,
  /(^|\/)[^/]+\.test\.(ts|tsx|js|jsx)$/,
  /(^|\/)__mocks__\//,
  /(^|\/)__snapshots__\//,
  /\.snap$/,
  /\.(png|jpe?g|gif|webp|mp4|pdf|ttf|otf|woff2?|ico)$/,
];

/** Scripts are build/CI tooling, except this gate, which must test itself. */
const INERT_SCRIPTS = /^scripts\//;
export const GATE_DIRECTORY = /^scripts\/ci\/e2eAffected\//;

/** Directories whose modules the import graph can resolve. */
const SOURCE_PATTERNS: RegExp[] = [
  /^[^/]+\/src\//,
  /^example-frontend\/(app|components|constants|hooks|lib|store|types|utils|e2e)\//,
  /^admin-spa\/(app|components|store)\//,
];

const MANIFEST_PATTERNS: RegExp[] = [/^bun\.lock$/, /(^|\/)package\.json$/];

export const classifyChangedFile = ({path}: {path: string}): ChangeScope => {
  if (GATE_DIRECTORY.test(path)) {
    return "global";
  }
  if (INERT_SCRIPTS.test(path) || INERT_PATTERNS.some((pattern) => pattern.test(path))) {
    return "inert";
  }
  if (MANIFEST_PATTERNS.some((pattern) => pattern.test(path))) {
    return "manifest";
  }
  if (SOURCE_PATTERNS.some((pattern) => pattern.test(path)) && SOURCE_EXTENSION.test(path)) {
    return "source";
  }
  return "global";
};
