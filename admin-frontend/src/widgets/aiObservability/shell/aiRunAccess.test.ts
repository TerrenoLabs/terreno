import {describe, expect, it} from "bun:test";
import {resolveAiRunBlockedMessage, resolveAiRunError} from "./aiRunAccess";

const DEFAULT_API_KEY_HINT = "Add an AI API key in your app settings, then try again.";
const PLAYGROUND_BACKEND_UNAVAILABLE_MESSAGE =
  "Playground is unavailable. Configure ObservabilityApp.aiService or requestAiServiceFactory on the backend.";
const MISSING_API_KEY_ERROR_TITLE =
  "No AI service is available. Configure ObservabilityApp.aiService or provide an AI API key.";

describe("resolveAiRunBlockedMessage", () => {
  it("returns undefined while the host is still loading a saved key", () => {
    expect(
      resolveAiRunBlockedMessage({
        apiKeyLoading: true,
        playgroundAiSource: "request-key",
      })
    ).toBeUndefined();
  });

  it("returns a hint when the backend expects a request key and none is available", () => {
    expect(
      resolveAiRunBlockedMessage({
        playgroundAiSource: "request-key",
      })
    ).toBe(DEFAULT_API_KEY_HINT);

    expect(
      resolveAiRunBlockedMessage({
        apiKeyHint: "Save a key on Profile.",
        playgroundAiSource: "request-key",
      })
    ).toBe("Save a key on Profile.");
  });

  it("does not block when a trimmed key is present or the server provides AI", () => {
    expect(
      resolveAiRunBlockedMessage({
        apiKey: "  saved-key  ",
        playgroundAiSource: "request-key",
      })
    ).toBeUndefined();

    expect(
      resolveAiRunBlockedMessage({
        playgroundAiSource: "server",
      })
    ).toBeUndefined();
  });

  it("reports backend misconfiguration only when playground AI is unavailable", () => {
    expect(
      resolveAiRunBlockedMessage({
        playgroundAiSource: "unavailable",
      })
    ).toBe(PLAYGROUND_BACKEND_UNAVAILABLE_MESSAGE);
  });

  it("names the calling feature in the backend misconfiguration message", () => {
    expect(
      resolveAiRunBlockedMessage({
        featureLabel: "Multi-stage trace test",
        playgroundAiSource: "unavailable",
      })
    ).toBe(
      "Multi-stage trace test is unavailable. Configure ObservabilityApp.aiService or requestAiServiceFactory on the backend."
    );
  });
});

describe("resolveAiRunError", () => {
  it("maps the missing-key 503 title to the host hint for request-key backends", () => {
    expect(
      resolveAiRunError({
        error: {data: {title: MISSING_API_KEY_ERROR_TITLE}},
        playgroundAiSource: "request-key",
      })
    ).toBe(DEFAULT_API_KEY_HINT);

    expect(
      resolveAiRunError({
        apiKeyHint: "Save a key on Profile.",
        error: {data: {title: MISSING_API_KEY_ERROR_TITLE}},
        playgroundAiSource: "request-key",
      })
    ).toBe("Save a key on Profile.");
  });

  it("keeps the backend title when a key was supplied or the server owns AI", () => {
    expect(
      resolveAiRunError({
        apiKey: "saved-key",
        error: {data: {title: MISSING_API_KEY_ERROR_TITLE}},
        playgroundAiSource: "request-key",
      })
    ).toBe(MISSING_API_KEY_ERROR_TITLE);

    expect(
      resolveAiRunError({
        error: {data: {title: MISSING_API_KEY_ERROR_TITLE}},
        playgroundAiSource: "server",
      })
    ).toBe(MISSING_API_KEY_ERROR_TITLE);
  });

  it("falls back to a feature-specific message when the error has no title", () => {
    expect(
      resolveAiRunError({
        error: new Error("network"),
        playgroundAiSource: "request-key",
      })
    ).toBe("Playground run failed. Try again or check your AI configuration.");

    expect(
      resolveAiRunError({
        error: new Error("network"),
        featureLabel: "Multi-stage trace test",
        playgroundAiSource: "request-key",
      })
    ).toBe("Multi-stage trace test run failed. Try again or check your AI configuration.");
  });
});
