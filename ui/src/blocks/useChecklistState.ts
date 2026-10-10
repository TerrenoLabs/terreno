import type {Block} from "@terreno/blocks";
import {useCallback, useMemo, useState} from "react";

interface ChecklistTicks {
  /** The override the ticks were made on. A different override for the id drops them. */
  source: Block | undefined;
  ticks: Record<string, boolean>;
}

/**
 * Local checklist ticks for one rendered document, keyed by checklist id and then item id.
 * `checked` holds only ticks made on the block currently shown: when a host override for a
 * checklist arrives or changes, its earlier local ticks are dropped and the override's
 * `checked` values show. `checked[id]` is the shape `blockPlainText` takes as `checked`.
 */
export const useChecklistState = ({
  overrides,
}: {
  overrides?: Record<string, Block>;
}): {
  checked: Record<string, Record<string, boolean>>;
  setChecked: (target: {checked: boolean; checklistId: string; itemId: string}) => void;
} => {
  const [state, setState] = useState<Record<string, ChecklistTicks>>({});
  const setChecked = useCallback(
    ({checked, checklistId, itemId}: {checked: boolean; checklistId: string; itemId: string}) => {
      const source = overrides?.[checklistId];
      setState((current) => {
        const prior = current[checklistId];
        const ticks = prior !== undefined && prior.source === source ? prior.ticks : {};
        return {...current, [checklistId]: {source, ticks: {...ticks, [itemId]: checked}}};
      });
    },
    [overrides]
  );
  const checked = useMemo((): Record<string, Record<string, boolean>> => {
    const result: Record<string, Record<string, boolean>> = {};
    for (const [checklistId, entry] of Object.entries(state)) {
      if (entry.source === overrides?.[checklistId]) {
        result[checklistId] = entry.ticks;
      }
    }
    return result;
  }, [overrides, state]);
  return {checked, setChecked};
};
