import {APIError} from "@terreno/api";
import {type Block, type BlocksDocument, parseBlocks, validateBlocks} from "@terreno/blocks";

import type {GptHistoryDocument, GptHistoryPrompt} from "../types";

const MESSAGE_INDEX_PATTERN = /^msg-(\d+)$/;

/**
 * A `{v: 1, blocks}` document. Built by assignment so `v` stays the first key, which
 * `validateBlocks` requires (`KEY_ORDER`).
 */
export const blocksDocument = (blocks: Block[]): BlocksDocument => {
  const doc = {v: 1} as BlocksDocument;
  doc.blocks = blocks;
  return doc;
};

const isMapping = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Depth-first search of a parsed document's blocks, including card and columns children. */
const findRawBlock = (
  blocks: unknown,
  type: string,
  blockId: string
): Record<string, unknown> | undefined => {
  if (!Array.isArray(blocks)) {
    return undefined;
  }
  for (const block of blocks) {
    if (!isMapping(block)) {
      continue;
    }
    if (block.type === type && block.id === blockId) {
      return block;
    }
    const nested = findRawBlock(block.children, type, blockId);
    if (nested !== undefined) {
      return nested;
    }
  }
  return undefined;
};

/**
 * The block from one stored assistant prompt. The block is checked on its own, so a sibling
 * that needs host options (html, https images) does not hide it.
 */
const blockInPrompt = <T extends Block["type"]>(
  prompt: GptHistoryPrompt | undefined,
  type: T,
  blockId: string
): Extract<Block, {type: T}> | undefined => {
  if (prompt?.type !== "assistant" || typeof prompt.text !== "string") {
    return undefined;
  }
  const parsed = parseBlocks(prompt.text);
  if (!parsed.ok || !isMapping(parsed.value)) {
    return undefined;
  }
  const raw = findRawBlock(parsed.value.blocks, type, blockId);
  if (raw === undefined) {
    return undefined;
  }
  const validated = validateBlocks(blocksDocument([raw as unknown as Block]));
  if (!validated.ok) {
    return undefined;
  }
  return validated.doc.blocks[0] as Extract<Block, {type: T}>;
};

/**
 * Loads the block the agent wrote, from the stored history rather than from the client.
 * `msg-<n>` reads `history.prompts[n]` (stored prompts have no ids). Otherwise the only assistant
 * prompt holding a block of that type and id is used: 409 when several do, 404 when none does.
 */
export const findAgentBlock = <T extends Block["type"]>({
  blockId,
  history,
  messageId,
  type,
}: {
  blockId: string;
  history: GptHistoryDocument;
  messageId: string;
  type: T;
}): Extract<Block, {type: T}> => {
  const indexMatch = MESSAGE_INDEX_PATTERN.exec(messageId);
  if (indexMatch?.[1] !== undefined) {
    const direct = blockInPrompt(history.prompts[Number(indexMatch[1])], type, blockId);
    if (direct !== undefined) {
      return direct;
    }
  }
  const matches = history.prompts
    .map((prompt) => blockInPrompt(prompt, type, blockId))
    .filter((block): block is Extract<Block, {type: T}> => block !== undefined);
  if (matches.length > 1) {
    throw new APIError({
      detail: `${matches.length} replies hold a ${type} with id ${blockId}.`,
      status: 409,
      title: "Block is ambiguous",
    });
  }
  const [only] = matches;
  if (only === undefined) {
    throw new APIError({
      detail: `No reply holds a ${type} with id ${blockId}.`,
      status: 404,
      title: "Block not found",
    });
  }
  return only;
};
