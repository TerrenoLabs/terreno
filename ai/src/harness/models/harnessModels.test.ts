import {describe, expect, it} from "bun:test";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import {registerHarnessEvent} from "./harnessEvent";
import {registerHarnessMessage} from "./harnessMessage";

const EventModel = registerHarnessEvent();
const MessageModel = registerHarnessMessage();

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("HarnessMessage model", () => {
  it("stores no parts as an empty list, and one seq and requestId per conversation", async () => {
    await MessageModel.init();
    const conversationId = new mongoose.Types.ObjectId();
    const first = await MessageModel.create({conversationId, role: "assistant", seq: 1});
    expect(plain(first.parts)).toEqual([]);
    expect(first.aborted).toBe(false);

    // Messages without a requestId never collide; a repeated seq or requestId does.
    await MessageModel.create({conversationId, role: "assistant", seq: 2});
    await MessageModel.create({conversationId, requestId: "r1", role: "user", seq: 3});
    await expect(
      MessageModel.create({conversationId, role: "assistant", seq: 1})
    ).rejects.toMatchObject({code: 11000});
    await expect(
      MessageModel.create({conversationId, requestId: "r1", role: "user", seq: 4})
    ).rejects.toMatchObject({code: 11000});
    // The same seq and requestId in another conversation are fine.
    const other = new mongoose.Types.ObjectId();
    await MessageModel.create({conversationId: other, requestId: "r1", role: "user", seq: 1});
  });

  it("returns the registered model on every call", () => {
    expect(registerHarnessMessage()).toBe(MessageModel);
  });
});

describe("HarnessEvent model", () => {
  it("stores a conversation-stream event with an empty taskPath, one seq per stream", async () => {
    await EventModel.init();
    const streamId = new mongoose.Types.ObjectId();
    const event = await EventModel.create({
      created: DateTime.now().toJSDate(),
      payload: {text: "hi"},
      seq: 1,
      streamId,
      type: "output",
    });
    expect(plain(event.taskPath)).toEqual([]);
    await expect(
      EventModel.create({created: DateTime.now().toJSDate(), seq: 1, streamId, type: "output"})
    ).rejects.toMatchObject({code: 11000});
  });

  it("returns the registered model on every call", () => {
    expect(registerHarnessEvent()).toBe(EventModel);
  });
});
