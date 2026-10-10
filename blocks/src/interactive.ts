import type {ChecklistBlock, StepperBlock, StepperItem} from "./schema";

/** Tolerance for float noise when checking the step grid and rounding up. */
const EPSILON = 1e-9;

/** A checklist tick as the renderer sends it: the ticked item and every item's state. */
export interface ChecklistTick {
  checked: boolean;
  itemId: string;
  state: Record<string, boolean>;
}

const roundAmount = (amount: number, item: StepperItem): number => {
  const factor = 10 ** (item.decimals ?? 0);
  const scaled = amount * factor;
  const rounded = item.round === "up" ? Math.ceil(scaled - EPSILON) : Math.round(scaled);
  return Number((rounded / factor).toFixed(item.decimals ?? 0));
};

/**
 * True when `value` is finite, within `min`..`max`, and a whole number of `step`s from the
 * stepper's own `value`.
 */
export const isStepperValueAllowed = (stepper: StepperBlock, value: number): boolean => {
  if (!Number.isFinite(value) || value < stepper.min || value > stepper.max) {
    return false;
  }
  const steps = (value - stepper.value) / (stepper.step ?? 1);
  return Math.abs(steps - Math.round(steps)) < EPSILON;
};

/**
 * Returns `original` at `value` with every item scaled linearly from `original`, rounded by its
 * `decimals` and `round`. Always scale from the block the agent wrote, not the last result, so
 * rounding never drifts tap after tap. An original `value` of 0 keeps the amounts as written.
 * Check the value with `isStepperValueAllowed` first.
 */
export const scaleStepperBlock = (original: StepperBlock, value: number): StepperBlock => {
  if (original.items === undefined) {
    return {...original, value};
  }
  const ratio = original.value === 0 ? 1 : value / original.value;
  return {
    ...original,
    items: original.items.map((item) => ({
      ...item,
      amount: roundAmount(item.amount * ratio, item),
    })),
    value,
  };
};

/** The ids in a tick (its `itemId` and `state` keys) that `checklist` has no item for, once each. */
export const unknownChecklistItemIds = (
  checklist: ChecklistBlock,
  tick: ChecklistTick
): string[] => {
  const itemIds = new Set(checklist.items.map((item) => item.id));
  return [...new Set([tick.itemId, ...Object.keys(tick.state)])].filter((id) => !itemIds.has(id));
};

/**
 * Returns `checklist` with every item's `checked` taken from `tick.state`. An item missing from
 * `state` is unchecked, and the ticked item always takes `tick.checked`.
 */
export const applyChecklistState = (
  checklist: ChecklistBlock,
  tick: ChecklistTick
): ChecklistBlock => ({
  ...checklist,
  items: checklist.items.map((item) => ({
    ...item,
    checked: item.id === tick.itemId ? tick.checked : tick.state[item.id] === true,
  })),
});
