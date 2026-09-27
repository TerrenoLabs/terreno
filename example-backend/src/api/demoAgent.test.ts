import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {addGptRoutes, createAskTools, GptHistory, TITLE_GENERATION_PROMPT} from "@terreno/ai";
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

const askFor = async (prompt: string) => {
  const result = streamText({model: createDemoAgentModel(), prompt, tools: ASK_TOOLS});
  return {text: await result.text, toolCalls: await result.toolCalls};
};

const replyTo = async (response: Record<string, unknown>): Promise<string> => {
  const {toolCalls} = await askFor("Help me pick a plan");
  const [call] = toolCalls;
  if (!call) {
    throw new Error("The demo agent did not ask");
  }
  const messages: ModelMessage[] = [
    {content: "Help me pick a plan", role: "user"},
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
  const result = streamText({messages, model: createDemoAgentModel(), tools: ASK_TOOLS});
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

  it.each(["Help me pick a plan", "Which plans do you have?", "I am choosing a subscription"])(
    "asks which plan to set up for %p",
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
      const input = call.input as {options: {label: string}[]};
      expect(input).toMatchObject({
        default: ["team"],
        prompt: "Which plan should I set up for your workspace?",
        select: "one",
        title: "Choose a plan",
      });
      expect(input.options.map((option) => option.label)).toEqual([
        "Starter",
        "Team",
        "Enterprise",
      ]);
    }
  );

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

  it("explains how to try an ask when the message has no trigger words", async () => {
    const {text, toolCalls} = await askFor("Hello there");

    expect(toolCalls).toHaveLength(0);
    expect(text).toContain("I'm the Terreno demo agent");
    expect(text).toContain('Say "help me pick a plan"');
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
  });
});

describe("demo agent through /gpt/prompt", () => {
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
          addGptRoutes(router, {
            aiService: createDemoAgentService(),
            asks: true,
            openApiOptions: {openApi},
          });
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
});
