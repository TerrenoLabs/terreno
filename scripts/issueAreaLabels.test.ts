import {describe, it} from "bun:test";
import {assert} from "chai";
import {
  AREA_BY_PACKAGE,
  KIND_BY_VALUE,
  parseIssueLabels,
  parseKindTypeFromIssueBody,
  parsePackageAreaFromIssueBody,
  resolveTriageLabels,
} from "./issueAreaLabels.ts";

describe("parsePackageAreaFromIssueBody", () => {
  it("maps bug report package values to area labels", (): void => {
    const body = "### Affected package\n\n@terreno/ui\n\n### Version";
    assert.equal(parsePackageAreaFromIssueBody(body), "area:ui");
  });

  it("maps @terreno/jobs to area:api", (): void => {
    const body = "### Affected package\n\n@terreno/jobs\n\n### Version";
    assert.equal(parsePackageAreaFromIssueBody(body), "area:api");
  });

  it("maps plugins to area:dx", (): void => {
    const body = "### Affected package\n\nplugins\n\n### Kind";
    assert.equal(parsePackageAreaFromIssueBody(body), "area:dx");
  });

  it("returns null when package section is missing", (): void => {
    assert.isNull(parsePackageAreaFromIssueBody("No package here"));
  });

  it("returns null for a package outside the table", (): void => {
    assert.isNull(parsePackageAreaFromIssueBody("### Affected package\n\n@terreno/unknown\n"));
  });

  it("maps every package in the table to a label the taxonomy defines", async (): Promise<void> => {
    const labelsYaml = await Bun.file(".github/labels.yml").text();
    const definedNames = new Set(
      (Bun.YAML.parse(labelsYaml) as {name: string}[]).map((label) => label.name)
    );

    for (const areaLabel of Object.values(AREA_BY_PACKAGE)) {
      assert.isTrue(
        definedNames.has(areaLabel),
        `${areaLabel} is not defined in .github/labels.yml`
      );
    }
  });
});

describe("parseKindTypeFromIssueBody", () => {
  it("maps Kind dropdown values to type labels", (): void => {
    const body = "### Kind\n\nBug\n\n### Problem";
    assert.equal(parseKindTypeFromIssueBody(body), "type:bug");
  });

  it("returns null when Kind is missing", (): void => {
    assert.isNull(parseKindTypeFromIssueBody("### Affected package\n\n@terreno/ui\n"));
  });

  it("returns null for an unknown Kind", (): void => {
    assert.isNull(parseKindTypeFromIssueBody("### Kind\n\nRFC\n"));
  });

  it("maps every Kind value to a label the taxonomy defines", async (): Promise<void> => {
    const labelsYaml = await Bun.file(".github/labels.yml").text();
    const definedNames = new Set(
      (Bun.YAML.parse(labelsYaml) as {name: string}[]).map((label) => label.name)
    );

    for (const typeLabel of Object.values(KIND_BY_VALUE)) {
      assert.isTrue(
        definedNames.has(typeLabel),
        `${typeLabel} is not defined in .github/labels.yml`
      );
    }
  });
});

describe("dropdown coverage", (): void => {
  // The mapping silently returned "no area" for @terreno/comms for as long as
  // that option existed, because nothing asserted the two lists agree.
  it("maps every package option in bug_report.yml", async (): Promise<void> => {
    const template = await Bun.file(".github/ISSUE_TEMPLATE/bug_report.yml").text();
    const parsed = Bun.YAML.parse(template) as {
      body?: {attributes?: {label?: string; options?: string[]}; type?: string}[];
    };

    const packageDropdown = parsed.body?.find(
      (block) =>
        block.type === "dropdown" && /affected package/i.test(block.attributes?.label ?? "")
    );
    assert.ok(packageDropdown !== undefined, "bug_report.yml has no Affected package dropdown");

    const unmapped = (packageDropdown?.attributes?.options ?? []).filter(
      (option) => AREA_BY_PACKAGE[option] === undefined
    );
    assert.deepEqual(unmapped, [], `unmapped package options: ${unmapped.join(", ")}`);
  });

  it("maps every package option in work_item.yml", async (): Promise<void> => {
    const template = await Bun.file(".github/ISSUE_TEMPLATE/work_item.yml").text();
    const parsed = Bun.YAML.parse(template) as {
      body?: {attributes?: {label?: string; options?: string[]}; type?: string}[];
    };

    const packageDropdown = parsed.body?.find(
      (block) =>
        block.type === "dropdown" && /affected package/i.test(block.attributes?.label ?? "")
    );
    assert.ok(packageDropdown !== undefined, "work_item.yml has no Affected package dropdown");

    const unmapped = (packageDropdown?.attributes?.options ?? []).filter(
      (option) => AREA_BY_PACKAGE[option] === undefined
    );
    assert.deepEqual(unmapped, [], `unmapped work_item package options: ${unmapped.join(", ")}`);
  });

  it("maps every Kind option in work_item.yml", async (): Promise<void> => {
    const template = await Bun.file(".github/ISSUE_TEMPLATE/work_item.yml").text();
    const parsed = Bun.YAML.parse(template) as {
      body?: {attributes?: {label?: string; options?: string[]}; type?: string}[];
    };

    const kindDropdown = parsed.body?.find(
      (block) => block.type === "dropdown" && /^kind$/i.test(block.attributes?.label ?? "")
    );
    assert.ok(kindDropdown !== undefined, "work_item.yml has no Kind dropdown");

    const unmapped = (kindDropdown?.attributes?.options ?? []).filter(
      (option) => KIND_BY_VALUE[option] === undefined
    );
    assert.deepEqual(unmapped, [], `unmapped work_item Kind options: ${unmapped.join(", ")}`);
  });

  it("only maps to labels that exist in labels.yml", async (): Promise<void> => {
    const labels = Bun.YAML.parse(await Bun.file(".github/labels.yml").text()) as {name: string}[];
    const known = new Set(labels.map((label) => label.name));
    const unknownAreas = [...new Set(Object.values(AREA_BY_PACKAGE))].filter(
      (label) => !known.has(label)
    );
    assert.deepEqual(
      unknownAreas,
      [],
      `area labels missing from labels.yml: ${unknownAreas.join(", ")}`
    );
    const unknownTypes = [...new Set(Object.values(KIND_BY_VALUE))].filter(
      (label) => !known.has(label)
    );
    assert.deepEqual(
      unknownTypes,
      [],
      `type labels missing from labels.yml: ${unknownTypes.join(", ")}`
    );
  });
});

describe("resolveTriageLabels", (): void => {
  const formBody = "### Affected package\n\n@terreno/ui\n\n### Kind\n\nBug";

  it("keeps an area label the issue was opened with", (): void => {
    const resolved = resolveTriageLabels({
      body: "Roadmap summary with no issue-form sections.",
      existingLabels: ["area:ai", "type:feature", "roadmap"],
    });
    assert.deepEqual(resolved, {area: "area:ai", type: "type:feature"});
  });

  it("prefers existing labels over the form dropdowns", (): void => {
    const resolved = resolveTriageLabels({body: formBody, existingLabels: ["area:api"]});
    assert.equal(resolved.area, "area:api");
    assert.equal(resolved.type, parseKindTypeFromIssueBody(formBody) ?? "");
  });

  it("falls back to the form when the issue has no labels", (): void => {
    const resolved = resolveTriageLabels({body: formBody, existingLabels: []});
    assert.equal(resolved.area, parsePackageAreaFromIssueBody(formBody) ?? "");
  });

  it("returns empty values when neither source names an area", (): void => {
    assert.deepEqual(resolveTriageLabels({body: "", existingLabels: ["roadmap"]}), {
      area: "",
      type: "",
    });
  });
});

describe("parseIssueLabels", (): void => {
  it("reads a JSON array of names", (): void => {
    assert.deepEqual(parseIssueLabels('["area:ui","roadmap"]'), ["area:ui", "roadmap"]);
  });

  it("treats missing or malformed input as no labels", (): void => {
    assert.deepEqual(parseIssueLabels(undefined), []);
    assert.deepEqual(parseIssueLabels("not json"), []);
    assert.deepEqual(parseIssueLabels('{"a":1}'), []);
  });
});
