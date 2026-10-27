import {describe, expect, it} from "bun:test";

import {findMailMessage, formatReceivedAt, MAIL_MESSAGES} from "./mailFixtures";

describe("mailFixtures", () => {
  it("builds 30 messages with unique ids, newest first", () => {
    expect(MAIL_MESSAGES).toHaveLength(30);
    expect(new Set(MAIL_MESSAGES.map((message) => message.id)).size).toBe(30);
    const [first, second] = MAIL_MESSAGES;
    expect(first?.receivedAt > (second?.receivedAt ?? "")).toBe(true);
  });

  it("finds a message by id and returns undefined for an unknown or missing id", () => {
    expect(findMailMessage("3")?.subject).toBe("Lunch order for the offsite");
    expect(findMailMessage("999")).toBeUndefined();
    expect(findMailMessage(undefined)).toBeUndefined();
  });

  it("formats the received time as month, day, and clock time", () => {
    expect(formatReceivedAt(MAIL_MESSAGES[0]?.receivedAt ?? "")).toMatch(
      /^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} (AM|PM)$/
    );
  });
});
