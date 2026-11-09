import {describe, expect, it} from "bun:test";

import {parseFormField, parseModelField} from "./parseFields";
import {generateRestCliFiles} from "./rest/generateAppCli";
import {parseOpenApiDocument} from "./rest/loadSpec";

describe("parseFields", () => {
  it("parses model field flags", () => {
    expect(parseModelField("title:String:required:unique")).toEqual({
      name: "title",
      required: true,
      type: "String",
      unique: true,
    });
    expect(parseModelField("ownerId:ObjectId:ref=User")).toEqual({
      name: "ownerId",
      ref: "User",
      type: "ObjectId",
    });
  });

  it("parses form field flags", () => {
    expect(parseFormField("email:email:required:label=Email")).toEqual({
      label: "Email",
      name: "email",
      required: true,
      type: "email",
    });
  });
});

describe("generateRestCliFiles", () => {
  it("emits a bun CLI that imports @terreno/cli", () => {
    const spec = parseOpenApiDocument(
      '{"openapi":"3.0.0","info":{"title":"Shop","version":"1"},"paths":{}}'
    );
    const files = generateRestCliFiles({
      binName: "shop",
      spec,
      specLiteral: JSON.stringify(spec),
    });
    const paths = files.map((file) => file.path);
    expect(paths).toContain("src/cli.ts");
    expect(paths).toContain("package.json");
    const cli = files.find((file) => file.path === "src/cli.ts")?.content ?? "";
    expect(cli).toContain("@terreno/cli");
    expect(cli).toContain("runAppRestCli");
    const packageJson = files.find((file) => file.path === "package.json")?.content ?? "{}";
    expect(JSON.parse(packageJson).dependencies["@terreno/cli"]).toBe("latest");
  });

  it("normalizes YAML specs in the generated openapi.json", () => {
    const specLiteral = `openapi: 3.0.0
info:
  title: Shop
  version: "1"
paths: {}
`;
    const spec = parseOpenApiDocument(specLiteral);
    const files = generateRestCliFiles({binName: "shop", spec, specLiteral});
    const openApiJson = files.find((file) => file.path === "openapi.json")?.content ?? "";
    expect(JSON.parse(openApiJson)).toEqual(spec);
  });
});
