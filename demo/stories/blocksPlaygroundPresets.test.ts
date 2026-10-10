import {describe, expect, it} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {
  type Block,
  CALLOUT_STATUSES,
  CHART_KINDS,
  parseBlocks,
  validateBlocks,
} from "@terreno/blocks";

import {PLAYGROUND_HOST_ACTIONS, PRESETS, type PresetName} from "./blocksPlaygroundPresets";

const SCHEMA_SOURCE = readFileSync(
  join(import.meta.dir, "..", "..", "blocks", "src", "schema.ts"),
  "utf8"
);

/** Interface names in an `export type X = A | B | C;` union in schema.ts. */
const unionMembers = (name: string): string[] => {
  const match = SCHEMA_SOURCE.match(new RegExp(`export type ${name} =([^;]+);`));
  if (match?.[1] === undefined) {
    throw new Error(`No union ${name} in schema.ts`);
  }
  return match[1]
    .split("|")
    .map((member) => member.trim())
    .filter((member) => member.length > 0);
};

/** The `type` literal of an `export interface X {...}` in schema.ts. */
const typeLiteralOf = (interfaceName: string): string => {
  const body = SCHEMA_SOURCE.match(
    new RegExp(`export interface ${interfaceName} \\{([\\s\\S]*?)\\n\\}`)
  )?.[1];
  const literal = body?.match(/^\s+type: "([a-z]+)";$/m)?.[1];
  if (literal === undefined) {
    throw new Error(`No type literal on ${interfaceName} in schema.ts`);
  }
  return literal;
};

/** Every block `type` in the schema's `Block` union, read from the source so a new one is caught. */
const SCHEMA_BLOCK_TYPES = [
  ...unionMembers("LeafBlock"),
  ...unionMembers("Block").filter((member) => member !== "LeafBlock"),
]
  .map(typeLiteralOf)
  .sort();

/** Every `action.kind` in the schema's `BlockAction` union. */
const SCHEMA_ACTION_KINDS = unionMembers("BlockAction")
  .map((name) => {
    const body = SCHEMA_SOURCE.match(new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`));
    return body?.[1]?.match(/^\s+kind: "([a-z]+)";$/m)?.[1] ?? name;
  })
  .sort();

/** The photos bundled in demo/assets/blocks, by file name without `.jpg`. */
const BUNDLED_PHOTO_IDS = readdirSync(join(import.meta.dir, "..", "assets", "blocks"))
  .filter((file) => file.endsWith(".jpg"))
  .map((file) => file.replace(/\.jpg$/, ""))
  .sort();

const PRESET_NAMES = Object.keys(PRESETS) as PresetName[];

const validate = (name: PresetName): ReturnType<typeof validateBlocks> => {
  const parsed = parseBlocks(PRESETS[name]);
  if (!parsed.ok) {
    return {errors: parsed.errors, ok: false, warnings: []};
  }
  return validateBlocks(parsed.value, {allowHtml: true, hostActions: PLAYGROUND_HOST_ACTIONS});
};

interface Usage {
  actionKinds: Set<string>;
  blockTypes: Set<string>;
  calloutStatuses: Set<string>;
  chartKinds: Set<string>;
  elementTypes: Set<string>;
}

const collectUsage = (blocks: readonly Block[], usage: Usage): void => {
  for (const block of blocks) {
    usage.blockTypes.add(block.type);
    if (block.type === "chart") {
      usage.chartKinds.add(block.kind);
    }
    if (block.type === "callout") {
      usage.calloutStatuses.add(block.status ?? "info");
    }
    if (block.type === "actions") {
      for (const element of block.elements) {
        usage.elementTypes.add(element.type);
        if (element.type === "button") {
          usage.actionKinds.add(element.action.kind);
        }
      }
    }
    if (block.type === "columns" || block.type === "card") {
      collectUsage(block.children, usage);
    }
  }
};

const usageOf = (names: readonly PresetName[]): Usage => {
  const usage: Usage = {
    actionKinds: new Set(),
    blockTypes: new Set(),
    calloutStatuses: new Set(),
    chartKinds: new Set(),
    elementTypes: new Set(),
  };
  for (const name of names) {
    const result = validate(name);
    if (result.ok) {
      collectUsage(result.doc.blocks, usage);
    }
  }
  return usage;
};

describe("BlocksPlayground presets", () => {
  it("reads the block types and action kinds from the schema", () => {
    expect(SCHEMA_BLOCK_TYPES).toContain("heading");
    expect(SCHEMA_BLOCK_TYPES).toContain("card");
    expect(SCHEMA_BLOCK_TYPES).not.toContain("button");
    expect(SCHEMA_BLOCK_TYPES.length).toBeGreaterThanOrEqual(19);
    expect(SCHEMA_ACTION_KINDS).toEqual(["callback", "copy", "open", "reply", "select"]);
  });

  it("validates every preset with the playground's options, except Invalid", () => {
    for (const name of PRESET_NAMES) {
      const result = validate(name);
      if (name === "Invalid") {
        expect(result.ok).toBe(false);
        continue;
      }
      expect({errors: result.ok ? [] : result.errors, name}).toEqual({errors: [], name});
    }
  });

  it("shows every block type, action kind, chart kind, and callout status in some preset", () => {
    const usage = usageOf(PRESET_NAMES);
    expect([...usage.blockTypes].sort()).toEqual(SCHEMA_BLOCK_TYPES);
    expect([...usage.actionKinds].sort()).toEqual(SCHEMA_ACTION_KINDS);
    expect([...usage.elementTypes].sort()).toEqual(["button", "segmented"]);
    expect([...usage.chartKinds].sort()).toEqual([...CHART_KINDS].sort());
    expect([...usage.calloutStatuses].sort()).toEqual([...CALLOUT_STATUSES].sort());
  });

  it("has a preset for each block type, showing that type", () => {
    for (const type of SCHEMA_BLOCK_TYPES) {
      expect(PRESET_NAMES).toContain(type as PresetName);
      expect(usageOf([type as PresetName]).blockTypes.has(type)).toBe(true);
    }
  });

  it("shows every block type in the All blocks preset", () => {
    expect([...usageOf(["All blocks"]).blockTypes].sort()).toEqual(SCHEMA_BLOCK_TYPES);
  });

  it("uses only file: photos the demo bundles", () => {
    for (const name of PRESET_NAMES) {
      for (const [, id] of PRESETS[name].matchAll(/"file:([a-z-]+)"/g)) {
        expect(BUNDLED_PHOTO_IDS).toContain(id as string);
      }
    }
  });
});
