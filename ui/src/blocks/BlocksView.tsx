import {parseBlocks, validateBlocks, wrapAsTextDocument} from "@terreno/blocks";
import type React from "react";

import {Box} from "../Box";
import type {BlocksViewProps} from "../Common";
import {BlocksError} from "./BlocksError";
import {renderBlock} from "./blockRenderers";

export type {BlocksViewProps} from "../Common";

const rawOf = (document: BlocksViewProps["document"]): string => {
  if (typeof document === "string") {
    return document;
  }
  return JSON.stringify(document);
};

/**
 * Renders a whole-reply block document.
 * A reply that is not a document becomes one text block. An invalid document shows
 * the first errors and keeps the raw text collapsed.
 */
export const BlocksView: React.FC<BlocksViewProps> = ({document, testID}) => {
  if (typeof document === "string") {
    const parsed = parseBlocks(document);
    if (!parsed.ok) {
      const isNonDocument = parsed.errors.every((error) => error.code === "NOT_A_DOCUMENT");
      if (isNonDocument) {
        const fallback = wrapAsTextDocument(document);
        return (
          <Box gap={3} testID={testID}>
            {fallback.blocks.map((block, index) => renderBlock(block, `blocks-${index}`))}
          </Box>
        );
      }
      return <BlocksError errors={parsed.errors} raw={document} testID={testID} />;
    }
    const validated = validateBlocks(parsed.value);
    if (!validated.ok) {
      return <BlocksError errors={validated.errors} raw={document} testID={testID} />;
    }
    return (
      <Box gap={3} testID={testID}>
        {validated.doc.blocks.map((block, index) => renderBlock(block, `blocks-${index}`))}
      </Box>
    );
  }

  const validated = validateBlocks(document);
  if (!validated.ok) {
    return <BlocksError errors={validated.errors} raw={rawOf(document)} testID={testID} />;
  }
  return (
    <Box gap={3} testID={testID}>
      {validated.doc.blocks.map((block, index) => renderBlock(block, `blocks-${index}`))}
    </Box>
  );
};
