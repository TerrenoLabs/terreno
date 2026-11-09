import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {databaseSchema} from "../local/tools/databaseSchema.js";

const UNAVAILABLE_TEXT = "_Unavailable: set `MONGO_URI` in `backend/.env`";

describe("databaseSchema", () => {
  let projectRoot: string;
  let previousProjectRoot: string | undefined;
  let previousMongoUri: string | undefined;

  const writeModel = (name: string, content: string): void => {
    const modelsDir = join(projectRoot, "backend", "src", "models");
    mkdirSync(modelsDir, {recursive: true});
    writeFileSync(join(modelsDir, name), content);
  };

  const writeEnv = (content: string): void => {
    mkdirSync(join(projectRoot, "backend"), {recursive: true});
    writeFileSync(join(projectRoot, "backend", ".env"), content);
  };

  beforeEach((): void => {
    projectRoot = mkdtempSync(join(tmpdir(), "terreno-database-schema-"));
    previousProjectRoot = process.env.TERRENO_PROJECT_ROOT;
    previousMongoUri = process.env.MONGO_URI;
    process.env.TERRENO_PROJECT_ROOT = projectRoot;
    Reflect.deleteProperty(process.env, "MONGO_URI");
  });

  afterEach((): void => {
    rmSync(projectRoot, {force: true, recursive: true});
    if (previousProjectRoot === undefined) {
      Reflect.deleteProperty(process.env, "TERRENO_PROJECT_ROOT");
    } else {
      process.env.TERRENO_PROJECT_ROOT = previousProjectRoot;
    }
    if (previousMongoUri === undefined) {
      Reflect.deleteProperty(process.env, "MONGO_URI");
    } else {
      process.env.MONGO_URI = previousMongoUri;
    }
  });

  it("reports no models and no live database for an empty project", async (): Promise<void> => {
    const text = await databaseSchema({});

    expect(text).toContain("# Database schema");
    expect(text).toContain("_(No model files found.)_");
    expect(text).toContain("## Live MongoDB");
    expect(text).toContain(UNAVAILABLE_TEXT);
  });

  it("includes an excerpt of each model file except the index barrel", async (): Promise<void> => {
    writeModel("todo.ts", 'export const todoSchema = "todo";\n');
    writeModel("user.ts", 'export const userSchema = "user";\n');
    writeModel("index.ts", 'export * from "./todo";\n');
    writeModel("README.md", "Not a model\n");

    const text = await databaseSchema({});

    expect(text).toContain("### todo.ts");
    expect(text).toContain('export const todoSchema = "todo";');
    expect(text).toContain("### user.ts");
    expect(text).not.toContain("### index.ts");
    expect(text).not.toContain("README.md");
  });

  it("truncates model excerpts to the first 80 lines", async (): Promise<void> => {
    const content = Array.from({length: 100}, (_, index) => `// line ${index + 1}`).join("\n");
    writeModel("long.ts", content);

    const text = await databaseSchema({});

    expect(text).toContain("// line 80");
    expect(text).not.toContain("// line 81");
  });

  it("counts model files instead of printing them in summary mode", async (): Promise<void> => {
    writeModel("todo.ts", "export const todo = 1;\n");
    writeModel("user.ts", "export const user = 1;\n");

    const text = await databaseSchema({summary: true});

    expect(text).toContain("Found 2 model file(s). Re-run with `summary: false` for excerpts.");
    expect(text).not.toContain("### todo.ts");
  });

  it("treats blank or quoted-empty Mongo URIs in backend/.env as unset", async (): Promise<void> => {
    writeEnv(
      [
        "# MONGO_URI=mongodb://commented-out",
        "",
        "NOT_A_PAIR",
        "PORT=4000",
        'MONGO_URI=""',
        "MONGODB_URI=''",
      ].join("\n")
    );

    const text = await databaseSchema({});

    expect(text).toContain(UNAVAILABLE_TEXT);
    expect(text).not.toContain("commented-out");
  });

  it("ignores a whitespace-only MONGO_URI environment variable", async (): Promise<void> => {
    process.env.MONGO_URI = "   ";

    const text = await databaseSchema({});

    expect(text).toContain(UNAVAILABLE_TEXT);
  });
});
