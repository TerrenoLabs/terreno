import {describe, expect, it} from "bun:test";
import {validAskFixtures} from "../tests/askFixtures";
import {
  ASK_KINDS,
  type AskKind,
  askAllowsDecline,
  askInputSchemaFor,
  askKindsForSurface,
  COMPACT_ASK_KINDS,
  choiceAskInputSchema,
  compactChoiceAskInputSchema,
  compactConfirmAskInputSchema,
  confirmAskInputSchema,
  confirmButtonLabels,
} from "./schema";

describe("askKindsForSurface", () => {
  it("keeps every kind on the full surface", () => {
    const kinds: AskKind[] = ["confirm", "choice"];
    const offered = askKindsForSurface({kinds, surface: "full"});
    expect(offered).toEqual(["confirm", "choice"]);
    expect(offered).not.toBe(kinds);
  });

  it("keeps only the compact kinds on the compact surface", () => {
    expect(askKindsForSurface({kinds: ASK_KINDS, surface: "compact"})).toEqual([
      ...COMPACT_ASK_KINDS,
    ]);
    expect(askKindsForSurface({kinds: [], surface: "compact"})).toEqual([]);
  });

  it("offers choice and confirm on the compact surface", () => {
    expect([...COMPACT_ASK_KINDS]).toEqual(["choice", "confirm"]);
  });
});

describe("askInputSchemaFor", () => {
  it("returns the full schema by default and the narrowed schema for compact", () => {
    expect(askInputSchemaFor({kind: "choice"})).toBe(choiceAskInputSchema);
    expect(askInputSchemaFor({kind: "choice", surface: "full"})).toBe(choiceAskInputSchema);
    expect(askInputSchemaFor({kind: "choice", surface: "compact"})).toBe(
      compactChoiceAskInputSchema
    );
    expect(askInputSchemaFor({kind: "confirm"})).toBe(confirmAskInputSchema);
    expect(askInputSchemaFor({kind: "confirm", surface: "compact"})).toBe(
      compactConfirmAskInputSchema
    );
  });

  it("only narrows: every fixture the compact schema accepts, the full schema accepts", () => {
    for (const fixture of validAskFixtures()) {
      const compact = askInputSchemaFor({kind: fixture.kind, surface: "compact"});
      if (compact.safeParse(fixture.input).success) {
        expect(askInputSchemaFor({kind: fixture.kind}).safeParse(fixture.input).success).toBe(true);
      }
    }
  });
});

describe("askAllowsDecline", () => {
  it("defaults to true for choice and to false for confirm", () => {
    const prompt = "Go ahead?";
    expect(
      askAllowsDecline({
        input: {
          options: [
            {id: "yes", label: "Yes"},
            {id: "no", label: "No"},
          ],
          prompt,
          select: "one",
        },
        kind: "choice",
      })
    ).toBe(true);
    expect(askAllowsDecline({input: {prompt}, kind: "confirm"})).toBe(false);
  });

  it("follows allowDecline when the ask sets it", () => {
    const prompt = "Go ahead?";
    expect(askAllowsDecline({input: {allowDecline: true, prompt}, kind: "confirm"})).toBe(true);
    expect(askAllowsDecline({input: {allowDecline: false, prompt}, kind: "confirm"})).toBe(false);
  });
});

describe("confirmButtonLabels", () => {
  it("uses the ask's labels, defaulting to Confirm and Cancel", () => {
    expect(confirmButtonLabels({prompt: "Go?"})).toEqual({confirm: "Confirm", deny: "Cancel"});
    expect(
      confirmButtonLabels({confirmLabel: "Delete 14 todos", denyLabel: "Keep them", prompt: "Go?"})
    ).toEqual({confirm: "Delete 14 todos", deny: "Keep them"});
  });
});
