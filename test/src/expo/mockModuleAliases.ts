import {mock} from "bun:test";
import {existsSync, readdirSync, statSync} from "node:fs";
import {isAbsolute, join, relative, resolve, sep} from "node:path";

import type {ModuleExports} from "./mockHelpers";

/**
 * Path aliases the app resolves, e.g. `{"@hooks": "./hooks", "@store": "./store/index.ts"}`
 * (the `paths` in `tsconfig.json`, without the `/*`). A value may name a directory or a file.
 */
export type ModuleAliasMap = Record<string, string>;

/** Options for `createModuleAliasMocker`. */
export interface ModuleAliasMockerOptions {
  /** Alias to directory-or-file map. Relative targets resolve against `rootDir`. */
  aliases: ModuleAliasMap;
  /** Extensions tried when resolving an alias path, in order. Default `.ts`, `.tsx`, `.js`, `.jsx`. */
  extensions?: readonly string[];
  /** Files skipped when a whole directory is mocked. Default: tests, `.d.ts`, and `.web.*` variants. */
  ignore?: RegExp;
  /** Directory relative alias targets resolve against. Default `process.cwd()`. */
  rootDir?: string;
}

/** Options for one `mockModule` call. */
export interface MockAliasedModuleOptions {
  /** Allow override names the real module(s) do not export. Default `false` (throws on a typo). */
  allowNewExports?: boolean;
}

/** The mocker `createModuleAliasMocker` returns. */
export interface ModuleAliasMocker {
  /** Every specifier Bun may key `file`'s module cache on: alias forms plus both path forms. */
  getCacheKeys: (file: string) => string[];
  /** The module files an alias specifier covers (one file, or every file under a directory). */
  getModuleFiles: (specifier: string) => string[];
  /** Real exports of a module file or alias specifier, captured once before any mock applied. */
  getRealExports: (specifierOrFile: string) => ModuleExports;
  /**
   * Mocks `specifier` starting from its real exports, replacing only the names in `overrides`.
   * A directory alias (`"@hooks"`) re-registers every file under it; each override applies to
   * whichever files export that name. Registers under every cache key, so imports through the
   * alias, a relative path, or the absolute path all see the mock.
   */
  mockModule: (
    specifier: string,
    overrides: ModuleExports,
    options?: MockAliasedModuleOptions
  ) => void;
  /** Re-registers the real exports for `specifier`, or for every file mocked so far. */
  restore: (specifier?: string) => void;
}

const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"] as const;

const DEFAULT_IGNORE = /(?:\.test\.|\.spec\.|\.d\.ts$|\.web\.[jt]sx?$|(?:^|[\\/])__tests__[\\/])/u;

/** Real exports keyed by absolute file path, shared across mockers so a snapshot is taken once. */
const realExportsByFile = new Map<string, ModuleExports>();

const toPosix = (path: string): string => path.split(sep).join("/");

const isDirectory = (path: string): boolean => existsSync(path) && statSync(path).isDirectory();

const isFile = (path: string): boolean => existsSync(path) && statSync(path).isFile();

/**
 * Builds a mocker for an app's path aliases. Bun keys its module cache on the specifier it
 * resolved, so `@hooks/useProfile`, `../hooks/useProfile`, and `/abs/hooks/useProfile.ts` can be
 * separate entries. The mocker registers one factory under all of them, built from the module's
 * real exports, so a test overrides a single hook without stubbing the rest of the module.
 *
 * Like any `mock.module` call, a mock stays registered for the rest of the Bun process. Call
 * `mockModule` from `beforeEach` and `restore()` from `afterEach` / `afterAll`.
 */
export const createModuleAliasMocker = ({
  aliases,
  extensions = DEFAULT_EXTENSIONS,
  ignore = DEFAULT_IGNORE,
  rootDir = process.cwd(),
}: ModuleAliasMockerOptions): ModuleAliasMocker => {
  const aliasTargets = Object.entries(aliases)
    .map(([alias, target]): [string, string] => [
      alias.replace(/\/$/u, ""),
      isAbsolute(target) ? target : resolve(rootDir, target),
    ])
    // Longest alias first so `@store/sdk` wins over `@store` when both are declared.
    .sort(([a], [b]) => b.length - a.length);
  const mockedFiles = new Set<string>();

  const resolveFile = (basePath: string): string | undefined => {
    if (isFile(basePath)) {
      return basePath;
    }
    for (const extension of extensions) {
      if (isFile(`${basePath}${extension}`)) {
        return `${basePath}${extension}`;
      }
    }
    if (!isDirectory(basePath)) {
      return undefined;
    }
    for (const extension of extensions) {
      const indexFile = join(basePath, `index${extension}`);
      if (isFile(indexFile)) {
        return indexFile;
      }
    }
    return undefined;
  };

  const isModuleFile = (file: string): boolean =>
    extensions.some((extension) => file.endsWith(extension)) && !ignore.test(file);

  const listModuleFiles = (directory: string): string[] => {
    const files: string[] = [];
    for (const entry of readdirSync(directory).sort()) {
      if (entry.startsWith(".") || entry === "node_modules") {
        continue;
      }
      const path = join(directory, entry);
      if (isDirectory(path)) {
        files.push(...listModuleFiles(path));
      } else if (isModuleFile(path)) {
        files.push(path);
      }
    }
    return files;
  };

  /** Absolute path an alias specifier points at (file or directory), or undefined. */
  const resolveAliasPath = (specifier: string): string | undefined => {
    for (const [alias, target] of aliasTargets) {
      if (specifier === alias) {
        return target;
      }
      if (specifier.startsWith(`${alias}/`)) {
        return join(target, specifier.slice(alias.length + 1));
      }
    }
    return undefined;
  };

  const getModuleFiles = (specifier: string): string[] => {
    const aliasPath =
      resolveAliasPath(specifier) ?? (isAbsolute(specifier) ? specifier : undefined);
    if (!aliasPath) {
      throw new Error(
        `mockModuleAliases: "${specifier}" matches no alias in ${JSON.stringify(aliases)}`
      );
    }
    // An exact directory alias covers every file below it, even when the directory has an index.
    if (isDirectory(aliasPath) && (specifier in aliases || !resolveFile(aliasPath))) {
      return listModuleFiles(aliasPath);
    }
    const file = resolveFile(aliasPath);
    if (!file) {
      throw new Error(
        `mockModuleAliases: "${specifier}" resolves to ${aliasPath}, which does not exist`
      );
    }
    return [file];
  };

  const getRealExports = (specifierOrFile: string): ModuleExports => {
    const files = isFile(specifierOrFile) ? [specifierOrFile] : getModuleFiles(specifierOrFile);
    const merged: ModuleExports = {};
    for (const file of files) {
      let real = realExportsByFile.get(file);
      if (!real) {
        real = {...(require(file) as ModuleExports)};
        realExportsByFile.set(file, real);
      }
      Object.assign(merged, real);
    }
    return merged;
  };

  const getCacheKeys = (file: string): string[] => {
    const withoutExtension = file.replace(/\.[cm]?[jt]sx?$/u, "");
    const keys = new Set<string>([file, withoutExtension]);
    for (const [alias, target] of aliasTargets) {
      if (target === file) {
        keys.add(alias);
        continue;
      }
      const relativePath = toPosix(relative(target, withoutExtension));
      if (relativePath.startsWith("..") || isAbsolute(relativePath) || !isDirectory(target)) {
        continue;
      }
      keys.add(`${alias}/${relativePath}`);
      if (relativePath === "index") {
        keys.add(alias);
      } else if (relativePath.endsWith("/index")) {
        keys.add(`${alias}/${relativePath.slice(0, -"/index".length)}`);
      }
    }
    return [...keys];
  };

  const registerFile = (file: string, exports: ModuleExports): void => {
    const factory = (): ModuleExports => exports;
    for (const key of getCacheKeys(file)) {
      mock.module(key, factory);
    }
  };

  const mockModule = (
    specifier: string,
    overrides: ModuleExports,
    {allowNewExports = false}: MockAliasedModuleOptions = {}
  ): void => {
    const files = getModuleFiles(specifier);
    const realByFile = files.map((file) => getRealExports(file));
    const unmatched = new Set(Object.keys(overrides));
    for (const real of realByFile) {
      for (const name of Object.keys(overrides)) {
        if (name in real) {
          unmatched.delete(name);
        }
      }
    }
    if (unmatched.size > 0 && !allowNewExports) {
      throw new Error(
        `mockModuleAliases: ${[...unmatched].map((name) => `"${name}"`).join(", ")} ` +
          `is not exported by "${specifier}". Check for a typo or a renamed export, or pass {allowNewExports: true}.`
      );
    }
    files.forEach((file, index) => {
      const real = realByFile[index] as ModuleExports;
      const applied: ModuleExports = {...real};
      for (const [name, value] of Object.entries(overrides)) {
        // New names go on the first file so a single-file alias can still add exports.
        if (name in real || (unmatched.has(name) && index === 0)) {
          applied[name] = value;
        }
      }
      registerFile(file, applied);
      mockedFiles.add(file);
    });
  };

  const restore = (specifier?: string): void => {
    const files = specifier ? getModuleFiles(specifier) : [...mockedFiles];
    for (const file of files) {
      registerFile(file, getRealExports(file));
      mockedFiles.delete(file);
    }
  };

  return {getCacheKeys, getModuleFiles, getRealExports, mockModule, restore};
};
