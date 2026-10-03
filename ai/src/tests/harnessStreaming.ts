import type {AddressInfo} from "node:net";
import type express from "express";

/** One model request a gated streaming mock received; the test feeds its stream. */
export interface GatedRequest {
  /** Fail the response mid-stream, as a dropped provider connection would. */
  fail: (error: unknown) => void;
  /** End the response: an answer, or tool calls the turn must run. */
  finish: (options?: {toolCalls?: Array<{id: string; input?: unknown; name: string}>}) => void;
  /** The prompt the turn sent (LanguageModelV2 messages). */
  prompt: Array<{content: unknown; role: string}>;
  /** Stream more answer text. */
  text: (chunk: string) => void;
}

/**
 * A LanguageModelV2 mock whose `doStream` hands every request to the test, which streams
 * text into it and finishes it when it chooses. `doGenerate` is never used by the turn.
 */
export const gatedStreamingModel = (modelId = "gated-model") => {
  const received: GatedRequest[] = [];
  const waiters: Array<(request: GatedRequest) => void> = [];
  let taken = 0;
  const model = {
    doGenerate: async () => {
      throw new Error("gatedStreamingModel only streams");
    },
    doStream: async (options: {abortSignal?: AbortSignal; prompt: GatedRequest["prompt"]}) => {
      let controller: ReadableStreamDefaultController<unknown> | undefined;
      const stream = new ReadableStream({
        start(streamController) {
          controller = streamController;
        },
      });
      const enqueue = (part: unknown): void => controller?.enqueue(part);
      enqueue({type: "stream-start", warnings: []});
      enqueue({id: "text-0", type: "text-start"});
      const request: GatedRequest = {
        fail: (error) => {
          try {
            controller?.error(error);
          } catch {
            // Already finished.
          }
        },
        finish: ({toolCalls = []} = {}) => {
          enqueue({id: "text-0", type: "text-end"});
          for (const call of toolCalls) {
            enqueue({
              input: JSON.stringify(call.input ?? {}),
              toolCallId: call.id,
              toolName: call.name,
              type: "tool-call",
            });
          }
          enqueue({
            finishReason: toolCalls.length > 0 ? "tool-calls" : "stop",
            type: "finish",
            usage: {inputTokens: 3, outputTokens: 2, totalTokens: 5},
          });
          controller?.close();
        },
        prompt: JSON.parse(JSON.stringify(options.prompt)),
        text: (chunk) => enqueue({delta: chunk, id: "text-0", type: "text-delta"}),
      };
      // An aborted turn (or a stopping test) must not leave the stream open.
      options.abortSignal?.addEventListener("abort", () =>
        request.fail(options.abortSignal?.reason)
      );
      received.push(request);
      waiters.shift()?.(request);
      return {stream};
    },
    modelId,
    provider: "mock",
    specificationVersion: "v2" as const,
    supportedUrls: {},
  };
  /** The next request the turn makes (already made, or the one it makes next). */
  const nextRequest = (): Promise<GatedRequest> => {
    const index = taken;
    taken += 1;
    const ready = received[index];
    if (ready) {
      return Promise.resolve(ready);
    }
    return new Promise((resolve) => waiters.push(resolve));
  };
  return {model, nextRequest, received};
};

/** One parsed SSE frame. */
export interface SseFrame {
  data: {created: string; payload: unknown; seq: number; taskId?: string; type: string};
  event: string;
  id: number;
}

/** A live SSE connection: frames and heartbeat comments received so far. */
export interface SseClient {
  close: () => void;
  comments: string[];
  frames: SseFrame[];
  /** Resolves once a frame matches, or rejects after `timeoutMs`. */
  waitFor: (predicate: (frame: SseFrame) => boolean, timeoutMs?: number) => Promise<SseFrame>;
}

/** Start `app` on a free local port; returns its base URL and a stop function. */
export const listen = async (
  app: express.Application
): Promise<{stop: () => Promise<void>; url: string}> => {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const {port} = server.address() as AddressInfo;
  return {
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
    url: `http://127.0.0.1:${port}`,
  };
};

/**
 * Open an SSE stream with `fetch` and parse frames as they arrive. Throws with the status
 * and body when the server answers with anything but an event stream.
 */
export const openSse = async (
  url: string,
  {headers = {}}: {headers?: Record<string, string>} = {}
): Promise<SseClient> => {
  const controller = new AbortController();
  const response = await fetch(url, {
    headers: {accept: "text/event-stream", ...headers},
    signal: controller.signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`SSE ${response.status}: ${await response.text()}`);
  }
  const frames: SseFrame[] = [];
  const comments: string[] = [];
  const listeners = new Set<() => void>();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const parse = (block: string): void => {
    const fields: Record<string, string> = {};
    for (const line of block.split("\n")) {
      if (line.startsWith(":")) {
        comments.push(line.slice(1).trim());
        continue;
      }
      const colon = line.indexOf(":");
      if (colon > 0) {
        fields[line.slice(0, colon)] = line.slice(colon + 1).trimStart();
      }
    }
    if (fields.data !== undefined) {
      frames.push({
        data: JSON.parse(fields.data),
        event: fields.event ?? "message",
        id: Number(fields.id),
      });
    }
  };
  void (async () => {
    try {
      for (;;) {
        const {done, value} = await reader.read();
        if (done) {
          return;
        }
        buffer += decoder.decode(value, {stream: true});
        let end = buffer.indexOf("\n\n");
        while (end >= 0) {
          parse(buffer.slice(0, end));
          buffer = buffer.slice(end + 2);
          end = buffer.indexOf("\n\n");
        }
        for (const listener of listeners) {
          listener();
        }
      }
    } catch {
      // Aborted by close().
    }
  })();
  const waitFor = (predicate: (frame: SseFrame) => boolean, timeoutMs = 10_000) =>
    new Promise<SseFrame>((resolve, reject) => {
      const check = (): boolean => {
        const found = frames.find(predicate);
        if (found) {
          listeners.delete(listener);
          clearTimeout(timer);
          resolve(found);
        }
        return Boolean(found);
      };
      const listener = (): void => {
        check();
      };
      const timer = setTimeout(() => {
        listeners.delete(listener);
        reject(
          new Error(
            `SSE frame not received within ${timeoutMs} ms; got ${frames.map((frame) => `${frame.id}:${frame.event}`).join(", ")}`
          )
        );
      }, timeoutMs);
      if (!check()) {
        listeners.add(listener);
      }
    });
  return {close: () => controller.abort(), comments, frames, waitFor};
};
