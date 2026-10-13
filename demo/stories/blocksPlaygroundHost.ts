import {
  applyChecklistState,
  type Block,
  type BlockAction,
  type BlocksDocument,
  type ChecklistTick,
  isStepperValueAllowed,
  scaleStepperBlock,
} from "@terreno/blocks";

/** The event `BlocksView` passes to `onAction`. */
export interface PlaygroundActionEvent {
  action: BlockAction;
  blockId: string;
  elementId: string;
}

/** What the playground does with one action: an optional replacement block and a toast line. */
export interface PlaygroundActionResult {
  message: string;
  override?: {block: Block; blockId: string};
}

const findBlock = (blocks: readonly Block[], blockId: string): Block | undefined => {
  for (const block of blocks) {
    if ("id" in block && block.id === blockId) {
      return block;
    }
    if (block.type === "columns" || block.type === "card") {
      const child = findBlock(block.children, blockId);
      if (child !== undefined) {
        return child;
      }
    }
  }
  return undefined;
};

const describeAction = (action: BlockAction): string => {
  switch (action.kind) {
    case "reply":
      return `Reply: "${action.text}"`;
    case "open":
      return `Open: ${action.url ?? action.route ?? ""}`;
    case "select":
      return `Select: ${action.data} on ${action.target}`;
    case "callback":
      return `Callback "${action.name}" sent ${JSON.stringify(action.payload ?? {})}`;
    case "copy":
      return "Copied";
  }
};

/**
 * Runs one `BlocksView` action without a server. A stepper or checklist callback is computed
 * with the same `@terreno/blocks` helpers the `@terreno/ai` host actions use, always from the
 * block the document wrote, and returns the replacement block. Anything else (a reply, an
 * open, a select, another callback) only describes the event for a toast.
 */
export const runPlaygroundAction = ({
  document,
  event,
}: {
  document: BlocksDocument | undefined;
  event: PlaygroundActionEvent;
}): PlaygroundActionResult => {
  const {action, blockId} = event;
  if (action.kind !== "callback" || document === undefined) {
    return {message: describeAction(action)};
  }
  const original = findBlock(document.blocks, blockId);
  if (original?.type === "stepper") {
    const value = Number(action.payload?.value);
    if (!isStepperValueAllowed(original, value)) {
      return {message: `${action.name} rejected ${String(action.payload?.value)}`};
    }
    const block = scaleStepperBlock(original, value);
    const unit = block.unit ? ` ${block.unit}` : "";
    return {message: `${action.name} → ${value}${unit}`, override: {block, blockId}};
  }
  if (original?.type === "checklist") {
    const block = applyChecklistState(original, action.payload as unknown as ChecklistTick);
    const done = block.items.filter((item) => item.checked === true).length;
    return {
      message: `${action.name} → ${done} of ${block.items.length}`,
      override: {block, blockId},
    };
  }
  return {message: describeAction(action)};
};
