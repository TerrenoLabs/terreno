import {afterEach, describe, it} from "bun:test";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {assert} from "chai";
import {NativeModules, Platform, TurboModuleRegistry} from "react-native";

import {type NativeModuleRow, resolveNativeModuleRows} from "./nativeModuleBaseline";

interface ExpoGlobal {
  expo?: {modules?: Record<string, unknown>};
}

const readJson = (path: string): Record<string, Record<string, string>> =>
  JSON.parse(readFileSync(resolve(import.meta.dir, path), "utf8"));

const rowFor = (rows: NativeModuleRow[], packageName: string): NativeModuleRow => {
  const row = rows.find((candidate) => candidate.packageName === packageName);
  if (!row) {
    throw new Error(`${packageName} missing from the baseline`);
  }
  return row;
};

const originalOS = Platform.OS;
const originalTurboGet = TurboModuleRegistry.get;
const nativeModules = NativeModules as Record<string, unknown>;
const expoGlobal = globalThis as ExpoGlobal;
const originalExpo = expoGlobal.expo;

describe("resolveNativeModuleRows", () => {
  afterEach(() => {
    // The react-native mock is shared across the suite, so undo every override.
    (Platform as {OS: string}).OS = originalOS;
    (TurboModuleRegistry as {get: typeof originalTurboGet}).get = originalTurboGet;
    delete nativeModules.RNPurchases;
    expoGlobal.expo = originalExpo;
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

  it("reports config-plugin packages as build config and unlinked native modules as missing", () => {
    for (const row of resolveNativeModuleRows()) {
      if (row.kind === "config-plugin") {
        assert.equal(row.status, "buildOnly");
      } else {
        // The test runtime has no native binary, so nothing reports as linked.
        assert.equal(row.status, "missing", row.packageName);
      }
    }
  });

  it("reports native modules as web on the web platform", () => {
    (Platform as {OS: string}).OS = "web";
    const rows = resolveNativeModuleRows();
    for (const row of rows) {
      assert.equal(row.status, row.kind === "config-plugin" ? "buildOnly" : "web");
    }
  });

  it("reports an Expo module as linked when globalThis.expo.modules registers it", () => {
    expoGlobal.expo = {modules: {ExpoCrypto: {}}};
    const rows = resolveNativeModuleRows();
    assert.equal(rowFor(rows, "expo-crypto").status, "linked");
    assert.equal(rowFor(rows, "expo-device").status, "missing");
  });

  it("reports a React Native module as linked through TurboModuleRegistry or NativeModules", () => {
    (TurboModuleRegistry as {get: (name: string) => unknown}).get = (name: string): unknown =>
      name === "StripeSdk" ? {} : null;
    nativeModules.RNPurchases = {};
    const rows = resolveNativeModuleRows();
    assert.equal(rowFor(rows, "@stripe/stripe-react-native").status, "linked");
    assert.equal(rowFor(rows, "react-native-purchases").status, "linked");
    assert.equal(rowFor(rows, "react-native-purchases-ui").status, "missing");
  });
});
