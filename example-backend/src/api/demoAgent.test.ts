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

const ASK_TOOLS = createAskTools({kinds: ["choice", "confirm", "markdown", "form"]});
const COMPACT_ASK_TOOLS = createAskTools({
  kinds: ["choice", "confirm", "markdown", "form"],
  surface: "compact",
});

const INVOICE_DEFAULTS = {
  company: "Acme Corp",
  email: "billing@acme.example",
  notify: true,
  region: "us",
  seats: 5,
};

const ANNOUNCEMENT_DRAFT =
  "# We're live\n\nToday we launched **Terreno Asks**: your agent can now ask you a question and wait for the answer.\n\n- Pick from options\n- Approve or deny\n- Edit a draft like this one\n";

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
    expect(text).toContain('"send the weekly report"');
    expect(text).toContain('"archive old chats"');
    expect(text).toContain('"draft an announcement"');
    expect(text).toContain('"invoice details"');
    expect(text).toContain("GEMINI_API_KEY");
  });

  it.each(["Draft an announcement", "Write the launch announcements"])(
    "asks the user to edit an announcement draft for %p",
    async (prompt) => {
      const {text, toolCalls} = await askFor(prompt);

      expect(text).toBe("");
      expect(toolCalls).toHaveLength(1);
      const [call] = toolCalls;
      expect(call?.toolName).toBe("ask_markdown");
      expect(call?.invalid).toBeFalsy();
      expect(call?.toolCallId).toStartWith("demo_announcement_");
      expect(call?.input).toEqual({
        initial: ANNOUNCEMENT_DRAFT,
        maxLength: 2000,
        minLength: 40,
        placeholder: "Write the announcement",
        prompt: "Here is a draft of the launch announcement. Edit it, or approve it as is.",
        submitLabel: "Post it",
        title: "Launch announcement",
      });
    }
  );

  it.each([
    {
      expected:
        'You approved the draft as is, so a real agent would post it now. Say "draft an announcement" to try another answer.',
      response: {action: "accept", content: {changed: false, markdown: ANNOUNCEMENT_DRAFT}},
    },
    {
      expected:
        'You edited the draft (17 characters). A real agent would post this now:\n\n---\n\n# We shipped Asks\n\n---\n\nSay "draft an announcement" to try another answer.',
      response: {action: "accept", content: {changed: true, markdown: "# We shipped Asks"}},
    },
    {
      expected:
        'No problem, I dropped the announcement. Say "draft an announcement" when you want a new draft.',
      response: {action: "decline"},
    },
    {
      expected: "The announcement question was cancelled, so I did not post anything.",
      response: {action: "cancel", reason: "user_sent_message"},
    },
  ])("replies to the announcement answer $response", async ({expected, response}) => {
    expect(await replyTo(response, {}, "Draft an announcement")).toBe(expected);
  });

  it("titles an announcement conversation from the user's message", async () => {
    expect(await titleFor("User: Draft an announcement\nAssistant: OK.")).toBe(
      "Drafting an announcement"
    );
  });

  it.each(["Fill in the invoice details", "Let me fill out a form"])(
    "asks the user to fill in the invoice form for %p",
    async (prompt) => {
      const {text, toolCalls} = await askFor(prompt);

      expect(text).toBe("");
      expect(toolCalls).toHaveLength(1);
      const [call] = toolCalls;
      expect(call?.toolName).toBe("ask_form");
      expect(call?.invalid).toBeFalsy();
      expect(call?.toolCallId).toStartWith("demo_invoice_");
      const input = call?.input as {
        fields: {default?: unknown; id: string; required?: boolean; type: string}[];
        submitLabel: string;
        title: string;
      };
      expect(input.title).toBe("Invoice details");
      expect(input.submitLabel).toBe("Send details");
      expect(input.fields.map(({id, type}) => `${id}:${type}`)).toEqual([
        "company:text",
        "email:email",
        "phone:phone",
        "seats:number",
        "start:date",
        "region:select",
        "notify:boolean",
        "notes:textarea",
      ]);
      expect(
        Object.fromEntries(
          input.fields.flatMap((field) =>
            field.default === undefined ? [] : [[field.id, field.default]]
          )
        )
      ).toEqual(INVOICE_DEFAULTS);
    }
  );

  it.each([
    {
      expected: [
        "Thanks. A real agent would create the invoice with these details:",
        "",
        "- **Company name:** Globex",
        "- **Billing email:** ap@globex.example",
        "- **Seats:** 12",
        "- **Start date:** 2026-10-01",
        "- **Region:** European Union",
        "- **Email me the invoice:** No",
        "",
        'Say "invoice details" to try another answer.',
      ].join("\n"),
      response: {
        action: "accept",
        content: {
          values: {
            company: "Globex",
            email: "ap@globex.example",
            notify: false,
            region: "eu",
            seats: 12,
            start: "2026-10-01",
          },
        },
      },
    },
    {
      expected:
        'No problem, I did not create an invoice. Say "invoice details" when you want to fill them in.',
      response: {action: "decline"},
    },
    {
      expected: "The invoice question was cancelled, so I did not create an invoice.",
      response: {action: "cancel", reason: "user_sent_message"},
    },
  ])("replies to the invoice form answer $response.action", async ({expected, response}) => {
    expect(await replyTo(response, {}, "Invoice details")).toBe(expected);
  });

  it("titles an invoice conversation from the user's message", async () => {
    expect(await titleFor("User: Fill out a form\nAssistant: OK.")).toBe(
      "Filling in invoice details"
    );
  });

  it("says asks are off when the route offers no ask tool", async () => {
    const result = streamText({model: createDemoAgentModel(), prompt: "Help me pick a plan"});

    expect(await result.toolCalls).toHaveLength(0);
    expect(await result.text).toContain("Pass `asks: true` to addGptRoutes");
  });

  it.each([
    {
      id: "report",
      input: {
        confirmLabel: "Send report",
        denyLabel: "Not now",
        prompt: "Send the weekly report to the team now? It goes to 8 people.",
        title: "Send the weekly report",
      },
      prompt: "Send the weekly report",
    },
    {
      id: "archive",
      input: {
        confirmLabel: "Archive 12 chats",
        denyLabel: "Keep them",
        destructive: true,
        prompt: "Archive the 12 chats older than 90 days? You can't undo this.",
        title: "Archive old chats",
      },
      prompt: "Please archive old chats",
    },
  ])("asks to confirm before the $id action", async ({id, input, prompt}) => {
    const {text, toolCalls} = await askFor(prompt);

    expect(text).toBe("");
    expect(toolCalls).toHaveLength(1);
    const [call] = toolCalls;
    if (!call) {
      throw new Error("The demo agent did not ask");
    }
    expect(call.toolName).toBe("ask_confirm");
    expect(call.invalid).toBeFalsy();
    expect(call.toolCallId).toStartWith(`demo_${id}_`);
    expect(call.input).toEqual(input);
  });

  it.each([
    {
      expected:
        'You said yes, so a real agent would send the **weekly report** to the team now. Say "send the weekly report" to try another answer.',
      prompt: "Send the weekly report",
      response: {action: "accept", content: {confirmed: true}},
    },
    {
      expected:
        'OK, I did not send the weekly report. Say "send the weekly report" to try another answer.',
      prompt: "Send the weekly report",
      response: {action: "accept", content: {confirmed: false}},
    },
    {
      expected:
        'You confirmed, so a real agent would archive the **12 chats** older than 90 days now. This demo archived nothing. Say "archive old chats" to try another answer.',
      prompt: "Archive old chats",
      response: {action: "accept", content: {confirmed: true}},
    },
    {
      expected: 'OK, I kept all your chats. Say "archive old chats" to try another answer.',
      prompt: "Archive old chats",
      response: {action: "accept", content: {confirmed: false}},
    },
    {
      expected: "The archive question was cancelled, so I kept your chats.",
      prompt: "Archive old chats",
      response: {action: "cancel", reason: "user_sent_message"},
    },
  ])("replies to $response for $prompt", async ({expected, prompt, response}) => {
    expect(await replyTo(response, {}, prompt)).toBe(expected);
  });

  it("titles confirm conversations from the user's message", async () => {
    expect(await titleFor("User: Send the weekly report\nAssistant: OK.")).toBe(
      "Sending the weekly report"
    );
    expect(await titleFor("User: Archive old chats\nAssistant: OK.")).toBe("Archiving old chats");
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

  it("sends the announcement question as text, since the compact surface has no markdown ask", async () => {
    const {text, toolCalls} = await askFor("Draft an announcement", {isCompact: true});

    expect(toolCalls).toHaveLength(0);
    expect(text).toBe(
      'Editing a draft needs a bigger screen. Open the chat on your phone and say "draft an announcement".'
    );
  });

  it.each([
    {
      expected: "You approved the draft. A real agent would post it now.",
      response: {action: "accept", content: {changed: false, markdown: ANNOUNCEMENT_DRAFT}},
    },
    {
      expected: "You edited the draft (1,500 characters). A real agent would post it now.",
      response: {action: "accept", content: {changed: true, markdown: "a".repeat(1500)}},
    },
    {expected: "OK, I dropped the announcement.", response: {action: "decline"}},
  ])(
    "replies to an announcement answer answered on a small screen: $expected",
    async ({expected, response}) => {
      const messages: ModelMessage[] = [
        {content: "Draft an announcement", role: "user"},
        {
          content: [
            {
              input: {initial: ANNOUNCEMENT_DRAFT, prompt: "Edit it."},
              toolCallId: "demo_announcement_1",
              toolName: "ask_markdown",
              type: "tool-call",
            },
          ],
          role: "assistant",
        },
        {
          content: [
            {
              output: {type: "json", value: response as never},
              toolCallId: "demo_announcement_1",
              toolName: "ask_markdown",
              type: "tool-result",
            },
          ],
          role: "tool",
        },
      ];
      const result = streamText({
        messages,
        model: createDemoAgentModel(),
        ...surfaceCallOptions({isCompact: true}),
      });

      expect(await result.text).toBe(expected);
    }
  );

  it("sends the invoice form as text, since the compact surface has no form ask", async () => {
    const {text, toolCalls} = await askFor("Invoice details", {isCompact: true});

    expect(toolCalls).toHaveLength(0);
    expect(text).toBe(
      'Filling in a form needs a bigger screen. Open the chat on your phone and say "invoice details".'
    );
  });

  it.each([
    {
      expected:
        "You sent the invoice details (5 fields). A real agent would create the invoice now.",
      response: {action: "accept", content: {values: INVOICE_DEFAULTS}},
    },
    {expected: "OK, no invoice for now.", response: {action: "decline"}},
  ])(
    "replies to an invoice answer answered on a small screen: $expected",
    async ({expected, response}) => {
      const messages: ModelMessage[] = [
        {content: "Invoice details", role: "user"},
        {
          content: [
            {
              input: {fields: [], prompt: "Details."},
              toolCallId: "demo_invoice_1",
              toolName: "ask_form",
              type: "tool-call",
            },
          ],
          role: "assistant",
        },
        {
          content: [
            {
              output: {type: "json", value: response as never},
              toolCallId: "demo_invoice_1",
              toolName: "ask_form",
              type: "tool-result",
            },
          ],
          role: "tool",
        },
      ];
      const result = streamText({
        messages,
        model: createDemoAgentModel(),
        ...surfaceCallOptions({isCompact: true}),
      });

      expect(await result.text).toBe(expected);
    }
  );

  it.each(["Send the weekly report", "Archive old chats"])(
    "asks to confirm %p with the compact ask tool",
    async (prompt) => {
      const {toolCalls} = await askFor(prompt, {isCompact: true});

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]?.toolName).toBe("ask_confirm");
      expect(toolCalls[0]?.invalid).toBeFalsy();
    }
  );

  it.each([
    {confirmed: true, expected: "Confirmed. A real agent would archive 12 chats now."},
    {confirmed: false, expected: "OK, I kept your chats."},
  ])(
    "replies to an archive answer of $confirmed in short sentences",
    async ({confirmed, expected}) => {
      expect(
        await replyTo(
          {action: "accept", content: {confirmed}},
          {isCompact: true},
          "Archive old chats"
        )
      ).toBe(expected);
    }
  );

  it.each([
    {confirmed: true, expected: "OK. A real agent would send the weekly report now."},
    {confirmed: false, expected: "OK, I did not send the report."},
  ])(
    "replies to a report answer of $confirmed in short sentences",
    async ({confirmed, expected}) => {
      expect(
        await replyTo(
          {action: "accept", content: {confirmed}},
          {isCompact: true},
          "Send the weekly report"
        )
      ).toBe(expected);
    }
  );

  it("explains how to try an ask in two short sentences", async () => {
    const {text, toolCalls} = await askFor("Hello there", {isCompact: true});

    expect(toolCalls).toHaveLength(0);
    expect(text).toBe(
      `I'm the Terreno demo agent. Say "help me pick a plan" or "archive old chats" to try an ask.`
    );
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

  it("pauses on the archive confirm, refuses Skip, and continues with the deny answer", async () => {
    const auth = {Authorization: `Bearer ${await signIn()}`};

    const asked = await supertest(app)
      .post("/gpt/prompt")
      .set(auth)
      .send({prompt: "Archive old chats"});
    expect(asked.status).toBe(200);
    const askedEvents = parseEvents(asked.text);
    const ask = askedEvents.find((event) => "ask" in event)?.ask as {
      kind: string;
      simple: {buttons: {id: string; label: string; style: string}[]; handoff: boolean};
      toolCallId: string;
    };
    expect(ask.kind).toBe("confirm");
    expect(ask.simple.handoff).toBe(false);
    expect(ask.simple.buttons.map(({id, label, style}) => ({id, label, style}))).toEqual([
      {id: "approve", label: "Archive 12 chats", style: "destructive"},
      {id: "deny", label: "Keep them", style: "cancel"},
    ]);
    const {historyId} = askedEvents.at(-1) as {historyId: string};

    const skipped = await supertest(app)
      .post("/gpt/prompt")
      .set(auth)
      .send({askResponse: {action: "decline", toolCallId: ask.toolCallId}, historyId});
    expect(skipped.status).toBe(400);
    expect(skipped.body.fields.map((field: {code: string}) => field.code)).toEqual([
      "DECLINE_NOT_ALLOWED",
    ]);

    const response = {action: "accept", content: {confirmed: false}};
    const answered = await supertest(app)
      .post("/gpt/prompt")
      .set(auth)
      .send({askResponse: {...response, toolCallId: ask.toolCallId}, historyId});
    expect(answered.status).toBe(200);
    const answeredEvents = parseEvents(answered.text);
    const text = answeredEvents
      .map((event) => (typeof event.text === "string" ? event.text : ""))
      .join("");
    expect(text).toBe('OK, I kept all your chats. Say "archive old chats" to try another answer.');
    expect(answeredEvents.at(-1)).toEqual({done: true, historyId, title: "Archiving old chats"});

    const history = await GptHistory.findById(historyId).lean();
    const askRow = history?.prompts.find((row) => row.toolCallId === ask.toolCallId && row.ask);
    expect(askRow?.ask).toEqual({kind: "confirm", status: "answered"});
  });

  it("pauses on the announcement draft, rejects a false changed flag, and continues with the edit", async () => {
    const auth = {Authorization: `Bearer ${await signIn()}`};

    const asked = await supertest(app)
      .post("/gpt/prompt")
      .set(auth)
      .send({prompt: "Draft an announcement"});
    expect(asked.status).toBe(200);
    const askedEvents = parseEvents(asked.text);
    const ask = askedEvents.find((event) => "ask" in event)?.ask as {
      input: {initial: string};
      kind: string;
      simple: {buttons: {id: string; label: string}[]; handoff: boolean};
      toolCallId: string;
    };
    expect(ask.kind).toBe("markdown");
    expect(ask.input.initial).toBe(ANNOUNCEMENT_DRAFT);
    expect(ask.simple.handoff).toBe(true);
    expect(ask.simple.buttons.map(({id, label}) => ({id, label}))).toEqual([
      {id: "approve", label: "Approve draft"},
      {id: "cancel", label: "Cancel"},
    ]);
    const {historyId} = askedEvents.at(-1) as {historyId: string};
    const edited = `${ANNOUNCEMENT_DRAFT}\nThanks to everyone who tried the beta.\n`;

    const mismatched = await supertest(app)
      .post("/gpt/prompt")
      .set(auth)
      .send({
        askResponse: {
          action: "accept",
          content: {changed: false, markdown: edited},
          toolCallId: ask.toolCallId,
        },
        historyId,
      });
    expect(mismatched.status).toBe(400);
    expect(mismatched.body.fields.map((field: {code: string}) => field.code)).toEqual([
      "CHANGED_MISMATCH",
    ]);

    const response = {action: "accept", content: {changed: true, markdown: edited}};
    const answered = await supertest(app)
      .post("/gpt/prompt")
      .set(auth)
      .send({askResponse: {...response, toolCallId: ask.toolCallId}, historyId});
    expect(answered.status).toBe(200);
    const answeredEvents = parseEvents(answered.text);
    const text = answeredEvents
      .map((event) => (typeof event.text === "string" ? event.text : ""))
      .join("");
    expect(text).toStartWith(
      `You edited the draft (${edited.length} characters). A real agent would post this now:`
    );
    expect(text).toContain("Thanks to everyone who tried the beta.");
    expect(answeredEvents.at(-1)).toEqual({
      done: true,
      historyId,
      title: "Drafting an announcement",
    });

    const history = await GptHistory.findById(historyId).lean();
    const resultRow = history?.prompts.find(
      (row) => row.toolCallId === ask.toolCallId && row.type === "tool-result"
    );
    expect(resultRow?.result).toEqual(response);
  });

  it("approves the announcement draft as is from a small screen with the card's Approve button", async () => {
    const auth = {Authorization: `Bearer ${await signIn()}`};

    const asked = await supertest(app)
      .post("/gpt/prompt")
      .set(auth)
      .send({prompt: "Draft an announcement"});
    const {historyId} = parseEvents(asked.text).at(-1) as {historyId: string};

    const listed = await supertest(app).get("/gpt/histories/pendingAsks").set(auth);
    expect(listed.status).toBe(200);
    const [pending] = listed.body.data as {
      kind: string;
      simple: {buttons: {id: string}[]; handoff: boolean};
      toolCallId: string;
    }[];
    expect(pending?.kind).toBe("markdown");
    expect(pending?.simple.handoff).toBe(true);

    const answered = await supertest(app)
      .post(`/gpt/histories/${historyId}/turn`)
      .set(auth)
      .send({buttonId: "approve", surface: "compact", toolCallId: pending?.toolCallId});
    expect(answered.status).toBe(200);
    expect(answered.body.data).toEqual({
      historyId,
      text: "You approved the draft. A real agent would post it now.",
      title: "Drafting an announcement",
    });

    const history = await GptHistory.findById(historyId).lean();
    const resultRow = history?.prompts.find(
      (row) => row.toolCallId === pending?.toolCallId && row.type === "tool-result"
    );
    expect(resultRow?.result).toEqual({
      action: "accept",
      content: {changed: false, markdown: ANNOUNCEMENT_DRAFT},
    });
  });

  it("pauses on the invoice form, rejects invalid values per field, and continues with the answer", async () => {
    const auth = {Authorization: `Bearer ${await signIn()}`};

    const asked = await supertest(app)
      .post("/gpt/prompt")
      .set(auth)
      .send({prompt: "Fill in the invoice details"});
    expect(asked.status).toBe(200);
    const askedEvents = parseEvents(asked.text);
    const ask = askedEvents.find((event) => "ask" in event)?.ask as {
      kind: string;
      simple: {buttons: {id: string; label: string}[]; handoff: boolean};
      toolCallId: string;
    };
    expect(ask.kind).toBe("form");
    expect(ask.simple.handoff).toBe(true);
    expect(ask.simple.buttons.map(({id, label}) => ({id, label}))).toEqual([
      {id: "submit-defaults", label: "Submit defaults"},
      {id: "cancel", label: "Cancel"},
    ]);
    const {historyId} = askedEvents.at(-1) as {historyId: string};

    const invalid = await supertest(app)
      .post("/gpt/prompt")
      .set(auth)
      .send({
        askResponse: {
          action: "accept",
          content: {
            values: {company: " ", email: "not-an-email", seats: 900, start: "2026-02-30"},
          },
          toolCallId: ask.toolCallId,
        },
        historyId,
      });
    expect(invalid.status).toBe(400);
    expect(
      invalid.body.fields.map(
        (field: {code: string; path: string}) => `${field.path}:${field.code}`
      )
    ).toEqual([
      "content.values.company:REQUIRED_FIELD",
      "content.values.email:FIELD_TYPE_MISMATCH",
      "content.values.seats:OUT_OF_RANGE",
      "content.values.start:INVALID_DATE",
    ]);

    const response = {
      action: "accept",
      content: {values: {...INVOICE_DEFAULTS, phone: "+14155552671", start: "2026-10-01"}},
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
    expect(text).toContain("- **Callback phone:** +14155552671");
    expect(text).toContain("- **Start date:** 2026-10-01");
    expect(answeredEvents.at(-1)).toEqual({
      done: true,
      historyId,
      title: "Filling in invoice details",
    });

    const history = await GptHistory.findById(historyId).lean();
    const resultRow = history?.prompts.find(
      (row) => row.toolCallId === ask.toolCallId && row.type === "tool-result"
    );
    expect(resultRow?.result).toEqual(response);
  });

  it("submits the invoice defaults from a small screen with the card's Submit defaults button", async () => {
    const auth = {Authorization: `Bearer ${await signIn()}`};

    const asked = await supertest(app)
      .post("/gpt/prompt")
      .set(auth)
      .send({prompt: "Invoice details"});
    const {historyId} = parseEvents(asked.text).at(-1) as {historyId: string};

    const listed = await supertest(app).get("/gpt/histories/pendingAsks").set(auth);
    expect(listed.status).toBe(200);
    const [pending] = listed.body.data as {kind: string; toolCallId: string}[];
    expect(pending?.kind).toBe("form");

    const answered = await supertest(app)
      .post(`/gpt/histories/${historyId}/turn`)
      .set(auth)
      .send({buttonId: "submit-defaults", surface: "compact", toolCallId: pending?.toolCallId});
    expect(answered.status).toBe(200);
    expect(answered.body.data).toEqual({
      historyId,
      text: "You sent the invoice details (5 fields). A real agent would create the invoice now.",
      title: "Filling in invoice details",
    });

    const history = await GptHistory.findById(historyId).lean();
    const resultRow = history?.prompts.find(
      (row) => row.toolCallId === pending?.toolCallId && row.type === "tool-result"
    );
    expect(resultRow?.result).toEqual({action: "accept", content: {values: INVOICE_DEFAULTS}});
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

  it("answers the weekly report confirm from a small screen with its approve button", async () => {
    const auth = {Authorization: `Bearer ${await signIn()}`};
    const created = await supertest(app).post("/gpt/histories").set(auth).send({});
    const historyId = created.body.data._id as string;
    const turnPath = `/gpt/histories/${historyId}/turn`;

    const asked = await supertest(app)
      .post(turnPath)
      .set(auth)
      .send({prompt: "Send the weekly report", surface: "compact"});
    expect(asked.status).toBe(200);
    const {pendingAsk} = asked.body.data as {
      pendingAsk: {
        kind: string;
        simple: {buttons: {id: string; style: string}[]; handoff: boolean};
        toolCallId: string;
      };
    };
    expect(pendingAsk.kind).toBe("confirm");
    expect(pendingAsk.simple.handoff).toBe(false);
    expect(pendingAsk.simple.buttons.map(({id, style}) => ({id, style}))).toEqual([
      {id: "approve", style: "primary"},
      {id: "deny", style: "cancel"},
    ]);

    const answered = await supertest(app)
      .post(turnPath)
      .set(auth)
      .send({buttonId: "approve", surface: "compact", toolCallId: pendingAsk.toolCallId});
    expect(answered.status).toBe(200);
    expect(answered.body.data).toEqual({
      historyId,
      text: "OK. A real agent would send the weekly report now.",
      title: "Sending the weekly report",
    });
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
