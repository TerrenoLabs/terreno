import type {Block} from "@terreno/blocks";
import type React from "react";

import {Badge} from "../Badge";
import {Box} from "../Box";
import {Card} from "../Card";
import {Heading} from "../Heading";
import {MarkdownView} from "../MarkdownView";
import {SectionDivider} from "../SectionDivider";
import {Text} from "../Text";

const trendMark = {
  down: "▼",
  flat: "–",
  up: "▲",
} as const;

const renderChildren = (children: readonly Block[], path: string): React.ReactElement[] =>
  children.map((child, index) => renderBlock(child, `${path}-${index}`));

/** Renders one catalog block with @terreno/ui components. */
export const renderBlock = (block: Block, path: string): React.ReactElement => {
  switch (block.type) {
    case "heading":
      return (
        <Heading key={path} size={block.size} testID={path}>
          {block.text}
        </Heading>
      );
    case "text":
      return (
        <Box key={path} testID={path}>
          <MarkdownView>{block.markdown}</MarkdownView>
        </Box>
      );
    case "metric":
      return (
        <Card key={path} testID={path}>
          <Text size="sm">{block.label}</Text>
          <Heading>{block.value}</Heading>
          {block.delta || block.trend ? (
            <Text>{`${block.trend ? `${trendMark[block.trend]} ` : ""}${block.delta ?? ""}`}</Text>
          ) : null}
          {block.helper ? (
            <Text color="secondaryLight" size="sm">
              {block.helper}
            </Text>
          ) : null}
        </Card>
      );
    case "badge":
      return <Badge key={path} status={block.status ?? "info"} testID={path} value={block.text} />;
    case "divider":
      return (
        <Box key={path} testID={path}>
          <SectionDivider />
        </Box>
      );
    case "context":
      return (
        <Text color="secondaryLight" key={path} size="sm" testID={path}>
          {block.text}
        </Text>
      );
    case "columns":
      return (
        <Box direction="column" gap={3} key={path} mdDirection="row" testID={path}>
          {renderChildren(block.children, path)}
        </Box>
      );
    case "card":
      return (
        <Card key={path} testID={path}>
          {block.title ? <Heading size="sm">{block.title}</Heading> : null}
          {renderChildren(block.children, path)}
        </Card>
      );
    default:
      return <Box key={path} testID={path} />;
  }
};
