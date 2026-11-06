/**
 * SyncDB Load Lab — an admin tool for stress-testing the local-first data layer.
 *
 * Two independently controllable engines exercise the stack end to end:
 *
 *  - "Other clients" (server engine): calls the admin `/todos/loadtest*` actions, which
 *    write to the owner-scoped todos collection server-side. Those writes fire MongoDB
 *    change streams → RealtimeApp broadcasts `sync:delta` over the websocket → this device's
 *    syncdb client applies them. From the local client's perspective they are indistinguishable
 *    from another user's device mutating shared data — new todos stream in, get updated, and
 *    get deleted continuously.
 *
 *  - Local engine: drives `client.mutate()` directly (create/update/delete on random local
 *    entities), exercising the optimistic path + durable outbox + ack round-trip.
 *
 * Watch it live in the SyncDB Debugger (/syncdb-debug), ideally in a second window.
 *
 * Endpoints are called with `fetch` + the Better Auth session token (matching gcs-settings.tsx)
 * rather than the generated SDK, so the tool needs no SDK regen to work.
 */

import {AdminScreenPage} from "@terreno/admin-frontend";
import type {SyncStatus} from "@terreno/syncdb";
import {baseUrl} from "@terreno/syncdb/config";
import {SyncDbProvider, useSyncDbClient} from "@terreno/syncdb/react";
import {Badge, BooleanField, Box, Button, Card, Heading, NumberField, Text} from "@terreno/ui";
import {DateTime} from "luxon";
import type React from "react";
import {useCallback, useEffect, useRef, useState} from "react";
import {SyncLabRateControls} from "@/components/SyncLabRateControls";
import {SYNC_LAB_COLLECTION, SYNC_LAB_RATE_OPS, useSyncLabRates} from "@/components/syncLabRates";
import {useOpenSyncDebugger} from "@/hooks/useOpenSyncDebugger";
import {getSessionToken} from "@/lib/betterAuth";
import {syncDb} from "@/store/syncdb";

interface LabMetrics {
  localCount: number;
  status: SyncStatus;
  eventTotal: number;
  deltaRate: number;
  mutateRate: number;
  ackRate: number;
}

interface RateSample {
  t: number;
  delta: number;
  mutate: number;
  ack: number;
}

const MetricBadge: React.FC<{
  label: string;
  value: string | number;
  status?: "info" | "success" | "warning" | "error" | "neutral";
}> = ({label, value, status = "neutral"}) => {
  return (
    <Box direction="column" gap={1}>
      <Text color="secondaryLight" size="sm">
        {label}
      </Text>
      <Badge status={status} value={String(value)} />
    </Box>
  );
};

const SyncLabContent: React.FC = () => {
  const client = useSyncDbClient();
  const openDebugger = useOpenSyncDebugger();
  const {showDevPanel, setShowDevPanel} = useSyncLabRates();

  const [generateCount, setGenerateCount] = useState<string>("1000");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);

  // Seed the status from the client rather than a hand-written literal so this
  // screen never has to be updated when SyncStatus grows a field.
  const [metrics, setMetrics] = useState<LabMetrics>(() => ({
    ackRate: 0,
    deltaRate: 0,
    eventTotal: 0,
    localCount: 0,
    mutateRate: 0,
    status: client.getSyncStatus(),
  }));
  const prevSampleRef = useRef<RateSample | null>(null);

  const callLoadTest = useCallback(
    async (path: string, body?: Record<string, unknown>): Promise<Record<string, number>> => {
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
    },
    []
  );

  const handleGenerate = useCallback(async (): Promise<void> => {
    const count = Number(generateCount);
    if (!Number.isFinite(count) || count <= 0) {
      setError("Enter a positive number of todos to generate");
      return;
    }
    setBusy("generate");
    setError(null);
    try {
      const result = await callLoadTest("loadtestGenerate", {count});
      setLastAction(`Generated ${result.created ?? 0} todos server-side`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generate failed");
    } finally {
      setBusy(null);
    }
  }, [callLoadTest, generateCount]);

  const handleClear = useCallback(async (): Promise<void> => {
    setBusy("clear");
    setError(null);
    try {
      const result = await callLoadTest("loadtestClear");
      setLastAction(`Cleared ${result.deleted ?? 0} todos server-side`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Clear failed");
    } finally {
      setBusy(null);
    }
  }, [callLoadTest]);

  // Metrics sampler (2 Hz): reads live status + debug stats and derives per-second rates.
  useEffect(() => {
    const sample = (): void => {
      const status = client.getSyncStatus();
      const localCount = client.store.listEntities({collection: SYNC_LAB_COLLECTION}).length;
      const stats = client.debug?.getStats();
      const nowMs = DateTime.now().toMillis();

      let deltaRate = 0;
      let mutateRate = 0;
      let ackRate = 0;
      const prev = prevSampleRef.current;
      if (stats && prev) {
        const dt = (nowMs - prev.t) / 1000;
        if (dt > 0) {
          deltaRate = Math.max(0, (stats.byType.delta - prev.delta) / dt);
          mutateRate = Math.max(0, (stats.byType.mutate - prev.mutate) / dt);
          ackRate = Math.max(0, (stats.byType.ack - prev.ack) / dt);
        }
      }
      if (stats) {
        prevSampleRef.current = {
          ack: stats.byType.ack,
          delta: stats.byType.delta,
          mutate: stats.byType.mutate,
          t: nowMs,
        };
      }

      setMetrics({
        ackRate,
        deltaRate,
        eventTotal: stats?.total ?? 0,
        localCount,
        mutateRate,
        status,
      });
    };
    sample();
    const id = setInterval(sample, 500);
    return (): void => clearInterval(id);
  }, [client]);

  const debugEnabled = Boolean(client.debug);

  return (
    <AdminScreenPage maxWidth="100%" scroll title="SyncDB Load Lab">
      <Box gap={4} padding={4}>
        <Box alignItems="center" direction="row" gap={2} justifyContent="between" wrap>
          <Box gap={1}>
            <Heading size="lg">SyncDB Load Lab</Heading>
            <Text color="secondaryLight" size="sm">
              Stress the local-first data layer and watch patches stream in over the websocket.
            </Text>
          </Box>
          <Button iconName="bug" onClick={openDebugger} text="Open debugger" variant="secondary" />
        </Box>

        {error ? (
          <Card>
            <Text color="error">{error}</Text>
          </Card>
        ) : null}
        {lastAction ? (
          <Text color="secondaryLight" size="sm">
            {lastAction}
          </Text>
        ) : null}

        {/* Live metrics */}
        <Card>
          <Box gap={3}>
            <Heading size="sm">Live metrics</Heading>
            <Box direction="row" gap={5} wrap>
              <MetricBadge label="Local todos" status="info" value={metrics.localCount} />
              <MetricBadge
                label="Connection"
                status={metrics.status.isOnline ? "success" : "error"}
                value={metrics.status.isOnline ? "online" : "offline"}
              />
              <MetricBadge
                label="Syncing"
                status={metrics.status.isSyncing ? "warning" : "neutral"}
                value={metrics.status.isSyncing ? "yes" : "idle"}
              />
              <MetricBadge
                label="Outbox queued"
                status={metrics.status.queuedCount > 0 ? "warning" : "neutral"}
                value={metrics.status.queuedCount}
              />
              <MetricBadge
                label="Conflicts"
                status={metrics.status.conflictCount > 0 ? "error" : "neutral"}
                value={metrics.status.conflictCount}
              />
            </Box>
            <Box direction="row" gap={5} wrap>
              <MetricBadge
                label="Deltas/sec (in)"
                status="info"
                value={metrics.deltaRate.toFixed(0)}
              />
              <MetricBadge
                label="Mutations/sec (out)"
                status="success"
                value={metrics.mutateRate.toFixed(0)}
              />
              <MetricBadge label="Acks/sec" status="success" value={metrics.ackRate.toFixed(0)} />
              <MetricBadge label="Debug events" status="neutral" value={metrics.eventTotal} />
            </Box>
            {debugEnabled ? null : (
              <Text color="secondaryLight" size="sm">
                Enable createSyncDb(&#123; debug: true &#125;) to see per-second event rates (on by
                default in dev).
              </Text>
            )}
          </Box>
        </Card>

        {/* Seed / reset */}
        <Card>
          <Box gap={3}>
            <Heading size="sm">Seed data</Heading>
            <Text color="secondaryLight" size="sm">
              Bulk-generate random todos server-side; each one streams to this client as an inbound
              delta over the websocket.
            </Text>
            <Box alignItems="end" direction="row" gap={3} wrap>
              <Box width={160}>
                <NumberField
                  onChange={setGenerateCount}
                  title="Count"
                  type="number"
                  value={generateCount}
                />
              </Box>
              <Button
                disabled={busy !== null}
                iconName="bolt"
                loading={busy === "generate"}
                onClick={handleGenerate}
                text="Generate"
                variant="primary"
              />
              <Button
                disabled={busy !== null}
                iconName="trash"
                loading={busy === "clear"}
                onClick={handleClear}
                text="Clear all"
                variant="destructive"
              />
            </Box>
          </Box>
        </Card>

        {/* Continuous engines — rates shared with home SyncDB dev panel */}
        <Card>
          <Box gap={4}>
            <Heading size="sm">Continuous churn</Heading>
            <BooleanField
              helperText="When on, the SyncDB dev panel (with these rate dropdowns) appears on the home todos screen."
              onChange={setShowDevPanel}
              testID="sync-lab-show-dev-panel"
              title="Show SyncDB dev panel on home"
              value={showDevPanel}
              variant="title"
            />
            <Text color="secondaryLight" size="sm">
              Other clients simulates remote devices via server writes; This client drives
              optimistic mutations through the outbox. Rates stay in sync with the home SyncDB dev
              panel.
            </Text>
            <SyncLabRateControls />
            <Text color="secondaryLight" size="sm">
              Approximate rates: Off · Low ≈ 1 op / 5s · Med {SYNC_LAB_RATE_OPS[2]}/s · High{" "}
              {SYNC_LAB_RATE_OPS[3]}/s · Max {SYNC_LAB_RATE_OPS[4]}/s.
            </Text>
          </Box>
        </Card>
      </Box>
    </AdminScreenPage>
  );
};

const SyncLabScreen: React.FC = () => {
  return (
    <SyncDbProvider client={syncDb}>
      <SyncLabContent />
    </SyncDbProvider>
  );
};

export default SyncLabScreen;
