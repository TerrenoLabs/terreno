import {describe, expect, it} from "bun:test";
import {z} from "zod";
import {ASK_ERROR_CODES, type AskErrorCode, finalizeAskErrors, issuesToAskErrors} from "./errors";
import type {ChoiceAskInput} from "./schema";
import {validateAskInput} from "./validateInput";
import {validateAskResponse} from "./validateResponse";

const INPUT: ChoiceAskInput = {
  options: [
    {id: "red", label: "Red"},
    {id: "blue", label: "Blue"},
  ],
  prompt: "Pick a color.",
  select: "one",
};

const inputCodes = (input: unknown): AskErrorCode[] =>
  validateAskInput({input, kind: "choice"}).map((error) => error.code);

const responseCodes = (response: unknown, input: ChoiceAskInput = INPUT): AskErrorCode[] =>
  validateAskResponse({input, kind: "choice", response}).map((error) => error.code);

const mapIssues = (schema: z.ZodType, root: unknown) => {
  const result = schema.safeParse(root);
  if (result.success) {
    throw new Error("Expected the schema to reject the value.");
  }
  return finalizeAskErrors(issuesToAskErrors({issues: result.error.issues, root}));
};

describe("ASK_ERROR_CODES", () => {
  const producers: Record<AskErrorCode, () => AskErrorCode[]> = {
    DECLINE_NOT_ALLOWED: () => responseCodes({action: "decline"}, {...INPUT, allowDecline: false}),
    DEFAULT_NOT_IN_OPTIONS: () => inputCodes({...INPUT, default: ["green"]}),
    DUPLICATE_ID: () =>
      inputCodes({
        ...INPUT,
        options: [
          {id: "red", label: "Red"},
          {id: "red", label: "Crimson"},
        ],
      }),
    INVALID_ENUM: () => inputCodes({...INPUT, select: "many"}),
    INVALID_FORMAT: () =>
      inputCodes({
        ...INPUT,
        options: [
          {id: "Red", label: "Red"},
          {id: "blue", label: "Blue"},
        ],
      }),
    INVALID_TYPE: () => inputCodes({...INPUT, prompt: 7}),
    MISSING_REQUIRED: () => inputCodes({options: INPUT.options, select: "one"}),
    OPTION_NOT_OFFERED: () => responseCodes({action: "accept", content: {selected: ["green"]}}),
    SELECTION_COUNT: () => responseCodes({action: "accept", content: {selected: ["red", "blue"]}}),
    TOO_FEW: () => inputCodes({...INPUT, options: [{id: "red", label: "Red"}]}),
    TOO_LONG: () => inputCodes({...INPUT, title: "t".repeat(81)}),
    TOO_MANY: () =>
      inputCodes({
        ...INPUT,
        options: Array.from({length: 51}, (_, index) => ({
          id: `c${index}`,
          label: `Color ${index}`,
        })),
      }),
    TOO_SHORT: () => inputCodes({...INPUT, prompt: ""}),
    UNKNOWN_KEY: () => inputCodes({...INPUT, color: "red"}),
  };

  for (const code of Object.keys(ASK_ERROR_CODES) as AskErrorCode[]) {
    it(`${code} is returned by a validator`, () => {
      expect(producers[code]()).toEqual([code]);
    });
  }

  it("has a producer for every code and no others", () => {
    expect(Object.keys(producers).sort()).toEqual(Object.keys(ASK_ERROR_CODES).sort());
  });
});

describe("issuesToAskErrors fallbacks", () => {
  it("reports a missing root value", () => {
    expect(validateAskInput({input: undefined, kind: "choice"})).toEqual([
      {
        code: "MISSING_REQUIRED",
        fix: "Send the value.",
        message: "The value is required.",
        path: "",
      },
    ]);
  });

  it("reports a missing list item by its index", () => {
    expect(mapIssues(z.array(z.string()), [undefined])).toEqual([
      {code: "MISSING_REQUIRED", fix: "Send [0].", message: "[0] is required.", path: "[0]"},
    ]);
  });

  it("names other string formats", () => {
    expect(mapIssues(z.object({contact: z.email()}), {contact: "not an email"})).toEqual([
      {
        code: "INVALID_FORMAT",
        fix: "Change contact to match the email format.",
        message: "contact does not match the email format.",
        path: "contact",
      },
    ]);
  });

  it("keeps the message of a custom issue without an ask code", () => {
    expect(
      mapIssues(
        z.string().refine(() => false, {message: "Nope."}),
        "x"
      )
    ).toEqual([{code: "INVALID_FORMAT", fix: "Check the value.", message: "Nope.", path: ""}]);
  });

  it("treats a union without a discriminator as a type error", () => {
    expect(mapIssues(z.object({value: z.union([z.string(), z.number()])}), {value: true})).toEqual([
      {
        code: "INVALID_TYPE",
        fix: "Check value.",
        message: "Invalid input",
        path: "value",
      },
    ]);
  });

  it("falls back to INVALID_TYPE for issue codes asks never produce", () => {
    expect(mapIssues(z.object({seats: z.number().multipleOf(5)}), {seats: 7})).toEqual([
      {
        code: "INVALID_TYPE",
        fix: "Check seats.",
        message: "Invalid number: must be a multiple of 5",
        path: "seats",
      },
    ]);
  });

  it("describes other expected and received types", () => {
    expect(
      mapIssues(z.object({count: z.number(), day: z.date(), tags: z.string()}), {
        count: {},
        day: "2026-09-27",
        tags: 10n,
      })
    ).toEqual([
      {
        code: "INVALID_TYPE",
        fix: "Make count a number.",
        message: "count must be a number, not an object.",
        path: "count",
      },
      {
        code: "INVALID_TYPE",
        fix: "Make day date.",
        message: "day must be date, not a string.",
        path: "day",
      },
      {
        code: "INVALID_TYPE",
        fix: "Make tags a string.",
        message: "tags must be a string, not bigint.",
        path: "tags",
      },
    ]);
  });

  it("describes booleans and null as received values", () => {
    expect(
      mapIssues(z.object({a: z.string(), b: z.string()}), {a: true, b: null}).map(
        (error) => error.message
      )
    ).toEqual(["a must be a string, not a boolean.", "b must be a string, not null."]);
  });
});
