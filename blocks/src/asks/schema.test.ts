import {describe, expect, it} from "bun:test";
import {validAskFixtures} from "../tests/askFixtures";
import {
  ASK_KINDS,
  type AskKind,
  askInputSchemaFor,
  askKindsForSurface,
  COMPACT_ASK_KINDS,
  choiceAskInputSchema,
  compactChoiceAskInputSchema,
} from "./schema";

describe("askKindsForSurface", () => {
  it("keeps every kind on the full surface", () => {
    const kinds: AskKind[] = ["choice"];
    const offered = askKindsForSurface({kinds, surface: "full"});
    expect(offered).toEqual(["choice"]);
    expect(offered).not.toBe(kinds);
  });

  it("keeps only the compact kinds on the compact surface", () => {
    expect(askKindsForSurface({kinds: ASK_KINDS, surface: "compact"})).toEqual([
      ...COMPACT_ASK_KINDS,
    ]);
    expect(askKindsForSurface({kinds: [], surface: "compact"})).toEqual([]);
  });
});

describe("askInputSchemaFor", () => {
  it("returns the full schema by default and the narrowed schema for compact", () => {
    expect(askInputSchemaFor({kind: "choice"})).toBe(choiceAskInputSchema);
    expect(askInputSchemaFor({kind: "choice", surface: "full"})).toBe(choiceAskInputSchema);
    expect(askInputSchemaFor({kind: "choice", surface: "compact"})).toBe(
      compactChoiceAskInputSchema
    );
  });

  it("only narrows: every fixture the compact schema accepts, the full schema accepts", () => {
    for (const fixture of validAskFixtures()) {
      if (compactChoiceAskInputSchema.safeParse(fixture.input).success) {
        expect(choiceAskInputSchema.safeParse(fixture.input).success).toBe(true);
      }
    }
  });
});
