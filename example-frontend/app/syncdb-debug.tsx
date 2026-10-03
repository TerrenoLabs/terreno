/**
 * SyncDB Debugger — a Redux-DevTools-style live view over the @terreno/syncdb
 * debug event log. The event list and the JSON inspector sit side by side at or
 * above the desktop floor, and stack below it. Open it in a second browser
 * window: local mutations, outbound sends, inbound server deltas
 * ("patches"), acks/nacks, conflicts, reconcile/replay and connectivity all
 * stream in live.
 *
 * The look is intentionally custom (dark, monospace, dense) rather than themed —
 * it is a developer tool. It uses raw RN primitives + a FlatList for a flat,
 * virtualized, high-throughput list, and freezes on pause so a burst can be read.
 *
 * NOT A PATTERN TO COPY: bypassing @terreno/ui and the theme (raw View/Text plus the
 * hardcoded PALETTE below) is a deliberate exception for this one debug-only screen,
 * where per-row render cost dominates at thousands of events. Product screens must use
 * Box/Text/Card and theme values.
 *
 * The same data is available programmatically via `client.debug.snapshot()`,
 * which is the shape a future MCP tool will return.
 */
import type {SyncDebugEvent, SyncDebugEventType} from "@terreno/syncdb";
import {SyncDbProvider, useSyncDebugLog, useSyncStatus} from "@terreno/syncdb/react";
import {
  formatConflictFieldLabel,
  formatConflictFieldValue,
  getChangedConflictFields,
  isSupportedDesktopWidth,
  NO_CONFLICT_DIFF_FIELDS,
} from "@terreno/ui";
import {useRouter} from "expo-router";
import React, {useCallback, useEffect, useMemo, useState} from "react";
import {
  FlatList,
  type ListRenderItem,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import {useOpenSyncLab} from "@/hooks/useOpenSyncLab";
import {syncDb} from "@/store/syncdb";

const PALETTE = {
  accent: "#4c8dff",
  bg: "#0b0e14",
  border: "#1f2430",
  panel: "#11151f",
  panelAlt: "#161b26",
  rowSelected: "#1d2740",
  text: "#d7dce5",
  textDim: "#7b8496",
  textFaint: "#4b5364",
};

/** Per-type accent colors, roughly grouped by direction/outcome. */
const TYPE_COLOR: Record<SyncDebugEventType, string> = {
  ack: "#3fb950",
  conflict: "#f78166",
  connect: "#2dd4bf",
  delta: "#4c8dff",
  disconnect: "#8b949e",
  failed: "#f85149",
  mutate: "#3fb950",
  nack: "#f85149",
  reconcile: "#bc8cff",
  replay: "#bc8cff",
  resolve: "#d29922",
  retry: "#d29922",
  send: "#58a6ff",
};

const ALL_TYPES = Object.keys(TYPE_COLOR) as SyncDebugEventType[];

const ROW_HEIGHT = 34;

const monospace = Platform.select({
  default: "monospace",
  ios: "Menlo",
  web: "ui-monospace, SFMono-Regular, Menlo, monospace",
});

const formatTime = (iso: string): string => {
  // HH:mm:ss.SSS from an ISO timestamp without pulling in luxon for hot-path rendering.
  const t = iso.slice(11, 23);
  return t.length >= 8 ? t : iso;
};

const StatusPill: React.FC<{label: string; color: string}> = ({label, color}) => {
  return (
    <View
      style={{
        backgroundColor: PALETTE.panelAlt,
        borderColor: color,
        borderRadius: 4,
        borderWidth: 1,
        paddingHorizontal: 8,
        paddingVertical: 3,
      }}
    >
      <Text style={{color, fontFamily: monospace, fontSize: 11}}>{label}</Text>
    </View>
  );
};

const ToolbarButton: React.FC<{
  label: string;
  onPress: () => void;
  danger?: boolean;
  active?: boolean;
}> = ({label, onPress, danger, active}) => {
  const color = danger ? "#f85149" : active ? PALETTE.accent : PALETTE.text;
  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: active ? PALETTE.rowSelected : PALETTE.panelAlt,
        borderColor: active ? PALETTE.accent : PALETTE.border,
        borderRadius: 4,
        borderWidth: 1,
        paddingHorizontal: 10,
        paddingVertical: 5,
      }}
      testID={`syncdb-debug-btn-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <Text style={{color, fontFamily: monospace, fontSize: 12}}>{label}</Text>
    </Pressable>
  );
};

interface EventRowProps {
  event: SyncDebugEvent;
  selected: boolean;
  onSelect: (event: SyncDebugEvent) => void;
}

const EventRow: React.FC<EventRowProps> = React.memo(({event, selected, onSelect}) => {
  const color = TYPE_COLOR[event.type];
  const handlePress = useCallback((): void => onSelect(event), [event, onSelect]);
  return (
    <Pressable
      onPress={handlePress}
      style={{
        alignItems: "center",
        backgroundColor: selected ? PALETTE.rowSelected : "transparent",
        borderBottomColor: PALETTE.border,
        borderBottomWidth: 1,
        flexDirection: "row",
        height: ROW_HEIGHT,
        paddingHorizontal: 10,
      }}
      testID={`syncdb-debug-row-${event.id}`}
    >
      <Text style={{color: PALETTE.textFaint, fontFamily: monospace, fontSize: 11, width: 92}}>
        {formatTime(event.timestamp)}
      </Text>
      <View
        style={{
          backgroundColor: `${color}22`,
          borderRadius: 3,
          marginRight: 8,
          minWidth: 74,
          paddingHorizontal: 6,
          paddingVertical: 2,
        }}
      >
        <Text style={{color, fontFamily: monospace, fontSize: 10, textAlign: "center"}}>
          {event.type}
          {event.phase ? `:${event.phase}` : ""}
        </Text>
      </View>
      <Text
        numberOfLines={1}
        style={{color: PALETTE.text, flex: 1, fontFamily: monospace, fontSize: 12}}
      >
        {event.label}
      </Text>
      {typeof event.seq === "number" ? (
        <Text style={{color: PALETTE.textDim, fontFamily: monospace, fontSize: 11, marginLeft: 8}}>
          seq {event.seq}
        </Text>
      ) : null}
    </Pressable>
  );
});
EventRow.displayName = "EventRow";

const EventDetail: React.FC<{event: SyncDebugEvent | null}> = ({event}) => {
  const [showDiff, setShowDiff] = useState<boolean>(false);

  // Reset diff view when the selected event changes.
  useEffect(() => {
    setShowDiff(false);
  }, [event?.id]);

  if (!event) {
    return (
      <View style={{alignItems: "center", flex: 1, justifyContent: "center", padding: 16}}>
        <Text style={{color: PALETTE.textFaint, fontFamily: monospace, fontSize: 12}}>
          Select an event to inspect
        </Text>
      </View>
    );
  }

  const detail = event.detail as
    | {
        localData?: unknown;
        serverDoc?: unknown;
      }
    | undefined;
  const canDiff =
    event.type === "conflict" &&
    detail !== undefined &&
    (detail.localData !== undefined || detail.serverDoc !== undefined);
  const localPayload =
    detail?.localData === undefined
      ? {}
      : typeof detail.localData === "object" && detail.localData !== null
        ? (detail.localData as Record<string, unknown>)
        : {value: detail.localData};
  const serverPayload =
    detail?.serverDoc === undefined
      ? {}
      : typeof detail.serverDoc === "object" && detail.serverDoc !== null
        ? (detail.serverDoc as Record<string, unknown>)
        : {value: detail.serverDoc};
  const changedFields = canDiff
    ? getChangedConflictFields({local: localPayload, server: serverPayload})
    : [];

  return (
    <ScrollView style={{flex: 1}} testID="syncdb-debug-detail">
      <View style={{padding: 12}}>
        <View
          style={{
            alignItems: "center",
            flexDirection: "row",
            gap: 8,
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <Text
            style={{
              color: TYPE_COLOR[event.type],
              flex: 1,
              fontFamily: monospace,
              fontSize: 13,
            }}
          >
            #{event.id} · {event.type}
            {event.phase ? `:${event.phase}` : ""} · {event.direction}
          </Text>
          {canDiff ? (
            <Pressable
              onPress={() => setShowDiff((prev) => !prev)}
              style={{
                backgroundColor: showDiff ? PALETTE.rowSelected : PALETTE.panelAlt,
                borderColor: showDiff ? PALETTE.accent : PALETTE.border,
                borderRadius: 4,
                borderWidth: 1,
                paddingHorizontal: 10,
                paddingVertical: 5,
              }}
              testID="syncdb-debug-diff-toggle"
            >
              <Text style={{color: PALETTE.text, fontFamily: monospace, fontSize: 12}}>
                {showDiff ? "Hide diff" : "Diff"}
              </Text>
            </Pressable>
          ) : null}
        </View>
        {showDiff && canDiff ? (
          <View style={{marginBottom: 12}} testID="syncdb-debug-diff-panel">
            {changedFields.length === 0 ? (
              <Text style={{color: PALETTE.textDim, fontFamily: monospace, fontSize: 12}}>
                {NO_CONFLICT_DIFF_FIELDS}
              </Text>
            ) : (
              changedFields.map((field) => (
                <View key={field} style={{marginBottom: 8}}>
                  <Text style={{color: PALETTE.text, fontFamily: monospace, fontSize: 12}}>
                    {formatConflictFieldLabel(field)}:{" "}
                    {formatConflictFieldValue(localPayload[field])} →{" "}
                    {formatConflictFieldValue(serverPayload[field])}
                  </Text>
                </View>
              ))
            )}
          </View>
        ) : null}
        <Text style={{color: PALETTE.text, fontFamily: monospace, fontSize: 12, lineHeight: 18}}>
          {JSON.stringify(event, null, 2)}
        </Text>
      </View>
    </ScrollView>
  );
};

const SyncDebugContent: React.FC = () => {
  const router = useRouter();
  const openSyncLab = useOpenSyncLab();
  const {events, stats, clear, enabled, log} = useSyncDebugLog();
  const status = useSyncStatus();
  const [paused, setPaused] = useState<boolean>(false);
  const [frozen, setFrozen] = useState<SyncDebugEvent[]>([]);
  const [activeTypes, setActiveTypes] = useState<Set<SyncDebugEventType>>(new Set());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const {width: windowWidth} = useWindowDimensions();
  const isDesktopLayout = isSupportedDesktopWidth({width: windowWidth});

  const togglePause = useCallback((): void => {
    setPaused((prev) => {
      const next = !prev;
      // Freeze the current buffer when pausing so a burst can be inspected.
      setFrozen(next ? (log?.getEvents() ?? []) : []);
      return next;
    });
  }, [log]);

  const toggleType = useCallback((type: SyncDebugEventType): void => {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  const handleClear = useCallback((): void => {
    clear();
    setSelectedId(null);
    setFrozen([]);
  }, [clear]);

  const handleCopy = useCallback((): void => {
    const snapshot = log?.snapshot();
    if (!snapshot) {
      return;
    }
    const json = JSON.stringify(snapshot, null, 2);
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(json);
      return;
    }
    console.info("[syncdb-debug] snapshot", json);
  }, [log]);

  const source = paused ? frozen : events;

  // Newest first, filtered by the active type set (empty set = all). Recomputed
  // only when the source, filter, or pause state changes.
  const displayed = useMemo((): SyncDebugEvent[] => {
    const filtered =
      activeTypes.size === 0 ? source : source.filter((event) => activeTypes.has(event.type));
    return filtered.slice().reverse();
  }, [source, activeTypes]);

  const selected = useMemo((): SyncDebugEvent | null => {
    if (selectedId === null) {
      return null;
    }
    return source.find((event) => event.id === selectedId) ?? null;
  }, [source, selectedId]);

  const handleSelect = useCallback((event: SyncDebugEvent): void => {
    setSelectedId(event.id);
  }, []);

  const keyExtractor = useCallback((event: SyncDebugEvent): string => String(event.id), []);

  const renderItem = useCallback<ListRenderItem<SyncDebugEvent>>(
    ({item}) => <EventRow event={item} onSelect={handleSelect} selected={item.id === selectedId} />,
    [handleSelect, selectedId]
  );

  const getItemLayout = useCallback(
    (_data: ArrayLike<SyncDebugEvent> | null | undefined, index: number) => ({
      index,
      length: ROW_HEIGHT,
      offset: ROW_HEIGHT * index,
    }),
    []
  );

  if (!enabled) {
    return (
      <View
        style={{
          alignItems: "center",
          backgroundColor: PALETTE.bg,
          flex: 1,
          justifyContent: "center",
          padding: 24,
        }}
      >
        <Text style={{color: PALETTE.text, fontFamily: monospace, fontSize: 14, marginBottom: 8}}>
          SyncDB debug log is disabled
        </Text>
        <Text
          style={{color: PALETTE.textDim, fontFamily: monospace, fontSize: 12, textAlign: "center"}}
        >
          Enable it with createSyncDb(&#123; debug: true &#125;) (on by default in dev).
        </Text>
      </View>
    );
  }

  return (
    <View style={{backgroundColor: PALETTE.bg, flex: 1}} testID="syncdb-debug-screen">
      {/* Toolbar */}
      <View
        style={{
          alignItems: "center",
          borderBottomColor: PALETTE.border,
          borderBottomWidth: 1,
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 8,
          paddingHorizontal: 12,
          paddingVertical: 10,
        }}
      >
        <Text
          style={{
            color: PALETTE.text,
            fontFamily: monospace,
            fontSize: 14,
            fontWeight: "700",
            marginRight: 4,
          }}
        >
          SyncDB Debugger
        </Text>
        <StatusPill
          color={status.isOnline ? "#3fb950" : "#f85149"}
          label={status.isOnline ? "online" : "offline"}
        />
        <StatusPill
          color={status.isSyncing ? "#d29922" : PALETTE.textDim}
          label={status.isSyncing ? "syncing" : "idle"}
        />
        <StatusPill
          color={status.queuedCount > 0 ? "#d29922" : PALETTE.textDim}
          label={`queued ${status.queuedCount}`}
        />
        <StatusPill
          color={status.conflictCount > 0 ? "#f85149" : PALETTE.textDim}
          label={`conflicts ${status.conflictCount}`}
        />
        <StatusPill
          color={PALETTE.textDim}
          label={`events ${stats?.retained ?? 0}/${stats?.total ?? 0}`}
        />
        <View style={{flex: 1}} />
        <ToolbarButton label="Sync Lab" onPress={openSyncLab} />
        <ToolbarButton active={paused} label={paused ? "Resume" : "Pause"} onPress={togglePause} />
        <ToolbarButton label="Copy JSON" onPress={handleCopy} />
        <ToolbarButton danger label="Clear" onPress={handleClear} />
        <ToolbarButton label="Close" onPress={() => router.back()} />
      </View>

      {/* Type filters */}
      <View
        style={{
          alignItems: "center",
          borderBottomColor: PALETTE.border,
          borderBottomWidth: 1,
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 6,
          paddingHorizontal: 12,
          paddingVertical: 8,
        }}
      >
        {ALL_TYPES.map((type) => {
          const active = activeTypes.has(type);
          return (
            <Pressable
              key={type}
              onPress={() => toggleType(type)}
              style={{
                backgroundColor: active ? `${TYPE_COLOR[type]}33` : PALETTE.panel,
                borderColor: active ? TYPE_COLOR[type] : PALETTE.border,
                borderRadius: 3,
                borderWidth: 1,
                paddingHorizontal: 7,
                paddingVertical: 3,
              }}
              testID={`syncdb-debug-filter-${type}`}
            >
              <Text
                style={{
                  color: active ? TYPE_COLOR[type] : PALETTE.textDim,
                  fontFamily: monospace,
                  fontSize: 11,
                }}
              >
                {type} {stats?.byType[type] ?? 0}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Split: event stream + detail */}
      <View style={{flex: 1, flexDirection: isDesktopLayout ? "row" : "column"}}>
        <View style={{borderRightColor: PALETTE.border, borderRightWidth: 1, flex: 3}}>
          {displayed.length === 0 ? (
            <View style={{alignItems: "center", flex: 1, justifyContent: "center"}}>
              <Text style={{color: PALETTE.textFaint, fontFamily: monospace, fontSize: 12}}>
                {paused ? "Paused — no captured events" : "Waiting for sync events…"}
              </Text>
            </View>
          ) : (
            <FlatList
              data={displayed}
              getItemLayout={getItemLayout}
              initialNumToRender={30}
              keyExtractor={keyExtractor}
              maxToRenderPerBatch={30}
              removeClippedSubviews
              renderItem={renderItem}
              testID="syncdb-debug-list"
              windowSize={11}
            />
          )}
        </View>
        <View style={{backgroundColor: PALETTE.panel, flex: 2}}>
          <EventDetail event={selected} />
        </View>
      </View>
    </View>
  );
};

const SyncDebugScreen: React.FC = () => {
  return (
    <SyncDbProvider client={syncDb}>
      <SyncDebugContent />
    </SyncDbProvider>
  );
};

export default SyncDebugScreen;
