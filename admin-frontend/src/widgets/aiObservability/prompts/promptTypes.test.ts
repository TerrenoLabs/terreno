import {describe, expect, it} from "bun:test";
import {
  filterPrompts,
  folderCounts,
  formatPlaygroundMetrics,
  formatProduction,
  judgeOutputSchemaFromDetail,
  latestVersionFromDetail,
  nextVersionFromDetail,
  outgoingProductionCopy,
  type PromptDetail,
  type PromptListItem,
  type PromptVersionDetail,
  productionVersionFromDetail,
  schemaSummary,
  templateVariableKeys,
  unwrapPromptDetail,
  unwrapPromptList,
  variableNamesFromVersion,
} from "./promptTypes";

const sample: PromptListItem[] = [
  {
    folder: "examples",
    latestVersion: 2,
    name: "summarize",
    production: 1,
    type: "chat",
    usage7d: {calls: 4, costUsd: 0.0123},
  },
  {folder: "ops", latestVersion: 1, name: "triage", production: "—", type: "text"},
];

const version = (
  partial: Partial<PromptVersionDetail> & {version: number}
): PromptVersionDetail => ({
  sensitive: false,
  template: "Hello {{name}}",
  type: "chat",
  variables: [{key: "name", required: true}],
  ...partial,
});

const detail: PromptDetail = {
  description: "Summarize user text",
  folder: "examples",
  labels: [
    {label: "latest", version: 2},
    {label: "production", version: 1},
  ],
  name: "summarize",
  relationships: {
    experiments: {items: [], limit: 20, total: 0},
    traces: {items: [], limit: 20, total: 0},
  },
  tags: ["ops"],
  versions: [version({version: 1}), version({system: "Be brief", version: 2})],
};

describe("promptTypes helpers", () => {
  it("unwraps list payloads whether RTK already unwrapped them", () => {
    expect(unwrapPromptList(sample)).toEqual(sample);
    expect(unwrapPromptList({data: sample})).toEqual(sample);
    expect(unwrapPromptList(undefined)).toEqual([]);
  });

  it("unwraps detail payloads", () => {
    expect(unwrapPromptDetail(detail)?.name).toBe("summarize");
    expect(unwrapPromptDetail({data: detail})?.name).toBe("summarize");
  });

  it("counts folders and filters by folder plus search", () => {
    expect(folderCounts(sample)).toEqual([
      {count: 1, folder: "examples"},
      {count: 1, folder: "ops"},
    ]);
    expect(
      filterPrompts({folder: "ops", prompts: sample, search: ""}).map((row) => row.name)
    ).toEqual(["triage"]);
    expect(
      filterPrompts({folder: "", prompts: sample, search: "sum"}).map((row) => row.name)
    ).toEqual(["summarize"]);
  });

  it("formats production as a version or em dash", () => {
    expect(formatProduction(1)).toBe("v1");
    expect(formatProduction("—")).toBe("—");
  });

  it("uses the production schema, or the latest version when production is unset", () => {
    const unlabelled = {
      ...detail,
      labels: [],
      versions: [
        version({outputSchema: {old: {type: "string"}}, version: 1}),
        version({outputSchema: {current: {type: "string"}}, version: 2}),
      ],
    };
    expect(judgeOutputSchemaFromDetail(unlabelled)).toEqual({current: {type: "string"}});
    const labelled = {
      ...unlabelled,
      labels: [{label: "production", version: 1}],
    };
    expect(judgeOutputSchemaFromDetail(labelled)).toEqual({old: {type: "string"}});
  });

  it("derives latest, next, and production versions from detail", () => {
    expect(latestVersionFromDetail(detail)).toBe(2);
    expect(nextVersionFromDetail(detail)).toBe(3);
    expect(productionVersionFromDetail(detail)).toBe(1);
    expect(outgoingProductionCopy({detail, selectedVersion: 2})).toContain(
      "outgoing production version is v1"
    );
  });

  it("parses template variables and falls back when the version list is empty", () => {
    expect(templateVariableKeys("Hi {{first}} and {{ last }}")).toEqual(["first", "last"]);
    expect(
      variableNamesFromVersion(version({template: "Hi {{topic}}", variables: [], version: 1}))
    ).toEqual(["topic"]);
  });

  it("summarizes schema and playground metrics", () => {
    expect(
      schemaSummary(version({outputSchema: {summary: {type: "string"}}, version: 1})).includes(
        "summary"
      )
    ).toBe(true);
    expect(
      formatPlaygroundMetrics({
        compiledMessages: [],
        costUsd: 0.01,
        latencyMs: 12,
        output: "ok",
        tokens: {totalTokens: 9},
      })
    ).toBe("12 ms · 9 tokens · $0.0100");
  });
});
