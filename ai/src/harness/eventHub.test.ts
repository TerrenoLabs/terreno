import {afterEach, describe, expect, it} from "bun:test";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import {HarnessEventHub, type HubEvent, type HubSubscriber} from "./eventHub";
import {registerHarnessEvent} from "./models/harnessEvent";

const EventModel = registerHarnessEvent();

interface Collector {
  events: HubEvent[];
  failures: unknown[];
  subscriber: HubSubscriber;
}

const collector = (
  streamId: mongoose.Types.ObjectId,
  taskId?: mongoose.Types.ObjectId
): Collector => {
  const events: HubEvent[] = [];
  const failures: unknown[] = [];
  return {
    events,
    failures,
    subscriber: {
      deliver: (event) => events.push(event),
      fail: (error) => failures.push(error),
      streamId: String(streamId),
      taskId: taskId === undefined ? undefined : String(taskId),
    },
  };
};

const waitUntil = async (predicate: () => boolean, label: string): Promise<void> => {
  const deadline = DateTime.now().plus({seconds: 10});
  while (!predicate()) {
    if (DateTime.now() > deadline) {
      expect(`timed out waiting for ${label}`).toBe("");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

const seqs = (events: HubEvent[]): number[] => events.map(({seq}) => seq);

const unsubscribes: Array<() => void> = [];

afterEach(() => {
  for (const unsubscribe of unsubscribes.splice(0)) {
    unsubscribe();
  }
});

describe("HarnessEventHub", () => {
  it("delivers a task subscriber only the events on that task's path", async () => {
    const hub = new HarnessEventHub();
    const root = new mongoose.Types.ObjectId();
    const childA = new mongoose.Types.ObjectId();
    const childB = new mongoose.Types.ObjectId();
    const whole = collector(root);
    const onA = collector(root, childA);
    const onB = collector(root, childB);
    const elsewhere = collector(new mongoose.Types.ObjectId());
    for (const {subscriber} of [whole, onA, onB, elsewhere]) {
      unsubscribes.push(await hub.subscribe(subscriber));
    }
    expect(hub.openStreams).toBe(1);

    const created = DateTime.now().toJSDate();
    await EventModel.create(
      [
        {created, seq: 1, streamId: root, taskId: childA, taskPath: [childA, root], type: "output"},
        {created, seq: 2, streamId: root, taskId: childB, taskPath: [childB, root], type: "output"},
        {created, seq: 3, streamId: root, taskId: root, taskPath: [root], type: "output"},
      ],
      {ordered: true}
    );

    await waitUntil(() => whole.events.length === 3, "every event on the root stream");
    expect(seqs(whole.events)).toEqual([1, 2, 3]);
    expect(seqs(onA.events)).toEqual([1]);
    expect(seqs(onB.events)).toEqual([2]);
    expect(elsewhere.events).toEqual([]);
  });

  it("fails every subscriber when its tail closes, even if closing the cursor again fails", async () => {
    const hub = new HarnessEventHub();
    const streamId = new mongoose.Types.ObjectId();
    const first = collector(streamId);
    const second = collector(streamId);
    unsubscribes.push(await hub.subscribe(first.subscriber));
    unsubscribes.push(await hub.subscribe(second.subscriber));

    // The cursor goes away underneath the tail (a failover), and a second close rejects.
    const tail = (hub as unknown as {changes: {close: () => Promise<void>}}).changes;
    const closeCursor = tail.close.bind(tail);
    let closeAttempts = 0;
    tail.close = () => {
      closeAttempts += 1;
      return Promise.reject(new Error("cursor already gone"));
    };
    await closeCursor();

    await waitUntil(() => first.failures.length === 1 && second.failures.length === 1, "failures");
    // Either the driver's "closed" error or the hub's own; both end the streams.
    expect(first.failures[0]).toBeInstanceOf(Error);
    expect(second.failures[0]).toBe(first.failures[0]);
    await waitUntil(() => closeAttempts > 0, "the tail's own close attempt");
    expect(hub.openStreams).toBe(0);

    // The next subscriber opens a fresh tail that delivers.
    const later = collector(streamId);
    unsubscribes.push(await hub.subscribe(later.subscriber));
    expect(hub.openStreams).toBe(1);
    await EventModel.create({created: DateTime.now().toJSDate(), seq: 1, streamId, type: "output"});
    await waitUntil(() => later.events.length === 1, "an event on the new tail");
    expect(first.events).toEqual([]);
  });
});
