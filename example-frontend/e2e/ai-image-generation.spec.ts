import {expect, test} from "./fixtures/test";
import {loginAs} from "./helpers/login";
import {
  assistantImageRow,
  mockGptTurns,
  mockSavedHistory,
  PIXEL_PNG_DATA_URL,
  savedHistory,
  toolCallEvents,
  toolCallRow,
  toolResultRow,
  unmockGptStream,
  userRow,
} from "./helpers/mockGpt";

const SKILL_RESULT = {
  description: "How we style every image",
  files: [],
  instructions: "Use flat pastel colors.",
  name: "house-style",
};

test.describe("AI image generation", () => {
  test.beforeEach(async ({page}) => {
    await loginAs(page);
    await page.goto("/ai");
    await page.getByTestId("gpt-input").waitFor({state: "visible"});
  });

  test.afterEach(async ({page}) => {
    await unmockGptStream(page);
  });

  test("user sees the skill load and the generated image in the chat", async ({page}) => {
    const historyId = `mock-history-${Date.now()}`;
    await mockGptTurns(page, [
      [
        ...toolCallEvents({
          args: {name: "house-style"},
          result: SKILL_RESULT,
          toolCallId: "call_skill",
          toolName: "load_skill",
        }),
        ...toolCallEvents({
          args: {prompt: "A flat pastel bake sale poster"},
          result: {images: [{id: "img_1", mimeType: "image/png"}]},
          toolCallId: "call_image",
          toolName: "generate_image",
        }),
        {image: {mimeType: "image/png", url: PIXEL_PNG_DATA_URL}},
        {text: "Here is your poster."},
        {done: true, historyId, title: "Bake sale poster"},
      ],
    ]);

    await page.getByTestId("gpt-input").fill("/house-style a poster for a bake sale");
    await page.getByTestId("gpt-submit").click();

    await expect(page.getByTestId("gpt-tool-call-load_skill")).toContainText(
      "Used skill house-style"
    );
    await expect(page.getByTestId("gpt-tool-call-generate_image")).toContainText("Generated image");
    await expect(page.getByTestId("gpt-tool-call-generate_image")).not.toContainText(
      "Generating image…"
    );
    await expect(page.locator('[data-testid^="gpt-message-image-"]')).toHaveCount(1);
    await expect(page.locator('[data-testid^="gpt-message-image-"]').first()).toBeVisible();
  });

  test("user sees Generating image… while the image call has no result", async ({page}) => {
    const history = savedHistory({
      historyId: "mock-history-pending-image",
      prompts: [
        userRow("Make a poster"),
        toolCallRow({
          args: {prompt: "A poster"},
          toolCallId: "call_image",
          toolName: "generate_image",
        }),
      ],
      title: "Pending poster",
    });
    await mockSavedHistory(page, history);
    await page.reload();
    await page.getByTestId("gpt-input").waitFor({state: "visible"});
    await page.getByText("Pending poster").click();

    await expect(page.getByTestId("gpt-tool-call-generate_image")).toContainText(
      "Generating image…"
    );
  });

  test("user still sees the generated image after reload from saved history", async ({page}) => {
    const history = savedHistory({
      historyId: "mock-history-saved-image",
      prompts: [
        userRow("/house-style a poster for a bake sale"),
        toolCallRow({
          args: {name: "house-style"},
          toolCallId: "call_skill",
          toolName: "load_skill",
        }),
        toolResultRow({result: SKILL_RESULT, toolCallId: "call_skill", toolName: "load_skill"}),
        assistantImageRow("Here is your poster.", PIXEL_PNG_DATA_URL),
      ],
      title: "Saved poster",
    });
    await mockSavedHistory(page, history);
    await page.reload();
    await page.getByTestId("gpt-input").waitFor({state: "visible"});
    await page.getByText("Saved poster").click();

    await expect(page.getByTestId("gpt-tool-call-load_skill")).toContainText(
      "Used skill house-style"
    );
    await expect(page.locator('[data-testid^="gpt-message-image-"]')).toHaveCount(1);
    await expect(page.locator('[data-testid^="gpt-message-image-"]').first()).toBeVisible();
  });

  test("user sees the error text when the image limit is reached", async ({page}) => {
    const historyId = `mock-history-${Date.now()}`;
    await mockGptTurns(page, [
      [
        ...toolCallEvents({
          args: {prompt: "One more poster"},
          result: {error: "Image limit reached for this turn"},
          toolCallId: "call_image",
          toolName: "generate_image",
        }),
        {text: "I can't make more images this turn."},
        {done: true, historyId, title: "Image limit"},
      ],
    ]);

    await page.getByTestId("gpt-input").fill("Make another poster");
    await page.getByTestId("gpt-submit").click();

    await expect(page.getByTestId("gpt-tool-call-error-generate_image")).toHaveText(
      "Image limit reached for this turn"
    );
    await expect(page.getByTestId("gpt-tool-call-generate_image")).not.toContainText(
      "Generating image…"
    );
  });
});
