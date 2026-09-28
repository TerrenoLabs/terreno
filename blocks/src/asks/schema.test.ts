import {describe, expect, it} from "bun:test";
import {validAskFixtures} from "../tests/askFixtures";
import {formDefaultValues} from "./formValues";
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
  formAskInputSchema,
  isCompactAskKind,
  markdownAskInputSchema,
  markdownLengthBounds,
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
    expect(askInputSchemaFor({kind: "markdown"})).toBe(markdownAskInputSchema);
  });

  it("returns the form schema on the full surface and throws on compact", () => {
    expect(askInputSchemaFor({kind: "form"})).toBe(formAskInputSchema);
    expect(isCompactAskKind("form")).toBe(false);
    expect(() => askInputSchemaFor({kind: "form", surface: "compact"})).toThrow(
      'The compact surface does not offer ask kind "form".'
    );
  });

  it("does not offer markdown on the compact surface, because a draft cannot be edited there", () => {
    expect(isCompactAskKind("markdown")).toBe(false);
    expect(() => askInputSchemaFor({kind: "markdown", surface: "compact"})).toThrow(
      'The compact surface does not offer ask kind "markdown".'
    );
  });

  it("only narrows: every fixture the compact schema accepts, the full schema accepts", () => {
    for (const fixture of validAskFixtures()) {
      if (!isCompactAskKind(fixture.kind)) {
        continue;
      }
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

  it("defaults to true for markdown", () => {
    const prompt = "Edit the draft.";
    expect(askAllowsDecline({input: {prompt}, kind: "markdown"})).toBe(true);
    expect(askAllowsDecline({input: {allowDecline: false, prompt}, kind: "markdown"})).toBe(false);
  });
});

describe("ASK_KINDS", () => {
  it("lists form after markdown, so existing tool order is kept", () => {
    expect([...ASK_KINDS]).toEqual(["choice", "confirm", "markdown", "form"]);
  });
});

describe("askAllowsDecline for form", () => {
  it("defaults to true", () => {
    const input = {fields: [{id: "name", label: "Name", type: "text" as const}], prompt: "Go."};
    expect(askAllowsDecline({input, kind: "form"})).toBe(true);
    expect(askAllowsDecline({input: {...input, allowDecline: false}, kind: "form"})).toBe(false);
  });
});

describe("formDefaultValues", () => {
  it("keys each field's default by id and leaves fields without one out", () => {
    expect(
      formDefaultValues({
        fields: [
          {default: "Acme", id: "company", label: "Company", type: "text"},
          {id: "seats", label: "Seats", type: "number"},
          {default: false, id: "notify", label: "Notify", type: "boolean"},
          {default: 0, id: "count", label: "Count", type: "number"},
        ],
        prompt: "Go.",
      })
    ).toEqual({company: "Acme", count: 0, notify: false});
  });
});

describe("markdownLengthBounds", () => {
  it("defaults to 0 through the 20,000-character cap", () => {
    expect(markdownLengthBounds({})).toEqual({max: 20_000, min: 0});
    expect(markdownLengthBounds({maxLength: 400, minLength: 20})).toEqual({max: 400, min: 20});
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
