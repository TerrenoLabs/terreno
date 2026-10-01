import {type Block, parseBlocks, validateBlocks, wrapAsTextDocument} from "@terreno/blocks";
import type React from "react";

import {Box} from "../Box";
import type {BlocksViewProps} from "../Common";
import {BlocksError} from "./BlocksError";
import {type BlockRenderContext, renderBlock} from "./blockRenderers";
import {useBlockSelections} from "./useBlockSelections";
import {useResolvedDatasets} from "./useResolvedDatasets";

export type {BlocksViewProps} from "../Common";

const rawOf = (document: BlocksViewProps["document"]): string => {
  if (typeof document === "string") {
    return document;
  }
  return JSON.stringify(document);
};

const renderBlocks = (
  blocks: readonly Block[],
  context: BlockRenderContext,
  testID: string | undefined
): React.ReactElement => (
  <Box gap={3} testID={testID}>
    {blocks.map((block, index) => renderBlock(block, `blocks-${index}`, context))}
  </Box>
);

/**
 * Renders a whole-reply block document.
 * A reply that is not a document becomes one text block. An invalid document shows
 * the first errors and keeps the raw text collapsed.
 */
export const BlocksView: React.FC<BlocksViewProps> = ({
  document,
  hostActions,
  onAction,
  overrides,
  pendingElementIds,
  resolveDataset,
  testID,
}) => {
  const parsed =
    typeof document === "string" ? parseBlocks(document) : {ok: true as const, value: document};
  const validated = parsed.ok ? validateBlocks(parsed.value) : undefined;
  const {loadingIds, resolved} = useResolvedDatasets({
    datasets: validated?.ok ? validated.doc.datasets : undefined,
    resolveDataset,
  });
  const {selections, setSelection} = useBlockSelections();
  const context: BlockRenderContext = {
    hostActions,
    loadingIds,
    onAction,
    overrides,
    pendingElementIds: pendingElementIds === undefined ? undefined : new Set(pendingElementIds),
    resolved,
    selections,
    setSelection,
  };

  if (typeof document === "string" && !parsed.ok) {
    const isNonDocument = parsed.errors.every((error) => error.code === "NOT_A_DOCUMENT");
    if (isNonDocument) {
      return renderBlocks(wrapAsTextDocument(document).blocks, context, testID);
    }
    return <BlocksError errors={parsed.errors} raw={document} testID={testID} />;
  }
  if (validated === undefined || !validated.ok) {
    const errors = validated === undefined ? [] : validated.errors;
    return <BlocksError errors={errors} raw={rawOf(document)} testID={testID} />;
  }
  return renderBlocks(validated.doc.blocks, context, testID);
};
