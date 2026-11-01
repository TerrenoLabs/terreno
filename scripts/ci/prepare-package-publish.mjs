import {copyFileSync, readFileSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";

const [packageDirectory, version, dependencyMode = "release"] = process.argv.slice(2);
if (!packageDirectory || !version) {
  throw new Error(
    "Usage: prepare-package-publish.mjs <package-directory> <version> [release|manual]"
  );
}

const rootPackage = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
const packagePath = resolve(packageDirectory, "package.json");
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
packageJson.version = version;

let latestApiVersion;
if (dependencyMode === "manual") {
  const response = await fetch("https://registry.npmjs.org/@terreno%2fapi/latest");
  if (!response.ok) {
    throw new Error(`Could not resolve latest @terreno/api: ${response.status}`);
  }
  latestApiVersion = (await response.json()).version;
}

for (const dependencyType of ["dependencies", "devDependencies", "peerDependencies"]) {
  const dependencies = packageJson[dependencyType];
  if (!dependencies) {
    continue;
  }
  for (const [name, value] of Object.entries(dependencies)) {
    if (value === "catalog:") {
      const catalogVersion = rootPackage.catalog?.[name];
      if (!catalogVersion) {
        throw new Error(`Catalog entry not found for ${name}`);
      }
      dependencies[name] = catalogVersion;
      continue;
    }
    if (value !== "workspace:*") {
      continue;
    }
    if (dependencyMode === "manual" && name === "@terreno/api") {
      dependencies[name] = `^${latestApiVersion}`;
    } else if (name.startsWith("@terreno/") || name === "create-terreno-app") {
      dependencies[name] = version;
    }
  }
}

writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

// The changelog lives at the repository root; ship the tagged copy in every tarball
// so consumers read the release notes for the exact version they installed.
copyFileSync(resolve("CHANGELOG.md"), resolve(packageDirectory, "CHANGELOG.md"));
