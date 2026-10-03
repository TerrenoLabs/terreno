import {parseBlocks, stripBlocksFence} from "./parse";
import {validateBlocks} from "./validate";

export interface ParseBlocksPartialResult {
  blocks: unknown[];
  datasets?: Record<string, unknown>;
  pending: boolean;
}

const emptyPending = (): ParseBlocksPartialResult => ({blocks: [], pending: true});

const isPlainMapping = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.getPrototypeOf(value) === Object.prototype;
};

const datasetsFrom = (value: unknown): Record<string, unknown> | undefined => {
  if (!isPlainMapping(value) || !isPlainMapping(value.datasets)) {
    return undefined;
  }
  return value.datasets;
};

const blocksFrom = (value: unknown): unknown[] | undefined => {
  if (!isPlainMapping(value) || !Array.isArray(value.blocks)) {
    return undefined;
  }
  return value.blocks;
};

/**
 * Top-level block items are the lines indented exactly two spaces that start a sequence entry.
 * Nested lists sit deeper, so they stay inside the current item.
 */
const topLevelItems = (body: string): string[] => {
  const items: string[] = [];
  let current: string[] | null = null;
  for (const line of body.split("\n")) {
    if (line.startsWith("  - ")) {
      if (current !== null) {
        items.push(current.join("\n"));
      }
      current = [line];
      continue;
    }
    if (current !== null) {
      current.push(line);
    }
  }
  if (current !== null) {
    items.push(current.join("\n"));
  }
  return items;
};

const blockFromItem = (item: string): unknown | undefined => {
  const parsed = parseBlocks(`v: 1\nblocks:\n${item}\n`);
  if (!parsed.ok) {
    return undefined;
  }
  const blocks = blocksFrom(parsed.value);
  return blocks?.[0];
};

/**
 * Reads a truncated reply while it is still streaming.
 * A finished, valid document returns every block with `pending: false`.
 * A cut reply returns only the top-level blocks that already ended (the next `- ` arrived)
 * and sets `pending: true`. It never throws.
 */
export const parseBlocksPartial = (text: string): ParseBlocksPartialResult => {
  try {
    const stripped = stripBlocksFence(text);
    if (stripped.trim() === "") {
      return emptyPending();
    }
    const parsed = parseBlocks(stripped);
    if (parsed.ok) {
      const blocks = blocksFrom(parsed.value);
      if (blocks !== undefined && validateBlocks(parsed.value).ok) {
        return {
          blocks,
          datasets: datasetsFrom(parsed.value),
          pending: false,
        };
      }
    }

    const lines = stripped.split("\n");
    const blocksLine = lines.findIndex((line) => line === "blocks:" || line.startsWith("blocks: "));
    if (blocksLine < 0) {
      return emptyPending();
    }

    const prefix = lines.slice(0, blocksLine).join("\n");
    let datasets: Record<string, unknown> | undefined;
    if (prefix.includes("datasets:")) {
      const closed = parseBlocks(`${prefix}\nblocks:\n  - type: divider\n`);
      if (closed.ok) {
        datasets = datasetsFrom(closed.value);
      }
    }

    const items = topLevelItems(lines.slice(blocksLine + 1).join("\n"));
    const completeItems = items.slice(0, -1);
    const blocks = completeItems.flatMap((item) => {
      const block = blockFromItem(item);
      return block === undefined ? [] : [block];
    });
    return {blocks, datasets, pending: true};
  } catch {
    return emptyPending();
  }
};
