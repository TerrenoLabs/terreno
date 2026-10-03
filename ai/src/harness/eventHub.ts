import {APIError, logger} from "@terreno/api";
import mongoose from "mongoose";

import type {HarnessEventDocument} from "../types/harness";
import {errorMessage, harnessError} from "./errors";
import {registerHarnessEvent} from "./models/harnessEvent";

/** How long one wait on the tail may block; also how soon a stop takes effect. */
const TAIL_AWAIT_MS = 1000;

/** An event as a change stream delivers it (a raw document, not a mongoose model). */
export type HubEvent = Pick<
  HarnessEventDocument,
  "created" | "payload" | "seq" | "streamId" | "taskId" | "taskPath" | "type"
>;

/** One SSE connection's interest in the log. */
export interface HubSubscriber {
  deliver: (event: HubEvent) => void;
  /** The shared tail failed; the subscriber is already removed. */
  fail: (error: unknown) => void;
  streamId: string;
  /** Task streams: only events whose `taskPath` includes this task. */
  taskId?: string;
}

type EventChangeStream = mongoose.mongo.ChangeStream<HubEvent>;

const matches = (subscriber: HubSubscriber, event: HubEvent): boolean =>
  String(event.streamId) === subscriber.streamId &&
  (subscriber.taskId === undefined ||
    (event.taskPath ?? []).some((id) => String(id) === subscriber.taskId));

/**
 * One change stream on `HarnessEvent` per `HarnessApp`, shared by every SSE connection
 * and fanned out in memory by stream (and task path). It opens with the first subscriber,
 * at a cluster time read after that subscriber registered, and closes with the last. A
 * subscriber registers before it queries its replay, and the tail delivers every insert
 * committed after it opened, so each event committed after a subscriber's replay query
 * reaches it through the tail: replay plus tail, deduplicated by `seq`, is exactly once.
 * One stream holds one pooled connection however many clients watch.
 */
export class HarnessEventHub {
  private changes: EventChangeStream | undefined;
  private starting: Promise<void> | undefined;
  private readonly subscribers = new Set<HubSubscriber>();

  /** Number of open tails (0 or 1); for tests and diagnostics. */
  get openStreams(): number {
    return this.changes ? 1 : 0;
  }

  /**
   * Register `subscriber` and make sure the tail is open. Returns the unsubscribe
   * function. Throws (503) when no cluster time is available to start the tail.
   */
  async subscribe(subscriber: HubSubscriber): Promise<() => void> {
    this.subscribers.add(subscriber);
    const unsubscribe = (): void => this.unsubscribe(subscriber);
    try {
      await this.ensureStarted();
    } catch (error: unknown) {
      unsubscribe();
      throw error;
    }
    return unsubscribe;
  }

  private unsubscribe(subscriber: HubSubscriber): void {
    this.subscribers.delete(subscriber);
    if (this.subscribers.size === 0) {
      // The pump sees this after its current read and closes the tail.
      this.changes = undefined;
    }
  }

  private async ensureStarted(): Promise<void> {
    if (this.changes) {
      return;
    }
    this.starting ??= this.start().finally(() => {
      this.starting = undefined;
    });
    await this.starting;
  }

  private async start(): Promise<void> {
    const ping = await mongoose.connection.db?.command({ping: 1});
    const startAtOperationTime = ping?.operationTime;
    // Without a start time the tail could miss events committed during a replay.
    if (!startAtOperationTime) {
      throw new APIError({status: 503, title: "Event stream unavailable: no cluster time"});
    }
    // Every subscriber left while the cluster time was read.
    if (this.subscribers.size === 0) {
      return;
    }
    const changes = registerHarnessEvent().collection.watch<HubEvent>(
      [{$match: {operationType: "insert"}}],
      {maxAwaitTimeMS: TAIL_AWAIT_MS, startAtOperationTime}
    ) as unknown as EventChangeStream;
    this.changes = changes;
    void this.pump(changes);
  }

  /**
   * Read the tail until it is stopped or replaced (`this.changes` no longer points at it),
   * then close it. Closing only between reads means the opening aggregate has always
   * answered first; closing while it is in flight would orphan its server cursor.
   */
  private async pump(changes: EventChangeStream): Promise<void> {
    try {
      while (this.changes === changes) {
        // An invalidated (collection dropped) or externally closed tail is a failure.
        if (changes.closed) {
          throw harnessError({detail: "The HarnessEvent change stream closed", kind: "internal"});
        }
        const change = (await changes.tryNext()) as {fullDocument?: HubEvent} | null;
        const event = change?.fullDocument;
        if (!event) {
          continue;
        }
        for (const subscriber of [...this.subscribers]) {
          if (matches(subscriber, event)) {
            subscriber.deliver(event);
          }
        }
      }
    } catch (error: unknown) {
      if (this.changes === changes) {
        this.fail(error);
      }
    } finally {
      // A failed close only means the cursor is already gone.
      await changes.close().catch(() => undefined);
    }
  }

  /** The tail failed: drop every subscriber (each closes its stream); the next one restarts it. */
  private fail(error: unknown): void {
    logger.warn(`Harness event tail failed; closing its SSE streams: ${errorMessage(error)}`);
    const subscribers = [...this.subscribers];
    this.subscribers.clear();
    this.changes = undefined;
    for (const subscriber of subscribers) {
      subscriber.fail(error);
    }
  }
}
