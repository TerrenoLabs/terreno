import {type Block, parseBlocks, validateBlocks, wrapAsTextDocument} from "@terreno/blocks";
import type React from "react";

import {Box} from "../Box";
import type {BlocksViewProps} from "../Common";
import {Spinner} from "../Spinner";
import {BlocksError} from "./BlocksError";
import {type BlockRenderContext, renderBlock} from "./blockRenderers";
import {useBlockSelections} from "./useBlockSelections";
import {useChecklistState} from "./useChecklistState";
import {useResolvedDatasets} from "./useResolvedDatasets";
import {useResolvedImages} from "./useResolvedImages";

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

/** A draft that is still streaming should not flash a validation banner the server may still correct. */
const StreamingBlocks = ({testID}: {testID?: string}): React.ReactElement => (
  <Box testID={testID}>
    <Spinner size="sm" />
  </Box>
);

/**
 * Renders a whole-reply block document.
 * A reply that is not a document becomes one text block. An invalid document shows
 * the first errors and keeps the raw text collapsed.
 */
export const BlocksView: React.FC<BlocksViewProps> = ({
  allowHtml = false,
  document,
  hostActions,
  imageHosts,
  onAction,
  overrides,
  pendingElementIds,
  resolveDataset,
  resolveImage,
  streaming = false,
  testID,
}) => {
  const parsed =
    typeof document === "string" ? parseBlocks(document) : {ok: true as const, value: document};
  const validated = parsed.ok
    ? validateBlocks(parsed.value, {
        allowHtml: true,
        ...(imageHosts ? {imageHosts} : {}),
      })
    : undefined;
  const {loadingIds, resolved} = useResolvedDatasets({
    datasets: validated?.ok ? validated.doc.datasets : undefined,
    resolveDataset,
  });
  const {selections, setSelection} = useBlockSelections();
  const {checked: checklistTicks, setChecked: setChecklistTick} = useChecklistState({overrides});
  const resolvedImages = useResolvedImages({
    blocks: validated?.ok ? validated.doc.blocks : undefined,
    resolveImage,
  });
  const boundData: Record<string, string> = {};
  if (validated?.ok) {
    const visit = (blocks: readonly Block[]): void => {
      for (const block of blocks) {
        if (
          (block.type === "chart" || block.type === "table") &&
          block.id !== undefined &&
          block.data !== undefined
        ) {
          boundData[block.id] = block.data;
        }
        if (block.type === "columns" || block.type === "card") {
          visit(block.children);
        }
      }
    };
    visit(validated.doc.blocks);
  }
  const context: BlockRenderContext = {
    allowHtml,
    boundData,
    checklistTicks,
    hostActions,
    loadingIds,
    onAction,
    overrides,
    pendingElementIds: pendingElementIds === undefined ? undefined : new Set(pendingElementIds),
    resolved,
    resolvedImages,
    selections,
    setChecklistTick,
    setSelection,
    streaming,
  };

  if (typeof document === "string" && !parsed.ok) {
    const isNonDocument = parsed.errors.every((error) => error.code === "NOT_A_DOCUMENT");
    if (isNonDocument) {
      return renderBlocks(wrapAsTextDocument(document).blocks, context, testID);
    }
    if (streaming) {
      return <StreamingBlocks testID={testID} />;
    }
    return <BlocksError errors={parsed.errors} raw={document} testID={testID} />;
  }
  if (validated === undefined || !validated.ok) {
    if (streaming) {
      return <StreamingBlocks testID={testID} />;
    }
    const errors = validated === undefined ? [] : validated.errors;
    return <BlocksError errors={errors} raw={rawOf(document)} testID={testID} />;
  }
  return renderBlocks(validated.doc.blocks, context, testID);
};
