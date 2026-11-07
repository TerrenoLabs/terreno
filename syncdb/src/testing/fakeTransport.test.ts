import {describe, expect, it} from "bun:test";
import type {TransportStatus} from "../sync/transport";
import type {SyncDelta} from "../types";
import {createFakeTransport} from "./fakeTransport";

const makeDelta = (overrides: Partial<SyncDelta> = {}): SyncDelta => ({
  collection: "todos",
  data: {title: "x"},
  id: "t1",
  method: "create",
  seq: 1,
  stream: "todos|owner:u1",
  ...overrides,
});

describe("createFakeTransport", () => {
  it("emits app events to onEvent listeners and tracks listener counts", () => {
    const transport = createFakeTransport();
    const seen: unknown[][] = [];
    const first = transport.onEvent?.("featureFlagsChanged", (...args) => seen.push(args));
    const second = transport.onEvent?.("featureFlagsChanged", (...args) => seen.push(args));
    expect(transport.eventListenerCount("featureFlagsChanged")).toBe(2);

    transport.emitEvent("featureFlagsChanged", {key: "a"});
    expect(seen).toEqual([[{key: "a"}], [{key: "a"}]]);

    first?.();
    second?.();
    expect(transport.eventListenerCount("featureFlagsChanged")).toBe(0);
    transport.emitEvent("featureFlagsChanged");
    expect(seen).toHaveLength(2);
    expect(() => transport.onEvent?.("sync:ack", () => {})).toThrow("reserved");
  });

  it("connect/disconnect notify status listeners once per change", async () => {
    const transport = createFakeTransport();
    const statuses: TransportStatus[] = [];
    transport.onStatusChange((status) => statuses.push(status));
    await transport.connect();
    await transport.connect();
    transport.disconnect();
    expect(statuses).toEqual([{connected: true}, {connected: false}]);
  });

  it("delivers deltas to listeners and honors unsubscribe", async () => {
    const transport = createFakeTransport();
    const seen: SyncDelta[] = [];
    const unsubscribe = transport.onDelta((delta) => seen.push(delta));
    transport.deliverDelta(makeDelta());
    unsubscribe();
    transport.deliverDelta(makeDelta({id: "t2"}));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.id).toBe("t1");
  });

  it("records subscriptions as a distinct union", () => {
    const transport = createFakeTransport();
    transport.subscribe(["todos"]);
    transport.subscribe(["todos", "notes"]);
    expect(transport.subscribedCollections.sort()).toEqual(["notes", "todos"]);
  });

  it("auto-acks by default with increasing seqs and request-derived ids", async () => {
    const transport = createFakeTransport();
    const first = await transport.sendMutation({
      collection: "todos",
      id: "t1",
      mutationId: "m1",
      operation: "create",
    });
    const second = await transport.sendMutation({
      collection: "todos",
      mutationId: "m2",
      operation: "create",
    });
    expect(first).toEqual({ack: {id: "t1", mutationId: "m1", seq: 1}, type: "ack"});
    expect(second).toEqual({ack: {id: "server-2", mutationId: "m2", seq: 2}, type: "ack"});
    expect(transport.sentMutations.map((m) => m.mutationId)).toEqual(["m1", "m2"]);
  });

  it("respondWithAck/respondWithNack queue one-shot responses in order", async () => {
    const transport = createFakeTransport();
    transport.respondWithNack({code: "conflict", serverDoc: {title: "srv"}, serverSeq: 4});
    transport.respondWithAck({seq: 9});
    const nacked = await transport.sendMutation({
      collection: "todos",
      id: "t1",
      mutationId: "m1",
      operation: "update",
    });
    const acked = await transport.sendMutation({
      collection: "todos",
      id: "t1",
      mutationId: "m2",
      operation: "update",
    });
    expect(nacked).toEqual({
      nack: {code: "conflict", mutationId: "m1", serverDoc: {title: "srv"}, serverSeq: 4},
      type: "nack",
    });
    expect(acked).toEqual({ack: {id: "t1", mutationId: "m2", seq: 9}, type: "ack"});
  });

  it("respondWith supports rejecting responders and setDefaultResponder overrides", async () => {
    const transport = createFakeTransport();
    transport.respondWith(() => {
      throw new Error("network down");
    });
    await expect(
      transport.sendMutation({collection: "todos", id: "t1", mutationId: "m1", operation: "update"})
    ).rejects.toThrow("network down");

    transport.setDefaultResponder((request) => ({
      nack: {code: "validation", mutationId: request.mutationId},
      type: "nack",
    }));
    const result = await transport.sendMutation({
      collection: "todos",
      id: "t1",
      mutationId: "m2",
      operation: "update",
    });
    expect(result.type).toBe("nack");

    transport.setDefaultResponder();
    const acked = await transport.sendMutation({
      collection: "todos",
      id: "t1",
      mutationId: "m3",
      operation: "update",
    });
    expect(acked.type).toBe("ack");
  });

  it("status unsubscribe stops notifications", async () => {
    const transport = createFakeTransport();
    const statuses: TransportStatus[] = [];
    const unsubscribe = transport.onStatusChange((status) => statuses.push(status));
    unsubscribe();
    transport.setConnected(true);
    expect(statuses).toEqual([]);
  });
});
