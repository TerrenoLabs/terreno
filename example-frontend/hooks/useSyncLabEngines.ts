/**
 * Singleton Sync Lab churn engines — one remote interval and one local interval
 * for the whole app, driven by the shared rate store.
 *
 * Mount once via {@link SyncLabRuntime} in the root layout so engines keep
 * running while navigating between screens. Multiple subscribers are still
 * supported (first starts timers, last tears them down).
 */

import {generateMutationId, type SyncDb} from "@terreno/syncdb";
import {baseUrl} from "@terreno/syncdb/config";
import {useSyncDbClient} from "@terreno/syncdb/react";
import {useEffect, useState} from "react";
import {
  getSyncLabRates,
  SYNC_LAB_COLLECTION,
  SYNC_LAB_RATE_OPS,
  SYNC_LAB_TICK_MS,
  subscribeSyncLabRates,
} from "@/components/syncLabRates";
import {getSessionToken} from "@/lib/betterAuth";

const TITLE_WORDS = ["sync", "delta", "outbox", "conflict", "replay", "cursor", "socket", "chaos"];
const randomInt = (max: number): number => Math.floor(Math.random() * max);
const randomTitle = (): string =>
  `local ${TITLE_WORDS[randomInt(TITLE_WORDS.length)]} #${randomInt(100_000)}`;

interface EngineRuntime {
  client: SyncDb | null;
  subscriberCount: number;
  remoteTimer: ReturnType<typeof setInterval> | undefined;
  localTimer: ReturnType<typeof setInterval> | undefined;
  remoteAccum: number;
  localAccum: number;
  unsubscribeRates: (() => void) | undefined;
  lastError: string | null;
  errorListeners: Set<() => void>;
}

const runtime: EngineRuntime = {
  client: null,
  errorListeners: new Set(),
  lastError: null,
  localAccum: 0,
  localTimer: undefined,
  remoteAccum: 0,
  remoteTimer: undefined,
  subscriberCount: 0,
  unsubscribeRates: undefined,
};

const setLastError = (message: string | null): void => {
  if (runtime.lastError === message) {
    return;
  }
  runtime.lastError = message;
  for (const listener of runtime.errorListeners) {
    listener();
  }
};

const callLoadTest = async (
  path: string,
  body?: Record<string, unknown>
): Promise<Record<string, number>> => {
  const token = await getSessionToken();
  const response = await fetch(`${baseUrl}/todos/${path}`, {
    body: JSON.stringify(body ?? {}),
    headers: {
      "Content-Type": "application/json",
      ...(token ? {Authorization: `Bearer ${token}`} : {}),
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`loadtest ${path} failed with status ${response.status}`);
  }
  const json = (await response.json()) as {data?: Record<string, number>};
  return json.data ?? {};
};

const runLocalChurn = (ops: number): void => {
  const client = runtime.client;
  if (!client) {
    return;
  }
  const entities = client.store.listEntities<{_id?: string}>({
    collection: SYNC_LAB_COLLECTION,
  });
  for (let i = 0; i < ops; i++) {
    const roll = Math.random();
    if (roll < 0.5 || entities.length === 0) {
      const id = generateMutationId();
      client.mutate({
        collection: SYNC_LAB_COLLECTION,
        data: {_id: id, completed: false, title: randomTitle()},
        operation: "create",
      });
      continue;
    }
    const target = entities[randomInt(entities.length)];
    if (!target?.id) {
      continue;
    }
    if (roll < 0.9) {
      client.mutate({
        collection: SYNC_LAB_COLLECTION,
        data: {completed: Math.random() < 0.5, title: randomTitle()},
        id: target.id,
        operation: "update",
      });
      continue;
    }
    client.mutate({collection: SYNC_LAB_COLLECTION, id: target.id, operation: "delete"});
  }
};

const stopRemoteEngine = (): void => {
  if (runtime.remoteTimer !== undefined) {
    clearInterval(runtime.remoteTimer);
    runtime.remoteTimer = undefined;
  }
  runtime.remoteAccum = 0;
};

const stopLocalEngine = (): void => {
  if (runtime.localTimer !== undefined) {
    clearInterval(runtime.localTimer);
    runtime.localTimer = undefined;
  }
  runtime.localAccum = 0;
};

const syncEnginesToRates = (): void => {
  const {localRate, remoteRate} = getSyncLabRates();
  const remoteOps = SYNC_LAB_RATE_OPS[remoteRate];
  const localOps = SYNC_LAB_RATE_OPS[localRate];

  if (remoteOps === 0) {
    stopRemoteEngine();
  } else if (runtime.remoteTimer === undefined) {
    runtime.remoteAccum = 0;
    let inFlight = false;
    runtime.remoteTimer = setInterval(() => {
      const opsPerSec = SYNC_LAB_RATE_OPS[getSyncLabRates().remoteRate];
      if (opsPerSec === 0) {
        return;
      }
      runtime.remoteAccum += opsPerSec * (SYNC_LAB_TICK_MS / 1_000);
      const ops = Math.floor(runtime.remoteAccum + 1e-9);
      if (ops < 1 || inFlight) {
        return;
      }
      runtime.remoteAccum -= ops;
      inFlight = true;
      callLoadTest("loadtestChurn", {
        creates: Math.ceil(ops * 0.5),
        deletes: Math.floor(ops * 0.1),
        updates: Math.ceil(ops * 0.4),
      })
        .catch((err: unknown) => {
          setLastError(err instanceof Error ? err.message : "Churn failed");
        })
        .finally(() => {
          inFlight = false;
        });
    }, SYNC_LAB_TICK_MS);
  }

  if (localOps === 0) {
    stopLocalEngine();
  } else if (runtime.localTimer === undefined) {
    runtime.localAccum = 0;
    runtime.localTimer = setInterval(() => {
      const opsPerSec = SYNC_LAB_RATE_OPS[getSyncLabRates().localRate];
      if (opsPerSec === 0) {
        return;
      }
      runtime.localAccum += opsPerSec * (SYNC_LAB_TICK_MS / 1_000);
      const ops = Math.floor(runtime.localAccum + 1e-9);
      if (ops < 1) {
        return;
      }
      runtime.localAccum -= ops;
      runLocalChurn(ops);
    }, SYNC_LAB_TICK_MS);
  }

  if (localRate === 0 && remoteRate === 0) {
    setLastError(null);
  }
};

const attachSubscriber = (client: SyncDb): void => {
  runtime.client = client;
  runtime.subscriberCount += 1;
  if (runtime.subscriberCount === 1) {
    runtime.unsubscribeRates = subscribeSyncLabRates(syncEnginesToRates);
    syncEnginesToRates();
  }
};

const detachSubscriber = (): void => {
  runtime.subscriberCount = Math.max(0, runtime.subscriberCount - 1);
  if (runtime.subscriberCount > 0) {
    return;
  }
  runtime.unsubscribeRates?.();
  runtime.unsubscribeRates = undefined;
  stopRemoteEngine();
  stopLocalEngine();
  runtime.client = null;
};

export interface UseSyncLabEnginesResult {
  error: string | null;
}

/** Subscribe this screen to the singleton Sync Lab engines. */
export const useSyncLabEngines = (): UseSyncLabEnginesResult => {
  const client = useSyncDbClient();
  const [error, setError] = useState<string | null>(runtime.lastError);

  // Keep the singleton engines alive while any consumer is mounted.
  useEffect(() => {
    attachSubscriber(client);
    return (): void => {
      detachSubscriber();
    };
  }, [client]);

  // Mirror singleton error into React state for UI.
  useEffect(() => {
    const onError = (): void => {
      setError(runtime.lastError);
    };
    runtime.errorListeners.add(onError);
    setError(runtime.lastError);
    return (): void => {
      runtime.errorListeners.delete(onError);
    };
  }, []);

  return {error};
};
