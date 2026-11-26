import {DateTime} from "luxon";
import type React from "react";
import {memo, useCallback, useEffect, useRef, useState} from "react";
import {ScrollView, useWindowDimensions} from "react-native";

import {Badge} from "./Badge";
import {Box} from "./Box";
import {Button} from "./Button";
import {
  formatConflictFieldLabel,
  formatConflictFieldValue,
  getChangedConflictFields,
  NO_CONFLICT_DIFF_FIELDS,
  parseConflictPayload,
  summarizeConflictSide,
} from "./conflictFieldDiff";
import {Modal} from "./Modal";
import {Text} from "./Text";
import {useStableCallback} from "./useStableCallback";

/** Resolution strategy for a sync conflict. */
export type SyncConflictResolutionStrategy = "useServer" | "keepMine";

/**
 * Minimal shape of a sync conflict rendered by {@link ConflictSheet}. Mirrors the fields exposed by
 * @terreno/syncdb's `SyncConflict` (local/server payloads are JSON strings) without importing the
 * data layer, so the sheet stays a pure presentational component.
 */
export interface SyncConflictItem {
  mutationId: string;
  collection: string;
  entityId: string;
  /** Local (optimistic) payload as a JSON string. */
  localData: string;
  /** Server payload as a JSON string. */
  serverData: string;
}

export interface ConflictSheetProps {
  visible: boolean;
  onDismiss: () => void;
  /** Unresolved conflicts to display. */
  conflicts: SyncConflictItem[];
  /** Called when the user picks a resolution for a conflict. */
  onResolve: (args: {mutationId: string; strategy: SyncConflictResolutionStrategy}) => void;
  /**
   * Modal title. Default avoids sync jargon so non-technical users understand
   * they need to pick between two versions of the same item.
   */
  title?: string;
  /**
   * Plain-language explanation shown above the conflict list. Pass an empty
   * string to hide it.
   */
  description?: string;
  testID?: string;
}

const DEFAULT_TITLE = "These changes don't match";

const DEFAULT_DESCRIPTION =
  "The same item was changed in two places at once — for example on this device and on another phone, computer, or by someone else. Choose which version to keep. The other one will be discarded.";

const LOCAL_COLUMN_TITLE = "Your change";
const REMOTE_COLUMN_TITLE = "Other version";

const KEEP_MINE_BUTTON = "Keep my change";
const USE_OTHER_BUTTON = "Use the other version";
const KEEP_MINE_ALL_BUTTON = "Keep all of my changes";
const USE_OTHER_ALL_BUTTON = "Use all other versions";

const KEEP_MINE_ALL_CONFIRM_TITLE = "Keep all of your changes?";
const KEEP_MINE_ALL_CONFIRM_TEXT =
  "Your edits on this device will be kept and sent again. The other versions will be discarded.";
const USE_OTHER_ALL_CONFIRM_TITLE = "Use the other versions for everything?";
const USE_OTHER_ALL_CONFIRM_TEXT =
  "Your edits on this device will be discarded. What's saved elsewhere will be kept instead.";

const EMPTY_STATE = "Nothing left to choose — you're all set.";

const TIME_UNAVAILABLE = "Time unavailable";

/**
 * Best-effort "when was this last touched" for a conflict side. Payload shapes
 * vary by collection, so try the usual timestamp fields in order of specificity.
 */
const parseConflictTime = (data: Record<string, unknown>): DateTime | null => {
  const value = data.updated ?? data.updatedAt ?? data.created ?? data.createdAt;
  if (typeof value !== "string") {
    return null;
  }
  const dateTime = DateTime.fromISO(value);
  return dateTime.isValid ? dateTime : null;
};

const formatConflictTime = (dateTime: DateTime | null): string =>
  dateTime ? dateTime.toLocaleString(DateTime.DATETIME_MED_WITH_SECONDS) : TIME_UNAVAILABLE;

/** Badge label for each side, or null where there is nothing meaningful to say. */
type RecencyLabel = "Newer" | "Same time" | null;

/**
 * Which side is more recent, so the user can tell at a glance which version they
 * would be discarding. Both sides need a usable timestamp for a comparison to
 * mean anything; without that we stay silent rather than guess.
 */
const compareRecency = ({
  local,
  server,
}: {
  local: DateTime | null;
  server: DateTime | null;
}): {local: RecencyLabel; server: RecencyLabel} => {
  if (!local || !server) {
    return {local: null, server: null};
  }
  const localMillis = local.toMillis();
  const serverMillis = server.toMillis();
  if (localMillis === serverMillis) {
    return {local: "Same time", server: "Same time"};
  }
  if (localMillis > serverMillis) {
    return {local: "Newer", server: null};
  }
  return {local: null, server: "Newer"};
};

const RecencyBadge: React.FC<{label: RecencyLabel; testID: string}> = ({label, testID}) => {
  if (!label) {
    return null;
  }
  return (
    <Badge
      secondary
      status={label === "Newer" ? "info" : "neutral"}
      testID={testID}
      value={label}
    />
  );
};

interface VersionColumnProps {
  action: React.ReactNode;
  changedFields: string[];
  data: Record<string, unknown>;
  entityId: string;
  recency: RecencyLabel;
  showDiff: boolean;
  side: "local" | "server";
  time: DateTime | null;
  title: string;
}

const VersionColumn: React.FC<VersionColumnProps> = ({
  action,
  changedFields,
  data,
  entityId,
  recency,
  showDiff,
  side,
  time,
  title,
}) => (
  <Box
    flex="grow"
    gap={3}
    justifyContent="between"
    minWidth={240}
    testID={`conflict-${side}-column-${entityId}`}
    width={240}
  >
    <Box gap={2}>
      <Box alignItems="center" direction="row" gap={1}>
        <Text bold color="secondaryDark" size="sm">
          {title}
        </Text>
        <RecencyBadge label={recency} testID={`conflict-${side}-recency-${entityId}`} />
      </Box>
      <Text color="secondaryLight" size="sm" testID={`conflict-${side}-time-${entityId}`}>
        {formatConflictTime(time)}
      </Text>
      {showDiff ? (
        changedFields.length === 0 ? (
          <Text color="secondaryLight" size="sm">
            {NO_CONFLICT_DIFF_FIELDS}
          </Text>
        ) : (
          changedFields.map((field) => (
            <Box gap={1} key={field} testID={`conflict-${side}-field-${field}-${entityId}`}>
              <Text bold color="secondaryDark" size="sm">
                {formatConflictFieldLabel(field)}
              </Text>
              <Text size="sm">{formatConflictFieldValue(data[field])}</Text>
            </Box>
          ))
        )
      ) : (
        <Text size="sm">{summarizeConflictSide({changedFields, data})}</Text>
      )}
    </Box>
    {action}
  </Box>
);

interface ConflictItemProps {
  conflict: SyncConflictItem;
  onResolve: (args: {mutationId: string; strategy: SyncConflictResolutionStrategy}) => void;
}

const ConflictItemComponent: React.FC<ConflictItemProps> = ({conflict, onResolve}) => {
  const [showDiff, setShowDiff] = useState<boolean>(false);
  const local = parseConflictPayload(conflict.localData);
  const server = parseConflictPayload(conflict.serverData);
  const localTime = parseConflictTime(local);
  const serverTime = parseConflictTime(server);
  const recency = compareRecency({local: localTime, server: serverTime});
  const changedFields = getChangedConflictFields({local, server});

  const handleToggleDiff = useCallback((): void => {
    setShowDiff((prev) => !prev);
  }, []);

  const handleKeepMine = useCallback((): void => {
    onResolve({mutationId: conflict.mutationId, strategy: "keepMine"});
  }, [conflict.mutationId, onResolve]);

  const handleUseServer = useCallback((): void => {
    onResolve({mutationId: conflict.mutationId, strategy: "useServer"});
  }, [conflict.mutationId, onResolve]);

  return (
    <Box
      border="default"
      gap={3}
      padding={3}
      rounding="md"
      testID={`conflict-item-${conflict.entityId}`}
    >
      <Box direction="row" gap={2} justifyContent="between" wrap>
        <Box flex="grow">
          <Text bold size="sm">
            {conflict.collection} · {conflict.entityId}
          </Text>
        </Box>
        <Button
          onClick={handleToggleDiff}
          size="sm"
          testID={`conflict-diff-toggle-${conflict.entityId}`}
          text={showDiff ? "Hide diff" : "Diff"}
          variant="outline"
        />
      </Box>
      <Box direction="row" gap={3} wrap>
        <VersionColumn
          action={
            <Button
              fullWidth
              onClick={handleKeepMine}
              testID={`conflict-keep-mine-button-${conflict.mutationId}`}
              text={KEEP_MINE_BUTTON}
              variant="outline"
            />
          }
          changedFields={changedFields}
          data={local}
          entityId={conflict.entityId}
          recency={recency.local}
          showDiff={showDiff}
          side="local"
          time={localTime}
          title={LOCAL_COLUMN_TITLE}
        />
        <VersionColumn
          action={
            <Button
              fullWidth
              onClick={handleUseServer}
              testID={`conflict-use-server-button-${conflict.mutationId}`}
              text={USE_OTHER_BUTTON}
              variant="primary"
            />
          }
          changedFields={changedFields}
          data={server}
          entityId={conflict.entityId}
          recency={recency.server}
          showDiff={showDiff}
          side="server"
          time={serverTime}
          title={REMOTE_COLUMN_TITLE}
        />
      </Box>
    </Box>
  );
};

ConflictItemComponent.displayName = "ConflictItem";

// Memoized so resolving one conflict does not re-parse and re-render every other one.
const ConflictItem = memo(ConflictItemComponent);

/**
 * Presentational modal listing unresolved sync conflicts. Copy is written for
 * non-technical users: "Your change" (this device) vs "Other version" (elsewhere
 * or out of sync), with a short explanation of why they must pick one. Whichever
 * side is more recent is badged. Users can resolve conflicts individually — each
 * button lives inside the version column it keeps — or apply a choice to every
 * conflict after confirmation. Data-layer agnostic: pass `conflicts` and an `onResolve`
 * callback (e.g. from @terreno/syncdb's `useConflicts`).
 *
 * The sheet never closes itself on a button press. It calls `onDismiss` once `conflicts`
 * becomes empty while open, so the caller's resolutions get to settle (or fail, keeping
 * the sheet open) before the UI goes away.
 */
export const ConflictSheet: React.FC<ConflictSheetProps> = ({
  visible,
  onDismiss,
  conflicts,
  onResolve,
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
  testID = "conflict-sheet",
}) => {
  const {height: windowHeight} = useWindowDimensions();
  // Whether this open episode ever had conflicts, so a sheet opened deliberately
  // with none (to show the empty state) is not closed out from under the caller.
  const hadConflictsRef = useRef<boolean>(false);

  // Dismissal is driven purely by the conflict list emptying, never by a button
  // press: `onResolve` resolutions settle asynchronously in the data layer, and the
  // parent drops a row from `conflicts` only once its resolution actually landed.
  // Closing at press time would hide a resolution that then failed, leaving the
  // conflict unresolved with no visible way back to it.
  useEffect(() => {
    if (!visible) {
      hadConflictsRef.current = false;
      return;
    }
    if (conflicts.length > 0) {
      hadConflictsRef.current = true;
      return;
    }
    if (hadConflictsRef.current) {
      onDismiss();
    }
  }, [conflicts.length, onDismiss, visible]);

  // Stable identity so an inline `onResolve` from the caller does not re-render every conflict.
  const handleResolve = useStableCallback(onResolve);

  const handleUseServerForAll = useCallback((): void => {
    for (const conflict of conflicts) {
      onResolve({mutationId: conflict.mutationId, strategy: "useServer"});
    }
  }, [conflicts, onResolve]);

  const handleUseMineForAll = useCallback((): void => {
    for (const conflict of conflicts) {
      onResolve({mutationId: conflict.mutationId, strategy: "keepMine"});
    }
  }, [conflicts, onResolve]);

  return (
    <Modal onDismiss={onDismiss} size="md" title={title} visible={visible}>
      <ScrollView
        contentContainerStyle={{paddingBottom: 4}}
        style={{maxHeight: Math.max(windowHeight * 0.65, 240), width: "100%"}}
        testID="conflict-sheet-scroll"
      >
        <Box gap={3} testID={testID}>
          {conflicts.length === 0 ? (
            <Text color="secondaryLight">{EMPTY_STATE}</Text>
          ) : (
            <>
              {description ? (
                <Text color="secondaryDark" size="sm" testID="conflict-sheet-description">
                  {description}
                </Text>
              ) : null}
              <Box direction="row" gap={2} wrap>
                <Button
                  confirmationText={KEEP_MINE_ALL_CONFIRM_TEXT}
                  modalTitle={KEEP_MINE_ALL_CONFIRM_TITLE}
                  onClick={handleUseMineForAll}
                  testID="conflict-use-mine-all-button"
                  text={KEEP_MINE_ALL_BUTTON}
                  variant="outline"
                  withConfirmation
                />
                <Button
                  confirmationText={USE_OTHER_ALL_CONFIRM_TEXT}
                  modalTitle={USE_OTHER_ALL_CONFIRM_TITLE}
                  onClick={handleUseServerForAll}
                  testID="conflict-use-server-all-button"
                  text={USE_OTHER_ALL_BUTTON}
                  variant="destructive"
                  withConfirmation
                />
              </Box>
              {conflicts.map((conflict) => (
                <ConflictItem
                  conflict={conflict}
                  key={conflict.mutationId}
                  onResolve={handleResolve}
                />
              ))}
            </>
          )}
        </Box>
      </ScrollView>
    </Modal>
  );
};
