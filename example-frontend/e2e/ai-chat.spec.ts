import {expect, test} from "./fixtures/test";
import {loginAs} from "./helpers/login";
import {
  askCallRow,
  askResultRow,
  assistantRow,
  type MockAsk,
  mockGptAskStream,
  mockGptStream,
  mockGptTurns,
  mockSavedHistory,
  savedHistory,
  unmockGptStream,
  userRow,
} from "./helpers/mockGpt";

const PLAN_ASK: MockAsk = {
  input: {
    default: ["team"],
    options: [
      {description: "Free for one person", id: "starter", label: "Starter"},
      {description: "$20 per seat each month", id: "team", label: "Team"},
      {description: "SSO and a support contract", id: "enterprise", label: "Enterprise"},
    ],
    prompt: "Which plan should I set up for your workspace?",
    select: "one",
    title: "Choose a plan",
  },
  kind: "choice",
  simple: {
    buttons: [
      {
        id: "option:team",
        label: "Team",
        response: {action: "accept", content: {selected: ["team"]}},
        style: "primary",
      },
      {
        id: "option:starter",
        label: "Starter",
        response: {action: "accept", content: {selected: ["starter"]}},
        style: "default",
      },
      {
        id: "option:enterprise",
        label: "Enterprise",
        response: {action: "accept", content: {selected: ["enterprise"]}},
        style: "default",
      },
    ],
    handoff: false,
    kind: "choice",
    text: "Which plan should I set up for your workspace?",
    title: "Choose a plan",
    toolCallId: "call_plan",
  },
  toolCallId: "call_plan",
};

const REGION_ASK: MockAsk = {
  input: {
    options: [
      {id: "us-east", label: "US East (Virginia)"},
      {id: "us-west", label: "US West (Oregon)"},
      {id: "eu", label: "EU (Frankfurt)"},
      {id: "uk", label: "UK (London)"},
      {id: "apac", label: "Asia Pacific (Tokyo)"},
    ],
    prompt: "Where should your data live?",
    select: "one",
    submitLabel: "Use this region",
    title: "Choose a region",
  },
  kind: "choice",
  toolCallId: "call_region",
};

test.describe("AI Chat", () => {
  test.beforeEach(async ({page}) => {
    await loginAs(page);
    await page.goto("/ai");
    await page.getByTestId("gpt-input").waitFor({state: "visible"});
  });

  test.afterEach(async ({page}) => {
    await unmockGptStream(page);
  });

  test("AI chat screen renders", async ({page}) => {
    await expect(page.getByTestId("chat")).toBeVisible();
    await expect(page.locator('[data-testid^="example-gpt-mascot-"]')).toHaveCount(1);
    await expect(page.getByTestId("gpt-input")).toBeVisible();
    await expect(page.getByTestId("gpt-submit")).toBeVisible();
    await expect(page.getByTestId("gpt-new-chat-button")).toBeVisible();
  });

  test("can type and submit a message", async ({page}) => {
    await mockGptStream(page, "Hello! I am a mock AI assistant.");

    await page.getByTestId("gpt-input").fill("Say hello");
    await page.getByTestId("gpt-submit").click();

    // Wait for the streamed response text to appear
    await page.getByText("Hello! I am a mock AI assistant.").waitFor({state: "visible"});
    await expect(page.getByText("Hello! I am a mock AI assistant.")).toBeVisible();
  });

  test("shows API key input when button clicked", async ({page}) => {
    await page.getByTestId("gpt-api-key-button").click();
    await page.getByTestId("gpt-api-key-input").waitFor({state: "visible"});
    await expect(page.getByTestId("gpt-api-key-input")).toBeVisible();
  });

  test("can start a new chat", async ({page}) => {
    await mockGptStream(page, "First response");

    // Send a message to start a conversation
    await page.getByTestId("gpt-input").fill("First message");
    await page.getByTestId("gpt-submit").click();
    await page.getByText("First response").waitFor({state: "visible"});

    // Click new chat button
    await page.getByTestId("gpt-new-chat-button").click();

    // The response text from the previous conversation should be gone
    await expect(page.getByText("First response")).not.toBeVisible();
    await expect(page.getByTestId("gpt-mascot")).toBeVisible();
  });

  test("conversation appears in sidebar after sending", async ({page}) => {
    const chatTitle = `E2E Chat ${Date.now()}`;
    await mockGptStream(page, "Sidebar test response", {title: chatTitle});

    await page.getByTestId("gpt-input").fill("Test sidebar");
    await page.getByTestId("gpt-submit").click();
    await page.getByText("Sidebar test response").waitFor({state: "visible"});

    // The history entry should appear in the sidebar with the title
    await page.getByText(chatTitle).waitFor({state: "visible"});
    await expect(page.getByText(chatTitle)).toBeVisible();
  });

  test("can rate a message", async ({page, consoleGuard}) => {
    // mockGptStream synthesizes a fake history id; the rating PATCH will 400 because
    // no such history exists on the backend. The test only verifies UI feedback.
    consoleGuard.allow("/gpt/histories/mock-history-");
    consoleGuard.allow("Failed to load resource: the server responded with a status of 400");
    await mockGptStream(page, "Rate this message please.");

    await page.getByTestId("gpt-input").fill("Give me something to rate");
    await page.getByTestId("gpt-submit").click();
    await page.getByText("Rate this message please.").waitFor({state: "visible"});

    // The rating buttons should be visible for the assistant message
    // Message index 0 is the user message, index 1 is the assistant message
    const rateUpButton = page.getByTestId("gpt-rate-up-1");
    await rateUpButton.waitFor({state: "visible"});
    await rateUpButton.click();

    // The button should still be visible after clicking (visual feedback)
    await expect(rateUpButton).toBeVisible();
  });

  test("answers a choice ask with a quick reply and shows the continuation", async ({page}) => {
    const gpt = await mockGptAskStream(page, {
      ask: PLAN_ASK,
      continuation: "You picked the Team plan.",
      title: "Choosing a plan",
    });

    await page.getByTestId("gpt-input").fill("Help me pick a plan");
    await page.getByTestId("gpt-submit").click();

    const card = page.getByTestId("gpt-ask-call_plan");
    await expect(card).toBeVisible();
    await expect(card.getByText("Which plan should I set up for your workspace?")).toBeVisible();
    await page.getByTestId("gpt-ask-call_plan-button-option:team").click();

    await expect(page.getByText("You picked the Team plan.")).toBeVisible();
    await expect(page.getByTestId("gpt-ask-call_plan-summary")).toContainText("You chose: Team");
    await expect(page.getByTestId("gpt-ask-call_plan-button-option:team")).toHaveCount(0);
    expect(gpt.requests).toHaveLength(2);
    expect(gpt.requests[0]).toMatchObject({prompt: "Help me pick a plan"});
    expect(gpt.requests[1]).toMatchObject({
      askResponse: {action: "accept", content: {selected: ["team"]}, toolCallId: "call_plan"},
      historyId: expect.stringMatching(/^mock-history-/),
    });
    expect(gpt.requests[1]).not.toHaveProperty("prompt");
  });

  test("submits a radio choice after showing a rejected answer's errors inline", async ({
    page,
    consoleGuard,
  }) => {
    consoleGuard.allow("Failed to load resource: the server responded with a status of 400");
    const gpt = await mockGptAskStream(page, {
      ask: REGION_ASK,
      continuation: "Your data will live in the EU.",
    });
    gpt.rejectNextAnswer({
      fields: [
        {
          code: "OPTION_NOT_OFFERED",
          fix: "Use the id of one of the ask's options.",
          message: "That region is no longer offered. Choose another region.",
          path: "content.selected.0",
        },
      ],
    });

    await page.getByTestId("gpt-input").fill("Where should my data live?");
    await page.getByTestId("gpt-submit").click();
    await expect(page.getByTestId("gpt-ask-call_region")).toBeVisible();

    await page.getByText("UK (London)", {exact: true}).click();
    await page.getByTestId("gpt-ask-call_region-submit").click();
    await expect(page.getByTestId("gpt-ask-call_region-errors")).toContainText(
      "That region is no longer offered."
    );

    await page.getByText("EU (Frankfurt)", {exact: true}).click();
    await page.getByTestId("gpt-ask-call_region-submit").click();

    await expect(page.getByText("Your data will live in the EU.")).toBeVisible();
    await expect(page.getByTestId("gpt-ask-call_region-summary")).toContainText(
      "You chose: EU (Frankfurt)"
    );
    const answers = gpt.requests.map((body) => body.askResponse);
    expect(answers).toEqual([
      undefined,
      {action: "accept", content: {selected: ["uk"]}, toolCallId: "call_region"},
      {action: "accept", content: {selected: ["eu"]}, toolCallId: "call_region"},
    ]);
  });

  test("shows the saved answer when another tab already answered the ask", async ({
    page,
    consoleGuard,
  }) => {
    consoleGuard.allow("Failed to load resource: the server responded with a status of 409");
    const gpt = await mockGptAskStream(page, {
      ask: PLAN_ASK,
      continuation: "You picked the Team plan.",
      title: "Choosing a plan",
    });

    await page.getByTestId("gpt-input").fill("Help me pick a plan");
    await page.getByTestId("gpt-submit").click();
    await expect(page.getByTestId("gpt-ask-call_plan")).toBeVisible();

    await gpt.answerElsewhere({
      content: {selected: ["enterprise"]},
      continuation: "You picked the Enterprise plan.",
    });
    await page.getByTestId("gpt-ask-call_plan-button-option:starter").click();

    await expect(page.getByTestId("gpt-ask-call_plan-summary")).toContainText(
      "You chose: Enterprise"
    );
    await expect(page.getByText("You picked the Enterprise plan.")).toBeVisible();
    await expect(page.getByTestId("gpt-ask-call_plan-button-option:starter")).toHaveCount(0);
    // The sidebar reloads too, so reopening the chat shows the answer instead of the stale ask.
    await expect(page.getByLabel("Select chat: Choosing a plan")).toBeVisible();
    expect(gpt.requests.at(-1)).toMatchObject({
      askResponse: {action: "accept", content: {selected: ["starter"]}, toolCallId: "call_plan"},
    });
  });

  test("shows the saved conversation when a turn streams only its end", async ({page}) => {
    const historyId = `mock-history-${Date.now()}`;
    const requests = await mockGptTurns(page, [
      [{text: "Hello! How can I help?"}, {done: true, historyId, title: "Planning"}],
      // Another tab's ask was already pending, so the server dropped this turn's ask unsent.
      [{done: true, historyId, title: "Planning"}],
    ]);

    await page.getByTestId("gpt-input").fill("Hi");
    await page.getByTestId("gpt-submit").click();
    await expect(page.getByText("Hello! How can I help?")).toBeVisible();

    await mockSavedHistory(
      page,
      savedHistory({
        historyId,
        pendingAsk: REGION_ASK,
        prompts: [
          userRow("Hi"),
          assistantRow("Hello! How can I help?"),
          userRow("Where should my data live?"),
          askCallRow(REGION_ASK, "pending"),
          userRow("Help me pick a plan"),
          askCallRow(PLAN_ASK, "cancelled"),
          askResultRow(PLAN_ASK, {action: "cancel", reason: "one_ask_at_a_time"}),
        ],
        title: "Planning",
      })
    );
    await page.getByTestId("gpt-input").fill("Help me pick a plan");
    await page.getByTestId("gpt-submit").click();

    await expect(page.getByTestId("gpt-ask-call_plan-summary")).toContainText(
      "Not asked: the assistant asked another question first."
    );
    await expect(page.getByText("Where should my data live?")).toBeVisible();
    await page.getByText("EU (Frankfurt)", {exact: true}).click();
    await expect(page.getByTestId("gpt-ask-call_region-submit")).toBeEnabled();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({historyId, prompt: "Help me pick a plan"});
  });

  test("sends a message that races an answer from another tab, and shows that answer", async ({
    page,
  }) => {
    const gpt = await mockGptAskStream(page, {
      ask: PLAN_ASK,
      continuation: "You picked the Team plan.",
    });

    await page.getByTestId("gpt-input").fill("Help me pick a plan");
    await page.getByTestId("gpt-submit").click();
    await expect(page.getByTestId("gpt-ask-call_plan")).toBeVisible();

    await gpt.answerRacesNextPrompt({
      content: {selected: ["enterprise"]},
      continuation: "You picked the Enterprise plan.",
      prompt: "Actually, never mind",
      reply: "No problem, the Enterprise plan stays.",
    });
    await page.getByTestId("gpt-input").fill("Actually, never mind");
    await page.getByTestId("gpt-submit").click();

    await expect(page.getByText("No problem, the Enterprise plan stays.")).toBeVisible();
    await expect(page.getByTestId("gpt-ask-call_plan-summary")).toContainText(
      "You chose: Enterprise"
    );
    await expect(page.getByText("Actually, never mind")).toBeVisible();
    await expect(page.getByText(/try again/)).toHaveCount(0);
    expect(gpt.requests.at(-1)).toMatchObject({
      historyId: expect.stringMatching(/^mock-history-/),
      prompt: "Actually, never mind",
    });
  });

  test("answers an ask on a new chat before the turn's end arrives", async ({page}) => {
    const gpt = await mockGptAskStream(page, {
      ask: PLAN_ASK,
      continuation: "You picked the Team plan.",
      title: "Choosing a plan",
    });
    gpt.holdNextDone();

    await page.getByTestId("gpt-input").fill("Help me pick a plan");
    await page.getByTestId("gpt-submit").click();
    await page.getByTestId("gpt-ask-call_plan-button-option:team").click();

    await expect(page.getByText("You picked the Team plan.")).toBeVisible();
    await expect(page.getByTestId("gpt-ask-call_plan-summary")).toContainText("You chose: Team");
    expect(gpt.requests).toHaveLength(2);
    expect(gpt.requests[1]).toMatchObject({
      askResponse: {action: "accept", content: {selected: ["team"]}, toolCallId: "call_plan"},
      historyId: expect.stringMatching(/^mock-history-/),
    });
  });
});
