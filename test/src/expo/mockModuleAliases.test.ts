import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {createModuleAliasMocker, type ModuleAliasMocker} from "./mockModuleAliases";

const root = mkdtempSync(join(tmpdir(), "terreno-alias-"));

const writeModule = (path: string, source: string): string => {
  const file = join(root, path);
  mkdirSync(join(file, ".."), {recursive: true});
  writeFileSync(file, source);
  return file;
};

const useAFile = writeModule(
  "hooks/useA.ts",
  'export const useA = (): string => "realA";\nexport const shared = "fromA";\n'
);
const useBFile = writeModule(
  "hooks/nested/useB.ts",
  'export const useB = (): string => "realB";\nexport const shared = "fromB";\n'
);
writeModule("hooks/nested/index.ts", 'export const nestedIndex = "index";\n');
writeModule("hooks/useA.test.ts", "export const ignored = true;\n");
writeModule("hooks/useA.web.ts", 'export const useA = (): string => "web";\n');
const storeFile = writeModule("store/index.ts", 'export const storeName = "real-store";\n');
const consumerFile = writeModule(
  "consumer.ts",
  'import {useA} from "./hooks/useA";\nimport {useB} from "./hooks/nested/useB";\nexport const read = (): string => useA() + "-" + useB();\n'
);

interface Consumer {
  read: () => string;
}

describe("createModuleAliasMocker", () => {
  let mocker: ModuleAliasMocker;
  let consumer: Consumer;

  beforeAll(async () => {
    mocker = createModuleAliasMocker({
      aliases: {"@hooks/": "hooks", "@store": "store/index.ts"},
      rootDir: root,
    });
    consumer = (await import(consumerFile)) as Consumer;
  });

  afterEach(() => {
    mocker.restore();
  });

  afterAll(() => {
    rmSync(root, {force: true, recursive: true});
  });

  it("lists every module file under a directory alias, skipping tests and web variants", () => {
    expect(mocker.getModuleFiles("@hooks").map((file) => file.slice(root.length))).toEqual([
      "/hooks/nested/index.ts",
      "/hooks/nested/useB.ts",
      "/hooks/useA.ts",
    ]);
    expect(mocker.getModuleFiles("@hooks/useA")).toEqual([useAFile]);
    expect(mocker.getModuleFiles("@hooks/nested")).toEqual([join(root, "hooks/nested/index.ts")]);
    expect(mocker.getModuleFiles(useBFile)).toEqual([useBFile]);
  });

  it("returns every cache key Bun may use for a file", () => {
    expect(mocker.getCacheKeys(useAFile)).toEqual([
      useAFile,
      useAFile.replace(/\.ts$/u, ""),
      "@hooks/useA",
    ]);
    expect(mocker.getCacheKeys(join(root, "hooks/nested/index.ts"))).toContain("@hooks/nested");
    expect(mocker.getCacheKeys(storeFile)).toContain("@store");
  });

  it("overrides one export and keeps the rest real, for relative and alias imports", async () => {
    mocker.mockModule("@hooks", {useA: (): string => "mockA"});
    expect(consumer.read()).toBe("mockA-realB");
    const viaAlias = (await import("@hooks/useA")) as {shared: string; useA: () => string};
    expect(viaAlias.useA()).toBe("mockA");
    expect(viaAlias.shared).toBe("fromA");
  });

  it("applies a name exported by several files to each of them", async () => {
    mocker.mockModule("@hooks", {shared: "mocked"});
    expect(((await import(useAFile)) as {shared: string}).shared).toBe("mocked");
    expect(((await import(useBFile)) as {shared: string}).shared).toBe("mocked");
  });

  it("restores the real exports", () => {
    mocker.mockModule("@hooks/useA", {useA: (): string => "mockA"});
    expect(consumer.read()).toBe("mockA-realB");
    mocker.restore("@hooks/useA");
    expect(consumer.read()).toBe("realA-realB");
  });

  it("throws on an override the real module does not export", () => {
    expect(() => mocker.mockModule("@hooks/useA", {useTypo: (): null => null})).toThrow(
      /"useTypo"/u
    );
  });

  it("adds new exports when allowed", async () => {
    mocker.mockModule("@store", {extra: 1, storeName: "mock-store"}, {allowNewExports: true});
    const store = (await import("@store")) as {extra: number; storeName: string};
    expect(store).toMatchObject({extra: 1, storeName: "mock-store"});
    expect(mocker.getRealExports("@store")).toEqual({storeName: "real-store"});
  });

  it("rejects specifiers outside the alias map or pointing at missing files", () => {
    expect(() => mocker.getModuleFiles("@unknown/thing")).toThrow(/matches no alias/u);
    expect(() => mocker.getModuleFiles("@hooks/missing")).toThrow(/does not exist/u);
  });
});
