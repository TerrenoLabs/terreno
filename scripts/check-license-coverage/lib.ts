import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";

/** Published npm packages — keep in sync with `.github/workflows/publish-on-tag.yml`. */
export const PUBLISHED_PACKAGES = [
  "api",
  "test",
  "ui",
  "rtk",
  "admin-backend",
  "admin-frontend",
  "admin-spa",
  "ai",
  "announcements",
  "api-health",
  "blocks",
  "comms",
  "create-terreno-app",
  "feature-flags",
  "jobs",
  "mcp-server",
  "cli",
] as const;

export type PublishedPackage = (typeof PUBLISHED_PACKAGES)[number];

interface PackageJson {
  files?: string[];
  license?: string;
}

export interface LicenseCheckFailure {
  packageDir: PublishedPackage;
  message: string;
}

const readPackageJson = (repoRoot: string, packageDir: PublishedPackage): PackageJson => {
  const packageJsonPath = join(repoRoot, packageDir, "package.json");
  return JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJson;
};

const readRootLicense = (repoRoot: string): string | undefined => {
  const rootPackageJsonPath = join(repoRoot, "package.json");
  if (!existsSync(rootPackageJsonPath)) {
    return undefined;
  }

  const rootPackageJson = JSON.parse(readFileSync(rootPackageJsonPath, "utf8")) as PackageJson;
  return rootPackageJson.license;
};

export const checkLicenseCoverage = ({
  repoRoot,
  publishedPackages = PUBLISHED_PACKAGES,
}: {
  repoRoot: string;
  publishedPackages?: readonly PublishedPackage[];
}): LicenseCheckFailure[] => {
  const failures: LicenseCheckFailure[] = [];
  const rootLicense = readRootLicense(repoRoot);

  if (!rootLicense) {
    failures.push({
      message: "root package.json is missing a license field",
      packageDir: "api",
    });
    return failures;
  }

  for (const packageDir of publishedPackages) {
    const licensePath = join(repoRoot, packageDir, "LICENSE");

    if (!existsSync(licensePath)) {
      failures.push({
        message: "missing LICENSE file",
        packageDir,
      });
    }

    const packageJson = readPackageJson(repoRoot, packageDir);

    if (packageJson.license !== rootLicense) {
      failures.push({
        message: `package.json license "${packageJson.license ?? "(missing)"}" does not match root license "${rootLicense}"`,
        packageDir,
      });
    }

    if (packageJson.files && !packageJson.files.includes("LICENSE")) {
      failures.push({
        message: 'package.json files array does not include "LICENSE"',
        packageDir,
      });
    }
  }

  return failures;
};
