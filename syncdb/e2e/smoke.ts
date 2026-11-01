/**
 * Real-process smoke for @terreno/syncdb. Run `bun e2e/smoke.ts` after `bun run compile`.
 *
 * Starts example-backend as a child process with `spawnExampleBackend()` against
 * `smokeMongoUri()`, then signs one user in twice through Better Auth, as two devices would.
 * Two clients built from the compiled `@terreno/syncdb` (`createSyncDb` with its default socket
 * transport and HTTP channel, `betterAuthAdapter`, and the memory persister) start against it and
 * settle: each has joined its stream and finished the subscribe catch-up. Client A writes a todo;
 * the smoke checks that the server acks it and that client B receives it as a live socket delta
 * (read from B's debug log) and holds it in its store within 5 s. Exits non-zero on the first
 * failed check.
 */
import {
  betterAuthAdapter,
  createSyncDb,
  memoryPersisterFactory,
  type SyncDb,
  type SyncDebugEvent,
  type SyncEntity,
} from "@terreno/syncdb";
import {
  type ExampleBackend,
  smokeMongoUri,
  spawnExampleBackend,
  stopSmokeMongo,
} from "@terreno/test";
import {DateTime} from "luxon";

const PASSWORD = "syncdb-smoke-password-1";
const COLLECTION = "todos";
const DELIVERY_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 50;
/** Startup is not part of the 5 s delivery budget; it waits on the backend's first requests. */
const SETTLE_TIMEOUT_MS = 15000;

interface Todo {
  title?: string;
}

interface BetterAuthSignInResponse {
  token: string;
}

const expectStatus = async (res: Response, status: number, step: string): Promise<unknown> => {
  const body = await res.text();
  if (res.status !== status) {
    throw new Error(`${step}: expected ${status}, got ${res.status}: ${body}`);
  }
  return body ? JSON.parse(body) : undefined;
};

/** Signs up or signs in through Better Auth's email routes and returns the bearer session. */
const signIn = async ({
  baseUrl,
  email,
  route,
}: {
  baseUrl: string;
  email: string;
  route: "sign-in" | "sign-up";
}): Promise<BetterAuthSignInResponse> => {
  const body =
    route === "sign-up"
      ? {email, name: "Syncdb smoke", password: PASSWORD}
      : {email, password: PASSWORD};
  return (await expectStatus(
    await fetch(`${baseUrl}/api/auth/${route}/email`, {
      body: JSON.stringify(body),
      headers: {"Content-Type": "application/json"},
      method: "POST",
    }),
    200,
    `POST /api/auth/${route}/email`
  )) as BetterAuthSignInResponse;
};

/**
 * One device: a compiled syncdb client whose `betterAuthAdapter` reads the session over HTTP
 * with the bearer token, the way a web app in bearer mode does. The debug log records socket
 * deltas and catch-up passes, so the smoke can tell how a row arrived.
 */
const createDevice = ({
  baseUrl,
  name,
  token,
}: {
  baseUrl: string;
  name: string;
  token: string;
}): SyncDb => {
  const authProvider = betterAuthAdapter(
    {
      getSession: async () => {
        const res = await fetch(`${baseUrl}/api/auth/get-session`, {
          headers: {Authorization: `Bearer ${token}`},
        });
        return {data: res.ok ? await res.json() : null};
      },
    },
    {getBearerToken: () => token, pollIntervalMs: 60_000}
  );
  return createSyncDb({
    authProvider,
    baseUrl,
    collections: [COLLECTION],
    debug: true,
    name,
    persisterFactory: memoryPersisterFactory,
    reconcileIntervalMs: 0,
  });
};

/** Polls `check` every 50 ms until it returns a value, or throws after `timeoutMs`. */
const waitFor = async <T>({
  check,
  describeLast = (): string => "",
  step,
  timeoutMs = DELIVERY_TIMEOUT_MS,
}: {
  check: () => T | undefined | false;
  describeLast?: () => string;
  step: string;
  timeoutMs?: number;
}): Promise<T> => {
  const deadline = DateTime.now().plus({milliseconds: timeoutMs});
  do {
    const value = check();
    if (value) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  } while (DateTime.now() < deadline);
  throw new Error(`${step}: not seen within ${timeoutMs} ms${describeLast()}`);
};

/** Waits until a client's local store holds the todo in the state `isReady` accepts. */
const waitForEntity = ({
  client,
  id,
  isReady,
  step,
  timeoutMs,
}: {
  client: SyncDb;
  id: string;
  isReady: (entity: SyncEntity<Todo>) => boolean;
  step: string;
  timeoutMs: number;
}): Promise<SyncEntity<Todo>> => {
  const read = (): SyncEntity<Todo> | undefined =>
    client.store.getEntity<Todo>({collection: COLLECTION, id});
  return waitFor({
    check: () => {
      const entity = read();
      return entity && isReady(entity) ? entity : undefined;
    },
    describeLast: () => `; last local row: ${JSON.stringify(read())}`,
    step,
    timeoutMs,
  });
};

/** True once `client` recorded a debug event matching `predicate`. */
const hasEvent = (client: SyncDb, predicate: (event: SyncDebugEvent) => boolean): boolean =>
  (client.debug?.getEvents() ?? []).some(predicate);

/**
 * Waits until a client has joined its todos stream and finished the HTTP catch-up that follows
 * the join, so a later write can only reach it as a live delta.
 */
const waitForSettled = ({client, label}: {client: SyncDb; label: string}): Promise<boolean> =>
  waitFor({
    check: () =>
      hasEvent(
        client,
        (event) =>
          event.type === "reconcile" &&
          event.label.startsWith("subscribe catch-up") &&
          event.label.includes(`${COLLECTION}|`)
      ) && !client.getSyncStatus().isSyncing,
    describeLast: () => `; status: ${JSON.stringify(client.getSyncStatus())}`,
    step: `client ${label} settled`,
    timeoutMs: SETTLE_TIMEOUT_MS,
  });

/** Boots example-backend, starts two clients for one user, and checks A's write reaches B. */
const run = async (): Promise<void> => {
  const startedAt = DateTime.now();
  const runId = startedAt.toMillis();
  const email = `syncdb-smoke-${runId}@example.com`;
  const title = `Syncdb smoke todo ${runId}`;
  let backend: ExampleBackend | undefined;
  const clients: SyncDb[] = [];

  try {
    backend = await spawnExampleBackend({
      mongoUri: await smokeMongoUri({databaseName: "syncdbSmoke"}),
    });
    const {baseUrl} = backend;

    const signUp = await signIn({baseUrl, email, route: "sign-up"});
    const secondSession = await signIn({baseUrl, email, route: "sign-in"});
    console.info("✅ Better Auth signs one user in on two devices");

    const clientA = createDevice({baseUrl, name: `syncdb-smoke-a-${runId}`, token: signUp.token});
    const clientB = createDevice({
      baseUrl,
      name: `syncdb-smoke-b-${runId}`,
      token: secondSession.token,
    });
    clients.push(clientA, clientB);
    await Promise.all([clientA.start(), clientB.start()]);
    await Promise.all([
      waitForSettled({client: clientA, label: "A"}),
      waitForSettled({client: clientB, label: "B"}),
    ]);
    console.info("✅ Both clients start, join their todos stream, and finish catch-up");

    const writtenAt = DateTime.now();
    const {id} = clientA.mutate({collection: COLLECTION, data: {title}, operation: "create"});

    const acked = await waitForEntity({
      client: clientA,
      id,
      isReady: (entity) => entity.seq > 0 && !entity.pendingMutationId,
      step: "client A ack",
      timeoutMs: DELIVERY_TIMEOUT_MS,
    });
    console.info(`✅ The server acks client A's todo (seq ${acked.seq})`);

    const received = await waitForEntity({
      client: clientB,
      id,
      // The delta event proves the row came over the socket, not from an HTTP snapshot page.
      isReady: (entity) =>
        entity.seq > 0 &&
        entity.data.title === title &&
        hasEvent(clientB, (event) => event.type === "delta" && event.entityId === id),
      step: "client B socket delta",
      timeoutMs: Math.max(0, DELIVERY_TIMEOUT_MS - DateTime.now().diff(writtenAt).toMillis()),
    });
    console.info(
      `✅ Client B gets the todo as a socket delta ${DateTime.now().diff(writtenAt).toMillis()} ms after A wrote it (seq ${received.seq})`
    );
  } catch (error: unknown) {
    if (backend) {
      console.error(`--- example-backend output ---\n${backend.output()}`);
    }
    throw error;
  } finally {
    await Promise.allSettled(clients.map((client) => client.stop()));
    await backend?.stop();
    await stopSmokeMongo();
  }

  console.info(`syncdb smoke passed in ${DateTime.now().diff(startedAt).toMillis()} ms`);
};

run().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
);
