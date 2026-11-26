import {Box, Modal, SelectField, Text, useToast} from "@terreno/ui";
import React, {memo, useCallback, useMemo, useState} from "react";
import type {AdminModelConfig} from "./types";

type AdminAction = NonNullable<AdminModelConfig["actions"]>[number];

interface AdminActionMenuProps {
  actions: AdminAction[] | undefined;
  disabled?: boolean;
  onRunAction: (actionId: string) => void | Promise<void>;
  selectedCount: number;
}

const AdminActionMenuComponent: React.FC<AdminActionMenuProps> = ({
  actions,
  disabled = false,
  onRunAction,
  selectedCount,
}) => {
  const toast = useToast();
  const [confirmActionId, setConfirmActionId] = useState<string | null>(null);
  const [selectValue, setSelectValue] = useState("__none__");

  const visibleActions = useMemo(
    () => (actions ?? []).filter((action) => action.allowed !== false),
    [actions]
  );

  const pendingAction = visibleActions.find((action) => action.id === confirmActionId);

  const handleSelect = useCallback(
    (next: string) => {
      setSelectValue("__none__");
      if (next === "__none__" || !next) {
        return;
      }
      const action = visibleActions.find((a) => a.id === next);
      if (!action) {
        return;
      }
      if (action.confirm) {
        setConfirmActionId(action.id);
        return;
      }
      void Promise.resolve(onRunAction(action.id)).catch((err) => {
        toast.catch(err, "Bulk action failed");
      });
    },
    [onRunAction, toast, visibleActions]
  );

  const handleConfirm = useCallback(async (): Promise<void> => {
    if (!confirmActionId) {
      return;
    }
    try {
      await onRunAction(confirmActionId);
      setConfirmActionId(null);
    } catch (err) {
      toast.catch(err, "Bulk action failed");
    }
  }, [confirmActionId, onRunAction, toast]);

  if (visibleActions.length === 0) {
    return null;
  }

  const isDisabled = disabled || selectedCount === 0;

  return (
    <Box minWidth={260}>
      <SelectField
        disabled={isDisabled}
        onChange={handleSelect}
        options={[
          {label: "Bulk actions\u2026", value: "__none__"},
          ...visibleActions.map((action) => ({label: action.label, value: action.id})),
        ]}
        testID="admin-action-menu"
        title="Actions"
        value={selectValue}
      />

      <Modal
        onDismiss={() => {
          setConfirmActionId(null);
        }}
        primaryButtonOnClick={handleConfirm}
        primaryButtonText="Continue"
        secondaryButtonOnClick={() => {
          setConfirmActionId(null);
        }}
        secondaryButtonText="Cancel"
        testID={pendingAction ? `admin-action-confirm-${pendingAction.id}` : undefined}
        title="Confirm bulk action"
        visible={Boolean(pendingAction?.confirm)}
      >
        <Text>{pendingAction?.confirm}</Text>
      </Modal>
    </Box>
  );
};

AdminActionMenuComponent.displayName = "AdminActionMenu";

/**
 * Bulk action dropdown for admin model tables. Supports confirmation modals and
 * hides actions marked with `allowed: false`.
 *
 * Memoized so typing in the table search does not re-render the dropdown and its modal.
 */
export const AdminActionMenu = memo(AdminActionMenuComponent);
