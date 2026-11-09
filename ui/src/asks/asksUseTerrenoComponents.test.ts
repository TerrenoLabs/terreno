import {describe, it} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {assert} from "chai";

const RAW_PRIMITIVES = [
  "Pressable",
  "ScrollView",
  "Text",
  "TextInput",
  "TouchableHighlight",
  "TouchableOpacity",
  "View",
];

const REACT_NATIVE_IMPORT = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']react-native["']/g;

const sourceFiles = (): string[] =>
  readdirSync(import.meta.dir).filter(
    (name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)
  );

const rawPrimitiveImports = (source: string): string[] =>
  [...source.matchAll(REACT_NATIVE_IMPORT)]
    .filter(([, typeOnly]) => !typeOnly)
    .flatMap(([, , names]) =>
      (names ?? "")
        .split(",")
        .map((name) => name.trim())
        .filter((name) => !/^type\s/.test(name))
        .map((name) => name.split(/\s+as\s+/)[0])
        .filter((name) => RAW_PRIMITIVES.includes(name ?? ""))
    );

describe("ui/src/asks", () => {
  it("renders with @terreno/ui components, never raw React Native primitives", () => {
    const files = sourceFiles();
    assert.isAbove(files.length, 0);
    const offenders = files.flatMap((name) =>
      rawPrimitiveImports(readFileSync(join(import.meta.dir, name), "utf8")).map(
        (primitive) => `${name}: ${primitive}`
      )
    );
    assert.deepEqual(offenders, []);
  });

  it("detects a raw primitive import", () => {
    assert.deepEqual(rawPrimitiveImports('import {Platform, View} from "react-native";'), ["View"]);
    assert.deepEqual(rawPrimitiveImports('import {Text as RNText} from "react-native";'), ["Text"]);
    assert.deepEqual(rawPrimitiveImports('import type {View} from "react-native";'), []);
    assert.deepEqual(rawPrimitiveImports('import {type View, Text} from "react-native";'), [
      "Text",
    ]);
  });
});
