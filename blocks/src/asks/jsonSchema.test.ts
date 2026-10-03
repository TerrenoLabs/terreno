import {describe, expect, it} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {z} from "zod";
import {validAskFixtures} from "../tests/askFixtures";
import {pendingAskListSchema, turnRequestSchema, turnResultSchema} from "./headless";
import {askJsonSchemas} from "./jsonSchema";
import {simpleCardSchema, toSimpleCard} from "./simpleCard";

const SCHEMAS_DIR = join(import.meta.dir, "..", "..", "schemas");

const documents = askJsonSchemas();

/** A Zod schema rebuilt from a committed document, standing in for a client's JSON Schema validator. */
const fromDocument = (fileName: string): z.ZodType => {
  const document = documents[fileName];
  if (!document) {
    throw new Error(`No JSON Schema document named ${fileName}.`);
  }
  return z.fromJSONSchema(document as Parameters<typeof z.fromJSONSchema>[0]);
};

const CARDS = validAskFixtures().map((fixture) =>
  toSimpleCard({input: fixture.input, kind: fixture.kind, toolCallId: "call_fixture"})
);

const [CARD] = CARDS;
if (!CARD) {
  throw new Error("The valid fixtures are missing.");
}

describe("askJsonSchemas", () => {
  it("matches the files committed in blocks/schemas (run `bun run schemas` in blocks/ to update them)", () => {
    const committed = Object.fromEntries(
      readdirSync(SCHEMAS_DIR)
        .sort()
        .map((fileName) => [
          fileName,
          JSON.parse(readFileSync(join(SCHEMAS_DIR, fileName), "utf8")) as unknown,
        ])
    );
    expect(committed).toEqual(documents);
  });

  it("writes draft-07 documents with a title and a description", () => {
    expect(Object.keys(documents).sort()).toEqual([
      "pendingAsksResponse.schema.json",
      "simpleCard.schema.json",
      "turnRequest.schema.json",
      "turnResponse.schema.json",
    ]);
    for (const document of Object.values(documents)) {
      expect(document.$schema).toBe("http://json-schema.org/draft-07/schema#");
      expect(typeof document.title).toBe("string");
      expect(typeof document.description).toBe("string");
    }
  });

  it("names nested types so generated code gets readable names", () => {
    const text = JSON.stringify(documents["turnResponse.schema.json"]);
    for (const title of ["TurnResult", "PendingAskSummary", "SimpleCard", "SimpleCardButton"]) {
      expect(text).toContain(`"title":"${title}"`);
    }
  });
});

describe("simpleCard.schema.json", () => {
  const fromJson = fromDocument("simpleCard.schema.json");

  it("accepts the card of every valid fixture, as simpleCardSchema does", () => {
    for (const card of CARDS) {
      expect(simpleCardSchema.safeParse(card).success).toBe(true);
      expect(fromJson.safeParse(card).success).toBe(true);
    }
  });

  it("rejects the cards simpleCardSchema rejects for their shape and limits", () => {
    const button = {id: "skip", label: "Skip", response: {action: "decline"}, style: "cancel"};
    const invalidCards = [
      {...CARD, buttons: ["a", "b", "c", "d"].map((id) => ({...button, id}))},
      {...CARD, buttons: [{...button, label: "x".repeat(21)}]},
      {...CARD, buttons: [{...button, style: "danger"}]},
      {...CARD, buttons: [{...button, response: {action: "skip"}}]},
      {...CARD, text: "x".repeat(141)},
      {...CARD, text: ""},
      {...CARD, title: "x".repeat(41)},
      {...CARD, kind: "signature"},
      {...CARD, color: "red"},
      {buttons: CARD.buttons, handoff: false, kind: "choice", toolCallId: "call_1"},
    ];
    for (const card of invalidCards) {
      expect(simpleCardSchema.safeParse(card).success).toBe(false);
      expect(fromJson.safeParse(card).success).toBe(false);
    }
  });
});

describe("turnRequest.schema.json", () => {
  const fromJson = fromDocument("turnRequest.schema.json");

  it("accepts every request shape turnRequestSchema accepts", () => {
    const bodies = [
      {prompt: "Help me pick a plan", surface: "compact"},
      {askResponse: {action: "accept", content: {selected: ["team"]}, toolCallId: "call_1"}},
      {askResponse: {action: "decline", toolCallId: "call_1"}},
      {buttonId: "option:team", surface: "full", toolCallId: "call_1"},
    ];
    for (const body of bodies) {
      expect(turnRequestSchema.safeParse(body).success).toBe(true);
      expect(fromJson.safeParse(body).success).toBe(true);
    }
  });

  it("rejects unknown fields, unknown surfaces, and answers without toolCallId", () => {
    const bodies = [
      {historyId: "h1", prompt: "Hi"},
      {prompt: "Hi", surface: "watch"},
      {askResponse: {action: "decline"}},
      {askResponse: {action: "skip", toolCallId: "call_1"}},
    ];
    for (const body of bodies) {
      expect(turnRequestSchema.safeParse(body).success).toBe(false);
      expect(fromJson.safeParse(body).success).toBe(false);
    }
  });

  it("leaves the one-shape rule to the server", () => {
    expect(fromJson.safeParse({}).success).toBe(true);
    expect(turnRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("turnResponse.schema.json and pendingAsksResponse.schema.json", () => {
  const turnResponse = fromDocument("turnResponse.schema.json");
  const pendingAsksResponse = fromDocument("pendingAsksResponse.schema.json");
  const result = {
    historyId: "h1",
    pendingAsk: {kind: "choice", simple: CARD, toolCallId: CARD.toolCallId},
    text: "",
    title: "Plans",
  };
  const item = {
    created: "2026-09-27T12:00:00.000Z",
    historyId: "h1",
    kind: "choice",
    simple: CARD,
    toolCallId: CARD.toolCallId,
  };

  const requestId = "3f0c9a52-7d1e-4b8a-9c65-2a4e1b7d9f30";

  it("accept the bodies the endpoints send, with or without the requestId TerrenoApp adds", () => {
    expect(turnResultSchema.safeParse(result).success).toBe(true);
    expect(pendingAskListSchema.safeParse([item]).success).toBe(true);
    for (const envelope of [{}, {requestId}]) {
      expect(turnResponse.safeParse({...envelope, data: result}).success).toBe(true);
      expect(pendingAsksResponse.safeParse({...envelope, data: [item]}).success).toBe(true);
      expect(pendingAsksResponse.safeParse({...envelope, data: []}).success).toBe(true);
    }
  });

  it("reject bodies missing required fields, with a bad timestamp, or with an unknown field", () => {
    expect(turnResponse.safeParse({data: {text: "Done."}}).success).toBe(false);
    expect(turnResponse.safeParse(result).success).toBe(false);
    expect(turnResponse.safeParse({data: result, requestID: requestId}).success).toBe(false);
    expect(pendingAsksResponse.safeParse({data: [{...item, created: "yesterday"}]}).success).toBe(
      false
    );
    expect(pendingAsksResponse.safeParse({data: [], requestId: 7}).success).toBe(false);
  });
});
