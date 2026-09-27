import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {
  addGptHistoryRoutes,
  addGptRoutes,
  COMPACT_SURFACE_SYSTEM_PROMPT,
  createAskTools,
  GptHistory,
  TITLE_GENERATION_PROMPT,
} from "@terreno/ai";
import {
  configureOpenApiValidator,
  generateTokens,
  resetOpenApiValidatorConfig,
  TerrenoApp,
} from "@terreno/api";
import {generateText, type ModelMessage, streamText} from "ai";
import express from "express";
import supertest from "supertest";

import {User as UserModel} from "../models/user";
import type {UserDocument} from "../types/models/userTypes";
import {createDemoAgentModel, createDemoAgentService, DEMO_AGENT_MODEL_ID} from "./demoAgent";

const ASK_TOOLS = createAskTools({kinds: ["choice"]});
const COMPACT_ASK_TOOLS = createAskTools({kinds: ["choice"], surface: "compact"});

interface SurfaceOptions {
  /** Calls the model the way a `surface: "compact"` turn does: the compact line and compact ask tools. */
  isCompact?: boolean;
}

const surfaceCallOptions = ({isCompact = false}: SurfaceOptions) => ({
  system: isCompact ? COMPACT_SURFACE_SYSTEM_PROMPT : undefined,
  tools: isCompact ? COMPACT_ASK_TOOLS : ASK_TOOLS,
});

const askFor = async (prompt: string, surface: SurfaceOptions = {}) => {
  const result = streamText({
    model: createDemoAgentModel(),
    prompt,
    ...surfaceCallOptions(surface),
  });
  return {text: await result.text, toolCalls: await result.toolCalls};
};

const replyTo = async (
  response: Record<string, unknown>,
  surface: SurfaceOptions = {},
  userPrompt = "Help me pick a plan"
): Promise<string> => {
  const {toolCalls} = await askFor(userPrompt, surface);
  const [call] = toolCalls;
  if (!call) {
    throw new Error("The demo agent did not ask");
  }
  const messages: ModelMessage[] = [
    {content: userPrompt, role: "user"},
    {
      content: [
        {
          input: call.input,
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          type: "tool-call",
        },
      ],
      role: "assistant",
    },
    {
      content: [
        {
          output: {type: "json", value: response as never},
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          type: "tool-result",
        },
      ],
      role: "tool",
    },
  ];
  const result = streamText({
    messages,
    model: createDemoAgentModel(),
    ...surfaceCallOptions(surface),
  });
  return result.text;
};

const titleFor = async (conversation: string): Promise<string> => {
  const result = await generateText({
    model: createDemoAgentModel(),
    prompt: conversation,
    system: TITLE_GENERATION_PROMPT,
  });
  return result.text;
};

const parseEvents = (body: string): Record<string, unknown>[] =>
  body
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice("data: ".length)) as Record<string, unknown>);

describe("demo agent", () => {
  it("names its model terreno-demo-agent", () => {
    expect(createDemoAgentModel().modelId).toBe(DEMO_AGENT_MODEL_ID);
    expect(createDemoAgentService().modelId).toBe("terreno-demo-agent");
  });

  it.each([
    "Help me pick a plan",
    "Which plans do you have?",
    "I am choosing a subscription",
    "Help me choose between several plans",
  ])("asks which plan to set up for %p", async (prompt) => {
    const {text, toolCalls} = await askFor(prompt);

    expect(text).toBe("");
    expect(toolCalls).toHaveLength(1);
    const [call] = toolCalls;
    if (!call) {
      throw new Error("The demo agent did not ask");
    }
    expect(call.toolName).toBe("ask_choice");
    expect(call.invalid).toBeFalsy();
    const input = call.input as {options: {label: string}[]};
    expect(input).toMatchObject({
      default: ["team"],
      prompt: "Which plan should I set up for your workspace?",
      select: "one",
      title: "Choose a plan",
    });
    expect(input.options.map((option) => option.label)).toEqual(["Starter", "Team", "Enterprise"]);
  });

  it("replies with the plan the user picked", async () => {
    const text = await replyTo({action: "accept", content: {selected: ["enterprise"]}});

    expect(text).toContain("You picked the **Enterprise** plan");
    expect(text).toContain("SSO, audit logs, and a support contract");
  });

  it("acknowledges a skipped plan question", async () => {
    const text = await replyTo({action: "decline"});

    expect(text).toContain("I skipped the plan for now");
  });

  it("explains a cancelled plan question", async () => {
    const text = await replyTo({action: "cancel", reason: "user_sent_message"});

    expect(text).toBe("The plan question was cancelled, so I did not choose a plan.");
  });

  it.each(["Pick toppings for my pizza", "Let me pick several toppings"])(
    "asks which toppings to add, several with Other, for %p",
    async (prompt) => {
      const {text, toolCalls} = await askFor(prompt);

      expect(text).toBe("");
      expect(toolCalls).toHaveLength(1);
      const [call] = toolCalls;
      if (!call) {
        throw new Error("The demo agent did not ask");
      }
      expect(call.toolName).toBe("ask_choice");
      expect(call.invalid).toBeFalsy();
      expect(call.toolCallId).toStartWith("demo_toppings_");
      const input = call.input as {options: {id: string}[]};
      expect(input).toMatchObject({
        allowOther: true,
        default: ["cheese", "mushrooms"],
        maxSelected: 3,
        otherLabel: "Another topping",
        select: "many",
        title: "Build your pizza",
      });
      expect(input.options.map((option) => option.id)).toEqual([
        "cheese",
        "mushrooms",
        "olives",
        "peppers",
        "pineapple",
        "onions",
      ]);
    }
  );

  it("replies with the toppings the user picked and the one they typed", async () => {
    const text = await replyTo(
      {action: "accept", content: {other: "Basil", selected: ["cheese", "olives"]}},
      {},
      "Pick toppings"
    );

    expect(text).toBe(
      'You picked **Extra cheese**, **Olives**, and your own topping, **Basil**. A real agent would add them to the order now. Say "pick toppings" to try another answer.'
    );
  });

  it("replies to an Other-only answer and to a skipped toppings question", async () => {
    expect(
      await replyTo({action: "accept", content: {other: "Anchovies", selected: []}}, {}, "Toppings")
    ).toContain("You picked your own topping, **Anchovies**.");
    expect(await replyTo({action: "decline"}, {}, "Toppings")).toContain(
      "I left the pizza as it is"
    );
  });

  it("explains how to try an ask when the message has no trigger words", async () => {
    const {text, toolCalls} = await askFor("Hello there");

    expect(toolCalls).toHaveLength(0);
    expect(text).toContain("I'm the Terreno demo agent");
    expect(text).toContain('Say "help me pick a plan"');
    expect(text).toContain('"pick toppings"');
    expect(text).toContain("GEMINI_API_KEY");
  });

  it("says asks are off when the route offers no ask tool", async () => {
    const result = streamText({model: createDemoAgentModel(), prompt: "Help me pick a plan"});

    expect(await result.toolCalls).toHaveLength(0);
    expect(await result.text).toContain("Pass `asks: true` to addGptRoutes");
  });

  it("titles a plan conversation from the user's message only", async () => {
    expect(
      await titleFor("User: Help me pick a plan\nAssistant: You picked the **Team** plan.")
    ).toBe("Choosing a plan");
    expect(await titleFor('User: Hello there\nAssistant: Say "help me pick a plan".')).toBe(
      "Demo agent chat"
    );
    expect(await titleFor("User: Pick toppings\nAssistant: You picked **Olives**.")).toBe(
      "Building a pizza"
    );
  });
});

describe("demo agent on the compact surface", () => {
  it("asks the plan question with input the compact ask tool accepts", async () => {
    const {text, toolCalls} = await askFor("Help me pick a plan", {isCompact: true});

    expect(text).toBe("");
    expect(toolCalls).toHaveLength(1);
    const [call] = toolCalls;
    if (!call) {
      throw new Error("The demo agent did not ask");
    }
    expect(call.toolName).toBe("ask_choice");
    expect(call.invalid).toBeFalsy();
    const input = call.input as {options: {label: string}[]};
    expect(input.options.map((option) => option.label)).toEqual(["Starter", "Team", "Enterprise"]);
  });

  it("replies to the picked plan in two short sentences without markdown", async () => {
    const text = await replyTo(
      {action: "accept", content: {selected: ["enterprise"]}},
      {isCompact: true}
    );

    expect(text).toBe("You picked the Enterprise plan. A real agent would set it up now.");
  });

  it("acknowledges a skipped plan question in one sentence", async () => {
    expect(await replyTo({action: "decline"}, {isCompact: true})).toBe(
      "OK, I skipped the plan for now."
    );
  });

  it("sends the toppings question as text, since the compact surface cannot pick several", async () => {
    const {text, toolCalls} = await askFor("Pick toppings", {isCompact: true});

    expect(toolCalls).toHaveLength(0);
    expect(text).toBe(
      'Picking several toppings needs a bigger screen. Open the chat on your phone and say "pick toppings".'
    );
  });

  it("explains how to try an ask in two short sentences", async () => {
    const {text, toolCalls} = await askFor("Hello there", {isCompact: true});

    expect(toolCalls).toHaveLength(0);
    expect(text).toBe(`I'm the Terreno demo agent. Say "help me pick a plan" to choose a plan.`);
  });

  it("says asks are off in one sentence when the route offers no ask tool", async () => {
    const result = streamText({
      model: createDemoAgentModel(),
      prompt: "Help me pick a plan",
      system: COMPACT_SURFACE_SYSTEM_PROMPT,
    });

    expect(await result.text).toBe(
      "Asks are turned off on this server, so I cannot ask you to choose."
    );
  });
});

describe("demo agent through the chat routes", () => {
  let app: ReturnType<TerrenoApp["build"]>;

  const signIn = async (): Promise<string> => {
    const email = `demo-agent-${crypto.randomUUID()}@example.com`;
    const user = (await UserModel.register(
      {admin: false, email, name: email} as never,
      "password12345"
    )) as unknown as UserDocument;
    const {token} = await generateTokens(user);
    if (!token) {
      throw new Error("No token generated");
    }
    return token;
  };

  beforeAll(() => {
    process.env.TOKEN_SECRET = process.env.TOKEN_SECRET || "test-secret";
    process.env.TOKEN_ISSUER = process.env.TOKEN_ISSUER || "example-backend-test";
    configureOpenApiValidator();
    app = new TerrenoApp({skipListen: true, userModel: UserModel as never})
      .register({
        register: (expressApp, openApi) => {
          const router = express.Router();
          const chat = {aiService: createDemoAgentService(), asks: true, openApiOptions: {openApi}};
          addGptHistoryRoutes(router, {chat, openApiOptions: {openApi}});
          addGptRoutes(router, chat);
          expressApp.use(router);
        },
      })
      .build();
  });

  afterAll(() => {
    resetOpenApiValidatorConfig();
  });

  it("pauses on the plan ask and continues with the user's answer", async () => {
    const token = await signIn();

    const asked = await supertest(app)
      .post("/gpt/prompt")
      .set("Authorization", `Bearer ${token}`)
      .send({prompt: "Help me pick a plan"});
    expect(asked.status).toBe(200);
    const askedEvents = parseEvents(asked.text);
    const ask = askedEvents.find((event) => "ask" in event)?.ask as {
      kind: string;
      simple: {buttons: {id: string}[]; handoff: boolean};
      toolCallId: string;
    };
    expect(ask.kind).toBe("choice");
    expect(ask.simple.handoff).toBe(false);
    expect(ask.simple.buttons.map((button) => button.id)).toEqual([
      "option:team",
      "option:starter",
      "option:enterprise",
    ]);
    const askedDone = askedEvents.at(-1) as {
      done: boolean;
      historyId: string;
      pendingAsk: {toolCallId: string};
    };
    expect(askedDone.done).toBe(true);
    expect(askedDone.pendingAsk).toEqual({toolCallId: ask.toolCallId});

    const answered = await supertest(app)
      .post("/gpt/prompt")
      .set("Authorization", `Bearer ${token}`)
      .send({
        askResponse: {
          action: "accept",
          content: {selected: ["enterprise"]},
          toolCallId: ask.toolCallId,
        },
        historyId: askedDone.historyId,
      });
    expect(answered.status).toBe(200);
    const answeredEvents = parseEvents(answered.text);
    expect(answeredEvents[0]).toEqual({
      askResolved: {action: "accept", toolCallId: ask.toolCallId},
    });
    const text = answeredEvents
      .map((event) => (typeof event.text === "string" ? event.text : ""))
      .join("");
    expect(text).toContain("You picked the **Enterprise** plan");
    expect(answeredEvents.at(-1)).toEqual({
      done: true,
      historyId: askedDone.historyId,
      title: "Choosing a plan",
    });

    const history = await GptHistory.findById(askedDone.historyId).lean();
    const askRow = history?.prompts.find((row) => row.toolCallId === ask.toolCallId && row.ask);
    expect(askRow?.ask?.status).toBe("answered");
    expect(history?.prompts.at(-1)).toMatchObject({model: "terreno-demo-agent", type: "assistant"});
  });

  it("pauses on the toppings ask and continues with the picked ids and the Other text", async () => {
    const auth = {Authorization: `Bearer ${await signIn()}`};

    const asked = await supertest(app)
      .post("/gpt/prompt")
      .set(auth)
      .send({prompt: "Pick toppings for my pizza"});
    expect(asked.status).toBe(200);
    const askedEvents = parseEvents(asked.text);
    const ask = askedEvents.find((event) => "ask" in event)?.ask as {
      input: {select: string};
      simple: {buttons: {id: string}[]; handoff: boolean};
      toolCallId: string;
    };
    expect(ask.input.select).toBe("many");
    expect(ask.simple.handoff).toBe(true);
    expect(ask.simple.buttons.map((button) => button.id)).toEqual(["use-default", "skip"]);
    const {historyId} = askedEvents.at(-1) as {historyId: string};

    const tooMany = await supertest(app)
      .post("/gpt/prompt")
      .set(auth)
      .send({
        askResponse: {
          action: "accept",
          content: {other: "Basil", selected: ["cheese", "olives", "peppers"]},
          toolCallId: ask.toolCallId,
        },
        historyId,
      });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.fields.map((field: {code: string}) => field.code)).toEqual([
      "SELECTION_COUNT",
    ]);

    const response = {
      action: "accept",
      content: {other: "Basil", selected: ["cheese", "olives"]},
    };
    const answered = await supertest(app)
      .post("/gpt/prompt")
      .set(auth)
      .send({askResponse: {...response, toolCallId: ask.toolCallId}, historyId});
    expect(answered.status).toBe(200);
    const answeredEvents = parseEvents(answered.text);
    const text = answeredEvents
      .map((event) => (typeof event.text === "string" ? event.text : ""))
      .join("");
    expect(text).toContain(
      "You picked **Extra cheese**, **Olives**, and your own topping, **Basil**."
    );
    expect(answeredEvents.at(-1)).toEqual({done: true, historyId, title: "Building a pizza"});

    const history = await GptHistory.findById(historyId).lean();
    const resultRow = history?.prompts.find(
      (row) => row.toolCallId === ask.toolCallId && row.type === "tool-result"
    );
    expect(resultRow?.result).toEqual(response);
  });

  it("answers other messages with the demo agent's help", async () => {
    const token = await signIn();

    const res = await supertest(app)
      .post("/gpt/prompt")
      .set("Authorization", `Bearer ${token}`)
      .send({prompt: "What can you do?"});

    expect(res.status).toBe(200);
    const events = parseEvents(res.text);
    const text = events.map((event) => (typeof event.text === "string" ? event.text : "")).join("");
    expect(text).toContain('Say "help me pick a plan"');
    expect(events.some((event) => "ask" in event)).toBe(false);
  });

  it("answers the plan ask from a small screen with a button of its simple card", async () => {
    const auth = {Authorization: `Bearer ${await signIn()}`};
    const created = await supertest(app).post("/gpt/histories").set(auth).send({});
    expect(created.status).toBe(201);
    const historyId = created.body.data._id as string;
    const turnPath = `/gpt/histories/${historyId}/turn`;

    const asked = await supertest(app)
      .post(turnPath)
      .set(auth)
      .send({prompt: "Help me pick a plan", surface: "compact"});
    expect(asked.status).toBe(200);
    expect(asked.body.data.text).toBe("");
    const {pendingAsk} = asked.body.data as {
      pendingAsk: {
        kind: string;
        simple: {buttons: {id: string}[]; handoff: boolean};
        toolCallId: string;
      };
    };
    expect(pendingAsk.kind).toBe("choice");
    expect(pendingAsk.simple.handoff).toBe(false);
    expect(pendingAsk.simple.buttons.map((button) => button.id)).toEqual([
      "option:team",
      "option:starter",
      "option:enterprise",
    ]);

    const listed = await supertest(app).get("/gpt/histories/pendingAsks").set(auth);
    expect(listed.status).toBe(200);
    expect(listed.body.data).toEqual([
      {
        created: expect.any(String),
        historyId,
        kind: "choice",
        simple: pendingAsk.simple,
        toolCallId: pendingAsk.toolCallId,
      },
    ]);

    const answered = await supertest(app)
      .post(turnPath)
      .set(auth)
      .send({buttonId: "option:starter", surface: "compact", toolCallId: pendingAsk.toolCallId});
    expect(answered.status).toBe(200);
    expect(answered.body.data).toEqual({
      historyId,
      text: "You picked the Starter plan. A real agent would set it up now.",
      title: "Choosing a plan",
    });
    const remaining = await supertest(app).get("/gpt/histories/pendingAsks").set(auth);
    expect(remaining.body.data).toEqual([]);
  });
});
