import {describe, it} from "bun:test";
import {existsSync, readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {assert} from "chai";

const repoRoot = join(import.meta.dir, "../..");
const DEP_TYPES = ["dependencies", "devDependencies", "peerDependencies"] as const;

interface PackageManifest {
  name: string;
  [key: string]: unknown;
}

const listedPackages = (): string[] => {
  const script = readFileSync(join(repoRoot, "scripts/ci/docker-compile-and-export.sh"), "utf8");
  return [...script.matchAll(/^ {2}(@terreno\/[a-z-]+)(?: \\)?$/gm)].map((match) => match[1]);
};

const workspaceManifests = (): Map<string, PackageManifest> => {
  const manifests = new Map<string, PackageManifest>();
  for (const dir of readdirSync(repoRoot)) {
    const manifestPath = join(repoRoot, dir, "package.json");
    if (!existsSync(manifestPath)) {
      continue;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
    manifests.set(manifest.name, manifest);
  }
  return manifests;
};

describe("docker-compile-and-export.sh package list", () => {
  it("lists every @terreno/* dependency of the packages it compiles", () => {
    const listed = listedPackages();
    const manifests = workspaceManifests();
    assert.isAbove(listed.length, 0);
    const missing: string[] = [];
    for (const name of listed) {
      const manifest = manifests.get(name);
      assert.isDefined(manifest, `${name} is not a workspace package`);
      for (const type of DEP_TYPES) {
        const deps = (manifest?.[type] ?? {}) as Record<string, string>;
        for (const dep of Object.keys(deps)) {
          if (dep.startsWith("@terreno/") && manifests.has(dep) && !listed.includes(dep)) {
            missing.push(`${name} -> ${dep}`);
          }
        }
      }
    }
    assert.deepEqual(missing, []);
  });
});
