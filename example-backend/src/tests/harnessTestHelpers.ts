import {afterAll, beforeAll} from "bun:test";
import {LocalTraceStore} from "@terreno/ai";
import {startMongoServer, stopMongoServer} from "@terreno/test";
import {DateTime} from "luxon";
import mongoose from "mongoose";

/** One span of a trace, flattened in tree order. */
export interface SpanLine {
  depth: number;
  kind: string;
  name: string;
  output?: unknown;
  parent?: string;
  status: string;
}

interface SpanNodeLike {
  children: SpanNodeLike[];
  kind: string;
  name: string;
  output?: unknown;
  status: string;
}

/**
 * The harness needs a replica set, but the example-backend preload connects a standalone
 * memory server. Swap the default connection to a single-node replica set for the calling
 * file's tests and restore the original afterwards.
 */
export const useReplicaSetConnection = (databaseName: string): void => {
  let originalUri = "";
  beforeAll(async () => {
    const {host, name, port} = mongoose.connection;
    originalUri = `mongodb://${host}:${port}/${name}`;
    await mongoose.disconnect();
    await startMongoServer({
      baseDatabaseName: databaseName,
      externalUriEnvVar: "TERRENO_EXAMPLE_HARNESS_TEST_MONGODB_URI",
      useReplSet: true,
    });
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await stopMongoServer();
    await mongoose.connect(originalUri);
  });
};

/** Poll `read` until it returns a value (not `undefined`) or `timeoutMs` passes. */
export const pollUntil = async <T>(
  read: () => Promise<T | undefined>,
  {
    intervalMs = 50,
    timeoutMs = 30_000,
    what,
  }: {intervalMs?: number; timeoutMs?: number; what: string}
): Promise<T> => {
  const deadline = DateTime.now().plus({milliseconds: timeoutMs});
  while (DateTime.now() < deadline) {
    const value = await read();
    if (value !== undefined) {
      return value;
    }
    await Bun.sleep(intervalMs);
  }
  throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}`);
};

const flatten = (nodes: SpanNodeLike[], depth: number, parent?: string): SpanLine[] =>
  nodes.flatMap((node) => [
    {depth, kind: node.kind, name: node.name, output: node.output, parent, status: node.status},
    ...flatten(node.children, depth + 1, node.name),
  ]);

/**
 * A trace's spans in tree order, read through the same store the observability trace API
 * (`GET /ai/observability/traces/:id`) serves.
 */
export const traceSpanLines = async (traceId: unknown): Promise<SpanLine[]> => {
  const detail = await new LocalTraceStore().getDetail(String(traceId));
  return flatten(detail.spans as unknown as SpanNodeLike[], 0);
};
