import {type BlocksDocument, parseBlocks} from "@terreno/blocks";

const ACTION_ID = /^[a-z][a-z0-9_]{0,63}$/;

interface LooseElement {
  id?: string;
}

interface LooseBlock {
  children?: LooseBlock[];
  elements?: LooseElement[];
  id?: string;
  type?: string;
}

interface LooseDocument {
  blocks: LooseBlock[];
  datasets?: BlocksDocument["datasets"];
  v: 1;
}

const isLooseDocument = (value: unknown): value is LooseDocument => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const doc = value as {blocks?: unknown; v?: unknown};
  return doc.v === 1 && Array.isArray(doc.blocks);
};

const collectIds = (blocks: readonly LooseBlock[], ids: Set<string>): void => {
  for (const block of blocks) {
    if (typeof block.id === "string" && ACTION_ID.test(block.id)) {
      ids.add(block.id);
    }
    if (block.type === "actions") {
      for (const element of block.elements ?? []) {
        if (typeof element.id === "string" && ACTION_ID.test(element.id)) {
          ids.add(element.id);
        }
      }
    }
    if (block.type === "columns" || block.type === "card") {
      collectIds(block.children ?? [], ids);
    }
  }
};

const nextActionId = (ids: Set<string>): string => {
  if (!ids.has("actions")) {
    return "actions";
  }
  let index = 2;
  while (ids.has(`actions_${index}`)) {
    index += 1;
  }
  return `actions_${index}`;
};

const assignIds = (blocks: LooseBlock[], ids: Set<string>): boolean => {
  let changed = false;
  for (const block of blocks) {
    if (block.type === "actions" && typeof block.id !== "string") {
      const id = nextActionId(ids);
      block.id = id;
      ids.add(id);
      changed = true;
    }
    if (block.type === "columns" || block.type === "card") {
      if (assignIds(block.children ?? [], ids)) {
        changed = true;
      }
    }
  }
  return changed;
};

/**
 * Gives each actions block that omitted `id` a unique one.
 * Models often leave it off; the schema requires it, and the chat then shows the raw YAML.
 * Returns the document as JSON, or undefined when nothing was missing.
 */
export const fillMissingActionIds = (text: string): string | undefined => {
  const parsed = parseBlocks(text);
  if (!parsed.ok || !isLooseDocument(parsed.value)) {
    return undefined;
  }
  const ids = new Set<string>();
  collectIds(parsed.value.blocks, ids);
  if (!assignIds(parsed.value.blocks, ids)) {
    return undefined;
  }
  const ordered: BlocksDocument = {
    v: 1,
    ...(parsed.value.datasets !== undefined ? {datasets: parsed.value.datasets} : {}),
    blocks: parsed.value.blocks as BlocksDocument["blocks"],
  };
  return JSON.stringify(ordered);
};
