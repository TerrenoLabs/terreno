import {describe, it} from "bun:test";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {assert} from "chai";
import {isFingerprintSkip} from "./fingerprintRisk.ts";
import {
  isTrustedRollingPr,
  UPDATE_DEPENDENCIES_BRANCH,
  UPDATE_DEPENDENCIES_PR_MARKER,
} from "./updateDependenciesPr.ts";

const ROOT_DIRECTORY = resolve(import.meta.dir, "../..");

const catalogPackageNames = (): string[] => {
  const packageJson = JSON.parse(readFileSync(resolve(ROOT_DIRECTORY, "package.json"), "utf8")) as {
    catalog: Record<string, string>;
  };
  return Object.keys(packageJson.catalog);
};

describe("isFingerprintSkip", (): void => {
  it("skips Expo SDK, React Native core, and native modules", (): void => {
    assert.isTrue(isFingerprintSkip("expo"));
    assert.isTrue(isFingerprintSkip("expo-router"));
    assert.isTrue(isFingerprintSkip("expo-sqlite"));
    assert.isTrue(isFingerprintSkip("react-native"));
    assert.isTrue(isFingerprintSkip("react-native-reanimated"));
    assert.isTrue(isFingerprintSkip("react-native-worklets"));
    assert.isTrue(isFingerprintSkip("@expo/config-plugins"));
    assert.isTrue(isFingerprintSkip("@sentry/react-native"));
    assert.isTrue(isFingerprintSkip("@shopify/flash-list"));
    assert.isTrue(isFingerprintSkip("@shopify/react-native-skia"));
    assert.isTrue(isFingerprintSkip("@stripe/stripe-react-native"));
    assert.isTrue(isFingerprintSkip("react-native-purchases"));
    assert.isTrue(isFingerprintSkip("react-native-purchases-ui"));
    assert.isTrue(isFingerprintSkip("@react-native-async-storage/async-storage"));
    assert.isTrue(isFingerprintSkip("@react-native-community/datetimepicker"));
    assert.isTrue(isFingerprintSkip("@react-native-picker/picker"));
  });

  it("does not skip JavaScript-only packages", (): void => {
    assert.isFalse(isFingerprintSkip("luxon"));
    assert.isFalse(isFingerprintSkip("express"));
    assert.isFalse(isFingerprintSkip("mongoose"));
    assert.isFalse(isFingerprintSkip("react"));
    assert.isFalse(isFingerprintSkip("react-dom"));
    assert.isFalse(isFingerprintSkip("react-native-web"));
    assert.isFalse(isFingerprintSkip("@expo/metro-runtime"));
    assert.isFalse(isFingerprintSkip("@expo/vector-icons"));
    assert.isFalse(isFingerprintSkip("@expo-google-fonts/nunito"));
    assert.isFalse(isFingerprintSkip("babel-preset-expo"));
    assert.isFalse(isFingerprintSkip("@sentry/react"));
    assert.isFalse(isFingerprintSkip("@sentry/bun"));
  });

  it("classifies every root catalog name", (): void => {
    const names = catalogPackageNames();
    assert.isAtLeast(names.length, 1);
    const skipped = names.filter((name) => isFingerprintSkip(name));
    assert.include(skipped, "expo");
    assert.include(skipped, "react-native");
    assert.notInclude(skipped, "luxon");
  });
});

describe("update-dependencies skill", (): void => {
  it("requires an exercise test and a fingerprint freeze", (): void => {
    const skill = readFileSync(
      resolve(ROOT_DIRECTORY, ".rulesync/skills/update-dependencies/SKILL.md"),
      "utf8"
    );
    assert.include(skill, "isFingerprintSkip");
    assert.match(skill, /exercise/i);
    assert.match(skill, /fingerprint/i);
    assert.match(skill, /release/i);
    assert.include(skill, "docs/explanation/dependency-management.md");
  });

  it("reuses one daily rolling PR and keeps a worked/failed ledger", (): void => {
    const skill = readFileSync(
      resolve(ROOT_DIRECTORY, ".rulesync/skills/update-dependencies/SKILL.md"),
      "utf8"
    );
    const rolling = readFileSync(
      resolve(ROOT_DIRECTORY, ".rulesync/skills/update-dependencies/references/rolling-pr.md"),
      "utf8"
    );

    assert.include(skill, UPDATE_DEPENDENCIES_BRANCH);
    assert.include(skill, "Ledger");
    assert.match(skill, /daily/i);
    assert.notInclude(skill, "One bump per PR");
    assert.include(rolling, UPDATE_DEPENDENCIES_BRANCH);
    assert.include(rolling, UPDATE_DEPENDENCIES_PR_MARKER);
    assert.include(rolling, "--head chore/update-dependencies");
    assert.notInclude(rolling, '--head "$OWNER:chore/update-dependencies"');
    assert.match(rolling, /Failed/);
    assert.match(rolling, /Landed/);
  });

  it("trusts only the canonical branch in the base repository", (): void => {
    const repository = {name: "terreno", ownerLogin: "FlourishHealth"};
    const candidate = {
      baseRefName: "master",
      headRefName: UPDATE_DEPENDENCIES_BRANCH,
      headRepositoryName: "terreno",
      headRepositoryOwnerLogin: "FlourishHealth",
      isCrossRepository: false,
    };

    assert.isTrue(isTrustedRollingPr(candidate, repository));
    assert.isFalse(isTrustedRollingPr({...candidate, isCrossRepository: true}, repository));
    assert.isFalse(
      isTrustedRollingPr(
        {...candidate, headRepositoryOwnerLogin: "untrusted-fork-owner"},
        repository
      )
    );
    assert.isFalse(isTrustedRollingPr({...candidate, headRefName: "spoofed-branch"}, repository));
  });

  it("keeps react-native-web eligible for root Dependabot security updates", (): void => {
    const dependabot = readFileSync(resolve(ROOT_DIRECTORY, ".github/dependabot.yml"), "utf8");
    const rootUpdates = dependabot.slice(
      dependabot.indexOf("# Root package.json"),
      dependabot.indexOf("# Backend packages")
    );

    assert.notInclude(rootUpdates, 'dependency-name: "react-native-*"');
    assert.notInclude(rootUpdates, 'dependency-name: "react-native-web"');
    for (const packageName of catalogPackageNames().filter(
      (name) => name.startsWith("react-native-") && isFingerprintSkip(name)
    )) {
      assert.include(rootUpdates, `dependency-name: "${packageName}"`);
    }
  });
});
