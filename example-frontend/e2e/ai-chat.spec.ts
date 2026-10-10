import {existsSync, readFileSync} from "node:fs";
import path from "node:path";
import type {Page} from "@playwright/test";

import {expect, test} from "./fixtures/test";
import {TEST_USER} from "./fixtures/testUsers";
import {loginAs} from "./helpers/login";
import {
  askCallRow,
  askResultRow,
  assistantRow,
  type MockAsk,
  mockFileUploads,
  mockGptAskStream,
  mockGptBlocks,
  mockGptDocument,
  mockGptStream,
  mockGptTurns,
  mockSavedHistory,
  savedHistory,
  unmockGptStream,
  userRow,
} from "./helpers/mockGpt";
import {
  configureE2ePhotoStorage,
  type RoastPhotoIds,
  roastDocument,
  type SeededHistory,
  SIGNED_URL_PREFIX,
  seedGptHistory,
  seedRoastPhotos,
} from "./helpers/seedGptHistory";

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

const RECEIPT_ASK: MockAsk = {
  input: {
    accept: ["image", "pdf", "text", "csv"],
    maxFiles: 3,
    prompt: "Upload the receipt for your expense report.",
    submitLabel: "Send receipt",
    title: "Upload a receipt",
  },
  kind: "files",
  toolCallId: "call_receipt",
};

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const RECEIPT_CSV = Buffer.from("date,item,amount\n2026-09-01,Coffee,4.50\n");

/** Opens the receipt ask's picker and picks a PNG and a CSV through the browser's file chooser. */
const pickReceiptFiles = async (page: Page): Promise<void> => {
  await page.getByTestId("gpt-ask-call_receipt-picker").click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByText("Document", {exact: true}).click();
  await (await chooser).setFiles([
    {buffer: PNG_BYTES, mimeType: "image/png", name: "receipt.png"},
    {buffer: RECEIPT_CSV, mimeType: "text/csv", name: "items.csv"},
  ]);
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

  test("shows the result card of a host tool as soon as its approval runs it", async ({page}) => {
    const historyId = `mock-history-${Date.now()}`;
    const approvalAsk = {
      input: {
        confirmLabel: "Delete",
        denyLabel: "Keep them",
        destructive: true,
        prompt: "Delete all of your completed todos? You can't undo this.",
        title: "Delete completed todos",
      },
      kind: "confirm",
      origin: "approval",
      toolCallId: "call_approval",
      toolName: "deleteCompletedTodos",
    };
    const requests = await mockGptTurns(page, [
      [
        {ask: approvalAsk, historyId},
        {done: true, historyId, pendingAsk: approvalAsk, title: "Cleaning up todos"},
      ],
      // A resumed approval streams no {toolCall}: the call was streamed by the turn that paused.
      [
        {askResolved: {action: "accept", toolCallId: "call_approval"}},
        {
          toolResult: {
            result: {deleted: 2, titles: ["Buy milk", "File taxes"]},
            toolCallId: "call_delete",
            toolName: "deleteCompletedTodos",
          },
        },
        {text: "Deleted 2 completed todos: Buy milk, File taxes."},
        {done: true, historyId, title: "Cleaning up todos"},
      ],
    ]);

    await page.getByTestId("gpt-input").fill("Delete my completed todos");
    await page.getByTestId("gpt-submit").click();
    await page.getByTestId("gpt-ask-call_approval-button-approve").click();

    await expect(page.getByText("Deleted 2 completed todos: Buy milk, File taxes.")).toBeVisible();
    const resultCard = page.getByLabel("Result: deleteCompletedTodos");
    await expect(resultCard).toBeVisible();
    await resultCard.click();
    await expect(page.getByText(/"deleted": 2/)).toBeVisible();
    await expect(page.getByTestId("gpt-ask-call_approval-summary")).toContainText(
      "You confirmed: Delete"
    );
    expect(requests[1]).toMatchObject({
      askResponse: {action: "accept", content: {confirmed: true}, toolCallId: "call_approval"},
      historyId,
    });
  });

  test("sends picked files as data URLs when the server has no file storage, after a rejected file", async ({
    page,
    consoleGuard,
  }) => {
    consoleGuard.allow("Failed to load resource: the server responded with a status of 404");
    consoleGuard.allow("Failed to load resource: the server responded with a status of 400");
    const uploads = await mockFileUploads(page);
    const gpt = await mockGptAskStream(page, {
      ask: RECEIPT_ASK,
      continuation: "You sent 2 files: receipt.png and items.csv.",
      title: "Uploading a receipt",
    });
    gpt.rejectNextAnswer({
      fields: [
        {
          code: "MIME_MISMATCH",
          fix: "Send the file with its real type, or a file that is image/png.",
          message: "The file is declared as image/png, but its bytes are text.",
          path: "content.files.0",
        },
      ],
    });

    await page.getByTestId("gpt-input").fill("Upload a receipt");
    await page.getByTestId("gpt-submit").click();
    const card = page.getByTestId("gpt-ask-call_receipt");
    await expect(card.getByText("Upload the receipt for your expense report.")).toBeVisible();
    await pickReceiptFiles(page);
    await expect(page.getByTestId("gpt-ask-call_receipt-selected")).toContainText("items.csv");

    await page.getByTestId("gpt-ask-call_receipt-submit").click();
    await expect(page.getByTestId("gpt-ask-call_receipt-errors")).toContainText(
      "The file is declared as image/png, but its bytes are text."
    );
    // Button ignores a second press within 500 ms, and the mocked rejection arrives sooner.
    await page.waitForTimeout(510);
    await page.getByTestId("gpt-ask-call_receipt-submit").click();

    await expect(page.getByText("You sent 2 files: receipt.png and items.csv.")).toBeVisible();
    await expect(page.getByTestId("gpt-ask-call_receipt-summary")).toContainText(
      "You sent 2 files: receipt.png, items.csv"
    );
    expect(uploads).toEqual(["receipt.png"]);
    const answers = gpt.requests.map((body) => body.askResponse);
    const dataUrlAnswer = {
      action: "accept",
      content: {
        files: [
          {
            filename: "receipt.png",
            mimeType: "image/png",
            size: PNG_BYTES.length,
            url: `data:image/png;base64,${PNG_BYTES.toString("base64")}`,
          },
          {
            filename: "items.csv",
            mimeType: "text/csv",
            size: RECEIPT_CSV.length,
            url: `data:text/csv;base64,${RECEIPT_CSV.toString("base64")}`,
          },
        ],
      },
      toolCallId: "call_receipt",
    };
    expect(answers).toEqual([undefined, dataUrlAnswer, dataUrlAnswer]);
  });

  test("uploads picked files and answers with their ids when the server has file storage", async ({
    page,
  }) => {
    const uploads = await mockFileUploads(page, {
      uploads: [
        {id: "66f0c0ffee0000000000000a", size: PNG_BYTES.length},
        {id: "66f0c0ffee0000000000000b", size: RECEIPT_CSV.length},
      ],
    });
    const gpt = await mockGptAskStream(page, {
      ask: RECEIPT_ASK,
      continuation: "Both files arrived.",
    });

    await page.getByTestId("gpt-input").fill("Upload a receipt");
    await page.getByTestId("gpt-submit").click();
    await pickReceiptFiles(page);
    await page.getByTestId("gpt-ask-call_receipt-submit").click();

    await expect(page.getByText("Both files arrived.")).toBeVisible();
    expect(uploads).toEqual(["receipt.png", "items.csv"]);
    expect(gpt.requests[1]?.askResponse).toEqual({
      action: "accept",
      content: {
        files: [
          {
            fileId: "66f0c0ffee0000000000000a",
            filename: "receipt.png",
            mimeType: "image/png",
            size: PNG_BYTES.length,
          },
          {
            fileId: "66f0c0ffee0000000000000b",
            filename: "items.csv",
            mimeType: "text/csv",
            size: RECEIPT_CSV.length,
          },
        ],
      },
      toolCallId: "call_receipt",
    });
  });

  test("renders a ref bar chart and sends a follow-up reply", async ({page}) => {
    await mockGptBlocks(page);

    await page.getByTestId("gpt-input").fill("Show signups");
    await page.getByTestId("gpt-submit").click();

    await expect(page.getByText("Jan")).toBeVisible();
    await expect(page.getByText("Feb")).toBeVisible();
    await expect(page.getByText("Web")).toBeVisible();
    await expect(page.getByText("3 components")).toBeVisible();
    await page.getByTestId("blocks-2-export_btn").scrollIntoViewIfNeeded();
    await saveChatShot(page, "blocks-chat-chart.png");

    await page.getByTestId("blocks-2-export_btn").click();
    await expect(page.getByTestId("blocks-2-export_btn")).toHaveCount(0);
    await page.getByTestId("blocks-2-weekly").click();

    await expect(page.getByText("Show weekly signups")).toBeVisible();
    await expect(page.getByText("Here is the weekly view.")).toBeVisible();
    const scrollToBottom = page.getByText("Scroll to bottom");
    if (await scrollToBottom.isVisible()) {
      await scrollToBottom.click();
      await scrollToBottom.waitFor({state: "hidden"});
    }
    await saveChatShot(page, "blocks-chat-reply.png");
  });

  test.describe("rich roast reply", () => {
    const ROAST_PROMPT =
      "Give me a plan for a sunday lamb roast, I'm having friends over still figuring out numbers tbh";
    // Served for every signed photo URL: the only storage call the browser makes.
    const FIXTURE_IMAGE = readFileSync(
      path.resolve(__dirname, "../assets/gptMascots/mascot-1.png")
    );
    // + scales every amount from the 5-person stepper the agent wrote.
    const SIX_PERSON_LIST = [
      "Number of people: 6 People",
      "Bone-in leg of lamb: 2.4 kg",
      "Potatoes: 1800 g",
      "Carrots: 10",
      "Parsnips: 6",
      "Tenderstem broccoli: 750 g",
      "Apples for crumble: 5",
    ].join("\n");

    let photoIds: RoastPhotoIds = {};
    let restoreStorage: (() => Promise<void>) | undefined;
    let history: SeededHistory | undefined;

    test.use({permissions: ["clipboard-read", "clipboard-write"]});

    test.beforeAll(async () => {
      photoIds = await seedRoastPhotos();
      restoreStorage = await configureE2ePhotoStorage();
    });

    test.afterAll(async () => {
      await restoreStorage?.();
    });

    test.beforeEach(async ({page}) => {
      // The stored reply is the one the mocked model streams, so callbacks resolve `msg-1` to it.
      const document = roastDocument(photoIds);
      history = await seedGptHistory({
        prompt: ROAST_PROMPT,
        reply: document,
        title: "Sunday lamb roast",
        user: TEST_USER,
      });
      await mockGptDocument(page, {
        document,
        historyId: history.historyId,
        title: "Sunday lamb roast",
      });
      await page.route(`${SIGNED_URL_PREFIX}**`, (route) =>
        route.fulfill({body: FIXTURE_IMAGE, contentType: "image/png", status: 200})
      );
    });

    test.afterEach(async ({page}) => {
      await page.unroute(`${SIGNED_URL_PREFIX}**`);
      await history?.remove();
    });

    test("user scales the roast, ticks a step, and copies the shopping list", async ({page}) => {
      const photoUrlRequests = new Set<string>();
      page.on("response", (response) => {
        const match = /\/photoLibrary\/([0-9a-f]{24})\/url$/.exec(new URL(response.url()).pathname);
        if (match?.[1] && response.status() === 200) {
          photoUrlRequests.add(match[1]);
        }
      });

      await page.getByTestId("gpt-input").fill(ROAST_PROMPT);
      await page.getByTestId("gpt-submit").click();

      const stepperValue = page.getByTestId("blocks-8-0-value");
      await expect(stepperValue).toHaveText("5");
      await expect(page.getByTestId("blocks-8-0-items")).toContainText("2.0 kg");

      // Gallery and list photos load through GET /photoLibrary/:id/url and the stubbed download.
      for (const index of [0, 1, 2]) {
        await expect(page.getByTestId(`blocks-1-image-${index}-image`)).toBeVisible();
        await expect(page.getByTestId(`blocks-1-image-${index}-placeholder`)).toHaveCount(0);
      }
      for (const index of [0, 1, 2, 3, 4]) {
        await expect(page.getByTestId(`blocks-5-item-${index}-image`)).toBeVisible();
      }
      await expect.poll(() => [...photoUrlRequests].sort()).toEqual(Object.values(photoIds).sort());
      await page.getByTestId("blocks-1").scrollIntoViewIfNeeded();
      await saveChatShot(page, "roast-photos.png");

      const scaled = page.waitForResponse(
        (response) =>
          response.url().endsWith("/gpt/actions") && response.request().method() === "POST"
      );
      await page.getByTestId("blocks-8-0-guests_increase").click();
      const scaleResponse = await scaled;
      expect(scaleResponse.status()).toBe(200);
      expect(scaleResponse.request().postDataJSON()).toMatchObject({
        blockId: "guests",
        historyId: history?.historyId,
        messageId: "msg-1",
        name: "scaleStepper",
        payload: {value: 6},
      });
      await expect(stepperValue).toHaveText("6");
      await expect(page.getByTestId("blocks-8-0-items")).toContainText("2.4 kg");
      await expect(page.getByTestId("blocks-8-0-items")).toContainText("1800 g");

      const counter = page.getByTestId("blocks-13-counter");
      await expect(counter).toHaveText("1 of 8");
      const ticked = page.waitForResponse(
        (response) =>
          response.url().endsWith("/gpt/actions") && response.request().method() === "POST"
      );
      await page.getByTestId("blocks-13-cooking_prepare_lamb-row-clickable").click();
      const tickResponse = await ticked;
      expect(tickResponse.status()).toBe(200);
      expect(tickResponse.request().postDataJSON()).toMatchObject({
        blockId: "cooking",
        name: "toggleChecklist",
        payload: {checked: true, itemId: "prepare_lamb"},
      });
      await expect(counter).toHaveText("2 of 8");
      await saveChatShot(page, "roast-checklist-ticked.png");

      await page.getByTestId("blocks-8-1-copy_shopping_list").click();
      await expect(page.getByTestId("blocks-8-1-copy_shopping_list-status-text")).toHaveText(
        "Copied"
      );
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(SIX_PERSON_LIST);
      await page.getByTestId("blocks-8-0").scrollIntoViewIfNeeded();
      await saveChatShot(page, "roast-scaled-copied.png");
    });
  });
});

/** Cloud agents attach these shots to the PR. CircleCI has no such directory. */
const saveChatShot = async (page: Page, name: string): Promise<void> => {
  const dir = `${process.env.E2E_ARTIFACTS_DIR ?? "/opt/cursor/artifacts"}/screenshots`;
  if (!existsSync(dir)) {
    return;
  }
  await page.screenshot({fullPage: true, path: `${dir}/${name}`});
};
