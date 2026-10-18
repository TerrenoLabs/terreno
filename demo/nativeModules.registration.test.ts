import {describe, it} from "bun:test";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {assert} from "chai";

import {findDemoConfig, ListedDemoConfig} from "./demoConfig";
import {resolveNativeModuleRows} from "./nativeModuleBaseline";

const readJson = (path: string): Record<string, Record<string, string>> =>
  JSON.parse(readFileSync(resolve(import.meta.dir, path), "utf8"));

describe("native modules diagnostics story", () => {
  it("is reachable by name but hidden from the catalog lists", () => {
    const config = findDemoConfig("Native Modules");
    assert.equal(config?.name, "Native Modules");
    assert.isTrue(config?.hidden);
    assert.isFalse(ListedDemoConfig.some((listed) => listed.name === "Native Modules"));
  });

  it("lists every baseline package from the root catalog and both app manifests", () => {
    const catalog = readJson("../package.json").catalog;
    const demoDependencies = readJson("./package.json").dependencies;
    const exampleDependencies = readJson("../example-frontend/package.json").dependencies;
    const rows = resolveNativeModuleRows();
    assert.lengthOf(rows, 8);
    for (const {packageName, version} of rows) {
      assert.isString(catalog[packageName], `${packageName} missing from the root catalog`);
      assert.equal(demoDependencies[packageName], "catalog:", `${packageName} missing from demo`);
      assert.equal(
        exampleDependencies[packageName],
        "catalog:",
        `${packageName} missing from example-frontend`
      );
      assert.match(version, /^\d+\.\d+\.\d+/);
    }
  });

  it("reports config-plugin packages as build config and native modules by link state", () => {
    for (const row of resolveNativeModuleRows()) {
      if (row.kind === "config-plugin") {
        assert.equal(row.status, "buildOnly");
      } else {
        // The test runtime has no native binary, so nothing reports as linked.
        assert.oneOf(row.status, ["missing", "web"]);
      }
    }
  });
});
