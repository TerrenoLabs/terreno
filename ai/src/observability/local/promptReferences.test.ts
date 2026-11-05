import {describe, expect, it} from "bun:test";

import {type PromptReferenceLookup, resolvePromptReferences} from "./promptReferences";

// Mirrors the module's nesting limit, which the docs promise.
const MAX_PROMPT_REFERENCE_DEPTH = 5;

const tag = (body: string): string => `{{> ${body}}}`;

const lookupFrom = (
  bodies: Record<string, {body: string; version: number}>
): PromptReferenceLookup => {
  return async ({label, name, version}) => {
    const found = bodies[name];
    if (!found || (version !== undefined && version !== found.version)) {
      return undefined;
    }
    return {...found, ...(label !== undefined ? {label} : {})};
  };
};

describe("prompt reference tags", () => {
  const seen = async (text: string): Promise<Array<{label?: string; version?: number}>> => {
    const lookups: Array<{label?: string; version?: number}> = [];
    await resolvePromptReferences({
      ancestors: ["caller"],
      lookup: async ({label, version}) => {
        lookups.push({label, version});
        return {body: "", version: version ?? 1};
      },
      text,
    });
    return lookups;
  };

  it("defaults a reference without label or version to production", async () => {
    expect(await seen(tag("base-rules"))).toEqual([{label: "production", version: undefined}]);
  });

  it("reads a pinned version and an explicit label", async () => {
    expect(await seen(`${tag("a version=3")} ${tag("b label=staging")}`)).toEqual([
      {label: undefined, version: 3},
      {label: "staging", version: undefined},
    ]);
  });

  it("rejects a missing name, a bad version, label plus version, and an unknown option", async () => {
    for (const body of [
      "label=production",
      "a version=0",
      "a label=production version=1",
      "a tone=warm",
      "a label=",
      "",
    ]) {
      await expect(seen(tag(body))).rejects.toThrow("Invalid prompt reference");
    }
  });
});

describe("resolvePromptReferences", () => {
  it("inlines nested references and records each include with the prompt that pulled it in", async () => {
    const resolved = await resolvePromptReferences({
      ancestors: ["triage"],
      lookup: lookupFrom({
        "base-rules": {body: `Be kind.\n${tag("safety")}`, version: 4},
        safety: {body: "Escalate risk.", version: 2},
      }),
      text: `${tag("base-rules")}\nTriage the {{message}}.`,
    });

    expect(resolved.text).toBe("Be kind.\nEscalate risk.\nTriage the {{message}}.");
    expect(resolved.includes).toEqual([
      {includedBy: "triage", label: "production", name: "base-rules", version: 4},
      {includedBy: "base-rules", label: "production", name: "safety", version: 2},
    ]);
  });

  it("returns text without references unchanged", async () => {
    const resolved = await resolvePromptReferences({
      ancestors: ["plain"],
      lookup: lookupFrom({}),
      text: "No references here.",
    });
    expect(resolved).toEqual({includes: [], text: "No references here."});
  });

  it("records a reference used twice once", async () => {
    const resolved = await resolvePromptReferences({
      ancestors: ["twice"],
      lookup: lookupFrom({base: {body: "B", version: 1}}),
      text: `${tag("base")} and ${tag("base")}`,
    });
    expect(resolved.text).toBe("B and B");
    expect(resolved.includes).toHaveLength(1);
  });

  it("rejects an unknown reference", async () => {
    await expect(
      resolvePromptReferences({
        ancestors: ["triage"],
        lookup: lookupFrom({}),
        text: tag("missing"),
      })
    ).rejects.toThrow("Invalid prompt reference");
  });

  it("rejects a cycle", async () => {
    await expect(
      resolvePromptReferences({
        ancestors: ["a"],
        lookup: lookupFrom({b: {body: tag("a"), version: 1}}),
        text: tag("b"),
      })
    ).rejects.toThrow("Prompt reference cycle");
  });

  it("rejects a chain deeper than the limit", async () => {
    const bodies: Record<string, {body: string; version: number}> = {};
    for (let level = 1; level <= MAX_PROMPT_REFERENCE_DEPTH + 1; level++) {
      bodies[`p${level}`] = {body: tag(`p${level + 1}`), version: 1};
    }
    bodies[`p${MAX_PROMPT_REFERENCE_DEPTH + 2}`] = {body: "leaf", version: 1};
    await expect(
      resolvePromptReferences({ancestors: ["p0"], lookup: lookupFrom(bodies), text: tag("p1")})
    ).rejects.toThrow("Prompt references nested too deeply");
  });
});
