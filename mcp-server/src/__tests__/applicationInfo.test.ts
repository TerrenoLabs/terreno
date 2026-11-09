import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {applicationInfo} from "../local/tools/applicationInfo.js";

const writePkg = (dir: string, body: Record<string, unknown>): void => {
  mkdirSync(dir, {recursive: true});
  writeFileSync(join(dir, "package.json"), JSON.stringify(body));
};

describe("applicationInfo", () => {
  let projectRoot: string;
  let previousProjectRoot: string | undefined;

  beforeEach((): void => {
    projectRoot = mkdtempSync(join(tmpdir(), "terreno-application-info-"));
    previousProjectRoot = process.env.TERRENO_PROJECT_ROOT;
    process.env.TERRENO_PROJECT_ROOT = projectRoot;
    writePkg(projectRoot, {name: "app-root", version: "2.0.0"});
  });

  afterEach((): void => {
    rmSync(projectRoot, {force: true, recursive: true});
    if (previousProjectRoot === undefined) {
      Reflect.deleteProperty(process.env, "TERRENO_PROJECT_ROOT");
    } else {
      process.env.TERRENO_PROJECT_ROOT = previousProjectRoot;
    }
  });

  it("reports example-backend and example-frontend when bootstrap dirs are absent", (): void => {
    writePkg(join(projectRoot, "example-backend"), {
      dependencies: {"@terreno/api": "workspace:*", mongoose: "catalog:"},
      name: "@terreno/example-backend",
      version: "1.0.0",
    });
    writePkg(join(projectRoot, "example-frontend"), {
      dependencies: {"@terreno/ui": "workspace:*", expo: "catalog:"},
      name: "@terreno/example-frontend",
      version: "1.0.0",
    });

    const text = applicationInfo();
    expect(text).toContain("## Backend workspace (example-backend/)");
    expect(text).toContain("- @terreno/api: workspace:*");
    expect(text).toContain("- **mongoose**: catalog:");
    expect(text).toContain("## Frontend workspace (example-frontend/)");
    expect(text).toContain("- @terreno/ui: workspace:*");
    expect(text).toContain("- **expo**: catalog:");
  });

  it("prefers bootstrap backend/ and frontend/ over example apps", (): void => {
    writePkg(join(projectRoot, "backend"), {
      dependencies: {"@terreno/api": "^57.1.0"},
      name: "consumer-backend",
      version: "0.1.0",
    });
    writePkg(join(projectRoot, "frontend"), {
      dependencies: {"@terreno/ui": "^57.1.0"},
      name: "consumer-frontend",
      version: "0.1.0",
    });
    writePkg(join(projectRoot, "example-backend"), {
      dependencies: {"@terreno/api": "workspace:*"},
      name: "@terreno/example-backend",
      version: "1.0.0",
    });
    writePkg(join(projectRoot, "example-frontend"), {
      dependencies: {"@terreno/ui": "workspace:*"},
      name: "@terreno/example-frontend",
      version: "1.0.0",
    });

    const text = applicationInfo();
    expect(text).toContain("## Backend workspace (backend/)");
    expect(text).toContain("- **name**: consumer-backend");
    expect(text).toContain("## Frontend workspace (frontend/)");
    expect(text).toContain("- **name**: consumer-frontend");
    expect(text).not.toContain("example-backend/");
    expect(text).not.toContain("example-frontend/");
  });

  it("lists root @terreno packages and notes the bun.lock workspace versions", (): void => {
    writePkg(projectRoot, {
      dependencies: {"@terreno/api": "^57.2.0", lodash: "^4.17.21"},
      devDependencies: {"@terreno/test": "^57.2.0"},
      name: "app-root",
      version: "2.0.0",
    });
    writeFileSync(join(projectRoot, "bun.lock"), "{}\n");

    const text = applicationInfo();
    expect(text).toContain("- **root package**: app-root @ 2.0.0");
    expect(text).toContain("- **bun.lock present**: yes");
    expect(text).toContain("## @terreno/* (root package.json)");
    expect(text).toContain("- @terreno/api: ^57.2.0");
    expect(text).toContain("- @terreno/test: ^57.2.0");
    expect(text).not.toContain("lodash");
    expect(text).toContain("## Lockfile");
    expect(text).toContain(
      "Workspace package versions are recorded under `workspaces` in `bun.lock`"
    );
  });

  it("skips a workspace whose package.json cannot be parsed", (): void => {
    mkdirSync(join(projectRoot, "backend"), {recursive: true});
    writeFileSync(join(projectRoot, "backend", "package.json"), "{not json");
    writePkg(join(projectRoot, "frontend"), {
      devDependencies: {expo: "~54.0.0"},
      name: "consumer-frontend",
    });

    const text = applicationInfo();
    expect(text).toContain("- **bun.lock present**: no");
    expect(text).not.toContain("## Backend workspace");
    expect(text).not.toContain("## @terreno/* (root package.json)");
    expect(text).not.toContain("## Lockfile");
    expect(text).toContain("## Frontend workspace (frontend/)");
    expect(text).toContain("- **version**: ?");
    expect(text).toContain("- **expo**: ~54.0.0");
  });
});
